// src/modules/finance/finance-export.service.ts
// Phase 7 Addendum B — Accountant Excel export (exceljs)
// Generates structured multi-sheet .xlsx matching accountant tabulation standard

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import ExcelJS from 'exceljs';
import dayjs from 'dayjs';

export type ExportType = 'all' | 'production' | 'poultry' | 'revenue' | 'summary';

@Injectable()
export class FinanceExportService {
  constructor(private readonly prisma: PrismaService) {}

  async generateExcel(
    from: string,
    to: string,
    type: ExportType = 'all',
  ): Promise<Buffer> {
    const fromDate = new Date(from);
    const toDate   = new Date(to);
    const label    = `${dayjs(from).format('D MMM YYYY')} – ${dayjs(to).format('D MMM YYYY')}`;

    const wb = new ExcelJS.Workbook();
    wb.creator  = 'AWFMS';
    wb.created  = new Date();
    wb.modified = new Date();

    if (type === 'all' || type === 'production') {
      await this.addProductionCostSheet(wb, fromDate, toDate, label);
    }
    if (type === 'all' || type === 'poultry') {
      await this.addPoultrySheet(wb, fromDate, toDate, label);
    }
    if (type === 'all' || type === 'revenue') {
      await this.addRevenueSheet(wb, fromDate, toDate, label);
    }
    if (type === 'all' || type === 'summary') {
      await this.addSummarySheet(wb, fromDate, toDate, label);
    }

    const buf = await wb.xlsx.writeBuffer();
    return buf as unknown as Buffer;
  }

  // ── Helper: style header row ───────────────────────────────────────────────

