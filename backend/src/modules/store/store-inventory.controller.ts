// src/modules/store/store-inventory.controller.ts
import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import {
  StoreInventoryService,
  CreateStoreItemDto,
  UpdateStoreItemDto,
  StockInDto,
  StockOutDto,
} from './store-inventory.service';

@ApiTags('store-inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('store/inventory')
export class StoreInventoryController {
  constructor(private readonly svc: StoreInventoryService) {}

  // ── Catalogue ────────────────────────────────────────────────────────────────

  @Get('items')
  @RequirePermission(Permission.INVENTORY_VIEW)
  listItems(
    @Query('category') category?: string,
    @Query('isActive')  isActive?: string,
  ) {
    const active = isActive === undefined ? undefined : isActive === 'true';
    return this.svc.listItems(category, active);
  }

  @Get('items/low-stock')
  @RequirePermission(Permission.INVENTORY_VIEW)
  lowStock() {
    return this.svc.getLowStockItems();
  }

  @Get('items/:id')
  @RequirePermission(Permission.INVENTORY_VIEW)
  getItem(@Param('id') id: string) {
    return this.svc.getItemById(id);
  }

  @Post('items')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  createItem(@Body() dto: CreateStoreItemDto, @Request() req: any) {
    return this.svc.createItem(dto, req.user);
  }

  @Patch('items/:id')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  updateItem(@Param('id') id: string, @Body() dto: UpdateStoreItemDto) {
    return this.svc.updateItem(id, dto);
  }

  // ── Stock In ─────────────────────────────────────────────────────────────────

  @Post('stock-in')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  stockIn(@Body() dto: StockInDto, @Request() req: any) {
    return this.svc.recordStockIn(dto, req.user);
  }

  @Get('stock-in')
  @RequirePermission(Permission.INVENTORY_VIEW)
  listStockIns(
    @Query('storeItemId') storeItemId?: string,
    @Query('fromDate')    fromDate?: string,
    @Query('toDate')      toDate?: string,
  ) {
    return this.svc.listStockIns(storeItemId, fromDate, toDate);
  }

  // ── Stock Out ─────────────────────────────────────────────────────────────────

  @Post('stock-out')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  stockOut(@Body() dto: StockOutDto, @Request() req: any) {
    return this.svc.recordStockOut(dto, req.user);
  }

  @Get('stock-out')
  @RequirePermission(Permission.INVENTORY_VIEW)
  listStockOuts(
    @Query('storeItemId') storeItemId?: string,
    @Query('fromDate')    fromDate?: string,
    @Query('toDate')      toDate?: string,
  ) {
    return this.svc.listStockOuts(storeItemId, fromDate, toDate);
  }

  @Get('expiring')
  @RequirePermission(Permission.INVENTORY_VIEW)
  getExpiringItems() {
    return this.svc.getExpiringItems();
  }
}
