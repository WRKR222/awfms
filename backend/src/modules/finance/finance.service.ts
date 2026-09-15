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
import PDFDocument from 'pdfkit';
import type { Response } from 'express';

const EGG_ITEM_LABELS: Record<string, string> = {
  STANDARD_EGGS:          'Standard Eggs',
  STARTER_EGGS:           'Starter Eggs',
  CONSUMABLE_BROKEN_EGGS: 'Consumable Broken Eggs',
};

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

/** A payment can be split across more than one method in a single
 *  submission — e.g. part cash, part M-Pesa — settling one invoice with
 *  several InvoicePayment rows created together instead of one call at a time. */
export interface LogSplitPaymentDto {
  invoiceId: string;
  paymentDate: string;
  payments: Array<{
    amount: number;
    paymentMethod: string;
    reference?: string;
    notes?: string;
  }>;
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

  // ── Invoice PDF ───────────────────────────────────────────────────────────

  /**
   * Streams a one-page, print-ready invoice PDF — company header, bill-to,
   * dates, a line-items table sized to the printable page width (so columns
   * never run off the edge), totals, and any payments already logged against
   * it (including split multi-method payments). Line items come from the
   * linked SalesOrder — every real invoice today is generated off one (see
   * generateInvoiceForOrder); CreateManualInvoiceDto exists but has no
   * implementation yet, so a manual-invoice fallback just shows one
   * "Invoice Total" line instead of a per-item breakdown.
   */
  async streamInvoicePdf(id: string, res: Response) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        customer: true,
        salesOrder: { include: { items: true } },
        payments: { orderBy: { paymentDate: 'asc' } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Invoice-${invoice.invoiceNumber}.pdf"`);
    doc.pipe(res);

    const brand   = '#2d7a4f';
    const gray    = '#6b7280';
    const dark    = '#111827';
    const light   = '#f3f4f6';
    const border  = '#e5e7eb';
    const left    = doc.page.margins.left;
    const pageWidth  = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const pageBottom = doc.page.height - doc.page.margins.bottom;
    const kes = (n: number) => `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // ── Header ──
    doc.fillColor(brand).font('Helvetica-Bold').fontSize(20).text('Anza Whole Foods', left, 50);
    doc.fillColor(gray).font('Helvetica').fontSize(9).text('Commercial Egg & Poultry Farm — Kenya', left, 73);

    doc.fillColor(dark).font('Helvetica-Bold').fontSize(22).text('INVOICE', left, 48, { width: pageWidth, align: 'right' });
    doc.fillColor(gray).font('Helvetica').fontSize(10).text(invoice.invoiceNumber, left, 74, { width: pageWidth, align: 'right' });

    doc.moveTo(left, 100).lineTo(left + pageWidth, 100).strokeColor(border).lineWidth(1).stroke();

    // ── Bill To (left) / dates (right) ──
    const topY = 115;
    doc.fillColor(gray).font('Helvetica-Bold').fontSize(8).text('BILL TO', left, topY);
    doc.fillColor(dark).font('Helvetica-Bold').fontSize(11).text(invoice.customer.name, left, topY + 13);
    let billY = topY + 30;
    doc.font('Helvetica').fontSize(9).fillColor(gray);
    if (invoice.customer.phone)   { doc.text(invoice.customer.phone, left, billY); billY += 13; }
    if (invoice.customer.email)   { doc.text(invoice.customer.email, left, billY); billY += 13; }
    if (invoice.customer.address) { doc.text(invoice.customer.address, left, billY, { width: 260 }); billY += 13; }

    const metaColWidth = 220;
    const metaX = left + pageWidth - metaColWidth;
    const metaRows: [string, string][] = [];
    if (invoice.salesOrder?.orderNumber) metaRows.push(['Order #', invoice.salesOrder.orderNumber]);
    metaRows.push(['Invoice Date', dayjs(invoice.invoiceDate).format('D MMM YYYY')]);
    metaRows.push(['Due Date', dayjs(invoice.dueDate).format('D MMM YYYY')]);
    metaRows.push(['Status', invoice.status]);
    let metaY = topY;
    for (const [label, value] of metaRows) {
      doc.fillColor(gray).font('Helvetica-Bold').fontSize(8).text(label.toUpperCase(), metaX, metaY, { width: metaColWidth, align: 'right' });
      doc.fillColor(dark).font('Helvetica').fontSize(10).text(value, metaX, metaY + 11, { width: metaColWidth, align: 'right' });
      metaY += 27;
    }

    let y = Math.max(billY, metaY) + 15;

    // ── Line items table ──
    const items = invoice.salesOrder?.items ?? [];
    const colFractions = [0.46, 0.16, 0.19, 0.19]; // Description | Qty | Unit Price | Amount — sums to 1
    const colWidths = colFractions.map(f => f * pageWidth);
    const colX = [left, left + colWidths[0], left + colWidths[0] + colWidths[1], left + colWidths[0] + colWidths[1] + colWidths[2]];
    const headers = ['Description', 'Qty', 'Unit Price', 'Amount'];

    const drawTableHeader = (headerY: number) => {
      doc.rect(left, headerY, pageWidth, 22).fill(brand);
      headers.forEach((h, i) => {
        doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9)
          .text(h, colX[i] + 6, headerY + 6, { width: colWidths[i] - 12, align: i === 0 ? 'left' : 'right' });
      });
      return headerY + 22;
    };
    y = drawTableHeader(y);

    const ensureRowSpace = (rowY: number, rowHeight: number) => {
      if (rowY + rowHeight > pageBottom - 120) { // leave room for totals block
        doc.addPage();
        return drawTableHeader(50);
      }
      return rowY;
    };

    const rows = items.length > 0
      ? items.map(item => {
          const label = EGG_ITEM_LABELS[item.itemType] ?? item.itemType;
          const qty = item.quantityEggs ?? (item.quantityTrays ? item.quantityTrays * 30 : 0);
          const qtyLabel = item.quantityTrays ? `${qty} eggs (${item.quantityTrays} trays)` : `${qty} eggs`;
          return { label, qtyLabel, unitPrice: Number(item.unitPrice), amount: Number(item.subtotal) };
        })
      : [{ label: 'Invoice Total', qtyLabel: '—', unitPrice: Number(invoice.subtotal), amount: Number(invoice.subtotal) }];

    rows.forEach((row, i) => {
      const rowHeight = 22;
      y = ensureRowSpace(y, rowHeight);
      if (i % 2 === 1) doc.rect(left, y, pageWidth, rowHeight).fill(light);
      doc.fillColor(dark).font('Helvetica').fontSize(9);
      doc.text(row.label,               colX[0] + 6, y + 6, { width: colWidths[0] - 12, align: 'left' });
      doc.text(row.qtyLabel,            colX[1] + 6, y + 6, { width: colWidths[1] - 12, align: 'right' });
      doc.text(kes(row.unitPrice),      colX[2] + 6, y + 6, { width: colWidths[2] - 12, align: 'right' });
      doc.text(kes(row.amount),         colX[3] + 6, y + 6, { width: colWidths[3] - 12, align: 'right' });
      y += rowHeight;
    });
    doc.moveTo(left, y).lineTo(left + pageWidth, y).strokeColor(border).stroke();
    y += 12;

    // ── Totals ──
    y = ensureRowSpace(y, 110);
    const totalsColWidth = 220;
    const totalsX = left + pageWidth - totalsColWidth;
    const totalLine = (label: string, value: string, opts?: { bold?: boolean; color?: string }) => {
      doc.font(opts?.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts?.bold ? 11 : 9.5)
        .fillColor(opts?.color ?? dark)
        .text(label, totalsX, y, { width: totalsColWidth - 100, align: 'left' })
        .text(value, totalsX + totalsColWidth - 100, y, { width: 100, align: 'right' });
      y += opts?.bold ? 20 : 16;
    };
    totalLine('Subtotal', kes(Number(invoice.subtotal)));
    if (Number(invoice.taxAmount) > 0) totalLine('Tax', kes(Number(invoice.taxAmount)));
    totalLine('Total', kes(Number(invoice.totalAmount)), { bold: true });
    totalLine('Paid', kes(Number(invoice.paidAmount)), { color: '#16a34a' });
    totalLine('Balance Due', kes(Number(invoice.balanceDue)), { bold: true, color: Number(invoice.balanceDue) > 0 ? '#dc2626' : '#16a34a' });

    // ── Payments received ──
    if (invoice.payments.length > 0) {
      y += 15;
      y = ensureRowSpace(y, 30 + invoice.payments.length * 16);
      doc.fillColor(dark).font('Helvetica-Bold').fontSize(10).text('Payments Received', left, y);
      y += 16;
      for (const p of invoice.payments) {
        y = ensureRowSpace(y, 16);
        const line = `${dayjs(p.paymentDate).format('D MMM YYYY')} · ${p.paymentMethod}` +
          (p.reference ? ` (Ref: ${p.reference})` : '');
        doc.fillColor(gray).font('Helvetica').fontSize(9)
          .text(line, left, y, { width: pageWidth - 100 })
          .text(kes(Number(p.amount)), left + pageWidth - 100, y, { width: 100, align: 'right' });
        y += 16;
      }
    }

    // ── Footer ──
    const footerY = pageBottom - 30;
    doc.fillColor(gray).font('Helvetica').fontSize(8)
      .text(`Generated ${dayjs().format('D MMM YYYY, h:mm A')} · Anza Whole Foods Farm Management System`, left, footerY, { width: pageWidth, align: 'center' });

    doc.end();
  }

  // ── Payment Logging ───────────────────────────────────────────────────────

  /** Single-method payment — thin wrapper around logSplitPayment (one line). */
  async logPayment(dto: LogPaymentDto, user: RequestUser) {
    const result = await this.logSplitPayment({
      invoiceId:   dto.invoiceId,
      paymentDate: dto.paymentDate,
      payments: [{
        amount: dto.amount, paymentMethod: dto.paymentMethod,
        reference: dto.reference, notes: dto.notes,
      }],
    }, user);
    return { payment: result.payments[0], newStatus: result.newStatus, newBalanceDue: result.newBalanceDue };
  }

  /**
   * Logs a payment that may be split across multiple methods in one
   * submission — e.g. KES 2,000 cash + KES 3,000 M-Pesa against the same
   * invoice. All lines are created together and the invoice/AR balance is
   * updated once off their combined total, rather than requiring the caller
   * to submit N separate payments (which would also fire N "invoice paid"
   * notifications instead of one).
   */
  async logSplitPayment(dto: LogSplitPaymentDto, user: RequestUser) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: dto.invoiceId },
      include: { customer: true, arEntry: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Invoice is already fully paid');
    }

    const lines = (dto.payments ?? []).filter(p => Number(p.amount) > 0);
    if (lines.length === 0) {
      throw new BadRequestException('At least one payment line with a positive amount is required');
    }

    const totalAmount = lines.reduce((s, p) => s + Number(p.amount), 0);
    const newPaidAmount = Number(invoice.paidAmount) + totalAmount;
    const newBalanceDue = Number(invoice.totalAmount) - newPaidAmount;
    if (newBalanceDue < -0.01) {
      throw new BadRequestException('Payment amount exceeds invoice balance');
    }
    const newStatus: InvoiceStatus = newBalanceDue <= 0.01
      ? InvoiceStatus.PAID : InvoiceStatus.PARTIAL;

    const payments = await this.prisma.$transaction(async tx => {
      const created = [];
      for (const line of lines) {
        created.push(await tx.invoicePayment.create({
          data: {
            invoiceId:     dto.invoiceId,
            paymentDate:   new Date(dto.paymentDate),
            amount:        Number(line.amount),
            paymentMethod: line.paymentMethod,
            reference:     line.reference ?? null,
            notes:         line.notes ?? null,
            recordedById:  user.id,
          },
        }));
      }

      await tx.invoice.update({
        where: { id: dto.invoiceId },
        data: { paidAmount: newPaidAmount, balanceDue: Math.max(0, newBalanceDue), status: newStatus },
      });

      if (invoice.arEntry) {
        await tx.arEntry.update({
          where: { id: invoice.arEntry.id },
          data: { currentBalance: Math.max(0, newBalanceDue) },
        });
      }

      return created;
    });

    if (newStatus === InvoiceStatus.PAID) {
      await this.notifications.notifyRole(
        UserRole.OWNER, 'SYSTEM' as any,
        `Invoice ${invoice.invoiceNumber} Paid`,
        `Full payment from ${invoice.customer.name} — KES ${Number(invoice.totalAmount).toLocaleString()}` +
        (payments.length > 1 ? ` (split across ${payments.length} payment methods).` : '.'),
        { entityId: invoice.id, entityType: 'Invoice' },
      );
    }

    return { payments, newStatus, newBalanceDue: Math.max(0, newBalanceDue) };
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

  // ── Batch Daily Cost ──────────────────────────────────────────────────────
  // Feed/vaccine-supplement/treatment cost per day for a batch, sourced from
  // StoreStockOut — the actual store issuance record (unitCostKes locked in
  // at issuance time) — rather than the individual attendant logs, since
  // vaccine/supplement/treatment logging can be free-text with no linked
  // store item at all and therefore no reliable cost of its own.

  async getBatchDailyCost(batchId: string, from?: string, to?: string) {
    const batch = await this.prisma.batch.findUnique({
      where: { id: batchId },
      select: { id: true, batchCode: true },
    });
    if (!batch) throw new NotFoundException('Batch not found');

    const toDate   = to && dayjs(to).isValid()   ? dayjs(to).endOf('day')     : dayjs().endOf('day');
    const fromDate = from && dayjs(from).isValid() ? dayjs(from).startOf('day') : toDate.subtract(29, 'day').startOf('day');

    const stockOuts = await this.prisma.storeStockOut.findMany({
      where: {
        issuedToBatchId: batchId,
        issuedDate: { gte: fromDate.toDate(), lte: toDate.toDate() },
      },
      include: { storeItem: { select: { category: true } } },
    });

    const FEED_CATEGORIES  = new Set(['FEED', 'FEED_SUPPLEMENT']);
    const VACC_CATEGORIES  = new Set(['VACCINE', 'SUPPLEMENT']);
    const TREAT_CATEGORIES = new Set(['TREATMENT', 'MEDICATION']);

    const byDay: Record<string, { feedCostKes: number; vaccineSupplementCostKes: number; treatmentCostKes: number; totalCostKes: number }> = {};

    for (const so of stockOuts) {
      const key = dayjs(so.issuedDate).format('YYYY-MM-DD');
      if (!byDay[key]) {
        byDay[key] = { feedCostKes: 0, vaccineSupplementCostKes: 0, treatmentCostKes: 0, totalCostKes: 0 };
      }
      const cost = Number(so.totalCostKes);
      const category = so.storeItem.category as string;
      if (FEED_CATEGORIES.has(category)) byDay[key].feedCostKes += cost;
      else if (VACC_CATEGORIES.has(category)) byDay[key].vaccineSupplementCostKes += cost;
      else if (TREAT_CATEGORIES.has(category)) byDay[key].treatmentCostKes += cost;
      byDay[key].totalCostKes += cost;
    }

    const days = Object.entries(byDay)
      .map(([date, costs]) => ({ date, ...costs }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const totalCostKes = days.reduce((s, d) => s + d.totalCostKes, 0);

    return {
      batch: { id: batch.id, batchCode: batch.batchCode },
      from: fromDate.format('YYYY-MM-DD'),
      to: toDate.format('YYYY-MM-DD'),
      days,
      totalCostKes,
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
