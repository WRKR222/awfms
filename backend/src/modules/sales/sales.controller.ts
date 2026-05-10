import { Controller, Get, Post, Patch, Put, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
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

  @Get('customers')
  @RequirePermission(Permission.SALES_VIEW)
  getCustomers() { return this.salesService.getCustomers(); }

  @Post('customers')
  @RequirePermission(Permission.SALES_CUSTOMER_MANAGE)
  createCustomer(@Body() body: any) { return this.salesService.createCustomer(body); }

  @Put('customers/:id')
  @RequirePermission(Permission.SALES_CUSTOMER_MANAGE)
  updateCustomer(@Param('id') id: string, @Body() body: any) { return this.salesService.updateCustomer(id, body); }

  @Patch('customers/:id')
  @RequirePermission(Permission.SALES_CUSTOMER_MANAGE)
  patchCustomer(@Param('id') id: string, @Body() body: any) { return this.salesService.updateCustomer(id, body); }

  @Delete('customers/:id')
  @RequirePermission(Permission.SALES_CUSTOMER_MANAGE)
  deleteCustomer(@Param('id') id: string) { return this.salesService.deleteCustomer(id); }

  @Get('orders')
  @RequirePermission(Permission.SALES_VIEW)
  getOrders(@Query('days') days?: number, @Query('status') status?: string) { return this.salesService.getOrders(days ?? 30, status); }

  @Post('orders')
  @RequirePermission(Permission.SALES_ORDER_CREATE)
  createOrder(@Body() body: CreateOrderDto, @CurrentUser() user: any) { return this.salesService.createOrder(body, user.id); }

  @Get('summary')
  @RequirePermission(Permission.SALES_VIEW)
  getSummary(@Query('days') days?: number) { return this.salesService.getSummary(days ?? 30); }

  @Patch('orders/:id/confirm')
  @RequirePermission(Permission.SALES_ORDER_MANAGE)
  confirmOrder(@Param('id') id: string, @CurrentUser() user: any) { return this.salesService.confirmOrder(id, user.id); }

  @Patch('orders/:id/delivering')
  @RequirePermission(Permission.SALES_ORDER_MANAGE)
  markDelivering(@Param('id') id: string, @Request() req: any) { return this.salesService.markOrderAsDelivering(id, req.user); }

  @Patch('orders/:id/deliver')
  @RequirePermission(Permission.SALES_ORDER_MANAGE)
  markDelivered(@Param('id') id: string, @Body('notes') notes: string, @Request() req: any) {
    return this.salesService.markOrderDelivered(id, notes, req.user);
  }

  @Get('stock')
  @RequirePermission(Permission.SALES_VIEW)
  getStock() { return this.salesService.getSalesStock(); }

  @Get('breakage-adjustments')
  @RequirePermission(Permission.SALES_VIEW)
  listBreakage() { return this.salesService.listBreakageAdjustments(); }

  @Post('breakage-adjustments')
  @RequirePermission(Permission.SALES_ORDER_CREATE)
  createBreakage(@Body() body: any, @CurrentUser() user: any) { return this.salesService.createBreakageAdjustment(body, user); }
}
