// backend/src/modules/finance/finance.service.ts
// Fixes: GAP-02 (categoryId FK bug), GAP-03 (add getAccountantSummary), GAP-07 (show all invoice statuses)
import {
  Injectable, NotFoundException, BadRequestException, Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { Cron } from '@nestjs/schedule';
import { InvoiceStatus, UserRole } from '@prisma/client';
import { RequestUser } from '../../auth/types/request-user.type';
import dayjs from 'dayjs';

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface CreateInvoiceFromOrderDto {
  salesOrderId: string;
  dueDate?: string;
  notes?: string;
}

export interface CreateManualInvoiceDto {
  customerId: string;
  invoiceDate: string;
  dueDate: string;
  shipDate?: string;
  notes?: string;
  vatPercent?: number;
  items: Array<{
    description: string;
    quantity: number;
    unitMeasure?: string;
    unitPrice: number;
  }>;
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
  category: string;     // category name (must exist)
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

  // ── GAP-03: Accountant Summary ────────────────────────────────────────────

  async getAccountantSummary() {
    const now = dayjs();
    const monthStart = now.startOf('month').toDate();

    const [paidThisMonth, totalInvoices, todayPrice] = await Promise.all([
      this.prisma.invoicePayment.aggregate({
        where: { paymentDate: { gte: monthStart } },
        _sum: { amount: true },
      }),
      this.prisma.invoice.count(),
      this.prisma.dailyEggPrice.findUnique({
        where: { priceDate: now.startOf('day').toDate() },
      }),
    ]);

    // Renamed conceptually to "pending issuance plan items awaiting accountant" —
    // kept the same response key (pendingPRCount) so existing frontend badges
    // keep working without a separate migration. Counts items, not whole plans,
    // since approval now happens per line item.
    const pendingPRCount = await this.prisma.issuancePlanItem.count({
      where: { status: 'PENDING_ACCOUNTANT' },
    });

    return {
      paidThisMonth: Number(paidThisMonth._sum.amount ?? 0),
      totalInvoices,
      pendingPriceSet: !todayPrice,
      pendingPRCount,
    };
  }

  // ── Invoice Generation ────────────────────────────────────────────────────

  async generateInvoiceForOrder(salesOrderId: string, createdById: string): Promise<any> {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: salesOrderId },
      include: { customer: true, items: true },
    });
    if (!order) throw new NotFoundException('Sales order not found');

    const existing = await this.prisma.invoice.findFirst({ where: { salesOrderId } });
    if (existing) return existing;

    const count = await this.prisma.invoice.count();
    const invoiceNumber = `INV-${dayjs().format('YYYYMM')}-${String(count + 1).padStart(4, '0')}`;
    const invoiceDate = dayjs().toDate();
    const dueDate = order.customer.creditDays > 0
      ? dayjs().add(order.customer.creditDays, 'day').toDate()
      : dayjs().toDate();
    const totalAmount = Number(order.subtotal);

    const invoice = await this.prisma.invoice.create({
      data: {
        invoiceNumber,
        salesOrderId,
        customerId:   order.customerId,
        invoiceDate:  dayjs(invoiceDate).startOf('day').toDate(),
        dueDate:      dayjs(dueDate).startOf('day').toDate(),
        subtotal:     order.subtotal,
        taxAmount:    0,
        totalAmount,
        paidAmount:   0,
        balanceDue:   totalAmount,
        status:       InvoiceStatus.UNPAID,
        createdById,
        notes:        order.notes ?? null,
      },
    });

    await this.prisma.arEntry.create({
      data: {
        invoiceId:      invoice.id,
        customerId:     order.customerId,
        originalAmount: totalAmount,
        currentBalance: totalAmount,
        dueDate:        invoice.dueDate,
      },
    });

    await this.notifications.notifyRole(
      UserRole.ACCOUNTANT, 'SYSTEM' as any,
      `Invoice ${invoiceNumber} Generated`,
      `Invoice ${invoiceNumber} for ${order.customer.name} — KES ${totalAmount.toLocaleString()} due ${dayjs(dueDate).format('D MMM YYYY')}.`,
      { entityId: invoice.id, entityType: 'Invoice' },
    );

    return invoice;
  }

  // ── Invoice Queries ───────────────────────────────────────────────────────

  async getInvoices(status?: InvoiceStatus, customerId?: string) {
    return this.prisma.invoice.findMany({
      where: {
        ...(status     ? { status }     : {}),
        ...(customerId ? { customerId } : {}),
      },
      include: {
        customer:   { select: { id: true, name: true, phone: true } },
        payments:   { orderBy: { paymentDate: 'desc' } },
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
        customer:   true,
        salesOrder: { include: { items: true } },
        payments:   { orderBy: { paymentDate: 'asc' } },
        arEntry:    true,
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
    if (invoice.status === InvoiceStatus.PAID)
      throw new BadRequestException('Invoice is already fully paid');

    const paymentAmount = Number(dto.amount);
    const newPaidAmount = Number(invoice.paidAmount) + paymentAmount;
    const newBalanceDue = Number(invoice.totalAmount) - newPaidAmount;
    if (newBalanceDue < -0.01)
      throw new BadRequestException('Payment amount exceeds invoice balance');

    const newStatus: InvoiceStatus = newBalanceDue <= 0.01
      ? InvoiceStatus.PAID : InvoiceStatus.PARTIAL;

    const payment = await this.prisma.invoicePayment.create({
      data: {
        invoiceId:     dto.invoiceId,
        paymentDate:   new Date(dto.paymentDate),
        amount:        paymentAmount,
        paymentMethod: dto.paymentMethod,
        reference:     dto.reference ?? null,
        notes:         dto.notes ?? null,
        recordedById:  user.id,
      },
    });

    await this.prisma.invoice.update({
      where: { id: dto.invoiceId },
      data: { paidAmount: newPaidAmount, balanceDue: Math.max(0, newBalanceDue), status: newStatus },
    });

    if (invoice.arEntry) {
      await this.prisma.arEntry.update({
        where: { id: invoice.arEntry.id },
        data: { currentBalance: Math.max(0, newBalanceDue) },
      });
    }

    if (newStatus === InvoiceStatus.PAID) {
      await this.notifications.notifyRole(
        UserRole.OWNER, 'SYSTEM' as any,
        `Invoice ${invoice.invoiceNumber} Paid`,
        `Full payment from ${invoice.customer.name} — KES ${Number(invoice.totalAmount).toLocaleString()}.`,
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
        where: { status: InvoiceStatus.OVERDUE }, _sum: { balanceDue: true },
      }),
      this.prisma.invoicePayment.aggregate({
        where: { paymentDate: { gte: dayjs().startOf('month').toDate() } },
        _sum: { amount: true },
      }),
    ]);
    return {
      totalOutstanding: arEntries.reduce((s, e) => s + Number(e.currentBalance), 0),
      overdueCount,
      overdueAmount:   Number(overdueAmount._sum.balanceDue ?? 0),
      paidThisMonth:   Number(paidThisMonth._sum.amount ?? 0),
    };
  }

  async getCustomerArDetail(customerId: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: { customerId, status: { not: InvoiceStatus.PAID } },
      include: { payments: true },
      orderBy: { dueDate: 'asc' },
    });
    return { customerId, invoices, totalBalance: invoices.reduce((s, i) => s + Number(i.balanceDue), 0) };
  }

  // ── Expense Categories ────────────────────────────────────────────────────

  async getExpenseCategories() {
    return this.prisma.expenseCategory.findMany({
      where: { isActive: true }, orderBy: { name: 'asc' },
    });
  }

  async createExpenseCategory(dto: CreateExpenseCategoryDto, user: RequestUser) {
    return this.prisma.expenseCategory.create({
      data: { name: dto.name.trim(), description: dto.description ?? null, createdById: user.id },
    });
  }

  async deactivateExpenseCategory(id: string) {
    return this.prisma.expenseCategory.update({ where: { id }, data: { isActive: false } });
  }

  // ── Expense Logging ───────────────────────────────────────────────────────

  async logExpense(dto: LogExpenseDto, user: RequestUser) {
    // Verify category exists
    const cat = await this.prisma.expenseCategory.findUnique({ where: { name: dto.category } });
    if (!cat) throw new NotFoundException(`Expense category '${dto.category}' not found`);

    return this.prisma.expenseLog.create({
      data: {
        categoryId:  cat.id,                   // ← GAP-02 FIX: was dto.category (name), must be UUID
        description: dto.description,
        amount:      dto.amount,
        expenseDate: new Date(dto.expenseDate),
        batchId:     dto.batchId    ?? null,
        vendorName:  dto.vendorName ?? null,
        receiptRef:  dto.receiptRef ?? null,
        recordedById: user.id,
      },
    });
  }

  async getExpenses(from?: string, to?: string, category?: string, batchId?: string) {
    return this.prisma.expenseLog.findMany({
      where: {
        // GAP-02 FIX: filter by category name through relation, not non-existent 'category' field
        ...(category ? { expenseCategory: { name: category } } : {}),
        ...(batchId  ? { batchId }                             : {}),
        ...(from || to ? {
          expenseDate: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to   ? { lte: new Date(to)   } : {}),
          },
        } : {}),
      },
      include: {
        expenseCategory: { select: { name: true } },
      },
      orderBy: { expenseDate: 'desc' },
      take: 500,
    });
  }

  async getExpenseSummaryByCategory(from: string, to: string) {
    const expenses = await this.prisma.expenseLog.findMany({
      where: { expenseDate: { gte: new Date(from), lte: new Date(to) } },
      select: { categoryId: true, amount: true, expenseCategory: { select: { name: true } } },
    });

    const grouped: Record<string, number> = {};
    for (const e of expenses) {
      const key = (e as any).expenseCategory?.name ?? e.categoryId;
      grouped[key] = (grouped[key] ?? 0) + Number(e.amount);
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
      case 'daily':     from = now.startOf('day'); break;
      case 'weekly':    from = now.startOf('week'); break;
      case 'monthly':   from = now.startOf('month'); break;
      case 'quarterly': {
        const qMonth = Math.floor(now.month() / 3) * 3;
        from = now.month(qMonth).startOf('month'); break;
      }
    }

    const [revenue, expenses, arSummary, overdueInvoices] = await Promise.all([
      this.prisma.invoicePayment.aggregate({
        where: { paymentDate: { gte: from.toDate() } }, _sum: { amount: true },
      }),
      this.prisma.expenseLog.aggregate({
        where: { expenseDate: { gte: from.toDate() } }, _sum: { amount: true },
      }),
      this.getArSummary(),
      this.prisma.invoice.findMany({
        where: { status: InvoiceStatus.OVERDUE },
        include: { customer: { select: { name: true } } },
        orderBy: { dueDate: 'asc' }, take: 5,
      }),
    ]);

    const revenueKes   = Number(revenue._sum.amount  ?? 0);
    const expensesKes  = Number(expenses._sum.amount ?? 0);
    const grossProfit  = revenueKes - expensesKes;
    const grossMarginPct = revenueKes > 0 ? (grossProfit / revenueKes) * 100 : 0;

    return {
      range, periodFrom: from.format('YYYY-MM-DD'),
      revenueKes, expensesKes, grossProfit,
      grossMarginPct: Math.round(grossMarginPct * 10) / 10,
      arSummary, overdueInvoices,
    };
  }

  // ── P&L Report ───────────────────────────────────────────────────────────
  // Returns revenue (payments received) + expenses in a given period for the PnL tab

  async getPnlReport(from: string, to: string) {
    const fromDate = new Date(from);
    const toDate   = new Date(to);
    // Push toDate to end of day
    toDate.setHours(23, 59, 59, 999);

    const [payments, expenses] = await Promise.all([
      this.prisma.invoicePayment.findMany({
        where: { paymentDate: { gte: fromDate, lte: toDate } },
        include: { invoice: { select: { invoiceNumber: true, customerId: true } } },
      }),
      this.prisma.expenseLog.findMany({
        where: { expenseDate: { gte: fromDate, lte: toDate } },
        include: { expenseCategory: { select: { name: true } } },
      }),
    ]);

    const totalRevenue  = payments.reduce((s, p) => s + Number(p.amount), 0);
    const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const netProfit     = totalRevenue - totalExpenses;
    const margin        = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

    const byCategory: Record<string, number> = {};
    for (const e of expenses) {
      const k = (e as any).expenseCategory?.name ?? 'Uncategorized';
      byCategory[k] = (byCategory[k] ?? 0) + Number(e.amount);
    }

    const byPaymentMethod: Record<string, number> = {};
    for (const p of payments) {
      const m = p.paymentMethod ?? 'CASH';
      byPaymentMethod[m] = (byPaymentMethod[m] ?? 0) + Number(p.amount);
    }

    return {
      period: { from, to },
      totalRevenue,
      totalExpenses,
      netProfit,
      grossMarginPct: Math.round(margin * 10) / 10,
      expensesByCategory: Object.entries(byCategory)
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount),
      revenueByPaymentMethod: Object.entries(byPaymentMethod)
        .map(([method, amount]) => ({ method, amount })),
      payments,
      expenses,
    };
  }

  // ── Sales Report (by item) ────────────────────────────────────────────────

  async getSalesReport(from: string, to: string) {
    const fromDate = new Date(from);
    const toDate   = new Date(to);
    toDate.setHours(23, 59, 59, 999);

    const orders = await this.prisma.salesOrder.findMany({
      where: {
        orderDate: { gte: fromDate, lte: toDate },
        status:    { not: 'CANCELLED' as any },
        deletedAt: null,
      },
      include: {
        customer: { select: { name: true } },
        items:    true,
      },
      orderBy: { orderDate: 'desc' },
    });

    // Aggregate by item type
    const byItemType: Record<string, { qty: number; revenue: number }> = {};
    for (const order of orders) {
      for (const item of order.items) {
        const k = item.itemType ?? 'UNKNOWN';
        if (!byItemType[k]) byItemType[k] = { qty: 0, revenue: 0 };
        byItemType[k].qty     += (item as any).quantityEggs ?? 0;
        byItemType[k].revenue += Number((item as any).subtotal ?? 0);
      }
    }

    const totalRevenue = orders.reduce((s, o) => s + Number(o.subtotal), 0);

    return {
      period: { from, to },
      orderCount: orders.length,
      totalRevenue,
      byItemType: Object.entries(byItemType)
        .map(([itemType, data]) => ({ itemType, ...data }))
        .sort((a, b) => b.revenue - a.revenue),
      orders: orders.map(o => ({
        id:          o.id,
        orderNumber: o.orderNumber,
        orderDate:   o.orderDate,
        customer:    o.customer,
        subtotal:    Number(o.subtotal),
        status:      o.status,
        paymentMethod: o.paymentMethod,
        items:       o.items,
      })),
    };
  }

  // ── Overdue Invoice Cron ─────────────────────────────────────────────────

  @Cron('0 1 * * *')
  async markOverdueInvoices() {
    this.logger.log('Running overdue invoice check...');
    const now = dayjs().startOf('day').toDate();
    const overdueNow = await this.prisma.invoice.findMany({
      where: { dueDate: { lt: now }, status: { in: [InvoiceStatus.UNPAID, InvoiceStatus.PARTIAL] } },
      include: { customer: { select: { name: true } } },
    });
    if (overdueNow.length === 0) return;

    await this.prisma.invoice.updateMany({
      where: { id: { in: overdueNow.map(i => i.id) } },
      data: { status: InvoiceStatus.OVERDUE },
    });
    await this.prisma.arEntry.updateMany({
      where: { invoiceId: { in: overdueNow.map(i => i.id) } },
      data: { updatedAt: new Date() },
    });

    const message = `${overdueNow.length} invoice${overdueNow.length > 1 ? 's' : ''} marked overdue: ${
      overdueNow.slice(0, 3).map(i => i.customer.name).join(', ')
    }${overdueNow.length > 3 ? ` + ${overdueNow.length - 3} more` : ''}.`;

    await this.notifications.notifyRole(UserRole.ACCOUNTANT, 'OVERDUE_INVOICE', 'Overdue Invoices', message);
    await this.notifications.notifyRole(UserRole.OWNER, 'OVERDUE_INVOICE', 'Overdue Invoices', message);
    this.logger.log(`Marked ${overdueNow.length} invoices as OVERDUE`);
  }
}
