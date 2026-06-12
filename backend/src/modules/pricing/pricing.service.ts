// backend/src/modules/pricing/pricing.service.ts
// FIX-01 (already fixed): pricePerEgg / pricePerEggBroken field names correct.
// FIX-03: After saving prices, query the locked tally to get per-category
//         egg counts and include them in the Sales notification.
//         This implements the "sendExpectedStock()" step from the Sequence Diagram.
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestUser } from '../../auth/types/request-user.type';
import dayjs from 'dayjs';

// ─── DTO (field names match DailyEggPrice Prisma model & DB schema) ──────────
export interface SetDailyPriceDto {
  priceDate: string;
  pricePerEgg: number;              // Standard / Production House eggs
  pricePerEggStarter?: number;      // Starter eggs (optional — 0 if not set)
  pricePerEggBroken?: number;       // Consumable broken / sellable broken eggs
  expectedRevenue?: number;
  notes?: string;
}

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  async setDailyPrice(dto: SetDailyPriceDto, user: RequestUser) {
    // Upsert the daily price record
    const existing = await this.prisma.dailyEggPrice.findUnique({
      where: { priceDate: new Date(dto.priceDate) },
    });

    let savedPrice: any;
    if (existing) {
      savedPrice = await this.prisma.dailyEggPrice.update({
        where: { priceDate: new Date(dto.priceDate) },
        data: {
          pricePerEgg:        dto.pricePerEgg,
          pricePerEggStarter: dto.pricePerEggStarter ?? null,
          pricePerEggBroken:  dto.pricePerEggBroken  ?? null,
          expectedRevenue:    dto.expectedRevenue    ?? null,
          notes:              dto.notes              ?? null,
          setById:            user.id,
        },
      });
    } else {
      savedPrice = await this.prisma.dailyEggPrice.create({
        data: {
          priceDate:          new Date(dto.priceDate),
          pricePerEgg:        dto.pricePerEgg,
          pricePerEggStarter: dto.pricePerEggStarter ?? null,
          pricePerEggBroken:  dto.pricePerEggBroken  ?? null,
          expectedRevenue:    dto.expectedRevenue    ?? null,
          notes:              dto.notes              ?? null,
          setById:            user.id,
        },
      });
    }

    // ── Sequence Diagram — sendRevenueProjection() + sendExpectedStock() ──
    // Total collected eggs = AM totalEggs + PM totalEggs, where per-session:
    //   totalEggs = totalGoodEggs + totalStarterEggs + totalBrokenSellable
    //             + totalBrokenUnsellable + totalSoftShell + totalDeformed
    const priceDay = new Date(dto.priceDate);
    priceDay.setHours(0, 0, 0, 0);

    const tallies = await this.prisma.eggTallyVerification.findMany({
      where: { isLocked: true, session: { sessionDate: priceDay } },
      include: {
        session: {
          select: {
            totalGoodEggs: true, totalStarterEggs: true,
            totalBrokenSellable: true, totalBrokenUnsellable: true,
            totalSoftShell: true, totalDeformed: true,
          },
        },
      },
    });

    // FIX: Derive per-category egg counts from the locked tally sessions.
    // The cosigned tally is the single source of truth for what stock was
    // forwarded to the sales person — standardCount = good eggs only.
    const standardCount = tallies.reduce((sum, t) => {
      const s = t.session as any;
      if (!s) return sum;
      return sum + (s.totalGoodEggs ?? 0);
    }, 0);
    const starterCount = tallies.reduce((sum, t) => {
      const s = t.session as any;
      if (!s) return sum;
      return sum + (s.totalStarterEggs ?? 0);
    }, 0);
    const brokenCount = tallies.reduce((sum, t) => {
      const s = t.session as any;
      if (!s) return sum;
      return sum + (s.totalBrokenSellable ?? 0);
    }, 0);
    const dateLabel       = dayjs(dto.priceDate).format('D MMM YYYY');
    const expectedKes     = dto.expectedRevenue
      ? `KES ${Number(dto.expectedRevenue).toLocaleString()}`
      : 'not yet calculated';

    // Notify OWNER (Director) — Revenue Projection
    const owners = await this.prisma.user.findMany({
      where: { role: 'OWNER', isActive: true }, select: { id: true },
    });
    for (const o of owners) {
      await this.prisma.notification.create({
        data: {
          userId:     o.id,
          type:       'PRICING_SET' as any,
          title:      `Revenue Projection — ${dateLabel}`,
          message:    `Egg prices set. Expected revenue: ${expectedKes}. ` +
                      `Standard: KES ${Number(dto.pricePerEgg).toFixed(2)}/egg` +
                      (dto.pricePerEggStarter ? `, Starter: KES ${Number(dto.pricePerEggStarter).toFixed(2)}/egg` : '') +
                      (dto.pricePerEggBroken  ? `, Consumable Broken: KES ${Number(dto.pricePerEggBroken).toFixed(2)}/egg`  : '') + '.',
          entityId:   savedPrice.id,
          entityType: 'DailyEggPrice',
        },
      });
    }

    // Notify SALES — Expected Stock per Category (sendExpectedStock from sequence diagram)
    // Includes both the prices AND the available egg counts per category
    const salesUsers = await this.prisma.user.findMany({
      where: { role: 'SALES', isActive: true }, select: { id: true },
    });
    for (const s of salesUsers) {
      const stockLines: string[] = [];
      stockLines.push(`Standard: ${standardCount} eggs (${Math.floor(standardCount / 30)} trays) @ KES ${Number(dto.pricePerEgg).toFixed(2)}/egg`);
      if (starterCount > 0 || dto.pricePerEggStarter) {
        stockLines.push(`Starter: ${starterCount} eggs @ KES ${Number(dto.pricePerEggStarter ?? 0).toFixed(2)}/egg`);
      }
      if (brokenCount > 0 || dto.pricePerEggBroken) {
        stockLines.push(`Consumable Broken: ${brokenCount} eggs @ KES ${Number(dto.pricePerEggBroken ?? 0).toFixed(2)}/egg`);
      }

      await this.prisma.notification.create({
        data: {
          userId:     s.id,
          type:       'PRICING_SET' as any,
          title:      `Egg Stock & Prices Ready — ${dateLabel}`,
          message:    stockLines.join('. ') +
                      (dto.expectedRevenue ? `. Expected revenue: ${expectedKes}.` : '') +
                      ' You may now create orders.',
          entityId:   savedPrice.id,
          entityType: 'DailyEggPrice',
        },
      });
    }
    // ── END FIX-03 ────────────────────────────────────────────────────────────

    return savedPrice;
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
