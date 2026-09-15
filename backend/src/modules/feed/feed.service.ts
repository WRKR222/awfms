import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { NotificationType, UserRole, FeedType } from '@prisma/client';
import { requiredFeedKg, withTolerance } from '../../common/feed/feed-standard.util';
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
    const safeDays = Number(days) > 0 ? Number(days) : 30;
    const from = dayjs().subtract(safeDays, 'day').toDate();
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
    // Threshold is now checked per-category inside the loop
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

      // Only include feed types that actually exist on the farm (have deliveries or usage)
      if (totalDelivered > 0 || totalUsed > 0) {
        results[ft] = {
          feedType: ft,
          currentStockKg: currentStock,
          avgDailyUsageKg: avgDailyUsage,
          daysRemaining: Math.round(daysRemaining * 10) / 10,
          isLow: currentStock <= await this.getAlertThreshold(ft),  // per-category kg threshold
        };
      }
    }
    return results;
  }

  /** Runs daily at 6AM — checks feed stock and fires alerts.
   *  NOTE: CHICK_MASH, GROWER_MASH, and LAYER_MASH low-feed alerts are
   *  intentionally suppressed — no notifications, no alertFired snapshots.
   *  Only KIENYEJI feed types will generate low-stock alerts.
   */
  @Cron('0 6 * * *')
  async checkFeedStockAlerts() {
    this.logger.log('Running daily feed stock check...');

    // Standard mash types for which low-stock alerts are DISABLED
    const ALERT_DISABLED_TYPES = new Set<string>([
      FeedType.CHICK_MASH,
      FeedType.GROWER_MASH,
      FeedType.LAYER_MASH,
    ]);

    const stocks = await this.getCurrentStock();

    for (const [feedType, stock] of Object.entries(stocks) as any) {
      // Skip alert for standard mash types — removed per product requirement
      if (ALERT_DISABLED_TYPES.has(feedType)) {
        this.logger.debug(`Feed alert suppressed for ${feedType} (disabled for standard mash types)`);
        continue;
      }

      const alertThreshold = await this.getAlertThreshold(feedType);
      if (stock.currentStockKg <= alertThreshold && stock.avgDailyUsageKg > 0) {
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

  async updateAlertThreshold(days: number, feedType?: string) {
    const value = String(Math.max(1, Math.min(9999, Math.round(days))));
    const key = feedType ? 'FEED_ALERT_THRESHOLD_' + feedType : 'FEED_ALERT_THRESHOLD_DAYS';
    await this.prisma.systemConfig.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    return { days: Number(value), feedType: feedType ?? 'ALL' };
  }

  async getAlertThresholdConfig() {
    // Threshold is now checked per-category inside the loop
    const thresholdVal = await this.getAlertThreshold();
    return { days: thresholdVal };
  }

  // ─── PRIVATE HELPERS ─────────────────────────────────────────────────────

  private getRecommendedIntake(
    birdCount: number,
    ageWeeks: number,
    feedType: FeedType,
  ): { min: number; max: number } {
    // Delegates to the shared feed-standard util (also used by BrooderService
    // for the brooder cage map) so production-house and brooder recommendations
    // never drift apart. Daily total = requiredFeedKg(..., days=1).
    const dailyKg = requiredFeedKg(birdCount, feedType, ageWeeks, 1);
    return withTolerance(dailyKg, 0.1);
  }

  private async getAlertThreshold(feedType?: string): Promise<number> {
    // Check per-category threshold first
    if (feedType) {
      const perCategory = await this.prisma.systemConfig.findUnique({
        where: { key: 'FEED_ALERT_THRESHOLD_' + feedType },
      });
      if (perCategory) return parseInt(perCategory.value, 10);
    }
    // Fall back to global threshold
    const config = await this.prisma.systemConfig.findUnique({
      where: { key: 'FEED_ALERT_THRESHOLD_DAYS' },
    });
    return config ? parseInt(config.value, 10) : 50;
  }
}

