import {
  Controller, Get, Post, Patch, Put, Body,
  Param, Query, UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SalesService, CreateOrderDto } from './sales.service';
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

  // ── Customers ──────────────────────────────────────────────────────────────

  @Get('customers')
  @RequirePermission(Permission.SALES_VIEW)
  @ApiOperation({ summary: 'Get all active customers' })
  getCustomers() {
    return this.salesService.getCustomers();
  }

  @Post('customers')
  @RequirePermission(Permission.SALES_CUSTOMER_MANAGE)
  @ApiOperation({ summary: 'Create a new customer' })
  createCustomer(@Body() body: any) {
    return this.salesService.createCustomer(body);
  }

  @Put('customers/:id')
  @RequirePermission(Permission.SALES_CUSTOMER_MANAGE)
  @ApiOperation({ summary: 'Update an existing customer' })
  updateCustomer(@Param('id') id: string, @Body() body: any) {
    return this.salesService.updateCustomer(id, body);
  }

  // ── Orders ─────────────────────────────────────────────────────────────────

  @Get('orders')
  @RequirePermission(Permission.SALES_VIEW)
  @ApiOperation({ summary: 'Get sales orders' })
  getOrders(@Query('days') days?: number, @Query('status') status?: string) {
    return this.salesService.getOrders(days ?? 30, status);
  }

  @Post('orders')
  @RequirePermission(Permission.SALES_ORDER_CREATE)
  @ApiOperation({
    summary: 'Create a new sales order',
    description: 'Unit prices are enforced from the accountant's daily pricing — not accepted from the client.',
  })
  createOrder(@Body() body: CreateOrderDto, @CurrentUser() user: any) {
    return this.salesService.createOrder(body, user.id);
  }

  @Get('summary')
  @RequirePermission(Permission.SALES_VIEW)
  @ApiOperation({ summary: 'Get sales summary including revenue progress' })
  getSummary(@Query('days') days?: number) {
    return this.salesService.getSummary(days ?? 30);
  }

  @Patch('orders/:id/confirm')
  @RequirePermission(Permission.SALES_ORDER_MANAGE)
  @ApiOperation({ summary: 'Confirm a PENDING order and generate invoice' })
  confirmOrder(@Param('id') id: string, @CurrentUser() user: any) {
    return this.salesService.confirmOrder(id, user.id);
  }

  // ── Delivery tracking ──────────────────────────────────────────────────────

  @Patch('orders/:id/delivering')
  @RequirePermission(Permission.SALES_ORDER_MANAGE)
  @ApiOperation({ summary: 'Mark a CONFIRMED order as out for delivery (DELIVERING)' })
  markDelivering(@Param('id') id: string, @Request() req: any) {
    return this.salesService.markOrderAsDelivering(id, req.user);
  }

  @Patch('orders/:id/deliver')
  @RequirePermission(Permission.SALES_ORDER_MANAGE)
  @ApiOperation({ summary: 'Mark a DELIVERING order as successfully DELIVERED' })
  markDelivered(
    @Param('id') id: string,
    @Body('notes') notes: string,
    @Request() req: any,
  ) {
    return this.salesService.markOrderDelivered(id, notes, req.user);
  }

  // ── Egg Stock ──────────────────────────────────────────────────────────────

  @Get('stock')
  @RequirePermission(Permission.SALES_VIEW)
  @ApiOperation({ summary: 'Get current egg stock summary with today's pricing' })
  getStock() {
    return this.salesService.getSalesStock();
  }

  // ── Egg Breakage Adjustments ───────────────────────────────────────────────

  @Get('breakage-adjustments')
  @RequirePermission(Permission.SALES_VIEW)
  @ApiOperation({ summary: 'List all egg breakage adjustments' })
  listBreakage() {
    return this.salesService.listBreakageAdjustments();
  }

  @Post('breakage-adjustments')
  @RequirePermission(Permission.SALES_ORDER_CREATE)
  @ApiOperation({ summary: 'Submit an egg breakage adjustment (notifies accountant)' })
  createBreakage(@Body() body: any, @CurrentUser() user: any) {
    return this.salesService.createBreakageAdjustment(body, user);
  }
}
