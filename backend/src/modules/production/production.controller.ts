// src/modules/production/production.controller.ts
import {
  Controller, Get, Post, Patch, Body, Param, Query,
  UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermissionGuard } from '../../common/guards/require-permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/enums/permissions.enum';
// FIX: CreateEggCollectionDto does not exist — correct name is CreateEggCollectionSessionDto
//      and it lives in './production.dto', not './production.service'
import { ProductionService } from './production.service';
import type { CreateEggCollectionSessionDto } from './production.dto';

@ApiTags('production')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RequirePermissionGuard)
@Controller('production')
export class ProductionController {
  constructor(private readonly svc: ProductionService) {}

  // ── Egg Collection Sessions ───────────────────────────────────────────
  @Post('sessions')
  @RequirePermission(Permission.PRODUCTION_ENTRY_CREATE)
  create(@Body() dto: CreateEggCollectionSessionDto, @Request() req: any) {
    return this.svc.createEggCollection(dto, req.user);
  }

  @Get('sessions')
  @RequirePermission(Permission.PRODUCTION_VIEW)
  findAll(
    @Query('houseId') houseId?: string,
    @Query('batchId') batchId?: string,
    @Query('sessionDate') sessionDate?: string,
  ) {
    return this.svc.getEggCollections(houseId, batchId, sessionDate);
  }

  @Get('sessions/today')
  @RequirePermission(Permission.PRODUCTION_VIEW)
  todaySummary(@Query('houseId') houseId: string) {
    return this.svc.getTodaySummary(houseId);
  }

  @Get('sessions/:id')
  @RequirePermission(Permission.PRODUCTION_VIEW)
  findOne(@Param('id') id: string) {
    return this.svc.getSessionById(id);
  }

  @Patch('sessions/:id/approve')
  @RequirePermission(Permission.PRODUCTION_ENTRY_APPROVE)
  approve(@Param('id') id: string, @Request() req: any) {
    return this.svc.verifySession(id, 'approve', undefined, req.user);
  }

  @Patch('sessions/:id/return')
  @RequirePermission(Permission.PRODUCTION_ENTRY_APPROVE)
  returnEntry(
    @Param('id') id: string,
    @Body('returnReason') returnReason: string,
    @Request() req: any,
  ) {
    return this.svc.verifySession(id, 'return', returnReason, req.user);
  }

  @Get('trend/:batchId')
  @RequirePermission(Permission.PRODUCTION_VIEW)
  trend(@Param('batchId') batchId: string, @Query('days') days?: string) {
    return this.svc.getHenDayTrend(batchId, days ? Number(days) : 14);
  }
}
