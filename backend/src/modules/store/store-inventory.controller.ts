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
  CreatePurchaseRequestDto,
  ReviewPurchaseRequestDto,
  CreateLPODto,
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

  // ── Purchase Requests ─────────────────────────────────────────────────────────

  @Post('purchase-requests')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  createPR(@Body() dto: CreatePurchaseRequestDto, @Request() req: any) {
    return this.svc.createPurchaseRequest(dto, req.user);
  }

  @Patch('purchase-requests/:id/submit')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  submitPR(@Param('id') id: string, @Request() req: any) {
    return this.svc.submitPurchaseRequest(id, req.user);
  }

  @Patch('purchase-requests/:id/review')
  @RequirePermission(Permission.INVOICE_MANAGE)   // Accountant permission
  reviewPR(@Param('id') id: string, @Body() dto: ReviewPurchaseRequestDto, @Request() req: any) {
    return this.svc.reviewPurchaseRequest(id, dto, req.user);
  }

  @Get('purchase-requests')
  @RequirePermission(Permission.INVENTORY_VIEW)
  listPRs(@Query('status') status?: string) {
    return this.svc.listPurchaseRequests(status);
  }

  @Get('purchase-requests/:id')
  @RequirePermission(Permission.INVENTORY_VIEW)
  getPR(@Param('id') id: string) {
    return this.svc.getPurchaseRequestById(id);
  }

  // ── LPOs ─────────────────────────────────────────────────────────────────────

  @Post('lpos')
  @RequirePermission(Permission.INVOICE_MANAGE)
  createLPO(@Body() dto: CreateLPODto, @Request() req: any) {
    return this.svc.createLPO(dto, req.user);
  }

  @Patch('lpos/:id/submit')
  @RequirePermission(Permission.INVOICE_MANAGE)
  submitLPO(@Param('id') id: string) {
    return this.svc.submitLPO(id);
  }

  @Patch('lpos/:id/approve')
  @RequirePermission(Permission.SETTINGS_MANAGE)   // Owner
  approveLPO(@Param('id') id: string, @Request() req: any) {
    return this.svc.approveLPO(id, req.user);
  }

  @Patch('lpos/:id/reject')
  @RequirePermission(Permission.SETTINGS_MANAGE)   // Owner
  rejectLPO(
    @Param('id') id: string,
    @Body('rejectionReason') rejectionReason: string,
    @Request() req: any,
  ) {
    return this.svc.rejectLPO(id, rejectionReason, req.user);
  }

  @Get('lpos')
  @RequirePermission(Permission.INVENTORY_VIEW)
  listLPOs(@Query('status') status?: string) {
    return this.svc.listLPOs(status);
  }

  @Get('lpos/:id')
  @RequirePermission(Permission.INVENTORY_VIEW)
  getLPO(@Param('id') id: string) {
    return this.svc.getLPOById(id);
  }
}
