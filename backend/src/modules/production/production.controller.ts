// src/modules/production/production.controller.ts
import {
  Controller, Get, Post, Patch, Body, Param, Query,
  UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { ProductionService } from './production.service';
import type { CreateEggCollectionSessionDto as CreateEggCollectionDto } from './production.dto';

@ApiTags('production')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('production')
export class ProductionController {
  constructor(private readonly svc: ProductionService) {}

  // ── Egg Collection Sessions ───────────────────────────────────────────
  @Post('sessions')
  @RequirePermission(Permission.PRODUCTION_ENTRY_CREATE)
  create(@Body() dto: CreateEggCollectionDto, @Request() req: any) {
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

  // Farm-time-aware AM/PM submission-window snapshot — same purpose as the
  // brooder module's /flock/brooder-session-status: lets the attendant UI
  // show/gate the AM/PM buttons without trusting the viewer's own device
  // clock/timezone. Declared before 'sessions/:id' so it isn't swallowed
  // by that param route.
  @Get('sessions/window-status')
  @RequirePermission(Permission.PRODUCTION_VIEW)
  windowStatus() {
    return this.svc.getEggCollectionSessionStatus();
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

  // ── Daily Aggregate (post-tally lock) ────────────────────────────────
  /**
   * GET /production/daily-aggregate?date=YYYY-MM-DD
   *
   * Returns the DailyEggAggregate for the given date (or the most recent
   * locked day if no record exists for the exact date). Used by the Sales
   * dashboard stock panel and the Director dashboard revenue section.
   */
  @Get('daily-aggregate')
  @RequirePermission(Permission.PRODUCTION_VIEW)
  async getDailyAggregate(@Query('date') date?: string) {
    return this.svc.getDailyAggregate(date);
  }
}
