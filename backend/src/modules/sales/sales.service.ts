import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OrderStatus, PaymentMethod } from '@prisma/client';
import { RequestUser } from '../../auth/types/request-user.type';
import dayjs from 'dayjs';
import { FinanceService } from '../finance/finance.service';

// ─── Egg item types (stored in SalesOrderItem.itemType) ──────────────────────
// NOTE: No 'grade' field is used anywhere. The egg category is expressed
//       entirely through itemType. The schema's nullable grade column is
//       intentionally left empty (never written).
export type EggItemType =
  | 'STANDARD_EGGS'
  | 'STARTER_EGGS'
  | 'CONSUMABLE_BROKEN_EGGS';

const VALID_EGG_TYPES: EggItemType[] = [
  'STANDARD_EGGS',
  'STARTER_EGGS',
  'CONSUMABLE_BROKEN_EGGS',
];

const EGG_TYPE_LABELS: Record<EggItemType, string> = {
  STANDARD_EGGS:          'Standard Eggs',
  STARTER_EGGS:           'Starter Eggs',
  CONSUMABLE_BROKEN_EGGS: 'Consumable Broken Eggs',
};

// ─── DTOs ─────────────────────────────────────────────────────────────────────
export interface CreateOrderItemDto {
  eggType: EggItemType;       // maps to SalesOrderItem.itemType
  quantityTrays: number;
  // unitPrice is NOT accepted from the client — always derived from DailyEggPrice
}

export interface CreateOrderDto {
  customerId: string;
  orderDate: string;
  paymentMethod: 'CASH' | 'MPESA' | 'BANK' | 'CREDIT';
  requiresDelivery?: boolean;
  deliveryAddress?: string;
  deliveryDate?: string;       // YYYY-MM-DD
  deliveryTime?: string;       // HH:mm optional note
  notes?: string;
  items: CreateOrderItemDto[];
}

@Injectable()
export class SalesService {
  constructor(
    private prisma: PrismaService,
    private financeService: FinanceService,
  ) {}

