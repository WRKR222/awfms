import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OrderStatus, PaymentMethod } from '@prisma/client';
import { RequestUser } from '../../auth/types/request-user.type';
import dayjs from 'dayjs';
import { FinanceService } from '../finance/finance.service';

type EggItemType = 'STANDARD_EGGS' | 'STARTER_EGGS' | 'CONSUMABLE_BROKEN_EGGS';

@Injectable()
export class SalesService {
  constructor(
    private prisma: PrismaService,
    private financeService: FinanceService,
  ) {}

  async getCustomers() {
    return this.prisma.customer.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, phone: true, email: true, address: true, creditDays: true },
    });
  }

  async createCustomer(dto: {
    name: string; phone?: string; email?: string; address?: string; creditDays?: number;
  }) {
    return this.prisma.customer.create({
      data: {
        name: dto.name, phone: dto.phone, email: dto.email, address: dto.address,
        creditDays: dto.creditDays ?? 0,
      },
    });
  }

  async getOrders(days = 30, status?: string) {
    const safeDays = Number(days) > 0 ? Number(days) : 30;
    const from = dayjs().subtract(safeDays, 'day').toDate();
    return this.prisma.salesOrder.findMany({
      where: {
        deletedAt: null,
        orderDate: { gte: from },
        ...(status && { status: status as OrderStatus }),
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        items: true,
      },
      orderBy: { orderDate: 'desc' },
    });
  }

  async createOrder(dto: {
    customerId: string;
    orderDate: string;
    paymentMethod: 'CASH' | 'MPESA' | 'BANK' | 'CREDIT';
    deliveryAddress?: string;
    deliveryDate?: string;
    deliveryTime?: string;
    requiresDelivery?: boolean;
    notes?: string;
    items: Array<{ eggType: EggItemType; quantityEggs: number; }>;
  }, createdById: string) {
    const count = await this.prisma.salesOrder.count();
    const orderNumber = `SO-${dayjs().format('YYYYMMDD')}-${String(count + 1).padStart(4, '0')}`;

    // Auto-fetch today's pricing (set by accountant)
    const today = dayjs().format('YYYY-MM-DD');
    const pricing = await this.prisma.dailyEggPrice.findUnique({ where: { priceDate: new Date(today) } });
    if (!pricing) throw new BadRequestException('No pricing set for today. Accountant must set daily prices before orders can be created.');

    const priceMap: Record<EggItemType, number | null> = {
      STANDARD_EGGS:          Number(pricing.pricePerEgg),
      STARTER_EGGS:           pricing.pricePerEggStarter != null ? Number(pricing.pricePerEggStarter) : null,
      CONSUMABLE_BROKEN_EGGS: pricing.pricePerEggBroken  != null ? Number(pricing.pricePerEggBroken)  : null,
    };

    const items = dto.items.map(i => {
      const unitPrice = priceMap[i.eggType];
      if (unitPrice == null) throw new BadRequestException(`No price set for ${i.eggType}. Ask the accountant to set it.`);
      const quantityTrays = Math.ceil(i.quantityEggs / 30);
      return {
        itemType:     i.eggType,
        grade:        null as string | null,
        quantityTrays,
        quantityEggs: i.quantityEggs,
        unitPrice,
        subtotal:     i.quantityEggs * unitPrice,
      };
    });
    const subtotal = items.reduce((s, i) => s + i.subtotal, 0);

    return this.prisma.salesOrder.create({
      data: {
        orderNumber,
        customerId: dto.customerId,
        orderDate: new Date(dto.orderDate),
        paymentMethod: (dto.paymentMethod ?? 'CASH') as PaymentMethod,
        subtotal,
        deliveryAddress: dto.requiresDelivery ? (dto.deliveryAddress ?? null) : null,
        notes: dto.notes,
        createdById,
        tier: 'TIER_1' as any,  // schema still has SalesTier; provide default until column is dropped
        items: { create: items },
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        items: true,
      },
    });
  }

  async getSummary(days = 30) {
    const from = dayjs().subtract(days, 'day').toDate();
    const orders = await this.prisma.salesOrder.findMany({
      where: { deletedAt: null, orderDate: { gte: from }, status: { not: 'CANCELLED' as OrderStatus } },
      include: { items: true },
    });
    const totalRevenue = orders.reduce((s, o) => s + Number(o.subtotal), 0);
    const totalTrays = orders.reduce(
      (s, o) => s + o.items.reduce((a, i) => a + (i.quantityTrays ?? 0), 0), 0,
    );
    const avgPerTray = totalTrays > 0 ? totalRevenue / totalTrays : 0;
    return { totalRevenue, totalTrays, avgPerTray, orderCount: orders.length };
  }

  async confirmOrder(orderId: string, userId: string) {
    const order = await this.prisma.salesOrder.update({
      where: { id: orderId },
      data: { status: 'CONFIRMED' as OrderStatus, confirmedAt: new Date() },
      include: { customer: true, items: true },
    });
    await this.financeService.generateInvoiceForOrder(orderId, userId);
    return order;
  }

  // ── Delivery ────────────────────────────────────────────────────────────────

  async markOrderDelivered(id: string, notes: string, user: RequestUser) {
    const order = await this.prisma.salesOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== ('DELIVERING' as OrderStatus)) {
      throw new BadRequestException('Only DELIVERING orders can be marked as delivered');
    }
    return this.prisma.salesOrder.update({
      where: { id },
      data: {
        status: 'DELIVERED' as OrderStatus,
        deliveryNotes: notes ?? null,
        deliveredAt: new Date(),
        deliveredById: user.id,
      },
    });
  }

  // ── Breakage Adjustments ────────────────────────────────────────────────────

  async listBreakageAdjustments(userId?: string) {
    return this.prisma.eggBreakageAdjustment.findMany({
      include: {
        reportedBy: { select: { fullName: true } },
      },
      orderBy: { adjustmentDate: 'desc' },
      take: 100,
    });
  }

  async createBreakageAdjustment(dto: {
    adjustmentDate: string;
    adjustmentType: string;
    tallySessionId?: string;
    quantityStandardBefore: number;
    quantityStarterBefore: number;
    quantityNonConsumableBefore: number;
    quantityConsumableBefore: number;
    newNonConsumable: number;
    newConsumable: number;
    notes?: string;
  }, user: RequestUser) {
    const count = await this.prisma.eggBreakageAdjustment.count();
    const adjustmentRef = `BA-${dayjs().format('YYYYMMDD')}-${String(count + 1).padStart(4, '0')}`;

    const quantityDiff =
      (dto.newNonConsumable - dto.quantityNonConsumableBefore) +
      (dto.newConsumable    - dto.quantityConsumableBefore);

    const adjustment = await this.prisma.eggBreakageAdjustment.create({
      data: {
        adjustmentRef,
        adjustmentDate:              new Date(dto.adjustmentDate),
        adjustmentType:              dto.adjustmentType,
        tallySessionId:              dto.tallySessionId ?? null,
        quantityStandardBefore:      dto.quantityStandardBefore,
        quantityStarterBefore:       dto.quantityStarterBefore,
        quantityNonConsumableBefore: dto.quantityNonConsumableBefore,
        quantityConsumableBefore:    dto.quantityConsumableBefore,
        newNonConsumable:            dto.newNonConsumable,
        newConsumable:               dto.newConsumable,
        quantityDiff,
        notes:                       dto.notes ?? null,
        reportedById:                user.id,
      },
      include: { reportedBy: { select: { fullName: true } } },
    });

    // Auto-log breakage as an ExpenseLog on the accountant's Finance → Expenses tab
    // Formula per spec:
    //   broken unsellable: costPerEgg × qty  (no revenue recovered)
    //   broken sellable:   (costPerEgg − pricePerEggBroken) × qty
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const pricing = await this.prisma.dailyEggPrice.findUnique({ where: { priceDate: today } });
      const costPerEgg        = pricing?.pricePerEgg       ? Number(pricing.pricePerEgg)       : 0;
      const pricePerEggBroken = pricing?.pricePerEggBroken ? Number(pricing.pricePerEggBroken) : 0;

      const deltaUnsellable = dto.newNonConsumable - dto.quantityNonConsumableBefore;
      const deltaSellable   = dto.newConsumable    - dto.quantityConsumableBefore;

      const unsellableLoss = Math.max(0, deltaUnsellable) * costPerEgg;
      const sellableLoss   = Math.max(0, deltaSellable)   * Math.max(0, costPerEgg - pricePerEggBroken);
      const totalLoss      = unsellableLoss + sellableLoss;

      if (totalLoss > 0) {
        // Ensure "Egg Breakage" category exists (idempotent)
        let cat = await this.prisma.expenseCategory.findUnique({ where: { name: 'Egg Breakage' } });
        if (!cat) {
          cat = await this.prisma.expenseCategory.create({
            data: { name: 'Egg Breakage', description: 'Auto-logged egg breakage losses', createdById: user.id },
          });
        }

        await this.prisma.expenseLog.create({
          data: {
            categoryId:   cat.id,
            description:
              `Egg breakage — Ref: ${adjustmentRef}. ` +
              (deltaUnsellable > 0 ? `Unsellable: ${deltaUnsellable} x KES ${costPerEgg.toFixed(2)}. ` : '') +
              (deltaSellable   > 0 ? `Sellable: ${deltaSellable} x KES ${(costPerEgg - pricePerEggBroken).toFixed(2)} (cost minus sell). ` : ''),
            amount:       totalLoss,
            expenseDate:  today,
            vendorName:   null,
            receiptRef:   adjustmentRef,
            recordedById: user.id,
          },
        });
      }

      // Notify accountant
      const accountant = await this.prisma.user.findFirst({ where: { role: 'ACCOUNTANT' as any, isActive: true } });
      if (accountant) {
        await this.prisma.notification.create({
          data: {
            userId:     accountant.id,
            type:       'SYSTEM' as any,
            title:      'Egg Breakage Expense Logged',
            message:    `Breakage ${adjustmentRef}: KES ${totalLoss.toFixed(2)} auto-logged as expense (${Math.max(0, deltaUnsellable)} unsellable, ${Math.max(0, deltaSellable)} sellable broken eggs).`,
            entityId:   adjustment.id,
            entityType: 'EggBreakageAdjustment',
          },
        });
      }
    } catch (_) { /* best-effort */ }

    return adjustment;
  }

  // ── Sales Stock ────────────────────────────────────────────────────────────
  // Returns an egg stock snapshot built from the DailyEggAggregate table, which
  // holds the correct AM+PM combined totals written once BOTH session tallies are
  // fully signed and locked. Falling back to the single latest locked tally only
  // when no aggregate exists yet (e.g. first day of operation).
  //
  // BUG that was here: previously read only the single latest locked
  // eggTallyVerification row, so Sales saw only one session's eggs (whichever
  // tally locked last — usually PM) instead of the true AM+PM sum. The
  // DailyEggAggregate row is the authoritative combined total and must be the
  // primary source.
  async getSalesStock() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // ── 1. Try the DailyEggAggregate first (AM + PM combined, written on full lock) ──
    const latestAggregate = await this.prisma.dailyEggAggregate.findFirst({
      orderBy: { aggregateDate: 'desc' },
    });

    // ── 2. Fallback: single latest locked tally (pre-aggregate or single-session day) ──
    const latestTally = !latestAggregate
      ? await this.prisma.eggTallyVerification.findFirst({
          where: { isLocked: true },
          orderBy: { lockedAt: 'desc' },
          include: {
            session: {
              select: {
                totalGoodEggs: true,
                totalBrokenEggs: true,
                totalStarterEggs: true,
                totalBrokenSellable: true,
                totalBrokenUnsellable: true,
              },
            },
          },
        })
      : null;

    if (!latestAggregate && !latestTally) {
      // No locked tally at all yet — return zero stock with today's pricing
      const todayPricing = await this.prisma.dailyEggPrice.findUnique({
        where: { priceDate: today },
      });
      return {
        standardEggs:      0,
        starterEggs:       0,
        nonConsumableEggs: 0,
        consumableEggs:    0,
        lastVerifiedDate:  null,
        pricing: todayPricing ? {
          pricePerEgg:        Number(todayPricing.pricePerEgg),
          pricePerEggStarter: Number((todayPricing as any).pricePerEggStarter ?? 0),
          pricePerEggBroken:  Number((todayPricing as any).pricePerEggBroken  ?? 0),
          priceDate:          todayPricing.priceDate,
        } : null,
      };
    }

    // Count breakage adjustments to get current consumable/non-consumable
    const latestAdj = await this.prisma.eggBreakageAdjustment.findFirst({
      orderBy: { adjustmentDate: 'desc' },
    });

    // Fetch today's pricing
    const pricing = await this.prisma.dailyEggPrice.findUnique({
      where: { priceDate: today },
    });

    // ── Derive base stock from aggregate (preferred) or single tally (fallback) ──
    // FIX: "standard eggs" = totalGoodEggs as computed at tally time (which
    // already nets out starter/broken-sellable/broken-unsellable/soft-shell/
    // deformed from the raw total). totalStdEggs on the aggregate already
    // represents this correctly (see tally-verification.service fix).
    const baseStandardEggs = latestAggregate
      ? (latestAggregate.totalStdEggs ?? 0)
      : (latestTally!.finalGoodEggs ?? latestTally!.session?.totalGoodEggs ?? 0);

    const baseStarterEggs = latestAggregate
      ? (latestAggregate.totalStarterEggs ?? 0)
      : (latestTally!.session?.totalStarterEggs ?? 0);

    // FIX: "Consumable broken" = broken SELLABLE eggs; "Non-consumable broken"
    // = broken UNSELLABLE eggs (per next-morning 3-party tally data). The
    // previous code read totalBrokenSellable into nonConsumableEggs and left
    // consumableEggs hardcoded at 0, swapping the two categories.
    const baseConsumableEggs = latestAggregate
      ? ((latestAggregate as any).totalBrokenSellable ?? 0)
      : (latestTally!.session?.totalBrokenSellable ?? 0);

    const baseNonConsumableEggs = latestAggregate
      ? ((latestAggregate as any).totalBrokenUnsellable ?? 0)
      : (latestTally!.session?.totalBrokenUnsellable ?? 0);

    // FIX: If standard (good) eggs are zero or below because the day's
    // collection was all starter eggs, surface that via a dedicated flag/value
    // so the Sales dashboard can show a "Starter Eggs" KPI card of its own
    // instead of (or alongside) the Standard Eggs card.
    const isStarterOnly = baseStandardEggs <= 0 && baseStarterEggs > 0;

    const lastVerifiedDate = latestAggregate
      ? latestAggregate.aggregateDate
      : latestTally!.verificationDate;

    const stockResult = {
      standardEggs:      baseStandardEggs,
      starterEggs:       baseStarterEggs,
      nonConsumableEggs: latestAdj?.newNonConsumable ?? baseNonConsumableEggs,
      consumableEggs:    latestAdj?.newConsumable    ?? baseConsumableEggs,
      lastVerifiedDate,
    };

    // Subtract eggs sold today from available stock
    const todaySold = await this.prisma.salesOrder.findMany({
      where: {
        orderDate: { gte: today },
        status: { not: 'CANCELLED' as any },
        deletedAt: null,
      },
      include: { items: true },
    });
    let soldStandard = 0, soldStarter = 0, soldConsumable = 0;
    for (const order of todaySold) {
      for (const item of order.items) {
        const qty = (item as any).quantityEggs ?? ((item as any).quantityTrays ?? 0) * 30;
        if (item.itemType === 'STANDARD_EGGS') soldStandard += qty;
        else if (item.itemType === 'STARTER_EGGS') soldStarter += qty;
        else if (item.itemType === 'CONSUMABLE_BROKEN_EGGS') soldConsumable += qty;
      }
    }

    // Subtract locked advance bookings
    const lockedBookings = await this.prisma.advanceBooking.findMany({
      where: { stockLocked: true, status: { not: 'CANCELLED' as any } },
    });
    let lockedEggs = 0;
    for (const b of lockedBookings) {
      lockedEggs += (b as any).quantityEggs ?? ((b as any).quantityTrays ?? 0) * 30;
    }

    stockResult.standardEggs      = Math.max(0, stockResult.standardEggs - soldStandard - lockedEggs);
    stockResult.starterEggs        = Math.max(0, stockResult.starterEggs - soldStarter);
    stockResult.consumableEggs     = Math.max(0, stockResult.consumableEggs - soldConsumable);

    // Return original (tally/aggregate) values alongside adjusted current values
    // for the "Original stock vs Current stock" comparison on the Sales Breakage page.
    const originalStandardEggs      = baseStandardEggs;
    const originalStarterEggs       = baseStarterEggs;
    const originalNonConsumableEggs = baseNonConsumableEggs;
    const originalConsumableEggs    = baseConsumableEggs;

    // ── Expected revenue: use stored aggregate value (set by pricing.service
    // recalcAggregateRevenue whenever the accountant saves/updates a price).
    // This is the authoritative source — it already accounts for all houses
    // (AM+PM combined) and the latest pricing, even when price is set after lock.
    // Sum across all aggregates for today (one row per batch/house combination).
    const todayAggregates = await this.prisma.dailyEggAggregate.findMany({
      where: { aggregateDate: today },
      select: { expectedRevenueKes: true, totalStdEggs: true, totalStarterEggs: true, totalBrokenSellable: true },
    });

    let expectedRevenueKes: number | null = null;
    if (todayAggregates.length > 0 && pricing) {
      // If the aggregate already has a stored expectedRevenueKes (written by
      // recalcAggregateRevenue), sum those. Otherwise compute live from egg counts × price.
      const hasStoredRevenue = todayAggregates.some(a => (a.expectedRevenueKes ?? null) !== null);
      if (hasStoredRevenue) {
        expectedRevenueKes = todayAggregates.reduce(
          (sum, a) => sum + Number(a.expectedRevenueKes ?? 0), 0,
        );
      } else {
        // Fallback: compute from egg counts × today's price (price set before both tallies locked)
        expectedRevenueKes = todayAggregates.reduce((sum, a) => {
          return sum
            + (a.totalStdEggs         ?? 0) * Number(pricing.pricePerEgg)
            + (a.totalStarterEggs     ?? 0) * Number((pricing as any).pricePerEggStarter ?? 0)
            + (a.totalBrokenSellable  ?? 0) * Number((pricing as any).pricePerEggBroken  ?? 0);
        }, 0);
      }
    }

    return {
      ...stockResult,
      isStarterOnly,
      originalStandardEggs,
      originalStarterEggs,
      originalNonConsumableEggs,
      originalConsumableEggs,
      expectedRevenueKes: expectedRevenueKes !== null ? Math.round(expectedRevenueKes) : null,
      pricing: pricing ? {
        pricePerEgg:        Number(pricing.pricePerEgg),
        pricePerEggStarter: Number((pricing as any).pricePerEggStarter ?? 0),
        pricePerEggBroken:  Number((pricing as any).pricePerEggBroken  ?? 0),
        priceDate:          pricing.priceDate,
      } : null,
    };
  }
  // ── Customer management (update/delete) ──────────────────────────────────
  async updateCustomer(id: string, body: any) {
    return this.prisma.customer.update({
      where: { id },
      data: {
        name:            body.name            ?? undefined,
        phone:           body.phone           ?? undefined,
        email:           body.email           ?? undefined,
        address: body.address ?? undefined,
      },
    });
  }

  async deleteCustomer(id: string) {
    // Soft-delete: mark inactive rather than hard delete (preserve order history)
    return this.prisma.customer.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // ── Order lifecycle: move to DELIVERING status ────────────────────────────
  async markOrderAsDelivering(id: string, user: any) {
    const order = await this.prisma.salesOrder.findUnique({ where: { id } });
    if (!order) throw new Error('Order not found');
    return this.prisma.salesOrder.update({
      where: { id },
      data: { status: 'DELIVERING' as any },
    });
  }

}
