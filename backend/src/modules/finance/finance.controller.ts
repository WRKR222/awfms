// src/modules/finance/finance.controller.ts
import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UseGuards, Request, Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermissionGuard } from '../../common/guards/require-permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import {
  FinanceService,
  CreateInvoiceFromOrderDto,
  LogPaymentDto,
  CreateExpenseCategoryDto,
  LogExpenseDto,
} from './finance.service';
import { FinanceExportService, ExportType } from './finance-export.service';
import { InvoiceStatus } from '@prisma/client';

@ApiTags('finance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RequirePermissionGuard)
@Controller('finance')
export class FinanceController {
  constructor(
    private readonly svc: FinanceService,
    private readonly exportSvc: FinanceExportService,
  ) {}

  // ── Excel Export ──────────────────────────────────────────────────────────

  @Get('export/excel')
  @RequirePermission(Permission.FINANCE_EXPORT)
  async exportExcel(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('type') type: ExportType = 'all',
    @Res() res: Response,
  ) {
    const fromDate = from ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const toDate   = to   ?? new Date().toISOString().split('T')[0];
    const buffer   = await this.exportSvc.generateExcel(fromDate, toDate, type);
    const filename = `AWFMS_Finance_${fromDate}_${toDate}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  // ── Invoices ──────────────────────────────────────────────────────────────

  @Post('invoices/generate')
  @RequirePermission(Permission.INVOICE_MANAGE)
  generateInvoice(@Body() dto: CreateInvoiceFromOrderDto, @Request() req: any) {
    return this.svc.generateInvoiceForOrder(dto.salesOrderId, req.user.id);
  }

  @Get('invoices')
  @RequirePermission(Permission.INVOICE_VIEW)
  getInvoices(
    @Query('status') status?: InvoiceStatus,
    @Query('customerId') customerId?: string,
  ) {
    return this.svc.getInvoices(status, customerId);
  }

  @Get('invoices/:id')
  @RequirePermission(Permission.INVOICE_VIEW)
  getInvoice(@Param('id') id: string) {
    return this.svc.getInvoiceById(id);
  }

  // ── Payments ──────────────────────────────────────────────────────────────

  @Post('invoices/payments')
  @RequirePermission(Permission.INVOICE_PAYMENT_LOG)
  logPayment(@Body() dto: LogPaymentDto, @Request() req: any) {
    return this.svc.logPayment(dto, req.user);
  }

  // ── AR ────────────────────────────────────────────────────────────────────

  @Get('ar/summary')
  @RequirePermission(Permission.AR_VIEW)
  getArSummary() {
    return this.svc.getArSummary();
  }

  @Get('ar/customer/:customerId')
  @RequirePermission(Permission.AR_VIEW)
  getCustomerAr(@Param('customerId') customerId: string) {
    return this.svc.getCustomerArDetail(customerId);
  }

  // ── Expense Categories ────────────────────────────────────────────────────

  @Get('expense-categories')
  @RequirePermission(Permission.FINANCE_VIEW)
  getCategories() {
    return this.svc.getExpenseCategories();
  }

  @Post('expense-categories')
  @RequirePermission(Permission.FINANCE_EXPENSE_LOG)
  createCategory(@Body() dto: CreateExpenseCategoryDto, @Request() req: any) {
    return this.svc.createExpenseCategory(dto, req.user);
  }

  @Patch('expense-categories/:id/deactivate')
  @RequirePermission(Permission.FINANCE_EXPENSE_LOG)
  deactivateCategory(@Param('id') id: string) {
    return this.svc.deactivateExpenseCategory(id);
  }

  // ── Expenses ──────────────────────────────────────────────────────────────

  @Post('expenses')
  @RequirePermission(Permission.FINANCE_EXPENSE_LOG)
  logExpense(@Body() dto: LogExpenseDto, @Request() req: any) {
    return this.svc.logExpense(dto, req.user);
  }

  @Get('expenses')
  @RequirePermission(Permission.FINANCE_VIEW)
  getExpenses(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('category') category?: string,
    @Query('batchId') batchId?: string,
  ) {
    return this.svc.getExpenses(from, to, category, batchId);
  }

  @Get('expenses/summary')
  @RequirePermission(Permission.FINANCE_REPORT_VIEW)
  getExpenseSummary(
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.svc.getExpenseSummaryByCategory(from, to);
  }

  // ── Owner Finance Dashboard ───────────────────────────────────────────────

  @Get('dashboard')
  @RequirePermission(Permission.FINANCE_REPORT_VIEW)
  getOwnerFinanceDashboard(
    @Query('range') range: 'daily' | 'weekly' | 'monthly' | 'quarterly' = 'weekly',
  ) {
    return this.svc.getOwnerFinanceDashboard(range);
  }
}
