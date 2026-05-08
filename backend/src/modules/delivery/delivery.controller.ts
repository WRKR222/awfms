// src/modules/delivery/delivery.controller.ts
import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermissionGuard } from '../../common/guards/require-permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import {
  DeliveryService,
  CreateDeliveryDto,
  UpdateDeliveryStatusDto,
} from './delivery.service';

@ApiTags('delivery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RequirePermissionGuard)
@Controller('delivery')
export class DeliveryController {
  constructor(private readonly svc: DeliveryService) {}

  @Get('summary')
  @RequirePermission(Permission.SALES_VIEW)
  summary(@Query('days') days?: string) {
    return this.svc.getDeliverySummary(days ? Number(days) : 30);
  }

  @Get()
  @RequirePermission(Permission.SALES_VIEW)
  findAll(
    @Query('route') route?: string,
    @Query('status') status?: string,
    @Query('days') days?: string,
  ) {
    return this.svc.getAllDeliveries(route, status, days ? Number(days) : 30);
  }

  @Get(':id')
  @RequirePermission(Permission.SALES_VIEW)
  findOne(@Param('id') id: string) {
    return this.svc.getDeliveryById(id);
  }

  @Post()
  @RequirePermission(Permission.SALES_DELIVERY_LOG)
  create(@Body() dto: CreateDeliveryDto, @Request() req: any) {
    return this.svc.createDelivery(dto, req.user);
  }

  @Patch(':id/status')
  @RequirePermission(Permission.SALES_DELIVERY_LOG)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateDeliveryStatusDto,
    @Request() req: any,
  ) {
    return this.svc.updateDeliveryStatus(id, dto, req.user);
  }
}
