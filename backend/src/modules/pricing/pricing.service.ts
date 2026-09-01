// backend/src/modules/pricing/pricing.service.ts
// CHANGE: Added pricePerEggBulk — applied when a STANDARD order/booking >= 330 eggs.
//         expectedRevenue on the pricing page = totalEggs (ALL eggs, not just good)
//         × pricePerEgg (standard rate, < 330).  Bulk rate is surfaced in
//         notifications and consumed by sales pages; it does NOT change the
//         expected-revenue calculation on this page (that remains a projection).
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestUser } from '../../auth/types/request-user.type';
import { NotificationType } from '@prisma/client';
import dayjs from 'dayjs';

// Threshold above which the bulk price applies (>= BULK_THRESHOLD)
export const STANDARD_BULK_THRESHOLD = 330;

// ─── DTO ──────────────────────────────────────────────────────────────────────
export interface SetDailyPriceDto {
  priceDate: string;
  pricePerEgg: number;              // Standard eggs, 1–329 per order
  pricePerEggBulk?: number;         // Standard eggs, >= 330 per order (optional)
  pricePerEggStarter?: number;
  pricePerEggBroken?: number;
  expectedRevenue?: number;
  notes?: string;
}

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  async setDailyPrice(dto: SetDailyPriceDto, user: RequestUser) {
    const existing = await this.prisma.dailyEggPrice.findUnique({
      where: { priceDate: new Date(dto.priceDate) },
    });

    const priceData = {
      pricePerEgg:        dto.pricePerEgg,
      pricePerEggBulk:    dto.pricePerEggBulk     ?? null,
      pricePerEggStarter: dto.pricePerEggStarter   ?? null,
      pricePerEggBroken:  dto.pricePerEggBroken    ?? null,
      expectedRevenue:    dto.expectedRevenue      ?? null,
      notes:              dto.notes               ?? null,
      setById:            user.id,
    };

    let savedPrice: any;
    if (existing) {
      savedPrice = await this.prisma.dailyEggPrice.update({
        where: { priceDate: new Date(dto.priceDate) },
        data: priceData,
      });
    } else {
      savedPrice = await this.prisma.dailyEggPrice.create({
        data: { priceDate: new Date(dto.priceDate), ...priceData },
      });
    }

    // ── Tally totals for notification ────────────────────────────────────────
    const priceDay = new Date(dto.priceDate);
    priceDay.setHours(0, 0, 0, 0);

    const tallies = await this.prisma.eggTallyVerification.findMany({
      where: { isLocked: true, session: { sessionDate: priceDay } },
      include: {
        session: {
          select: {
            totalGoodEggs: true, totalStarterEggs: true,
            totalBrokenSellable: true, totalBrokenUnsellable: true,
            totalSoftShell: true, totalDeformed: true, totalDamaged: true,
          },
        },
      },
    });

    // totalEggs = ALL egg categories (matches expectedRevenue calc on pricing page)
    const standardCount = tallies.reduce((sum, t) => {
      const s = t.session as any;
      if (!s) return sum;
      return sum
        + (s.totalGoodEggs         ?? 0)
        + (s.totalStarterEggs      ?? 0)
        + (s.totalBrokenSellable   ?? 0)
        + (s.totalBrokenUnsellable ?? 0)
        + (s.totalSoftShell        ?? 0)
        + (s.totalDeformed         ?? 0)
        + (s.totalDamaged          ?? 0);
    }, 0);

    const dateLabel   = dayjs(dto.priceDate).format('D MMM YYYY');
    const expectedKes = dto.expectedRevenue
      ? `KES ${Number(dto.expectedRevenue).toLocaleString()}`
      : 'not yet calculated';

    const bulkLine = dto.pricePerEggBulk
      ? `, Bulk (≥${STANDARD_BULK_THRESHOLD}): KES ${Number(dto.pricePerEggBulk).toFixed(2)}/egg`
      : '';

    // ── Owner notification ────────────────────────────────────────────────────
    const owners = await this.prisma.user.findMany({
      where: { role: 'OWNER', isActive: true }, select: { id: true },
    });
    for (const o of owners) {
      await this.prisma.notification.create({
        data: {
          userId:     o.id,
          type:       NotificationType.PRICING_SET,
          title:      `Revenue Projection — ${dateLabel}`,
          message:    `Egg prices set. Expected revenue: ${expectedKes}. ` +
                      `Standard: KES ${Number(dto.pricePerEgg).toFixed(2)}/egg` +
                      bulkLine +
                      (dto.pricePerEggStarter ? `, Starter: KES ${Number(dto.pricePerEggStarter).toFixed(2)}/egg` : '') +
                      (dto.pricePerEggBroken  ? `, Consumable Broken: KES ${Number(dto.pricePerEggBroken).toFixed(2)}/egg` : '') + '.',
          entityId:   savedPrice.id,
          entityType: 'DailyEggPrice',
        },
      });
    }

    // ── Sales notification ────────────────────────────────────────────────────
    const salesUsers = await this.prisma.user.findMany({
      where: { role: 'SALES', isActive: true }, select: { id: true },
    });
    for (const s of salesUsers) {
      const stockLines: string[] = [];
      stockLines.push(
        `Standard: ${standardCount} eggs (${Math.floor(standardCount / 30)} trays) ` +
        `@ KES ${Number(dto.pricePerEgg).toFixed(2)}/egg (1–${STANDARD_BULK_THRESHOLD - 1})` +
        (dto.pricePerEggBulk
          ? ` · KES ${Number(dto.pricePerEggBulk).toFixed(2)}/egg (≥${STANDARD_BULK_THRESHOLD})`
          : ''),
      );
      if (dto.pricePerEggStarter) {
        stockLines.push(`Starter: @ KES ${Number(dto.pricePerEggStarter).toFixed(2)}/egg`);
      }
      if (dto.pricePerEggBroken) {
        stockLines.push(`Consumable Broken: @ KES ${Number(dto.pricePerEggBroken).toFixed(2)}/egg`);
      }

      await this.prisma.notification.create({
        data: {
          userId:     s.id,
          type:       NotificationType.PRICING_SET,
          title:      `Egg Stock & Prices Ready — ${dateLabel}`,
          message:    stockLines.join('. ') +
                      (dto.expectedRevenue ? `. Expected revenue: ${expectedKes}.` : '') +
                      ' You may now create orders.',
          entityId:   savedPrice.id,
          entityType: 'DailyEggPrice',
        },
      });
    }

    // ── Recalculate DailyEggAggregate.expectedRevenueKes after price save ──────
    // The Director dashboard reads expectedRevenueKes from the aggregate.
    // If the accountant sets/updates price AFTER the tally is locked, the
    // aggregate still holds the stale value from lock-time. Recalculate here
    // so the dashboard always shows: locked tally eggs × current price.
    await this.recalcAggregateRevenue(
      new Date(dto.priceDate),
      dto.pricePerEgg,
      dto.pricePerEggStarter ?? null,
      dto.pricePerEggBroken  ?? null,
    );

    return savedPrice;
  }

  // Recalculate expectedRevenueKes whenever the accountant saves/updates a price.
  // Two paths:
  //   A) DailyEggAggregate rows exist (both AM+PM locked) → update stored value.
  //   B) No aggregate yet (only one session cosigned so far) → update the
  //      locked EggTallyVerification rows for that date so the Sales and Director
  //      dashboards can read revenue directly from the tally until the aggregate
  //      is written when the second session locks.
  private async recalcAggregateRevenue(
    priceDate: Date,
    pricePerEgg: number,
    pricePerEggStarter: number | null,
    pricePerEggBroken:  number | null,
  ): Promise<void> {
    // ── Path A: update DailyEggAggregate rows ────────────────────────────────
    const aggregates = await this.prisma.dailyEggAggregate.findMany({
      where: { aggregateDate: priceDate },
    });

    if (aggregates.length) {
      await Promise.all(
        aggregates.map(agg => {
          const expectedRevenueKes =
            agg.totalStdEggs          * pricePerEgg +
            agg.totalStarterEggs      * (pricePerEggStarter ?? 0) +
            agg.totalBrokenSellable   * (pricePerEggBroken  ?? 0);

          return this.prisma.dailyEggAggregate.update({
            where: { id: agg.id },
            data:  { expectedRevenueKes },
          });
        }),
      );
      return; // aggregate is authoritative — no need to touch tally rows
    }

    // ── Path B: no aggregate yet — update locked tally rows for the date ─────
    // This keeps expectedRevenueKes fresh on tally rows used as the interim
    // source by getSalesStock and the Director dashboard until the second session
    // cosigns and DailyEggAggregate is written.
    const tallies = await this.prisma.eggTallyVerification.findMany({
      where: {
        isLocked: true,
        session: { sessionDate: priceDate, status: 'APPROVED' },
      },
      include: {
        session: {
          select: {
            totalGoodEggs:        true,
            totalStarterEggs:     true,
            totalBrokenSellable:  true,
          },
        },
      },
    });

    if (!tallies.length) return;

    await Promise.all(
      tallies.map(t => {
        const s = t.session as any;
        if (!s) return Promise.resolve();
        const expectedRevenueKes =
          (s.totalGoodEggs       ?? 0) * pricePerEgg +
          (s.totalStarterEggs    ?? 0) * (pricePerEggStarter ?? 0) +
          (s.totalBrokenSellable ?? 0) * (pricePerEggBroken  ?? 0);

        return this.prisma.eggTallyVerification.update({
          where: { id: t.id },
          data:  { expectedRevenueKes },
        });
      }),
    );
  }

  async getTodayPrice() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return this.prisma.dailyEggPrice.findUnique({ where: { priceDate: today } });
  }

  async getPriceHistory(limit = 30) {
    return this.prisma.dailyEggPrice.findMany({
      orderBy: { priceDate: 'desc' },
      take: limit,
      include: { setBy: { select: { fullName: true, username: true } } },
    });
  }

  async getPriceForDate(date: string) {
    const price = await this.prisma.dailyEggPrice.findUnique({
      where: { priceDate: new Date(date) },
    });
    if (!price) throw new NotFoundException(`No price set for ${date}`);
    return price;
  }
}
