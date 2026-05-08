// src/modules/finance/finance.service.ts
import {
  Injectable, NotFoundException, BadRequestException, Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InvoiceStatus, UserRole } from '@prisma/client';
import { RequestUser } from '../../auth/types/request-user.type';
import dayjs from 'dayjs';

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface CreateInvoiceFromOrderDto {
  salesOrderId: string;
  dueDate?: string;    // ISO date string — defaults to creditDays from customer
  notes?: string;
}

export interface LogPaymentDto {
  invoiceId: string;
  paymentDate: string;
  amount: number;
  paymentMethod: 'CASH' | 'MPESA' | 'BANK_TRANSFER';
  reference?: string;
  notes?: string;
}

export interface CreateExpenseCategoryDto {
  name: string;
  description?: string;
}

export interface LogExpenseDto {
  category: string;          // category name (must exist)
  description: string;
  amount: number;
  expenseDate: string;
  batchId?: string;
  vendorName?: string;
  receiptRef?: string;
}

// ── SERVICE ───────────────────────────────────────────────────────────────────

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Invoice Generation ────────────────────────────────────────────────────

  /** Auto-generates an invoice from a confirmed SalesOrder.
   *  Called by SalesService when order status moves to CONFIRMED.
   */
  async generateInvoiceForOrder(salesOrderId: string, createdById: string): Promise<any> {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: salesOrderId },
      include: {
        customer: true,
        items: true,
      },
    });
    if (!order) throw new NotFoundException('Sales order not found');

    // Avoid duplicate invoice
    const existing = await this.prisma.invoice.findFirst({
      where: { salesOrderId },
    });
    if (existing) return existing;

    // Sequential invoice number: INV-YYYYMM-XXXX
    const count = await this.prisma.invoice.count();
    const invoiceNumber = `INV-${dayjs().format('YYYYMM')}-${String(count + 1).padStart(4, '0')}`;

    const invoiceDate = dayjs().toDate();
    const dueDate = order.customer.creditDays > 0
      ? dayjs().add(order.customer.creditDays, 'day').toDate()
      : dayjs().toDate(); // cash on delivery

    const totalAmount = Number(order.subtotal);

    const invoice = await this.prisma.invoice.create({
      data: {
        invoiceNumber,
        salesOrderId,
        customerId: order.customerId,
        invoiceDate: dayjs(invoiceDate).startOf('day').toDate(),
        dueDate: dayjs(dueDate).startOf('day').toDate(),
        subtotal: order.subtotal,
        taxAmount: 0,
        totalAmount,
        paidAmount: 0,
        balanceDue: totalAmount,
        status: InvoiceStatus.UNPAID,
        createdById,
        notes: order.notes ?? null,
      },
    });

    // Create linked AR entry
    await this.prisma.arEntry.create({
      data: {
        invoiceId: invoice.id,
        customerId: order.customerId,
        originalAmount: totalAmount,
        currentBalance: totalAmount,
        dueDate: invoice.dueDate,
      },
    });

    // Notify accountant
    await this.notifications.notifyRole(
      UserRole.ACCOUNTANT,
      'SYSTEM' as any,
      `Invoice ${invoiceNumber} Generated`,
      `Invoice ${invoiceNumber} for ${order.customer.name} — KES ${totalAmount.toLocaleString()} — due ${dayjs(dueDate).format('D MMM YYYY')}.`,
      { entityId: invoice.id, entityType: 'Invoice' },
    );

    return invoice;
  }

  // ── Invoice Queries ───────────────────────────────────────────────────────

  async getInvoices(status?: InvoiceStatus, customerId?: string) {
    return this.prisma.invoice.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(customerId ? { customerId } : {}),
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        payments: { orderBy: { paymentDate: 'desc' } },
        salesOrder: { select: { orderNumber: true, items: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async getInvoiceById(id: string) {
    const inv = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        customer: true,
        salesOrder: { include: { items: true } },
        payments: { orderBy: { paymentDate: 'asc' } },
        arEntry: true,
      },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    return inv;
  }

  // ── Payment Logging ───────────────────────────────────────────────────────

  async logPayment(dto: LogPaymentDto, user: RequestUser) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: dto.invoiceId },
      include: { customer: true, arEntry: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Invoice is already fully paid');
    }

    const paymentAmount = Number(dto.amount);
    const newPaidAmount = Number(invoice.paidAmount) + paymentAmount;
    const newBalanceDue = Number(invoice.totalAmount) - newPaidAmount;

    if (newBalanceDue < -0.01) {
      throw new BadRequestException('Payment amount exceeds invoice balance');
    }

    const newStatus: InvoiceStatus = newBalanceDue <= 0.01
      ? InvoiceStatus.PAID
      : InvoiceStatus.PARTIAL;

    // Log the payment
    const payment = await this.prisma.invoicePayment.create({
      data: {
        invoiceId: dto.invoiceId,
        paymentDate: new Date(dto.paymentDate),
        amount: paymentAmount,
        paymentMethod: dto.paymentMethod,
        reference: dto.reference ?? null,
        notes: dto.notes ?? null,
        recordedById: user.id,
      },
    });

    // Update invoice
    await this.prisma.invoice.update({
      where: { id: dto.invoiceId },
      data: {
        paidAmount: newPaidAmount,
        balanceDue: Math.max(0, newBalanceDue),
        status: newStatus,
      },
    });

    // Update AR entry
    if (invoice.arEntry) {
      await this.prisma.arEntry.update({
        where: { id: invoice.arEntry.id },
        data: { currentBalance: Math.max(0, newBalanceDue) },
      });
    }

    // Notify owner if fully paid
    if (newStatus === InvoiceStatus.PAID) {
      await this.notifications.notifyRole(
        UserRole.OWNER,
        'SYSTEM' as any,
        `Invoice ${invoice.invoiceNumber} Paid`,
        `Full payment received from ${invoice.customer.name} — KES ${Number(invoice.totalAmount).toLocaleString()}.`,
        { entityId: invoice.id, entityType: 'Invoice' },
      );
    }

    return { payment, newStatus, newBalanceDue: Math.max(0, newBalanceDue) };
  }

  // ── AR Summary ────────────────────────────────────────────────────────────

  async getArSummary() {
    const [arEntries, overdueCount, overdueAmount, paidThisMonth] = await Promise.all([
      this.prisma.arEntry.findMany({ select: { currentBalance: true } }),
      this.prisma.invoice.count({ where: { status: InvoiceStatus.OVERDUE } }),
      this.prisma.invoice.aggregate({
        where: { status: InvoiceStatus.OVERDUE },
        _sum: { balanceDue: true },
      }),
      this.prisma.invoicePayment.aggregate({
        where: {
          paymentDate: { gte: dayjs().startOf('month').toDate() },
        },
        _sum: { amount: true },
      }),
    ]);

    const totalOutstanding = arEntries.reduce((s, e) => s + Number(e.currentBalance), 0);

    return {
      totalOutstanding,
      overdueCount,
      overdueAmount: Number(overdueAmount._sum.balanceDue ?? 0),
      paidThisMonth: Number(paidThisMonth._sum.amount ?? 0),
    };
  }

  // ── Customer AR Detail ────────────────────────────────────────────────────

  async getCustomerArDetail(customerId: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: { customerId, status: { not: InvoiceStatus.PAID } },
      include: { payments: true },
      orderBy: { dueDate: 'asc' },
    });
    const totalBalance = invoices.reduce((s, i) => s + Number(i.balanceDue), 0);
    return { customerId, invoices, totalBalance };
  }

  // ── Expense Categories (custom, accountant-defined) ───────────────────────

  async getExpenseCategories() {
    return this.prisma.expenseCategory.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async createExpenseCategory(dto: CreateExpenseCategoryDto, user: RequestUser) {
    return this.prisma.expenseCategory.create({
      data: {
        name: dto.name.trim(),
        description: dto.description ?? null,
        createdById: user.id,
      },
    });
  }

  async deactivateExpenseCategory(id: string) {
    return this.prisma.expenseCategory.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // ── Expense Logging ───────────────────────────────────────────────────────

  async logExpense(dto: LogExpenseDto, user: RequestUser) {
    // Verify category exists
    const cat = await this.prisma.expenseCategory.findUnique({ where: { name: dto.category } });
    if (!cat) throw new NotFoundException(`Expense category '${dto.category}' not found`);

    return this.prisma.expenseLog.create({
      data: {
        categoryId: dto.category,
        description: dto.description,
        amount: dto.amount,
        expenseDate: new Date(dto.expenseDate),
        batchId: dto.batchId ?? null,
        vendorName: dto.vendorName ?? null,
        receiptRef: dto.receiptRef ?? null,
        recordedById: user.id,
      },
    });
  }

  async getExpenses(from?: string, to?: string, category?: string, batchId?: string) {
    return this.prisma.expenseLog.findMany({
      where: {
        ...(category ? { category } : {}),
        ...(batchId ? { batchId } : {}),
        ...(from || to ? {
          expenseDate: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to   ? { lte: new Date(to)   } : {}),
          },
        } : {}),
      },
      orderBy: { expenseDate: 'desc' },
      take: 500,
    });
  }

  async getExpenseSummaryByCategory(from: string, to: string) {
    const expenses = await this.prisma.expenseLog.findMany({
      where: {
        expenseDate: { gte: new Date(from), lte: new Date(to) },
      },
      select: { categoryId: true, amount: true },
    });

    const grouped: Record<string, number> = {};
    for (const e of expenses) {
      grouped[e.categoryId] = (grouped[e.categoryId] ?? 0) + Number(e.amount);
    }
    const total = Object.values(grouped).reduce((s, v) => s + v, 0);

    return {
      period: { from, to },
      byCategory: Object.entries(grouped)
        .map(([category, totalKes]) => ({ category, totalKes }))
        .sort((a, b) => b.totalKes - a.totalKes),
      total,
    };
  }

  // ── Owner Finance Dashboard ───────────────────────────────────────────────

  async getOwnerFinanceDashboard(range: 'daily' | 'weekly' | 'monthly' | 'quarterly') {
    const now = dayjs();
    let from: dayjs.Dayjs;

    switch (range) {
      case 'daily':   from = now.startOf('day'); break;
      case 'weekly':  from = now.startOf('week'); break;
      case 'monthly': from = now.startOf('month'); break;
      case 'quarterly':
        const qMonth = Math.floor(now.month() / 3) * 3;
        from = now.month(qMonth).startOf('month');
        break;
    }

    const [revenue, expenses, arSummary, topCustomers, overdueInvoices] = await Promise.all([
      // Revenue: sum of payments received in period
      this.prisma.invoicePayment.aggregate({
        where: { paymentDate: { gte: from.toDate() } },
        _sum: { amount: true },
      }),
      // Expenses: sum logged in period
      this.prisma.expenseLog.aggregate({
        where: { expenseDate: { gte: from.toDate() } },
        _sum: { amount: true },
      }),
      this.getArSummary(),
      // Top customers by revenue in period
      this.prisma.invoicePayment.groupBy({
        by: ['invoiceId'],
        where: { paymentDate: { gte: from.toDate() } },
        _sum: { amount: true },
      }),
      // Overdue invoices list
      this.prisma.invoice.findMany({
        where: { status: InvoiceStatus.OVERDUE },
        include: { customer: { select: { name: true } } },
        orderBy: { dueDate: 'asc' },
        take: 5,
      }),
    ]);

    const revenueKes = Number(revenue._sum.amount ?? 0);
    const expensesKes = Number(expenses._sum.amount ?? 0);
    const grossProfit = revenueKes - expensesKes;
    const grossMarginPct = revenueKes > 0 ? (grossProfit / revenueKes) * 100 : 0;

    return {
      range,
      periodFrom: from.format('YYYY-MM-DD'),
      revenueKes,
      expensesKes,
      grossProfit,
      grossMarginPct: Math.round(grossMarginPct * 10) / 10,
      arSummary,
      overdueInvoices,
    };
  }

  // ── Overdue Invoice Cron ─────────────────────────────────────────────────
  // Runs nightly at 01:00 — marks UNPAID/PARTIAL invoices past due date as OVERDUE

  @Cron('0 1 * * *')  // 1 AM every day
  async markOverdueInvoices() {
    this.logger.log('Running overdue invoice check...');
    const now = dayjs().startOf('day').toDate();

    const overdueNow = await this.prisma.invoice.findMany({
      where: {
        dueDate: { lt: now },
        status: { in: [InvoiceStatus.UNPAID, InvoiceStatus.PARTIAL] },
      },
      include: { customer: { select: { name: true } } },
    });

    if (overdueNow.length === 0) return;

    await this.prisma.invoice.updateMany({
      where: { id: { in: overdueNow.map(i => i.id) } },
      data: { status: InvoiceStatus.OVERDUE },
    });

    // Also update AR entries
    await this.prisma.arEntry.updateMany({
      where: { invoiceId: { in: overdueNow.map(i => i.id) } },
      data: { updatedAt: new Date() },
    });

    // Notify accountant + owner
    const message = `${overdueNow.length} invoice${overdueNow.length > 1 ? 's' : ''} marked overdue: ${
      overdueNow.slice(0, 3).map(i => i.customer.name).join(', ')
    }${overdueNow.length > 3 ? ` + ${overdueNow.length - 3} more` : ''}.`;

    await this.notifications.notifyRole(UserRole.ACCOUNTANT, 'OVERDUE_INVOICE', 'Overdue Invoices', message);
    await this.notifications.notifyRole(UserRole.OWNER, 'OVERDUE_INVOICE', 'Overdue Invoices', message);

    this.logger.log(`Marked ${overdueNow.length} invoices as OVERDUE`);
  }
}
