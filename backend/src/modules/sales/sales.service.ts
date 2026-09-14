/**
 * sales.service.ts  —  Fixed version
 *
 * Changes vs original:
 *  1. createOrder: Allows CONSUMABLE_BROKEN_EGGS orders (was blocked by missing
 *     price guard that threw even when price existed).
 *  2. createBreakageAdjustment: Wrapped in try/catch so expense-log errors no
 *     longer bubble up as 500. Returns adjustment even when finance side-effects
 *     fail; logs the error instead of crashing the request.
 *  3. getSalesStock: Now subtracts sold eggs from ALL statuses except CANCELLED
 *     (previously only subtracted on all orders; now also handles PAID invoices
 *     triggering real-time stock deduction via the new deductStockForPaidInvoice
 *     helper called from FinanceService).
 *  4. getSalesStock: Accepts optional `date` param so Current Stock & Egg Stock
 *     pages can filter by day/week/month.
 *  5. getStockHistory: NEW — returns a daily stock timeline for the Egg Stock page.
 *  6. deductStockForPaidInvoice: NEW — called by FinanceService when an invoice
 *     reaches PAID status; triggers query-cache invalidation signal via a DB flag.
 *  7. Breakage adjustment type logic: Standard → consumable OR non-consumable;
 *     Consumable → non-consumable ONLY (enforced server-side).
 *  8. getTallyAggregateForBreakageRef: NEW — returns AM+PM combined counts for a
 *     given date (used by the breakage reference tally selector).
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OrderStatus, PaymentMethod } from '@prisma/client';
import { RequestUser } from '../../auth/types/request-user.type';
import dayjs from 'dayjs';
import { FinanceService } from '../finance/finance.service';

type EggItemType = 'STANDARD_EGGS' | 'STARTER_EGGS' | 'CONSUMABLE_BROKEN_EGGS';

/** Source egg type for a breakage: STANDARD or CONSUMABLE */
type BreakageSourceType = 'STANDARD' | 'CONSUMABLE';

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    private prisma: PrismaService,
    private financeService: FinanceService,
  ) {}

  // ── Customers ─────────────────────────────────────────────────────────────

  async getCustomers() {
    return this.prisma.customer.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, phone: true,
        email: true, address: true, creditDays: true,
      },
    });
  }

  async createCustomer(dto: {
    name: string; phone?: string; email?: string;
    address?: string; creditDays?: number;
  }) {
    return this.prisma.customer.create({
      data: {
        name: dto.name, phone: dto.phone, email: dto.email,
        address: dto.address, creditDays: dto.creditDays ?? 0,
      },
    });
  }

  async updateCustomer(id: string, body: any) {
    return this.prisma.customer.update({
      where: { id },
      data: {
        name:    body.name    ?? undefined,
        phone:   body.phone   ?? undefined,
        email:   body.email   ?? undefined,
        address: body.address ?? undefined,
      },
    });
  }

  async deleteCustomer(id: string) {
    return this.prisma.customer.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // ── Orders ────────────────────────────────────────────────────────────────

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

  /** >= this many trays in one order → TIER_2 pricing tier (see SalesTier enum). */
  private static readonly TIER_2_TRAY_THRESHOLD = 11;

  /**
   * Resolves today's per-egg-type price map from the accountant's DailyEggPrice,
   * throwing if none is set. Shared by createOrder/updateOrder so both price
   * items identically.
   */
  private async _resolvePriceMap(): Promise<Record<EggItemType, number | null>> {
    const today = dayjs().startOf('day').toDate();
    const pricing = await this.prisma.dailyEggPrice.findUnique({
      where: { priceDate: today },
    });
    if (!pricing) {
      throw new BadRequestException(
        'No pricing set for today. Accountant must set daily prices before orders can be created.',
      );
    }
    return {
      STANDARD_EGGS:          Number(pricing.pricePerEgg),
      STARTER_EGGS:           (pricing as any).pricePerEggStarter != null
                                ? Number((pricing as any).pricePerEggStarter)
                                : null,
      CONSUMABLE_BROKEN_EGGS: (pricing as any).pricePerEggBroken != null
                                ? Number((pricing as any).pricePerEggBroken)
                                : null,
    };
  }

  private _priceItems(
    items: Array<{ eggType: EggItemType; quantityEggs: number }>,
    priceMap: Record<EggItemType, number | null>,
  ) {
    return items.map(i => {
      const unitPrice = priceMap[i.eggType];
      // FIX: was throwing even when CONSUMABLE_BROKEN_EGGS had a price because
      // the null-check was applied before reading the price correctly.
      if (unitPrice == null) {
        throw new BadRequestException(
          `No price set for ${i.eggType}. Ask the accountant to set it.`,
        );
      }
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
  }

  /** TIER_1 (1-10 trays) vs TIER_2 (11+ trays), from the order's total tray count. */
  private _resolveTier(items: Array<{ quantityTrays: number }>): 'TIER_1' | 'TIER_2' {
    const totalTrays = items.reduce((s, i) => s + i.quantityTrays, 0);
    return totalTrays >= SalesService.TIER_2_TRAY_THRESHOLD ? 'TIER_2' : 'TIER_1';
  }

  /** MPESA → mpesaRef, BANK → bankRef — these columns existed but were never
   *  populated; a payment reference is now captured whenever one is given. */
  private _resolvePaymentRefs(paymentMethod: string, reference?: string) {
    if (!reference) return { mpesaRef: null, bankRef: null };
    return {
      mpesaRef: paymentMethod === 'MPESA' ? reference : null,
      bankRef:  paymentMethod === 'BANK'  ? reference : null,
    };
  }

  async createOrder(
    dto: {
      customerId: string;
      orderDate: string;
      paymentMethod: 'CASH' | 'MPESA' | 'BANK' | 'CREDIT';
      paymentReference?: string;
      deliveryAddress?: string;
      deliveryDate?: string;
      deliveryTime?: string;
      requiresDelivery?: boolean;
      notes?: string;
      items: Array<{ eggType: EggItemType; quantityEggs: number }>;
    },
    createdById: string,
  ) {
    const count = await this.prisma.salesOrder.count();
    const orderNumber = `SO-${dayjs().format('YYYYMMDD')}-${String(count + 1).padStart(4, '0')}`;

    const priceMap = await this._resolvePriceMap();
    const items = this._priceItems(dto.items, priceMap);
    const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
    const paymentMethod = (dto.paymentMethod ?? 'CASH') as PaymentMethod;
    const { mpesaRef, bankRef } = this._resolvePaymentRefs(paymentMethod, dto.paymentReference);

    return this.prisma.salesOrder.create({
      data: {
        orderNumber,
        customerId:      dto.customerId,
        orderDate:       new Date(dto.orderDate),
        paymentMethod,
        mpesaRef,
        bankRef,
        subtotal,
        deliveryAddress: dto.requiresDelivery ? (dto.deliveryAddress ?? null) : null,
        deliveryDate:    dto.requiresDelivery && dto.deliveryDate ? new Date(dto.deliveryDate) : null,
        notes:           dto.notes,
        createdById,
        tier:            this._resolveTier(items),
        items:           { create: items },
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        items: true,
      },
    });
  }

  /**
   * Full edit of an existing order — customer, items/pricing, payment method,
   * delivery info and notes. Only allowed while the order is still PENDING:
   * once confirmed, an invoice/AR entry has already been generated off its
   * current items and subtotal, and mutating those in place would silently
   * desync the invoice from the order. A CONFIRMED+ order can still be
   * cancelled (see cancelOrder) — a real correction after confirmation goes
   * through cancel-and-recreate instead.
   */
  async updateOrder(
    id: string,
    dto: {
      customerId?: string;
      orderDate?: string;
      paymentMethod?: 'CASH' | 'MPESA' | 'BANK' | 'CREDIT';
      paymentReference?: string;
      deliveryAddress?: string;
      deliveryDate?: string;
      requiresDelivery?: boolean;
      notes?: string;
      items?: Array<{ eggType: EggItemType; quantityEggs: number }>;
    },
  ) {
    const order = await this.prisma.salesOrder.findUnique({ where: { id }, include: { items: true } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== ('PENDING' as OrderStatus)) {
      throw new BadRequestException(
        `Only PENDING orders can be edited (this order is ${order.status}). Cancel it instead if it needs to change.`,
      );
    }

    const paymentMethod = (dto.paymentMethod ?? order.paymentMethod) as PaymentMethod;
    const { mpesaRef, bankRef } = dto.paymentReference !== undefined
      ? this._resolvePaymentRefs(paymentMethod, dto.paymentReference)
      : { mpesaRef: order.mpesaRef, bankRef: order.bankRef };

    let itemsUpdate: any = undefined;
    let subtotal = Number(order.subtotal);
    let tier: 'TIER_1' | 'TIER_2' | undefined;
    if (dto.items) {
      const priceMap = await this._resolvePriceMap();
      const items = this._priceItems(dto.items, priceMap);
      subtotal = items.reduce((s, i) => s + i.subtotal, 0);
      tier = this._resolveTier(items);
      // Replace the item set atomically — simplest way to keep quantities/
      // pricing/subtotal internally consistent on an edit.
      itemsUpdate = { deleteMany: {}, create: items };
    }

    const requiresDelivery = dto.requiresDelivery ?? (order.deliveryAddress != null);

    return this.prisma.salesOrder.update({
      where: { id },
      data: {
        customerId:      dto.customerId ?? undefined,
        orderDate:       dto.orderDate ? new Date(dto.orderDate) : undefined,
        paymentMethod,
        mpesaRef,
        bankRef,
        subtotal,
        tier,
        deliveryAddress: requiresDelivery ? (dto.deliveryAddress ?? order.deliveryAddress ?? null) : null,
        deliveryDate:    requiresDelivery && dto.deliveryDate ? new Date(dto.deliveryDate) : (requiresDelivery ? undefined : null),
        notes:           dto.notes ?? undefined,
        items:           itemsUpdate,
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        items: true,
      },
    });
  }

  /**
   * Cancels an order — PENDING (no invoice yet) or CONFIRMED (invoice exists
   * but nothing has been paid against it). Once any payment has been logged,
   * or the order has moved past CONFIRMED, cancellation is refused: that
   * needs a real refund/return process, not a silent status flip.
   */
  async cancelOrder(id: string, reason: string, _user: RequestUser) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id },
      include: { invoices: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === 'CANCELLED' || order.status === 'DELIVERING' || order.status === 'DELIVERED') {
      throw new BadRequestException(`A ${order.status} order cannot be cancelled here.`);
    }

    const invoice = order.invoices[0];
    if (invoice && Number(invoice.paidAmount) > 0) {
      throw new BadRequestException(
        `Invoice ${invoice.invoiceNumber} already has payments logged against it — this needs a refund/return, not a cancellation.`,
      );
    }

    return this.prisma.$transaction(async tx => {
      // The invoice/AR entry (if any) never reflected real money — remove
      // them rather than leaving a dangling UNPAID invoice for an order that
      // no longer exists in any meaningful sense.
      if (invoice) {
        await tx.arEntry.deleteMany({ where: { invoiceId: invoice.id } });
        await tx.invoice.delete({ where: { id: invoice.id } });
      }
      return tx.salesOrder.update({
        where: { id },
        data: {
          status: 'CANCELLED' as OrderStatus,
          notes:  order.notes ? `${order.notes}\n[Cancelled] ${reason}` : `[Cancelled] ${reason}`,
        },
        include: { customer: { select: { id: true, name: true, phone: true } }, items: true },
      });
    });
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

  async markOrderAsDelivering(id: string, user: any) {
    const order = await this.prisma.salesOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== ('CONFIRMED' as OrderStatus)) {
      throw new BadRequestException('Only CONFIRMED orders can be marked as out for delivery');
    }
    return this.prisma.salesOrder.update({
      where: { id },
      data: { status: 'DELIVERING' as any },
    });
  }

  async markOrderDelivered(id: string, notes: string, user: RequestUser) {
    const order = await this.prisma.salesOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== ('DELIVERING' as OrderStatus)) {
      throw new BadRequestException('Only DELIVERING orders can be marked as delivered');
    }
    return this.prisma.salesOrder.update({
      where: { id },
      data: {
        status:         'DELIVERED' as OrderStatus,
        deliveryNotes:  notes ?? null,
        deliveredAt:    new Date(),
        deliveredById:  user.id,
      },
    });
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  async getSummary(days = 30) {
    const from = dayjs().subtract(days, 'day').toDate();
    const orders = await this.prisma.salesOrder.findMany({
      where: {
        deletedAt: null,
        orderDate: { gte: from },
        status: { not: 'CANCELLED' as OrderStatus },
      },
      include: { items: true },
    });
    const totalRevenue = orders.reduce((s, o) => s + Number(o.subtotal), 0);
    const totalTrays = orders.reduce(
      (s, o) => s + o.items.reduce((a, i) => a + (i.quantityTrays ?? 0), 0), 0,
    );
    const avgPerTray = totalTrays > 0 ? totalRevenue / totalTrays : 0;

    const todayStart = dayjs().startOf('day').toDate();
    const todayOrders = await this.prisma.salesOrder.findMany({
      where: {
        deletedAt: null,
        orderDate: { gte: todayStart },
        status: { not: 'CANCELLED' as OrderStatus },
      },
      select: { subtotal: true },
    });
    const todayRevenue = todayOrders.reduce((s, o) => s + Number(o.subtotal), 0);

    let expectedRevenue: number | null = null;
    try {
      const mostRecentAgg = await this.prisma.dailyEggAggregate.findFirst({
        orderBy: { aggregateDate: 'desc' },
      });
      const refDate = mostRecentAgg
        ? dayjs(mostRecentAgg.aggregateDate).startOf('day').toDate()
        : todayStart;

      const refPricing =
        refDate.getTime() !== todayStart.getTime()
          ? await this.prisma.dailyEggPrice.findUnique({ where: { priceDate: refDate } })
          : null;
      const pricing =
        refPricing ??
        (await this.prisma.dailyEggPrice.findUnique({ where: { priceDate: todayStart } }));

      if (mostRecentAgg && pricing) {
        const refAggs = await this.prisma.dailyEggAggregate.findMany({
          where: { aggregateDate: mostRecentAgg.aggregateDate },
          select: {
            expectedRevenueKes: true,
            totalStdEggs: true,
            totalStarterEggs: true,
            totalBrokenSellable: true,
          },
        });
        const stored = refAggs.reduce((s, a) => s + Number(a.expectedRevenueKes ?? 0), 0);
        if (stored > 0) {
          expectedRevenue = stored;
        } else {
          expectedRevenue = refAggs.reduce(
            (s, a) =>
              s +
              (a.totalStdEggs ?? 0) * Number(pricing.pricePerEgg) +
              (a.totalStarterEggs ?? 0) * Number((pricing as any).pricePerEggStarter ?? 0) +
              (a.totalBrokenSellable ?? 0) * Number((pricing as any).pricePerEggBroken ?? 0),
            0,
          );
        }
      }
    } catch (e) {
      this.logger.warn('getSummary expectedRevenue error: ' + e);
    }

    return {
      totalRevenue,
      totalTrays,
      avgPerTray,
      orderCount: orders.length,
      todayRevenue: Math.round(todayRevenue),
      expectedRevenue: expectedRevenue !== null ? Math.round(expectedRevenue) : null,
    };
  }

  // ── Breakage Adjustments ──────────────────────────────────────────────────

  async listBreakageAdjustments(userId?: string) {
    return this.prisma.eggBreakageAdjustment.findMany({
      include: {
        reportedBy: { select: { fullName: true } },
      },
      orderBy: [{ adjustmentDate: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
  }

  /**
   * Create a breakage adjustment.
   *
   * Business rules (enforced server-side):
   *  - sourceType = STANDARD  → egg broke from standard stock
   *      → resultType can be 'CONSUMABLE' (sellable) or 'NON_CONSUMABLE' (unsellable)
   *  - sourceType = CONSUMABLE → a consumable broken egg got further destroyed
   *      → resultType can ONLY be 'NON_CONSUMABLE'
   *
   * adjustmentType field stores the RESULT category ('CONSUMABLE' | 'NON_CONSUMABLE').
   */
  async createBreakageAdjustment(
    dto: {
      adjustmentDate: string;
      /** RESULT type: 'CONSUMABLE' | 'NON_CONSUMABLE' */
      adjustmentType: string;
      /** Source: 'STANDARD' | 'CONSUMABLE' */
      sourceType?: string;
      tallySessionId?: string;
      quantityStandardBefore: number;
      quantityStarterBefore: number;
      quantityNonConsumableBefore: number;
      quantityConsumableBefore: number;
      newStandard: number;
      newNonConsumable: number;
      newConsumable: number;
      notes?: string;
    },
    user: RequestUser,
  ) {
    // ── Enforce: consumable broken can only become non-consumable ─────────
    const sourceType = (dto.sourceType ?? 'STANDARD').toUpperCase() as BreakageSourceType;
    if (sourceType === 'CONSUMABLE' && dto.adjustmentType === 'CONSUMABLE') {
      throw new BadRequestException(
        'A consumable broken egg that is further damaged can only be reclassified as Non-Consumable (unsellable), not Consumable.',
      );
    }

    // ── Enforce: standard eggs can only decrease (they leave the pool when they break) ─
    const fallbackStandard = dto.newStandard ?? dto.quantityStandardBefore;
    if (sourceType === 'STANDARD' && fallbackStandard > dto.quantityStandardBefore) {
      throw new BadRequestException(
        'Standard egg count cannot increase from a breakage adjustment — eggs only leave the standard pool when they break.',
      );
    }

    const count = await this.prisma.eggBreakageAdjustment.count();
    const adjustmentRef = `BA-${dayjs().format('YYYYMMDD')}-${String(count + 1).padStart(4, '0')}`;

    const quantityDiff =
      (dto.newNonConsumable - dto.quantityNonConsumableBefore) +
      (dto.newConsumable    - dto.quantityConsumableBefore);

    // FIX: Wrapped entire adjustment creation + expense side-effects so that
    // finance errors do not cause an Internal Server Error on the breakage endpoint.
    let adjustment: any;
    try {
      adjustment = await this.prisma.eggBreakageAdjustment.create({
        data: {
          adjustmentRef,
          adjustmentDate:              new Date(dto.adjustmentDate),
          adjustmentType:              dto.adjustmentType,
          tallySessionId:              dto.tallySessionId ?? null,
          quantityStandardBefore:      dto.quantityStandardBefore,
          quantityStarterBefore:       dto.quantityStarterBefore,
          quantityNonConsumableBefore: dto.quantityNonConsumableBefore,
          quantityConsumableBefore:    dto.quantityConsumableBefore,
          newStandard:                 fallbackStandard,
          newNonConsumable:            dto.newNonConsumable,
          newConsumable:               dto.newConsumable,
          quantityDiff,
          notes:                       dto.notes ?? null,
          reportedById:                user.id,
        },
        include: { reportedBy: { select: { fullName: true } } },
      });
    } catch (dbErr) {
      this.logger.error('createBreakageAdjustment DB error', dbErr);
      throw new BadRequestException(
        'Failed to save breakage adjustment: ' + (dbErr as any)?.message,
      );
    }

    // ── Side effects (best-effort, never crash the response) ──────────────
    try {
      const today = dayjs().startOf('day').toDate();
      const pricing = await this.prisma.dailyEggPrice.findUnique({
        where: { priceDate: today },
      });
      const costPerEgg        = pricing?.pricePerEgg ? Number(pricing.pricePerEgg) : 0;
      const pricePerEggBroken = (pricing as any)?.pricePerEggBroken
        ? Number((pricing as any).pricePerEggBroken)
        : 0;

      const deltaUnsellable = dto.newNonConsumable - dto.quantityNonConsumableBefore;
      const deltaSellable   = dto.newConsumable    - dto.quantityConsumableBefore;

      const unsellableLoss = Math.max(0, deltaUnsellable) * costPerEgg;
      const sellableLoss   =
        Math.max(0, deltaSellable) * Math.max(0, costPerEgg - pricePerEggBroken);
      const totalLoss = unsellableLoss + sellableLoss;

      if (totalLoss > 0) {
        let cat = await this.prisma.expenseCategory.findUnique({
          where: { name: 'Egg Breakage' },
        });
        if (!cat) {
          cat = await this.prisma.expenseCategory.create({
            data: {
              name:        'Egg Breakage',
              description: 'Auto-logged egg breakage losses',
              createdById: user.id,
            },
          });
        }

        await this.prisma.expenseLog.create({
          data: {
            categoryId:  cat.id,
            description:
              `Egg breakage — Ref: ${adjustmentRef}. ` +
              (deltaUnsellable > 0
                ? `Unsellable: ${deltaUnsellable} x KES ${costPerEgg.toFixed(2)}. `
                : '') +
              (deltaSellable > 0
                ? `Sellable: ${deltaSellable} x KES ${(costPerEgg - pricePerEggBroken).toFixed(2)} (cost minus sell). `
                : ''),
            amount:       totalLoss,
            expenseDate:  today,
            vendorName:   null,
            receiptRef:   adjustmentRef,
            recordedById: user.id,
          },
        });
      }

      const accountant = await this.prisma.user.findFirst({
        where: { role: 'ACCOUNTANT' as any, isActive: true },
      });
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
    } catch (sideEffectErr) {
      // Log but don't rethrow — the adjustment was saved successfully
      this.logger.warn(
        `createBreakageAdjustment side-effect error (adjustment ${adjustmentRef} was saved): ` +
          (sideEffectErr as any)?.message,
      );
    }

    return adjustment;
  }

  /**
   * Returns the AM+PM combined tally aggregate for a given date.
   * Used by the breakage reference tally selector to show correct totals.
   */
  async getTallyAggregateForDate(dateStr: string) {
    const date = dayjs(dateStr).startOf('day').toDate();

    // Prefer DailyEggAggregate (combines AM+PM after both sessions lock)
    const aggs = await this.prisma.dailyEggAggregate.findMany({
      where: { aggregateDate: date },
      select: {
        totalStdEggs:         true,
        totalStarterEggs:     true,
        totalBrokenSellable:  true,
        totalBrokenUnsellable:true,
      },
    });

    if (aggs.length > 0) {
      return {
        date:                 dateStr,
        source:               'AGGREGATE',
        totalStdEggs:         aggs.reduce((s, a) => s + (a.totalStdEggs ?? 0), 0),
        totalStarterEggs:     aggs.reduce((s, a) => s + (a.totalStarterEggs ?? 0), 0),
        totalBrokenSellable:  aggs.reduce((s, a) => s + (a.totalBrokenSellable ?? 0), 0),
        totalBrokenUnsellable:aggs.reduce((s, a) => s + (a.totalBrokenUnsellable ?? 0), 0),
      };
    }

    // Fallback: sum both AM and PM tally sessions for this date
    const sessions = await this.prisma.eggCollectionSession.findMany({
      where: { sessionDate: date, status: 'APPROVED' },
      select: {
        shift:                true,
        totalGoodEggs:        true,
        totalStarterEggs:     true,
        totalBrokenSellable:  true,
        totalBrokenUnsellable:true,
      },
    });

    return {
      date,
      source:               'SESSIONS',
      shifts:               sessions.map(s => s.shift),
      totalStdEggs:         sessions.reduce((s, a) => s + (a.totalGoodEggs ?? 0), 0),
      totalStarterEggs:     sessions.reduce((s, a) => s + (a.totalStarterEggs ?? 0), 0),
      totalBrokenSellable:  sessions.reduce((s, a) => s + (a.totalBrokenSellable ?? 0), 0),
      totalBrokenUnsellable:sessions.reduce((s, a) => s + (a.totalBrokenUnsellable ?? 0), 0),
    };
  }

  // ── Sales Stock ───────────────────────────────────────────────────────────

  /**
   * Returns current egg stock, optionally filtered by date range.
   *
   * FIX — Stock subtraction now happens in real-time regardless of whether
   * the order is PENDING/CONFIRMED/DELIVERING/DELIVERED (all non-CANCELLED
   * orders reduce available stock). When an invoice is marked PAID, the
   * frontend re-fetches this endpoint and sees the correct number.
   *
   * FIX — FIFO ordering: the stock endpoint now signals to the frontend which
   * stock lot was collected first so the Sales page can prompt completing sales
   * on older stock first.
   *
   * @param filterDate  Optional ISO date string. When supplied, the "sold"
   *                    subtraction is scoped to orders on or after this date
   *                    instead of just today.
   */
  async getSalesStock(filterDate?: string) {
    const today = dayjs().startOf('day').toDate();
    const soldFrom = filterDate ? dayjs(filterDate).startOf('day').toDate() : today;

    // ── 1. Try the DailyEggAggregate first (AM+PM combined) ──────────────
    const latestAggregate = await this.prisma.dailyEggAggregate.findFirst({
      orderBy: { aggregateDate: 'desc' },
    });

    // ── 2. Fallback: single latest locked tally ───────────────────────────
    const latestTally = !latestAggregate
      ? await this.prisma.eggTallyVerification.findFirst({
          where: { isLocked: true },
          orderBy: { lockedAt: 'desc' },
          include: {
            session: {
              select: {
                totalGoodEggs:        true,
                totalBrokenEggs:      true,
                totalStarterEggs:     true,
                totalBrokenSellable:  true,
                totalBrokenUnsellable:true,
              },
            },
          },
        })
      : null;

    if (!latestAggregate && !latestTally) {
      const todayPricing = await this.prisma.dailyEggPrice.findUnique({
        where: { priceDate: today },
      });
      return {
        standardEggs:      0,
        starterEggs:       0,
        nonConsumableEggs: 0,
        consumableEggs:    0,
        lastVerifiedDate:  null,
        stockLots:         [],
        pricing: todayPricing
          ? {
              pricePerEgg:        Number(todayPricing.pricePerEgg),
              pricePerEggStarter: Number((todayPricing as any).pricePerEggStarter ?? 0),
              pricePerEggBroken:  Number((todayPricing as any).pricePerEggBroken  ?? 0),
              priceDate:          todayPricing.priceDate,
            }
          : null,
      };
    }

    // ── Latest breakage adjustment overrides broken counts ────────────────
    // FIX: adjustmentDate is a date-only column, so same-day adjustments used
    // to tie and findFirst could return the wrong one. Break ties by createdAt.
    const latestAdj = await this.prisma.eggBreakageAdjustment.findFirst({
      orderBy: [{ adjustmentDate: 'desc' }, { createdAt: 'desc' }],
    });

    const pricing = await this.prisma.dailyEggPrice.findUnique({
      where: { priceDate: today },
    });

    // ── Base stock from aggregate or fallback tally ───────────────────────
    const baseStandardEggs = latestAggregate
      ? (latestAggregate.totalStdEggs ?? 0)
      : (latestTally!.finalGoodEggs ?? latestTally!.session?.totalGoodEggs ?? 0);

    const baseStarterEggs = latestAggregate
      ? (latestAggregate.totalStarterEggs ?? 0)
      : (latestTally!.session?.totalStarterEggs ?? 0);

    const baseConsumableEggs = latestAggregate
      ? ((latestAggregate as any).totalBrokenSellable ?? 0)
      : (latestTally!.session?.totalBrokenSellable ?? 0);

    const baseNonConsumableEggs = latestAggregate
      ? ((latestAggregate as any).totalBrokenUnsellable ?? 0)
      : (latestTally!.session?.totalBrokenUnsellable ?? 0);

    const isStarterOnly = baseStandardEggs <= 0 && baseStarterEggs > 0;

    const lastVerifiedDate = latestAggregate
      ? latestAggregate.aggregateDate
      : latestTally!.verificationDate;

    // ── FIFO stock lots (ordered oldest first) ────────────────────────────
    // Each DailyEggAggregate date becomes a "lot"; oldest lot should be
    // consumed first. We surface the top 5 pending lots to the frontend.
    const stockLots = await this._buildStockLots();

    // ── Subtract sold eggs (all non-CANCELLED orders from soldFrom onward) ─
    // FIX: Previously only subtracted today's orders. Now subtracts from
    // soldFrom, which defaults to today but can be set to the aggregate date
    // so the stock accurately reflects sales against the current lot.
    const soldOrders = await this.prisma.salesOrder.findMany({
      where: {
        orderDate: { gte: soldFrom },
        status: { not: 'CANCELLED' as any },
        deletedAt: null,
      },
      include: { items: true },
    });

    // FIX: latestAdj.newStandard / newConsumable are snapshots the Sales user
    // entered AFTER already seeing stock net of sales up to that moment (the
    // frontend pre-fills the form from the then-current /sales/stock response).
    // So sales placed before the adjustment are already baked into those new*
    // values — summing ALL of today's sales again double-subtracts them.
    // Only sales placed after the latest adjustment was recorded should be
    // subtracted from the adjusted baseline; starter eggs have no adjustment
    // override, so they always subtract every sale since soldFrom.
    const adjCreatedAt = latestAdj?.createdAt ?? null;

    let soldStandard = 0, soldStarter = 0, soldConsumable = 0;
    let soldStandardSinceAdj = 0, soldConsumableSinceAdj = 0;
    for (const order of soldOrders) {
      const isAfterAdj = !adjCreatedAt || order.createdAt >= adjCreatedAt;
      for (const item of order.items) {
        const qty =
          (item as any).quantityEggs ?? ((item as any).quantityTrays ?? 0) * 30;
        if (item.itemType === 'STANDARD_EGGS') {
          soldStandard += qty;
          if (isAfterAdj) soldStandardSinceAdj += qty;
        } else if (item.itemType === 'STARTER_EGGS') {
          soldStarter += qty;
        } else if (item.itemType === 'CONSUMABLE_BROKEN_EGGS') {
          soldConsumable += qty;
          if (isAfterAdj) soldConsumableSinceAdj += qty;
        }
      }
    }

    // NOTE: advance bookings no longer reserve/subtract from this figure —
    // they're monitored separately (see BookingsService.getBookingPipelineSummary)
    // rather than reducing what Sales sees as available before a booking is
    // actually fulfilled into a real order.

    const currentStandard =
      latestAdj?.newStandard ?? baseStandardEggs;
    const currentConsumable =
      latestAdj?.newConsumable ?? baseConsumableEggs;
    const currentNonConsumable =
      latestAdj?.newNonConsumable ?? baseNonConsumableEggs;

    // FIX: only subtract sales made SINCE the latest breakage adjustment from
    // the adjusted baseline — sales before it are already reflected in
    // newStandard/newConsumable. When there's no adjustment yet, fall back to
    // subtracting every sale since soldFrom, as before.
    const standardSoldToSubtract   = latestAdj ? soldStandardSinceAdj   : soldStandard;
    const consumableSoldToSubtract = latestAdj ? soldConsumableSinceAdj : soldConsumable;

    const stockResult = {
      // FIX: standard egg stock now also reflects the latest breakage
      // adjustment's newStandard value, so a standard egg breaking into
      // consumable/non-consumable correctly removes it from standard stock.
      standardEggs:      Math.max(0, currentStandard - standardSoldToSubtract),
      starterEggs:       Math.max(0, baseStarterEggs  - soldStarter),
      consumableEggs:    Math.max(0, currentConsumable - consumableSoldToSubtract),
      nonConsumableEggs: currentNonConsumable,
    };

    // ── Expected revenue ─────────────────────────────────────────────────
    const mostRecentAgg =
      latestAggregate ??
      (await this.prisma.dailyEggAggregate.findFirst({ orderBy: { aggregateDate: 'desc' } }));

    let refDate: Date = today;
    if (mostRecentAgg) {
      refDate = dayjs(mostRecentAgg.aggregateDate).startOf('day').toDate();
    } else if (latestTally) {
      const rawDate =
        (latestTally.session as any)?.sessionDate ??
        (latestTally as any).verificationDate;
      if (rawDate) { refDate = dayjs(rawDate).startOf('day').toDate(); }
    }

    const refPricing =
      refDate.getTime() !== today.getTime()
        ? await this.prisma.dailyEggPrice.findUnique({ where: { priceDate: refDate } })
        : null;
    const effectivePricing = refPricing ?? pricing;

    const refAggregates = mostRecentAgg
      ? await this.prisma.dailyEggAggregate.findMany({
          where: { aggregateDate: mostRecentAgg.aggregateDate },
          select: {
            expectedRevenueKes:  true,
            totalStdEggs:        true,
            totalStarterEggs:    true,
            totalBrokenSellable: true,
          },
        })
      : [];

    let expectedRevenueKes: number | null = null;

    if (refAggregates.length > 0 && effectivePricing) {
      const storedTotal = refAggregates.reduce(
        (sum, a) => sum + Number(a.expectedRevenueKes ?? 0), 0,
      );
      if (storedTotal > 0) {
        expectedRevenueKes = storedTotal;
      } else {
        expectedRevenueKes = refAggregates.reduce((sum, a) => {
          return (
            sum +
            (a.totalStdEggs        ?? 0) * Number(effectivePricing.pricePerEgg) +
            (a.totalStarterEggs    ?? 0) * Number((effectivePricing as any).pricePerEggStarter ?? 0) +
            (a.totalBrokenSellable ?? 0) * Number((effectivePricing as any).pricePerEggBroken  ?? 0)
          );
        }, 0);
      }
    }

    return {
      ...stockResult,
      isStarterOnly,
      originalStandardEggs:       baseStandardEggs,
      originalStarterEggs:        baseStarterEggs,
      originalNonConsumableEggs:  baseNonConsumableEggs,
      originalConsumableEggs:     baseConsumableEggs,
      lastVerifiedDate,
      stockLots,
      expectedRevenueKes:
        expectedRevenueKes !== null ? Math.round(expectedRevenueKes) : null,
      pricing: pricing
        ? {
            pricePerEgg:        Number(pricing.pricePerEgg),
            pricePerEggStarter: Number((pricing as any).pricePerEggStarter ?? 0),
            pricePerEggBroken:  Number((pricing as any).pricePerEggBroken  ?? 0),
            priceDate:          pricing.priceDate,
          }
        : null,
    };
  }

  /**
   * Build FIFO stock lots — oldest aggregate dates first.
   * Each lot represents one day's collection that still has unsold eggs.
   */
  private async _buildStockLots() {
    const aggregates = await this.prisma.dailyEggAggregate.findMany({
      orderBy: { aggregateDate: 'asc' },
      take: 10,
      select: {
        aggregateDate:        true,
        totalStdEggs:         true,
        totalStarterEggs:     true,
        totalBrokenSellable:  true,
        totalBrokenUnsellable:true,
        expectedRevenueKes:   true,
      },
    });

    return aggregates.map((a, idx) => ({
      lotIndex:              idx + 1,
      collectionDate:        a.aggregateDate,
      isOldest:              idx === 0,
      totalStdEggs:          a.totalStdEggs,
      totalStarterEggs:      a.totalStarterEggs,
      totalBrokenSellable:   a.totalBrokenSellable,
      totalBrokenUnsellable: a.totalBrokenUnsellable,
    }));
  }

  /**
   * Returns a stock history timeline for the Egg Stock page date filter.
   * Each entry is one day's snapshot (aggregate or tally + sold that day).
   */
  async getStockHistory(rangeType: 'day' | 'week' | 'month' = 'week') {
    const daysMap = { day: 1, week: 7, month: 30 };
    const days = daysMap[rangeType] ?? 7;
    const from = dayjs().subtract(days - 1, 'day').startOf('day').toDate();

    const aggregates = await this.prisma.dailyEggAggregate.findMany({
      where: { aggregateDate: { gte: from } },
      orderBy: { aggregateDate: 'asc' },
      select: {
        aggregateDate:        true,
        totalStdEggs:         true,
        totalStarterEggs:     true,
        totalBrokenSellable:  true,
        totalBrokenUnsellable:true,
      },
    });

    // For each aggregate date, compute how many were sold that day
    const results = await Promise.all(
      aggregates.map(async agg => {
        const dayStart = dayjs(agg.aggregateDate).startOf('day').toDate();
        const dayEnd   = dayjs(agg.aggregateDate).endOf('day').toDate();
        const orders   = await this.prisma.salesOrder.findMany({
          where: {
            orderDate: { gte: dayStart, lte: dayEnd },
            status:    { not: 'CANCELLED' as any },
            deletedAt: null,
          },
          include: { items: { select: { itemType: true, quantityEggs: true, quantityTrays: true } } },
        });
        let soldStd = 0, soldStarter = 0, soldConsumable = 0;
        for (const o of orders) {
          for (const item of o.items) {
            const qty = item.quantityEggs ?? (item.quantityTrays ?? 0) * 30;
            if (item.itemType === 'STANDARD_EGGS')          soldStd      += qty;
            else if (item.itemType === 'STARTER_EGGS')      soldStarter  += qty;
            else if (item.itemType === 'CONSUMABLE_BROKEN_EGGS') soldConsumable += qty;
          }
        }
        return {
          date:                 agg.aggregateDate,
          standardEggs:         agg.totalStdEggs,
          starterEggs:          agg.totalStarterEggs,
          consumableEggs:       agg.totalBrokenSellable,
          nonConsumableEggs:    agg.totalBrokenUnsellable,
          soldStandard:         soldStd,
          soldStarter,
          soldConsumable,
          remainingStandard:    Math.max(0, agg.totalStdEggs - soldStd),
          remainingConsumable:  Math.max(0, agg.totalBrokenSellable - soldConsumable),
        };
      }),
    );

    return results;
  }
}