  private styleHeader(ws: ExcelJS.Worksheet, row: ExcelJS.Row, bg = '1A3A2A') {
    row.eachCell(cell => {
      cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      cell.font   = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
      cell.border = {
        bottom: { style: 'thin', color: { argb: '4ADE80' } },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    row.height = 20;
  }

  private styleTitle(ws: ExcelJS.Worksheet, row: ExcelJS.Row) {
    row.eachCell(cell => {
      cell.font      = { bold: true, size: 12, color: { argb: '1A3A2A' } };
      cell.alignment = { horizontal: 'left' };
    });
    row.height = 22;
  }

  private styleSubtitle(ws: ExcelJS.Worksheet, row: ExcelJS.Row) {
    row.eachCell(cell => {
      cell.font      = { italic: true, size: 9, color: { argb: '6B7280' } };
      cell.alignment = { horizontal: 'left' };
    });
  }

  private addTotalRow(ws: ExcelJS.Worksheet, values: (string | number | null)[], numericCols: number[]) {
    const row = ws.addRow(values);
    row.eachCell((cell, col) => {
      cell.font = { bold: true, size: 10 };
      if (numericCols.includes(col)) {
        cell.numFmt = '#,##0.00';
      }
    });
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F0FDF4' } };
    return row;
  }

  private fmtNum(val: any): number {
    return Math.round(Number(val ?? 0) * 100) / 100;
  }

  // ── Sheet 1: Production Cost ───────────────────────────────────────────────

  private async addProductionCostSheet(
    wb: ExcelJS.Workbook,
    from: Date,
    to: Date,
    label: string,
  ) {
    const ws = wb.addWorksheet('Production Cost');
    ws.columns = [
      { key: 'date',      width: 14 },
      { key: 'category',  width: 22 },
      { key: 'desc',      width: 36 },
      { key: 'qty',       width: 12 },
      { key: 'unit',      width: 10 },
      { key: 'unitCost',  width: 14 },
      { key: 'totalCost', width: 16 },
      { key: 'supplier',  width: 20 },
      { key: 'batch',     width: 14 },
    ];

    this.styleTitle(ws, ws.addRow(['ANZA WHOLE FOODS — PRODUCTION COST REPORT']));
    ws.mergeCells('A1:I1');
    this.styleSubtitle(ws, ws.addRow([label]));
    ws.mergeCells('A2:I2');
    ws.addRow([]);

    const hdr = ws.addRow(['Date', 'Category', 'Description', 'Quantity', 'Unit', 'Unit Cost (KES)', 'Total Cost (KES)', 'Supplier', 'Batch']);
    this.styleHeader(ws, hdr);

    const expenses = await this.prisma.expenseLog.findMany({
      where: { expenseDate: { gte: from, lte: to } },
      include: { expenseCategory: true },
      orderBy: [{ expenseCategory: { name: 'asc' } }, { expenseDate: 'asc' }],
    });

    const costRecords = await (this.prisma as any).historicalCostRecord.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: [{ category: 'asc' }, { date: 'asc' }],
    });

    let grandTotal = 0;

    for (const e of expenses) {
      const total = this.fmtNum(e.amount);
      grandTotal += total;
      const row = ws.addRow([
        dayjs(e.expenseDate).format('DD/MM/YYYY'),
        e.expenseCategory.name,
        e.description,
        null,
        null,
        null,
        total,
        e.vendorName ?? '',
        '',
      ]);
      row.getCell(7).numFmt = '#,##0.00';
    }

    for (const r of costRecords) {
      const total = this.fmtNum(r.totalCostKes);
      grandTotal += total;
      const row = ws.addRow([
        dayjs(r.date).format('DD/MM/YYYY'),
        r.category,
        r.description,
        r.quantity != null ? this.fmtNum(r.quantity) : null,
        r.unit ?? '',
        r.unitCostKes != null ? this.fmtNum(r.unitCostKes) : null,
        total,
        r.supplier ?? '',
        r.batchCode ?? '',
      ]);
      row.getCell(4).numFmt = '#,##0.000';
      row.getCell(6).numFmt = '#,##0.00';
      row.getCell(7).numFmt = '#,##0.00';
    }

    ws.addRow([]);
    this.addTotalRow(ws, ['', '', '', '', '', 'TOTAL', grandTotal, '', ''], [7]);
  }

  // ── Sheet 2: Poultry Performance ──────────────────────────────────────────

  private async addPoultrySheet(
    wb: ExcelJS.Workbook,
    from: Date,
    to: Date,
    label: string,
  ) {
    const ws = wb.addWorksheet('Poultry Report');
    ws.columns = [
      { key: 'date',      width: 14 },
      { key: 'batch',     width: 14 },
      { key: 'house',     width: 16 },
      { key: 'opening',   width: 12 },
      { key: 'mortality', width: 12 },
      { key: 'closing',   width: 12 },
      { key: 'goodEggs',  width: 14 },
      { key: 'trays',     width: 10 },
      { key: 'hdp',       width: 10 },
      { key: 'feedKg',    width: 12 },
    ];

    this.styleTitle(ws, ws.addRow(['ANZA WHOLE FOODS — POULTRY PERFORMANCE REPORT']));
    ws.mergeCells('A1:J1');
    this.styleSubtitle(ws, ws.addRow([label]));
    ws.mergeCells('A2:J2');
    ws.addRow([]);

    const hdr = ws.addRow(['Date', 'Batch', 'House', 'Opening Pop.', 'Mortality', 'Closing Pop.', 'Good Eggs', 'Trays', 'HDP %', 'Feed (kg)']);
    this.styleHeader(ws, hdr);

    const sessions = await this.prisma.eggCollectionSession.findMany({
      where: { sessionDate: { gte: from, lte: to }, status: 'APPROVED' },
      include: { batch: { include: { house: true } } },
      orderBy: [{ sessionDate: 'asc' }, { shift: 'asc' }],
    });

    let totalEggs = 0, totalMort = 0;

    for (const s of sessions) {
      const good = s.totalGoodEggs ?? 0;
      const mort = s.mortalities ?? 0;
      totalEggs += good;
      totalMort += mort;
      const row = ws.addRow([
        dayjs(s.sessionDate).format('DD/MM/YYYY'),
        s.batch.batchCode,
        s.batch.house?.name ?? '',
        s.openingPop,
        mort,
        (s.openingPop - mort),
        good,
        Math.floor(good / 30),
        s.henDayPercent != null ? `${Number(s.henDayPercent).toFixed(1)}%` : '',
        s.dailyFeedKg != null ? this.fmtNum(s.dailyFeedKg) : '',
      ]);
      row.getCell(10).numFmt = '#,##0.00';
    }

    // Also include historical production records
    const historical = await (this.prisma as any).historicalProductionRecord.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
    });

    for (const r of historical) {
      totalEggs += r.goodEggs;
      totalMort += r.mortality ?? 0;
      ws.addRow([
        dayjs(r.date).format('DD/MM/YYYY'),
        r.batchCode ?? 'Historical',
        '',
        r.birdCount,
        r.mortality ?? 0,
        r.birdCount - (r.mortality ?? 0),
        r.goodEggs,
        Math.floor(r.goodEggs / 30),
        '',
        '',
      ]);
    }

