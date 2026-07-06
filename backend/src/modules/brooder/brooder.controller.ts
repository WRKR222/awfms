// src/modules/brooder/brooder.controller.ts
import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { BrooderService } from './brooder.service';

@ApiTags('Brooder Cage Map')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('brooder')
export class BrooderController {
  constructor(private readonly svc: BrooderService) {}

  // ── Control standards (HyLine Brown rearing schedule) ───────────────────
  @Get('control-standards')
  @RequirePermission(Permission.FLOCK_VIEW)
  getControlStandards() {
    return this.svc.getControlStandards();
  }

  // ── Cage map ─────────────────────────────────────────────────────────────
  @Get('cage-map')
  @RequirePermission(Permission.FLOCK_VIEW)
  getCageMap() {
    return this.svc.getCageMap();
  }

  /** GET /brooder/rows-and-levels
   *  Returns the fixed 6-row × 4-level grid with occupancy status.
   *  Used by the New Batch registration modal so the PM can assign birds
   *  directly from the form without navigating away. */
  @Get('rows-and-levels')
  @RequirePermission(Permission.FLOCK_VIEW)
  getRowsAndLevels() {
    return this.svc.getRowsAndLevels();
  }

  @Get('feed-requirement-summary')
  @RequirePermission(Permission.FLOCK_VIEW)
  getFeedRequirementSummary() {
    return this.svc.getFeedRequirementSummary();
  }

  /** GET /brooder/daily-feed-breakdown
   *  Per-calendar-day feed totals for the current week (Sun–Sat), so the
   *  PM can spot any day that was skipped entirely. Not the same window as
   *  feed-requirement-summary's per-batch hatch-anchored week — this is a
   *  plain calendar view for day-by-day analysis. */
  @Get('daily-feed-breakdown')
  @RequirePermission(Permission.FLOCK_VIEW)
  getDailyFeedBreakdown() {
    return this.svc.getDailyFeedBreakdown();
  }

  /** GET /brooder/feed-issuance-calendar?weeks=4
   *  Same per-day breakdown as daily-feed-breakdown, but for the current
   *  week PLUS a configurable number of past weeks (default 4, capped at
   *  12), returned most-recent-week-first. Powers the PM's "feed issuance
   *  history" panel — a separate, on-demand endpoint so the lightweight
   *  single-week widget on the PM home page isn't affected. */
  @Get('feed-issuance-calendar')
  @RequirePermission(Permission.FLOCK_VIEW)
  getFeedIssuanceCalendar(@Query('weeks') weeks?: string) {
    return this.svc.getFeedIssuanceCalendar(weeks ? parseInt(weeks, 10) : 4);
  }

  /** GET /brooder/missed-feed-alerts
   *  Flags any row/level whose required ration for YESTERDAY was not fully
   *  dispensed by the time the day rolled over. Surfaced on Lead Attendant
   *  and PM home pages the morning after a shortfall occurs. */
  @Get('missed-feed-alerts')
  @RequirePermission(Permission.FLOCK_VIEW)
  getMissedFeedAlerts() {
    return this.svc.getMissedFeedAlerts();
  }

  @Get('assignments')
  @RequirePermission(Permission.FLOCK_VIEW)
  getAssignmentsByBatch(@Query('batchId') batchId: string) {
    return this.svc.getAssignmentsByBatch(batchId);
  }

  // ── Level assignment ─────────────────────────────────────────────────────
  @Post('levels/:levelId/assign')
  @RequirePermission(Permission.FLOCK_ENTRY_CREATE)
  assignLevel(
    @Param('levelId') levelId: string,
    @Body() body: any,
    @CurrentUser() user: any,
  ) {
    return this.svc.assignLevel(levelId, body, user.id);
  }

  @Delete('levels/:levelId/assign')
  @RequirePermission(Permission.FLOCK_BATCH_MANAGE)
  removeLevelAssignment(@Param('levelId') levelId: string) {
    return this.svc.removeLevelAssignment(levelId);
  }

  // ── Heat logs ────────────────────────────────────────────────────────────
  @Get('rows/:rowId/heat-logs')
  @RequirePermission(Permission.FLOCK_VIEW)
  listHeatLogs(@Param('rowId') rowId: string, @Query('limit') limit?: string) {
    return this.svc.listHeatLogs(rowId, limit ? Number(limit) : 30);
  }

  @Post('heat-logs')
  @RequirePermission(Permission.FLOCK_ENTRY_CREATE)
  createHeatLog(@Body() body: any, @CurrentUser() user: any) {
    return this.svc.createHeatLog(body, user.id);
  }

  @Patch('heat-logs/:id/stop')
  @RequirePermission(Permission.FLOCK_ENTRY_CREATE)
  stopBulbHeatLog(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.svc.stopBulbHeatLog(id, body, user.id);
  }

  // ── Per-level feed logs ──────────────────────────────────────────────────
  @Get('levels/:levelId/feed-logs')
  @RequirePermission(Permission.FEED_VIEW)
  listLevelFeedLogs(@Param('levelId') levelId: string, @Query('limit') limit?: string) {
    return this.svc.listLevelFeedLogs(levelId, limit ? Number(limit) : 30);
  }

