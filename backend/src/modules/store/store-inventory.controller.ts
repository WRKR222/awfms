// src/modules/store/store-inventory.controller.ts
import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request,
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

  // Items actually issued out of the store (all-time), in the given
  // category/categories, with computed dispensed/residual/overDrawnBy
  // totals. Used by the Store's issuance-plan screen (to see leftover
  // stock before re-issuing) — and, with all=true, by the Lead Attendant's
  // feed/vaccine/supplement/treatment logging dropdowns, which list every
  // active item in the category regardless of issuance so an attendant can
  // record what was physically given even before Store logs the stock-out;
  // the attached residual/overDrawnBy figures let Store/PM still monitor
  // for surplus or over-issuance once it is logged.
  @Get('issuable-items')
  @RequirePermission(Permission.INVENTORY_VIEW)
  issuableItems(@Query('categories') categories?: string, @Query('all') all?: string) {
    const list = (categories ?? '')
      .split(',')
      .map(c => c.trim())
      .filter(Boolean) as any[];
    return this.svc.getIssuableStoreItems(list, { includeUnissued: all === 'true' });
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

  /**
   * Soft-delete an inventory item (sets isActive = false).
   * Blocked if the item still has stock on hand.
   */
  @Delete('items/:id')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  deleteItem(@Param('id') id: string) {
    return this.svc.deleteItem(id);
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