    ws.addRow([]);
    this.addTotalRow(ws, ['', '', '', '', totalMort, '', totalEggs, Math.floor(totalEggs / 30), '', ''], [5, 7, 8]);
  }

  // ── Sheet 3: Revenue & AR ─────────────────────────────────────────────────

  private async addRevenueSheet(
    wb: ExcelJS.Workbook,
    from: Date,
    to: Date,
    label: string,
  ) {
    const ws = wb.addWorksheet('Revenue & AR');
    ws.columns = [
      { key: 'invDate',  width: 14 },
      { key: 'invNo',    width: 18 },
      { key: 'customer', width: 28 },
      { key: 'trays',    width: 10 },
      { key: 'amount',   width: 16 },
      { key: 'paid',     width: 16 },
      { key: 'balance',  width: 16 },
      { key: 'status',   width: 14 },
      { key: 'payDate',  width: 14 },
    ];

    this.styleTitle(ws, ws.addRow(['ANZA WHOLE FOODS — REVENUE & ACCOUNTS RECEIVABLE']));
    ws.mergeCells('A1:I1');
    this.styleSubtitle(ws, ws.addRow([label]));
    ws.mergeCells('A2:I2');
    ws.addRow([]);

    const hdr = ws.addRow(['Inv. Date', 'Invoice No.', 'Customer', 'Trays', 'Amount (KES)', 'Paid (KES)', 'Balance (KES)', 'Status', 'Payment Date']);
    this.styleHeader(ws, hdr);

    const invoices = await this.prisma.invoice.findMany({
      where: { createdAt: { gte: from, lte: to } },
      include: {
        payments: true,
        customer: true,
        salesOrder: { include: { items: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    let totalAmount = 0, totalPaid = 0;

    for (const inv of invoices) {
      const amount  = this.fmtNum(inv.totalAmount);
      const paid    = inv.payments.reduce((s, p) => s + this.fmtNum(p.amount), 0);
      const balance = amount - paid;
      totalAmount  += amount;
      totalPaid    += paid;

      const latestPayment = inv.payments.sort((a, b) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime())[0];

      const row = ws.addRow([
        dayjs(inv.createdAt).format('DD/MM/YYYY'),
        inv.invoiceNumber,
        inv.customer?.name ?? '',
        inv.salesOrder?.items?.reduce((s: number, i: any) => s + (i.quantityTrays ?? 0), 0) ?? '',
        amount,
        paid,
        balance,
        inv.status,
        latestPayment ? dayjs(latestPayment.paymentDate).format('DD/MM/YYYY') : '',
      ]);
      [5, 6, 7].forEach(c => { row.getCell(c).numFmt = '#,##0.00'; });
      if (balance > 0) {
        row.getCell(7).font = { color: { argb: 'DC2626' }, bold: true };
      }
    }

    // Historical sales
    const histSales = await (this.prisma as any).historicalSalesRecord.findMany({
      where: { invoiceDate: { gte: from, lte: to } },
      orderBy: { invoiceDate: 'asc' },
    });

    for (const r of histSales) {
      const amount = this.fmtNum(r.totalKes);
      totalAmount += amount;
      totalPaid   += amount; // historical = fully settled
      const row = ws.addRow([
        dayjs(r.invoiceDate).format('DD/MM/YYYY'),
        r.invoiceNumber,
        r.customerName,
        r.quantityTrays,
        amount,
        amount,
        0,
        'HISTORICAL',
        r.paymentDate ? dayjs(r.paymentDate).format('DD/MM/YYYY') : '',
      ]);
      [5, 6, 7].forEach(c => { row.getCell(c).numFmt = '#,##0.00'; });
    }

    ws.addRow([]);
    this.addTotalRow(ws, ['', '', '', '', totalAmount, totalPaid, totalAmount - totalPaid, '', ''], [5, 6, 7]);
  }

  // ── Sheet 4: Executive Summary ────────────────────────────────────────────

  private async addSummarySheet(
    wb: ExcelJS.Workbook,
    from: Date,
    to: Date,
    label: string,
  ) {
    const ws = wb.addWorksheet('Summary');
    ws.columns = [{ key: 'label', width: 36 }, { key: 'value', width: 22 }];

    this.styleTitle(ws, ws.addRow(['ANZA WHOLE FOODS — EXECUTIVE SUMMARY']));
    ws.mergeCells('A1:B1');
    this.styleSubtitle(ws, ws.addRow([label]));
    ws.mergeCells('A2:B2');
    ws.addRow([]);

    const [expenses, invoices, histSales, sessions, batches] = await Promise.all([
      this.prisma.expenseLog.aggregate({ where: { expenseDate: { gte: from, lte: to } }, _sum: { amount: true }, _count: true }),
      this.prisma.invoice.findMany({ where: { createdAt: { gte: from, lte: to } }, include: { payments: true, customer: true } }),
      (this.prisma as any).historicalSalesRecord.aggregate({ where: { invoiceDate: { gte: from, lte: to } }, _sum: { totalKes: true }, _count: true }),
      this.prisma.eggCollectionSession.findMany({ where: { sessionDate: { gte: from, lte: to }, status: 'APPROVED' }, select: { totalGoodEggs: true, mortalities: true } }),
      this.prisma.batch.findMany({ where: { isActive: true }, select: { currentBirdCount: true, batchCode: true } }),
    ]);

    const totalRevenue   = invoices.reduce((s: number, i: any) => s + this.fmtNum(i.totalAmount), 0) + this.fmtNum(histSales._sum.totalKes);
    const totalPaid      = invoices.reduce((s: number, i: any) => s + i.payments.reduce((ps: number, p: any) => ps + this.fmtNum(p.amount), 0), 0);
    const totalOutstanding = totalRevenue - totalPaid - this.fmtNum(histSales._sum.totalKes);
    const totalCosts     = this.fmtNum(expenses._sum.amount);
    const netProfit      = totalRevenue - totalCosts;
    const totalEggs      = sessions.reduce((s: number, ss: any) => s + (ss.totalGoodEggs ?? 0), 0);
    const totalMort      = sessions.reduce((s: number, ss: any) => s + (ss.mortalities ?? 0), 0);
    const totalBirds     = batches.reduce((s: number, b: any) => s + b.currentBirdCount, 0);
    const costPerEgg     = totalEggs > 0 ? totalCosts / totalEggs : 0;

    const sections: [string, string | number][] = [
      ['── PRODUCTION ──────────────────────', ''],
      ['Total Eggs Produced',                  totalEggs.toLocaleString()],
      ['Total Trays',                          Math.floor(totalEggs / 30).toLocaleString()],
      ['Total Mortality',                      totalMort.toLocaleString()],
      ['Active Birds (current)',               totalBirds.toLocaleString()],
      ['', ''],
      ['── REVENUE ──────────────────────────', ''],
      ['Gross Revenue (KES)',                  totalRevenue],
      ['Total Collected (KES)',                totalPaid],
      ['Outstanding AR (KES)',                 totalOutstanding],
      ['', ''],
      ['── COSTS ────────────────────────────', ''],
      ['Total Expenses (KES)',                 totalCosts],
      ['Expense Records',                      expenses._count],
      ['Cost per Egg (KES)',                   costPerEgg],
      ['', ''],
      ['── PROFITABILITY ────────────────────', ''],
      ['Gross Profit (KES)',                   netProfit],
      ['Profit Margin',                        totalRevenue > 0 ? `${((netProfit / totalRevenue) * 100).toFixed(1)}%` : 'N/A'],
      ['Generated',                            dayjs().format('D MMM YYYY HH:mm')],
    ];

    for (const [lbl, val] of sections) {
      const row = ws.addRow([lbl, val]);
      if (String(lbl).startsWith('──')) {
        row.getCell(1).font = { bold: true, color: { argb: '1A3A2A' }, size: 10 };
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F0FDF4' } };
        });
      } else if (typeof val === 'number') {
        row.getCell(2).numFmt = '#,##0.00';
        if (['Gross Profit (KES)', 'Gross Revenue (KES)', 'Total Collected (KES)'].includes(lbl)) {
          row.getCell(2).font = { bold: true };
        }
        if (lbl === 'Outstanding AR (KES)' && val > 0) {
          row.getCell(2).font = { bold: true, color: { argb: 'DC2626' } };
        }
        if (lbl === 'Gross Profit (KES)') {
          row.getCell(2).font = { bold: true, color: { argb: val >= 0 ? '16A34A' : 'DC2626' } };
        }
      }
    }
  }
}
