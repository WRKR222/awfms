// src/modules/store/stock-request.controller.ts
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../auth/types/request-user.type';
import { StockRequestService, CreateSimpleStockRequestDto, FulfillDto } from './stock-request.service';

@Controller('stock-requests')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StockRequestController {
  constructor(private readonly service: StockRequestService) {}

  @Post()
  @RequirePermission(Permission.STOCK_REQUEST_CREATE)
  create(@Body() dto: CreateSimpleStockRequestDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user);
  }

  @Get()
  @RequirePermission(Permission.STOCK_REQUEST_VIEW)
  list(@Query('status') status: string, @Query('mine') mine: string, @CurrentUser() user: RequestUser) {
    return this.service.list(status, mine === 'true', user);
  }

  @Get(':id')
  @RequirePermission(Permission.STOCK_REQUEST_VIEW)
  get(@Param('id') id: string) { return this.service.get(id); }

  @Post(':id/fulfill')
  @RequirePermission(Permission.STOCK_REQUEST_FULFILL)
  fulfill(@Param('id') id: string, @Body() dto: FulfillDto, @CurrentUser() user: RequestUser) {
    return this.service.fulfill(id, dto, user);
  }

  @Post(':id/cancel')
  @RequirePermission(Permission.STOCK_REQUEST_CREATE)
  cancel(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.cancel(id, user);
  }
}
