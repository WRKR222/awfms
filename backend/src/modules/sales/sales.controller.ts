import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
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

  @Get('customers')
  @RequirePermission(Permission.SALES_VIEW)
  @ApiOperation({ summary: 'Get all active customers' })
  getCustomers() {
    return this.salesService.getCustomers();
  }

  @Post('customers')
  @RequirePermission(Permission.SALES_CUSTOMER_MANAGE)
  @ApiOperation({ summary: 'Create a new customer' })
  createCustomer(@Body() body: any, @CurrentUser() user: any) {
    return this.salesService.createCustomer(body);
  }

  @Get('orders')
  @RequirePermission(Permission.SALES_VIEW)
  @ApiOperation({ summary: 'Get sales orders' })
  getOrders(@Query('days') days?: number, @Query('status') status?: string) {
    return this.salesService.getOrders(days ?? 30, status);
  }

  @Post('orders')
  @RequirePermission(Permission.SALES_ORDER_CREATE)
  @ApiOperation({ summary: 'Create a new sales order' })
  createOrder(@Body() body: any, @CurrentUser() user: any) {
    return this.salesService.createOrder(body, user.id);
  }

  @Get('summary')
  @RequirePermission(Permission.SALES_VIEW)
  @ApiOperation({ summary: 'Get sales summary stats' })
  getSummary(@Query('days') days?: number) {
    return this.salesService.getSummary(days ?? 30);
  }

  @Patch('orders/:id/confirm')
  @RequirePermission(Permission.SALES_ORDER_MANAGE)
  @ApiOperation({ summary: 'Confirm a sales order and generate invoice' })
  confirmOrder(@Param('id') id: string, @CurrentUser() user: any) {
    return this.salesService.confirmOrder(id, user.id);
  }
}
