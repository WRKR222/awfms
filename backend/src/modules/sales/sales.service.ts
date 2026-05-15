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

    return this.prisma.eggBreakageAdjustment.create({
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
  }

  // ── Sales Stock ────────────────────────────────────────────────────────────
  // Returns a best-effort egg stock snapshot from the latest locked tally
  async getSalesStock() {
    const latestTally = await this.prisma.eggTallyVerification.findFirst({
      where: { isLocked: true },
      orderBy: { verificationDate: 'desc' },
      include: {
        session: {
          select: {
            totalGoodEggs: true,
            totalBrokenEggs: true,
            totalStarterEggs: true,
          },
        },
      },
    });

    if (!latestTally) {
      // Still return pricing even with no tally
      const todayDate = new Date();
      todayDate.setHours(0, 0, 0, 0);
      const todayPricing = await this.prisma.dailyEggPrice.findUnique({
        where: { priceDate: todayDate },
      });
      return {
        standardEggs:      0,
        starterEggs:       0,
        nonConsumableEggs: 0,
        consumableEggs:    0,
        lastVerifiedDate:  null,
        pricing: todayPricing ? {
          pricePerEgg: Number(todayPricing.pricePerEgg),
          pricePerEggStarter: Number((todayPricing as any).pricePerEggStarter ?? 0),
          pricePerEggBroken: Number((todayPricing as any).pricePerEggBroken ?? 0),
          priceDate: todayPricing.priceDate,
        } : null,
      };
    }

    // Count breakage adjustments to get current consumable/non-consumable
    const latestAdj = await this.prisma.eggBreakageAdjustment.findFirst({
      orderBy: { adjustmentDate: 'desc' },
    });

    // Fetch today's pricing
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const pricing = await this.prisma.dailyEggPrice.findUnique({
      where: { priceDate: today },
    });

    return {
      standardEggs:      latestTally.finalGoodEggs      ?? latestTally.session?.totalGoodEggs    ?? 0,
      starterEggs:       latestTally.session?.totalStarterEggs ?? 0,
      nonConsumableEggs: latestAdj?.newNonConsumable ?? latestTally.session?.totalBrokenEggs ?? 0,
      consumableEggs:    latestAdj?.newConsumable    ?? 0,
      lastVerifiedDate:  latestTally.verificationDate,
      pricing: pricing ? {
        pricePerEgg: Number(pricing.pricePerEgg),
        pricePerEggStarter: Number((pricing as any).pricePerEggStarter ?? 0),
        pricePerEggBroken: Number((pricing as any).pricePerEggBroken ?? 0),
        priceDate: pricing.priceDate,
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
