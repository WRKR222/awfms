import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OrderStatus, PaymentMethod } from '@prisma/client';
import dayjs from 'dayjs';
import { FinanceService } from '../finance/finance.service';

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
    notes?: string;
    items: Array<{ grade: string; quantityTrays: number; unitPrice: number; }>;
  }, createdById: string) {
    const count = await this.prisma.salesOrder.count();
    const orderNumber = `SO-${dayjs().format('YYYYMMDD')}-${String(count + 1).padStart(4, '0')}`;

    const items = dto.items.map(i => ({
      itemType: 'EGGS',
      grade: i.grade,
      quantityTrays: i.quantityTrays,
      unitPrice: i.unitPrice,
      subtotal: i.quantityTrays * i.unitPrice,
    }));
    const subtotal = items.reduce((s, i) => s + i.subtotal, 0);

    return this.prisma.salesOrder.create({
      data: {
        orderNumber,
        customerId: dto.customerId,
        orderDate: new Date(dto.orderDate),
        paymentMethod: (dto.paymentMethod ?? 'CASH') as PaymentMethod,
        subtotal,
        deliveryAddress: dto.deliveryAddress,
        notes: dto.notes,
        createdById,
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
      where: { deletedAt: null, orderDate: { gte: from }, status: { not: 'CANCELLED' } },
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
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
      include: { customer: true, items: true },
    });
    await this.financeService.generateInvoiceForOrder(orderId, userId);
    return order;
  }
}
