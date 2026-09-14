/**
 * sales.controller.ts  —  Fixed version
 *
 * New endpoints added:
 *  GET  /sales/stock?date=YYYY-MM-DD          — stock filtered by date
 *  GET  /sales/stock/history?range=week       — stock timeline (day/week/month)
 *  GET  /sales/tally-aggregate?date=YYYY-MM-DD — AM+PM combined tally for breakage ref
 */

import {
  Controller, Get, Post, Patch, Put, Delete,
  Body, Param, Query, UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SalesService } from './sales.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/enums/permissions.enum';

@ApiTags('Sales')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  // ── Customers ─────────────────────────────────────────────────────────────

  @Get('customers')
  @RequirePermission(Permission.SALES_VIEW)
  getCustomers() { return this.salesService.getCustomers(); }

  @Post('customers')
  @RequirePermission(Permission.SALES_CUSTOMER_MANAGE)
  createCustomer(@Body() body: any) { return this.salesService.createCustomer(body); }

  @Put('customers/:id')
  @RequirePermission(Permission.SALES_CUSTOMER_MANAGE)
  updateCustomer(@Param('id') id: string, @Body() body: any) {
    return this.salesService.updateCustomer(id, body);
  }

  @Patch('customers/:id')
  @RequirePermission(Permission.SALES_CUSTOMER_MANAGE)
  patchCustomer(@Param('id') id: string, @Body() body: any) {
    return this.salesService.updateCustomer(id, body);
  }

  @Delete('customers/:id')
  @RequirePermission(Permission.SALES_CUSTOMER_MANAGE)
  deleteCustomer(@Param('id') id: string) { return this.salesService.deleteCustomer(id); }

  // ── Orders ────────────────────────────────────────────────────────────────

  @Get('orders')
  @RequirePermission(Permission.SALES_VIEW)
  getOrders(
    @Query('days') days?: number,
    @Query('status') status?: string,
  ) {
    return this.salesService.getOrders(days ?? 30, status);
  }

  @Post('orders')
  @RequirePermission(Permission.SALES_ORDER_CREATE)
  createOrder(@Body() body: any, @CurrentUser() user: any) {
    return this.salesService.createOrder(body, user.id);
  }

  @Get('summary')
  @RequirePermission(Permission.SALES_VIEW)
  getSummary(@Query('days') days?: number) { return this.salesService.getSummary(days ?? 30); }

  @Patch('orders/:id')
  @RequirePermission(Permission.SALES_ORDER_MANAGE)
  updateOrder(@Param('id') id: string, @Body() body: any) {
    return this.salesService.updateOrder(id, body);
  }

  @Patch('orders/:id/cancel')
  @RequirePermission(Permission.SALES_ORDER_MANAGE)
  cancelOrder(@Param('id') id: string, @Body('reason') reason: string, @CurrentUser() user: any) {
    return this.salesService.cancelOrder(id, reason, user);
  }

  @Patch('orders/:id/confirm')
  @RequirePermission(Permission.SALES_ORDER_MANAGE)
  confirmOrder(@Param('id') id: string, @CurrentUser() user: any) {
    return this.salesService.confirmOrder(id, user.id);
  }

  @Patch('orders/:id/delivering')
  @RequirePermission(Permission.SALES_ORDER_MANAGE)
  markDelivering(@Param('id') id: string, @Request() req: any) {
    return this.salesService.markOrderAsDelivering(id, req.user);
  }

  @Patch('orders/:id/deliver')
  @RequirePermission(Permission.SALES_ORDER_MANAGE)
  markDelivered(
    @Param('id') id: string,
    @Body('notes') notes: string,
    @Request() req: any,
  ) {
    return this.salesService.markOrderDelivered(id, notes, req.user);
  }

  // ── Stock ─────────────────────────────────────────────────────────────────

  /**
   * Current live stock. Optional ?date=YYYY-MM-DD scopes sold subtraction
   * to orders on or after that date (used by Egg Stock page date filters).
   */
  @Get('stock')
  @RequirePermission(Permission.SALES_VIEW)
  getStock(@Query('date') date?: string) {
    return this.salesService.getSalesStock(date);
  }

  /**
   * Stock history timeline for the Egg Stock page.
   * ?range=day|week|month  (default: week)
   */
  @Get('stock/history')
  @RequirePermission(Permission.SALES_VIEW)
  getStockHistory(@Query('range') range?: 'day' | 'week' | 'month') {
    return this.salesService.getStockHistory(range ?? 'week');
  }

  // ── Breakage Adjustments ──────────────────────────────────────────────────

  @Get('breakage-adjustments')
  @RequirePermission(Permission.SALES_VIEW)
  listBreakage() { return this.salesService.listBreakageAdjustments(); }

  @Post('breakage-adjustments')
  @RequirePermission(Permission.SALES_ORDER_CREATE)
  createBreakage(@Body() body: any, @CurrentUser() user: any) {
    return this.salesService.createBreakageAdjustment(body, user);
  }

  /**
   * AM+PM combined tally aggregate for a given date.
   * Used by the breakage page reference tally selector.
   * GET /sales/tally-aggregate?date=YYYY-MM-DD
   */
  @Get('tally-aggregate')
  @RequirePermission(Permission.SALES_VIEW)
  getTallyAggregate(@Query('date') date: string) {
    return this.salesService.getTallyAggregateForDate(date);
  }
}