  // ── Customers ───────────────────────────────────────────────────────────────

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
    name: string;
    phone?: string;
    email?: string;
    address?: string;
    creditDays?: number;
  }) {
    if (!dto.name?.trim()) throw new BadRequestException('Customer name is required');
    return this.prisma.customer.create({
      data: {
        name:      dto.name.trim(),
        phone:     dto.phone?.trim()   ?? null,
        email:     dto.email?.trim()   ?? null,
        address:   dto.address?.trim() ?? null,
        creditDays: dto.creditDays     ?? 0,
      },
    });
  }

  async updateCustomer(
    id: string,
    dto: { name?: string; phone?: string; email?: string; address?: string; creditDays?: number },
  ) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('Customer not found');
    return this.prisma.customer.update({
      where: { id },
      data: {
        ...(dto.name      !== undefined ? { name:      dto.name?.trim()    } : {}),
        ...(dto.phone     !== undefined ? { phone:     dto.phone?.trim()   ?? null } : {}),
        ...(dto.email     !== undefined ? { email:     dto.email?.trim()   ?? null } : {}),
        ...(dto.address   !== undefined ? { address:   dto.address?.trim() ?? null } : {}),
        ...(dto.creditDays !== undefined ? { creditDays: dto.creditDays    } : {}),
      },
    });
  }

  // ── Egg Stock ────────────────────────────────────────────────────────────────
  // Derived from latest locked tally minus confirmed/sold orders minus adjustments.
  // itemType values used throughout — no grade field.

  async getSalesStock() {
    // 1. Latest locked tally
    const latestTally = await this.prisma.eggTallyVerification.findFirst({
      where: { isLocked: true },
      include: {
        session: {
          select: {
            totalGoodEggs:        true,
            totalStarterEggs:     true,
            totalBrokenSellable:  true,
            totalBrokenUnsellable:true,
          },
        },
      },
      orderBy: { lockedAt: 'desc' },
    });

    const tallyStandard     = (latestTally?.session as any)?.totalGoodEggs          ?? 0;
    const tallyStarter      = (latestTally?.session as any)?.totalStarterEggs       ?? 0;
    const tallyConsumable   = (latestTally?.session as any)?.totalBrokenSellable    ?? 0;
    const tallyNonConsumable= (latestTally?.session as any)?.totalBrokenUnsellable  ?? 0;
    const tallyDate         = latestTally?.lockedAt ?? new Date(0);

    // 2. Sold quantities (CONFIRMED, DELIVERING, DELIVERED orders after tally date)
    const soldItems = await this.prisma.salesOrderItem.findMany({
      where: {
        order: {
          status:    { in: ['CONFIRMED', 'DELIVERING', 'DELIVERED'] as OrderStatus[] },
          deletedAt: null,
          orderDate: { gte: tallyDate },
        },
      },
      select: { itemType: true, quantityTrays: true },
    });

    let soldStandard   = 0;
    let soldStarter    = 0;
    let soldConsumable = 0;
    for (const item of soldItems) {
      const qty = (item.quantityTrays ?? 0) * 30;
      if      (item.itemType === 'STANDARD_EGGS')          soldStandard   += qty;
      else if (item.itemType === 'STARTER_EGGS')           soldStarter    += qty;
      else if (item.itemType === 'CONSUMABLE_BROKEN_EGGS') soldConsumable += qty;
    }

    // 3. Apply breakage adjustments (latest values override previous)
    const breakages = await this.prisma.eggBreakageAdjustment.findMany({
      where: { adjustmentDate: { gte: tallyDate } },
      orderBy: { adjustmentDate: 'asc' },
    });
    let adjNonConsumable = tallyNonConsumable;
    let adjConsumable    = tallyConsumable;
    for (const b of breakages) {
      adjNonConsumable = b.newNonConsumable;
      adjConsumable    = b.newConsumable;
    }

    // 4. Locked bookings stock
    const lockedBookings = await this.prisma.advanceBooking.findMany({
      where: { stockLocked: true, status: { in: ['PENDING', 'CONFIRMED'] as any[] } },
    });
    let lockedStandard   = 0;
    let lockedStarter    = 0;
    let lockedConsumable = 0;
    for (const b of lockedBookings) {
      const notesStr = ((b as any).notes ?? '') as string;
      if      (notesStr.includes('Standard Eggs'))          lockedStandard   += b.quantityEggs;
      else if (notesStr.includes('Starter Eggs'))           lockedStarter    += b.quantityEggs;
      else if (notesStr.includes('Consumable Broken Eggs')) lockedConsumable += b.quantityEggs;
      else                                                   lockedStandard   += b.quantityEggs; // default
    }

    // 5. Available = tally − sold − locked
    const standardEggs      = Math.max(0, tallyStandard    - soldStandard   - lockedStandard);
    const starterEggs       = Math.max(0, tallyStarter     - soldStarter    - lockedStarter);
    const consumableEggs    = Math.max(0, adjConsumable    - soldConsumable - lockedConsumable);
    const nonConsumableEggs = Math.max(0, adjNonConsumable);

    // 6. Today's pricing
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const pricing = await this.prisma.dailyEggPrice.findUnique({ where: { priceDate: today } });

    return {
      standardEggs,
      starterEggs,
      consumableEggs,
      nonConsumableEggs,
      tallyDate: latestTally?.lockedAt ?? null,
      pricing: pricing
        ? {
            pricePerEgg:        Number(pricing.pricePerEgg),
            pricePerEggStarter: pricing.pricePerEggStarter ? Number(pricing.pricePerEggStarter) : null,
            pricePerEggBroken:  pricing.pricePerEggBroken  ? Number(pricing.pricePerEggBroken)  : null,
            expectedRevenue:    pricing.expectedRevenue    ? Number(pricing.expectedRevenue)    : null,
          }
        : null,
    };
  }

  // ── Orders ───────────────────────────────────────────────────────────────────

  async getOrders(days = 30, status?: string) {
    const from = dayjs().subtract(days, 'day').toDate();
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

  async createOrder(dto: CreateOrderDto, createdById: string) {
    // 1. Validate items
    if (!dto.items?.length) throw new BadRequestException('At least one item is required');
    for (const item of dto.items) {
      if (!VALID_EGG_TYPES.includes(item.eggType)) {
        throw new BadRequestException(
          `Invalid egg type "${item.eggType}". Must be STANDARD_EGGS, STARTER_EGGS, or CONSUMABLE_BROKEN_EGGS`,
        );
      }
      if (!item.quantityTrays || item.quantityTrays <= 0) {
        throw new BadRequestException('Quantity must be greater than zero');
      }
    }

    // 2. Enforce accountant's DailyEggPrice — fetch today's pricing
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const pricing = await this.prisma.dailyEggPrice.findUnique({ where: { priceDate: today } });
    if (!pricing) {
      throw new BadRequestException(
        'No egg pricing has been set for today. Ask the accountant to set today\'s prices before creating orders.',
      );
    }

    // 3. Map eggType → price per tray (= pricePerEgg × 30)
    const priceMap: Record<EggItemType, number | null> = {
      STANDARD_EGGS:          Number(pricing.pricePerEgg) * 30,
      STARTER_EGGS:           pricing.pricePerEggStarter ? Number(pricing.pricePerEggStarter) * 30 : null,
      CONSUMABLE_BROKEN_EGGS: pricing.pricePerEggBroken  ? Number(pricing.pricePerEggBroken)  * 30 : null,
    };

    // 4. Build order items using server-side prices (grade never written)
    const orderItems = dto.items.map(item => {
      const pricePerTray = priceMap[item.eggType];
      if (pricePerTray == null) {
        throw new BadRequestException(
          `No price set for "${EGG_TYPE_LABELS[item.eggType]}" today. Ask the accountant to add this egg type to the daily pricing.`,
        );
      }
      return {
        itemType:      item.eggType,        // e.g. 'STANDARD_EGGS'
        quantityTrays: item.quantityTrays,
        unitPrice:     pricePerTray,
        subtotal:      item.quantityTrays * pricePerTray,
        // grade column intentionally omitted (nullable, not used)
      };
    });

    const subtotal = orderItems.reduce((s, i) => s + i.subtotal, 0);

    // 5. Generate order number
    const count = await this.prisma.salesOrder.count();
    const orderNumber = `SO-${dayjs().format('YYYYMMDD')}-${String(count + 1).padStart(4, '0')}`;

    // 6. Delivery validation
    if (dto.requiresDelivery && !dto.deliveryAddress?.trim()) {
      throw new BadRequestException('Delivery address is required when delivery is requested');
    }

    // 7. Create order
    return this.prisma.salesOrder.create({
      data: {
        orderNumber,
        customerId:      dto.customerId,
        orderDate:       new Date(dto.orderDate),
        paymentMethod:   (dto.paymentMethod ?? 'CASH') as PaymentMethod,
        subtotal,
        deliveryAddress: dto.requiresDelivery ? dto.deliveryAddress?.trim() ?? null : null,
        deliveryDate:    dto.requiresDelivery && dto.deliveryDate ? new Date(dto.deliveryDate) : null,
        notes: [
          dto.notes,
          dto.requiresDelivery && dto.deliveryTime ? `Expected delivery time: ${dto.deliveryTime}` : null,
        ].filter(Boolean).join(' | ') || null,
        createdById,
        items: { create: orderItems },
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
      where: {
        deletedAt: null,
        orderDate: { gte: from },
        status: { not: 'CANCELLED' as OrderStatus },
      },
      include: { items: true },
    });

    const totalRevenue = orders.reduce((s, o) => s + Number(o.subtotal), 0);
    const totalTrays   = orders.reduce((s, o) => s + o.items.reduce((a, i) => a + (i.quantityTrays ?? 0), 0), 0);
    const avgPerTray   = totalTrays > 0 ? totalRevenue / totalTrays : 0;

    // Today's expected revenue
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const pricing = await this.prisma.dailyEggPrice.findUnique({ where: { priceDate: today } });
    const expectedRevenue = pricing?.expectedRevenue ? Number(pricing.expectedRevenue) : null;

    // Today's actual sold revenue (confirmed + delivering + delivered)
    const todayOrders = await this.prisma.salesOrder.findMany({
      where: {
        deletedAt: null,
        orderDate: { gte: today },
        status: { in: ['CONFIRMED', 'DELIVERING', 'DELIVERED'] as OrderStatus[] },
      },
    });
    const todayRevenue = todayOrders.reduce((s, o) => s + Number(o.subtotal), 0);
    const remainingRevenue   = expectedRevenue !== null ? Math.max(0, expectedRevenue - todayRevenue) : null;
    const revenueProgressPct = expectedRevenue ? Math.min(100, (todayRevenue / expectedRevenue) * 100) : null;

    return {
      totalRevenue, totalTrays, avgPerTray,
      orderCount: orders.length,
      expectedRevenue, todayRevenue, remainingRevenue, revenueProgressPct,
      pricingSet: !!pricing,
    };
  }

  async confirmOrder(orderId: string, userId: string) {
    const existing = await this.prisma.salesOrder.findUnique({ where: { id: orderId } });
    if (!existing) throw new NotFoundException('Order not found');
    if (existing.status !== 'PENDING' as OrderStatus) {
      throw new BadRequestException('Only PENDING orders can be confirmed');
    }
    const order = await this.prisma.salesOrder.update({
      where: { id: orderId },
      data: { status: 'CONFIRMED' as OrderStatus, confirmedAt: new Date() },
      include: { customer: true, items: true },
    });
    await this.financeService.generateInvoiceForOrder(orderId, userId);
    return order;
  }

  // ── Delivery ─────────────────────────────────────────────────────────────────

  async markOrderAsDelivering(id: string, user: RequestUser) {
    const order = await this.prisma.salesOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'CONFIRMED' as OrderStatus) {
      throw new BadRequestException('Only CONFIRMED orders can be marked as out for delivery');
    }
    if (!order.deliveryAddress) {
      throw new BadRequestException('Order has no delivery address — cannot mark as delivering');
    }
    return this.prisma.salesOrder.update({
      where: { id },
      data: { status: 'DELIVERING' as OrderStatus },
    });
  }

  async markOrderDelivered(id: string, notes: string, user: RequestUser) {
    const order = await this.prisma.salesOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'DELIVERING' as OrderStatus) {
      throw new BadRequestException('Only DELIVERING orders can be marked as delivered');
    }
    return this.prisma.salesOrder.update({
      where: { id },
      data: {
        status:        'DELIVERED' as OrderStatus,
        deliveryNotes:  notes ?? null,
        deliveredAt:    new Date(),
        deliveredById:  user.id,
      },
    });
  }

  // ── Breakage Adjustments ────────────────────────────────────────────────────

  async listBreakageAdjustments() {
    return this.prisma.eggBreakageAdjustment.findMany({
      include: { reportedBy: { select: { fullName: true } } },
      orderBy: { adjustmentDate: 'desc' },
      take: 100,
    });
  }

  async createBreakageAdjustment(
    dto: {
      adjustmentDate: string;
      adjustmentType: 'NON_CONSUMABLE' | 'CONSUMABLE';
      tallySessionId?: string;
      quantityStandardBefore: number;
      quantityStarterBefore: number;
      quantityNonConsumableBefore: number;
      quantityConsumableBefore: number;
      newNonConsumable: number;
      newConsumable: number;
      notes?: string;
    },
    user: RequestUser,
  ) {
    const count        = await this.prisma.eggBreakageAdjustment.count();
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

    // Notify accountants — breakage = expense (notifyExpense() per sequence diagram)
    const breakageTypeLabel = dto.adjustmentType === 'NON_CONSUMABLE'
      ? 'Non-consumable broken (unsellable)' : 'Consumable broken (sellable)';

    const accountants = await this.prisma.user.findMany({
      where: { role: 'ACCOUNTANT', isActive: true },
      select: { id: true },
    });
    for (const acc of accountants) {
      await this.prisma.notification.create({
        data: {
          userId:     acc.id,
          type:       'EGG_BREAKAGE_ADJUSTMENT' as any,
          title:      'Egg Breakage Expense — Action Required',
          message:    `Sales (${adjustment.reportedBy?.fullName ?? 'Sales'}) recorded a breakage on ` +
                      `${dayjs(adjustment.adjustmentDate).format('D MMM YYYY')}. ` +
                      `Type: ${breakageTypeLabel}. ` +
                      `Non-consumable: ${dto.quantityNonConsumableBefore} → ${dto.newNonConsumable}. ` +
                      `Consumable: ${dto.quantityConsumableBefore} → ${dto.newConsumable}. ` +
                      `Net diff: ${quantityDiff > 0 ? '+' : ''}${quantityDiff} eggs. Log as expense.`,
          entityId:   adjustment.id,
          entityType: 'EggBreakageAdjustment',
        },
      });
    }

    return adjustment;
  }

  async deleteCustomer(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('Customer not found');
    return this.prisma.customer.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
      select: { id: true, name: true, isActive: true },
    });
  }
}