  /** POST /brooder/feed-logs
   *  Req 3: Blocked if proposed qty + today's issued > daily HyLine ration.
   *  Req 4: Residual carry-forward visible in GET feed-requirement-summary. */
  @Post('feed-logs')
  @RequirePermission(Permission.FEED_INTAKE_LOG)
  createLevelFeedLog(@Body() body: any, @CurrentUser() user: any) {
    return this.svc.createLevelFeedLog(body, user.id);
  }

  // ── Per-level mortality logs (Req 1 + Req 2 + Req 7) ────────────────────
  @Get('levels/:levelId/mortality-logs')
  @RequirePermission(Permission.FLOCK_VIEW)
  listLevelMortalityLogs(@Param('levelId') levelId: string, @Query('limit') limit?: string) {
    return this.svc.listLevelMortalityLogs(levelId, limit ? Number(limit) : 30);
  }

  /** POST /brooder/mortality-logs
   *  Req 1: Accepts row + level + count.
   *  Req 2: Decrements level.birdCount and batch.currentBirdCount → feed
   *         auto-adjusts on next getCageMap / getFeedRequirementSummary call.
   *  Req 7: Fires BROODER_MORTALITY_HIGH notification if cumulative % > standard. */
  @Post('mortality-logs')
  @RequirePermission(Permission.FLOCK_ENTRY_CREATE)
  createLevelMortalityLog(@Body() body: any, @CurrentUser() user: any) {
    return this.svc.createLevelMortalityLog(body, user.id);
  }

  @Get('batches/:batchId/mortality-logs')
  @RequirePermission(Permission.FLOCK_VIEW)
  getBatchMortalityLogs(@Param('batchId') batchId: string) {
    return this.svc.getBatchMortalityLogs(batchId);
  }

  // ── General (batch-wide) population feed & mortality logs ───────────────
  // For when the Lead Attendant cannot track feed/mortality per row/level
  // and needs to record it against the whole population instead. The
  // service blocks these if row/level-specific entries already exist for
  // the same batch + date (and vice versa) to prevent double counting.
  // Both support backdating.

  @Get('batches/:batchId/general-feed-logs')
  @RequirePermission(Permission.FEED_VIEW)
  listGeneralFeedLogs(@Param('batchId') batchId: string, @Query('limit') limit?: string) {
    return this.svc.listGeneralFeedLogs(batchId, limit ? Number(limit) : 30);
  }

  @Post('general-feed-logs')
  @RequirePermission(Permission.FEED_INTAKE_LOG)
  createGeneralFeedLog(@Body() body: any, @CurrentUser() user: any) {
    return this.svc.createGeneralFeedLog(body, user.id);
  }

  @Get('batches/:batchId/general-mortality-logs')
  @RequirePermission(Permission.FLOCK_VIEW)
  listGeneralMortalityLogs(@Param('batchId') batchId: string, @Query('limit') limit?: string) {
    return this.svc.listGeneralMortalityLogs(batchId, limit ? Number(limit) : 30);
  }

  @Post('general-mortality-logs')
  @RequirePermission(Permission.FLOCK_ENTRY_CREATE)
  createGeneralMortalityLog(@Body() body: any, @CurrentUser() user: any) {
    return this.svc.createGeneralMortalityLog(body, user.id);
  }

  /** GET /brooder/batches/:batchId/population-record-sheet?days=30
   *  Per-day rollup of feed + mortality for a batch, merging general and
   *  row/level entries, so the attendant can see which days already have
   *  data (and by which method) before adding a backdated entry. */
  @Get('batches/:batchId/population-record-sheet')
  @RequirePermission(Permission.FLOCK_VIEW)
  getPopulationRecordSheet(@Param('batchId') batchId: string, @Query('days') days?: string) {
    return this.svc.getPopulationRecordSheet(batchId, days ? Number(days) : 30);
  }

  // ── Bird weight samples (Req 6 + Req 7) ─────────────────────────────────
  /** POST /brooder/weight-samples
   *  Req 6: Returns the HyLine standard band for the batch's age week.
   *  Req 7: Fires BROODER_WEIGHT_ANOMALY if sample is outside the band. */
  @Post('weight-samples')
  @RequirePermission(Permission.FLOCK_WEIGHT_LOG)
  checkWeightSample(@Body() body: any, @CurrentUser() user: any) {
    return this.svc.checkWeightSample(body, user.id);
  }

  @Get('batches/:batchId/weight-history')
  @RequirePermission(Permission.FLOCK_VIEW)
  getWeightHistory(@Param('batchId') batchId: string) {
    return this.svc.getWeightHistory(batchId);
  }

  /** GET /brooder/levels/:levelId/weight-history
   *  Weight samples logged specifically against this occupied row/level. */
  @Get('levels/:levelId/weight-history')
  @RequirePermission(Permission.FLOCK_VIEW)
  getLevelWeightHistory(@Param('levelId') levelId: string) {
    return this.svc.getLevelWeightHistory(levelId);
  }

  /** GET /brooder/batches/:batchId/mortality-check
   *  Returns real-time cumulative mortality % vs HyLine ceiling for the batch. */
  @Get('batches/:batchId/mortality-check')
  @RequirePermission(Permission.FLOCK_VIEW)
  getCumulativeMortalityCheck(@Param('batchId') batchId: string) {
    return this.svc.getCumulativeMortalityCheck(batchId);
  }
}
