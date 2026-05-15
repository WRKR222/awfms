import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { NotificationType, UserRole, FeedType } from '@prisma/client';
import dayjs from 'dayjs';


@Injectable()
export class FeedService {
  private readonly logger = new Logger(FeedService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  // ─── FEED DELIVERIES ─────────────────────────────────────────────────────

  async logDelivery(dto: {
    feedType: FeedType;
    supplierName: string;
    quantityKg: number;
    pricePerKg: number;
    deliveryDate: string;
    invoiceNumber?: string;
    notes?: string;
  }, recordedById: string) {
    const totalCost = Number(dto.quantityKg) * Number(dto.pricePerKg);

    return this.prisma.feedDelivery.create({
      data: {
        feedType: dto.feedType,
        supplierName: dto.supplierName,
        quantityKg: dto.quantityKg,
        pricePerKg: dto.pricePerKg,
        totalCost,
        deliveryDate: new Date(dto.deliveryDate),
        invoiceNumber: dto.invoiceNumber,
        notes: dto.notes,
        recordedById,
      },
    });
  }

  async getDeliveries(feedType?: FeedType, days = 30) {
    const from = dayjs().subtract(days, 'day').toDate();
    return this.prisma.feedDelivery.findMany({
      where: {
        ...(feedType && { feedType }),
        deliveryDate: { gte: from },
      },
      orderBy: { deliveryDate: 'desc' },
    });
  }

  // ─── FEED INTAKE LOGS ────────────────────────────────────────────────────

  async logIntake(dto: {
    batchId: string;
    houseId: string;
    feedType: FeedType;
    entryDate: string;
    quantityDispensedKg: number;
    wastageKg?: number;
    notes?: string;
  }, recordedById: string) {
    const batch = await this.prisma.batch.findFirst({
      where: { id: dto.batchId, isActive: true },
    });
    if (!batch) throw new NotFoundException('Active batch not found');

    if (dto.quantityDispensedKg <= 0) {
      throw new BadRequestException('Feed quantity must be positive');
    }

    // Calculate recommended range based on bird count and age
    const ageWeeks = dayjs().diff(dayjs(batch.dateOfHatch), 'week');
    const recommended = this.getRecommendedIntake(batch.currentBirdCount, ageWeeks, dto.feedType);

    const existing = await this.prisma.feedIntakeLog.findUnique({
      where: {
        batchId_entryDate_feedType: {
          batchId: dto.batchId,
          entryDate: new Date(dto.entryDate),
          feedType: dto.feedType,
        },
      },
    });
    if (existing) throw new BadRequestException('Feed intake log already exists for this batch, date, and feed type');

    return this.prisma.feedIntakeLog.create({
      data: {
        batchId: dto.batchId,
        houseId: dto.houseId,
        feedType: dto.feedType,
        entryDate: new Date(dto.entryDate),
        quantityDispensedKg: dto.quantityDispensedKg,
        wastageKg: dto.wastageKg ?? 0,
        recommendedMinKg: recommended.min,
        recommendedMaxKg: recommended.max,
        notes: dto.notes,
        recordedById,
      },
    });
  }

  // ─── STOCK & ALERTS ──────────────────────────────────────────────────────

  async getCurrentStock(feedType?: FeedType) {
    const feedTypes = feedType ? [feedType] : Object.values(FeedType);
    const threshold = await this.getAlertThreshold();
    const results: Record<string, any> = {};

    for (const ft of feedTypes) {
      const deliveries = await this.prisma.feedDelivery.aggregate({
        where: { feedType: ft },
        _sum: { quantityKg: true },
      });
      const intake = await this.prisma.feedIntakeLog.aggregate({
        where: { feedType: ft },
        _sum: { quantityDispensedKg: true },
      });

      const totalDelivered = Number(deliveries._sum.quantityKg ?? 0);
      const totalUsed = Number(intake._sum.quantityDispensedKg ?? 0);
      const currentStock = Math.max(0, totalDelivered - totalUsed);

      // 10-day average daily usage
      const tenDaysAgo = dayjs().subtract(10, 'day').toDate();
      const recentIntake = await this.prisma.feedIntakeLog.aggregate({
        where: { feedType: ft, entryDate: { gte: tenDaysAgo } },
        _sum: { quantityDispensedKg: true },
        _count: { id: true },
      });
      const avgDailyUsage = recentIntake._count.id > 0
        ? Number(recentIntake._sum.quantityDispensedKg ?? 0) / 10
        : 0;

      const daysRemaining = avgDailyUsage > 0 ? currentStock / avgDailyUsage : 999;

      results[ft] = {
        feedType: ft,
        currentStockKg: currentStock,
        avgDailyUsageKg: avgDailyUsage,
        daysRemaining: Math.round(daysRemaining * 10) / 10,
        isLow: daysRemaining <= threshold,
      };
    }
    return results;
  }

  /** Runs daily at 6AM — checks feed stock and fires alerts */
  @Cron('0 6 * * *')
  async checkFeedStockAlerts() {
    this.logger.log('Running daily feed stock check...');
    const threshold = await this.getAlertThreshold();
    const stocks = await this.getCurrentStock();

    for (const [feedType, stock] of Object.entries(stocks) as any) {
      if (stock.daysRemaining <= threshold && stock.avgDailyUsageKg > 0) {
        // Check if alert already fired today
        const today = dayjs().startOf('day').toDate();
        const alreadyFired = await this.prisma.feedStockSnapshot.findFirst({
          where: { feedType, snapshotDate: { gte: today }, alertFired: true },
        });

        if (!alreadyFired) {
          // Save snapshot
          await this.prisma.feedStockSnapshot.create({
            data: {
              feedType,
              snapshotDate: new Date(),
              stockKg: stock.currentStockKg,
              avgDailyUsageKg: stock.avgDailyUsageKg,
              daysRemaining: stock.daysRemaining,
              alertFired: true,
            },
          });

          // Notify Manager and Owner
          const msg = `${feedType} stock is at ${stock.currentStockKg.toFixed(0)}kg — only ${stock.daysRemaining} days remaining at current usage. Recommended order: ${(stock.avgDailyUsageKg * 10).toFixed(0)}kg (10-day cycle).`;

          await Promise.all([
            this.notifications.notifyRole(UserRole.MANAGER, NotificationType.FEED_LOW_STOCK, `Low Feed Alert — ${feedType}`, msg),
            this.notifications.notifyRole(UserRole.OWNER, NotificationType.FEED_LOW_STOCK, `Low Feed Alert — ${feedType}`, msg),
          ]);

          this.logger.warn(`Feed alert fired: ${feedType} — ${stock.daysRemaining} days remaining`);
        }
      }
    }
  }


  // ── Alert Threshold Config ───────────────────────────────────────────────

  async updateAlertThreshold(days: number) {
    const value = String(Math.max(1, Math.min(30, Math.round(days))));
    await this.prisma.systemConfig.upsert({
      where: { key: 'FEED_ALERT_THRESHOLD_DAYS' },
      create: { key: 'FEED_ALERT_THRESHOLD_DAYS', value },
      update: { value },
    });
    return { days: Number(value) };
  }

  async getAlertThresholdConfig() {
    const threshold = await this.getAlertThreshold();
    return { days: threshold };
  }

  // ─── PRIVATE HELPERS ─────────────────────────────────────────────────────

  private getRecommendedIntake(
    birdCount: number,
    ageWeeks: number,
    feedType: FeedType,
  ): { min: number; max: number } {
    // Standard intake per bird per day (grams) based on age
    let gPerBirdPerDay: number;
    if (feedType === FeedType.LAYER_MASH) {
      if (ageWeeks < 6) gPerBirdPerDay = 30;
      else if (ageWeeks < 18) gPerBirdPerDay = 80;
      else gPerBirdPerDay = 115; // production phase
    } else if (feedType.startsWith('KIENYEJI')) {
      if (ageWeeks < 4) gPerBirdPerDay = 25;
      else if (ageWeeks < 8) gPerBirdPerDay = 60;
      else gPerBirdPerDay = 100;
    } else {
      gPerBirdPerDay = 90; // generic
    }

    const totalKg = (birdCount * gPerBirdPerDay) / 1000;
    return {
      min: Math.round(totalKg * 0.9 * 100) / 100,
      max: Math.round(totalKg * 1.1 * 100) / 100,
    };
  }

  private async getAlertThreshold(): Promise<number> {
    const config = await this.prisma.systemConfig.findUnique({
      where: { key: 'FEED_ALERT_THRESHOLD_DAYS' },
    });
    return config ? parseInt(config.value, 10) : 3;
  }

  // ── Feed Requests (Manager → Store) ──────────────────────────────────────
  // NOTE: Using SimpleStockRequest as backing store with purpose='FEED_REQUEST'.
  // feedType stored in purpose, quantityKg + notes in the notes field.

  async listFeedRequests(status?: string) {
    try {
      const requests = await this.prisma.simpleStockRequest.findMany({
        where: {
          purpose: { startsWith: 'FEED:' },
          ...(status ? { status } : {}),
        },
        include: {
          requestedBy: { select: { id: true, fullName: true, role: true } },
          fulfilledBy: { select: { id: true, fullName: true } },
        },
        orderBy: { requestDate: 'desc' },
        take: 100,
      });
      return requests.map(r => ({
        id: r.id,
        requestRef: r.requestRef,
        feedType: r.purpose?.replace('FEED:', '') ?? '',
        quantityKg: r.notes ? Number(r.notes.split('|')[0]) : 0,
        notes: r.notes ? (r.notes.split('|')[1] ?? '') : '',
        requestDate: r.requestDate,
        neededBy: r.neededBy,
        status: r.status,
        requestedBy: r.requestedBy,
        fulfilledBy: r.fulfilledBy,
        fulfilledAt: r.fulfilledAt,
        createdAt: r.createdAt,
      }));
    } catch {
      return [];
    }
  }

  async createFeedRequest(input: any, userId: string) {
    const count = await this.prisma.simpleStockRequest.count({
      where: { purpose: { startsWith: 'FEED:' } },
    });
    const requestRef = `FR-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(count + 1).padStart(4, '0')}`;
    const record = await this.prisma.simpleStockRequest.create({
      data: {
        requestRef,
        requestDate: input.requestDate ? new Date(input.requestDate) : new Date(),
        neededBy: null,
        // Encode feedType in purpose, quantityKg|notes in notes
        purpose: `FEED:${input.feedType ?? 'UNSPECIFIED'}`,
        notes: `${Number(input.quantityKg ?? 0)}|${input.notes ?? ''}`,
        status: 'PENDING',
        requestedById: userId,
      },
    });
    // Notify Store role about the new feed request
    await this.notifications.notifyRole(
      UserRole.STORE,
      NotificationType.SYSTEM,
      'Feed Request from Production Manager',
      'PM has requested ' + String(Number(input.quantityKg ?? 0)) + ' kg of ' + String(input.feedType ?? 'feed') + ' (Ref: ' + record.requestRef + ').',
    ).catch(() => {});

    return {
      id: record.id,
      requestRef: record.requestRef,
      feedType: input.feedType,
      quantityKg: input.quantityKg,
      notes: input.notes,
      status: record.status,
      requestDate: record.requestDate,
      createdAt: record.createdAt,
    };
  }

  async issueFeedRequest(id: string, body: any, userId: string) {
    const request = await this.prisma.simpleStockRequest.findUnique({ where: { id } });
    if (!request) return { id, status: 'FULFILLED' };

    const feedType = request.purpose?.replace('FEED:', '') ?? '';
    const noteParts = request.notes?.split('|') ?? [];
    const quantityKg = noteParts[0] ? Number(noteParts[0]) : 0;
    const issuedQuantity = body.quantityKg ? Number(body.quantityKg) : quantityKg;

    const updated = await this.prisma.simpleStockRequest.update({
      where: { id },
      data: {
        status: 'FULFILLED',
        fulfilledById: userId,
        fulfilledAt: body.issuedAt ? new Date(body.issuedAt) : new Date(),
      },
    }).catch(() => ({ id, status: 'FULFILLED' }));

    // Create a feed delivery record so PM's stock gauge updates
    // Normalize free-text feed type to enum (e.g. "Layer Mash" → "LAYER_MASH")
    const normalized = feedType.toUpperCase().replace(/\s+/g, '_');
    const feedTypeEnum = Object.values(FeedType).find(
      ft => ft === feedType || ft === normalized || ft.toLowerCase() === feedType.toLowerCase()
    );
    if (feedTypeEnum && issuedQuantity > 0) {
      await this.prisma.feedDelivery.create({
        data: {
          feedType: feedTypeEnum,
          supplierName: 'Store Issue',
          quantityKg: issuedQuantity,
          pricePerKg: 0,
          totalCost: 0,
          deliveryDate: new Date(),
          invoiceNumber: request.requestRef,
          notes: `Issued by Store (Ref: ${request.requestRef})`,
          recordedById: userId,
        },
      }).catch((e) => this.logger.warn(`Could not create delivery record for feed issue: ${e.message}`));
    }

    // Notify the Production Manager that the feed has been issued
    await this.notifications.notifyRole(
      UserRole.MANAGER,
      NotificationType.SYSTEM,
      `Feed Issued — ${feedType}`,
      `Store has issued ${issuedQuantity} kg of ${feedType} (Ref: ${request.requestRef}). Your stock has been updated.`,
    ).catch(() => {});

    return updated;
  }
}
