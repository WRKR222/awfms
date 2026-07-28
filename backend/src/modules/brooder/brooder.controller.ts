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

  /** GET /brooder/general-feed-schedule
   *  Day-by-day feed SCHEDULE (what should be given) for the current
   *  calendar week, computed farm-wide from each batch's general/official
   *  population — entirely independent of the cage map's row/level
   *  assignments. Use this when row/level bird counts on the cage map can't
   *  be relied on (not kept up to date); it gives the attendant a per-day
   *  total for the whole brooder, plus the per-batch figures it was
   *  calculated from, without needing an accurate row/level breakdown. */
  @Get('general-feed-schedule')
  @RequirePermission(Permission.FLOCK_VIEW)
  getGeneralFeedScheduleByDay() {
    return this.svc.getGeneralFeedScheduleByDay();
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

  /** GET /brooder/levels/:levelId/week-schedule?date=YYYY-MM-DD
   *  Recomputes the required-feed schedule for whichever brooder week
   *  `date` falls into (past or current), day-by-day, using every
   *  mortality/culling event on record for that window — including any
   *  entered or backdated AFTER that week already ended. Unlike the
   *  cage-map "Schedule" figure (which only ever reflects the CURRENT
   *  week), this lets you re-check a past week after a late/backdated
   *  mortality entry. */
  @Get('levels/:levelId/week-schedule')
  @RequirePermission(Permission.FLOCK_VIEW)
  getBrooderWeekSchedule(
    @Param('levelId') levelId: string,
    @Query('date') date: string,
  ) {
    return this.svc.getBrooderWeekSchedule(levelId, date);
  }

  // ── Cage assignment ──────────────────────────────────────────────────────
  // Population, mortality, reassignment, and weighing are now tracked per
  // cage (see AGENTS.md brooder cage-map notes). The parent level's rollup
  // is maintained automatically by the service.
  @Post('cages/:cageId/assign')
  @RequirePermission(Permission.FLOCK_ENTRY_CREATE)
  assignCage(
    @Param('cageId') cageId: string,
    @Body() body: any,
    @CurrentUser() user: any,
  ) {
    return this.svc.assignCage(cageId, body, user.id);
  }

  @Delete('cages/:cageId/assign')
  @RequirePermission(Permission.FLOCK_BATCH_MANAGE)
  removeCageAssignment(@Param('cageId') cageId: string) {
    return this.svc.removeCageAssignment(cageId);
  }

  /** POST /brooder/levels/:levelId/assign-equally
   *  Places `birdCount` (the LEVEL total) for one batch, split evenly
   *  across every cage on that level, instead of assigning cages one at a
   *  time. See BrooderService.assignLevelEqually for the split rule. */
  @Post('levels/:levelId/assign-equally')
  @RequirePermission(Permission.FLOCK_ENTRY_CREATE)
  assignLevelEqually(
    @Param('levelId') levelId: string,
    @Body() body: any,
    @CurrentUser() user: any,
  ) {
    return this.svc.assignLevelEqually(levelId, body, user.id);
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
   *  Req 4: Schedule-vs-issued net-to-issue visible in GET feed-requirement-summary. */
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

  /** GET /brooder/cages/:cageId/mortality-logs
   *  Mortality/culling history for one specific cage. */
  @Get('cages/:cageId/mortality-logs')
  @RequirePermission(Permission.FLOCK_VIEW)
  listCageMortalityLogs(@Param('cageId') cageId: string, @Query('limit') limit?: string) {
    return this.svc.listCageMortalityLogs(cageId, limit ? Number(limit) : 30);
  }

  /** POST /brooder/mortality-logs
   *  Req 1: Accepts row + level + count.
   *  Req 2: Decrements cage/level.birdCount (batch.currentBirdCount is left
   *         untouched — the cage map's population is tracked fully
   *         independently of the general record, in both directions) →
   *         feed auto-adjusts on next getCageMap / getFeedRequirementSummary
   *         call.
   *  Does NOT run the Req 7 mortality-vs-HyLine-schedule check — that only
   *  runs against the general population sheet, see POST
   *  /brooder/general-mortality-logs below. A cage-map entry never fires
   *  BROODER_MORTALITY_HIGH on its own. */
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

  /** POST /brooder/general-mortality-logs
   *  Decrements batch.currentBirdCount only — never touches any cage/level
   *  birdCount. The cage map is fully independent of this sheet. This is
   *  also the only place the Req 7 mortality-vs-HyLine-schedule check runs
   *  (fires BROODER_MORTALITY_HIGH if cumulative % > standard). */
  @Post('general-mortality-logs')
  @RequirePermission(Permission.FLOCK_ENTRY_CREATE)
  createGeneralMortalityLog(@Body() body: any, @CurrentUser() user: any) {
    return this.svc.createGeneralMortalityLog(body, user.id);
  }

  // ── Stock count (opening / closing stock reconciliation) ────────────────
  /** GET /brooder/batches/:batchId/expected-opening-stock
   *  What today's Opening Stock field should default to — the most recent
   *  stock count's closing stock, or the batch's current live count if
   *  none has ever been logged. Used to prefill the Daily Log form. */
  @Get('batches/:batchId/expected-opening-stock')
  @RequirePermission(Permission.FLOCK_VIEW)
  getExpectedOpeningStock(@Param('batchId') batchId: string) {
    return this.svc.getExpectedOpeningStock(batchId);
  }

  /** POST /brooder/stock-counts
   *  Upserts the whole-batch opening/closing stock for (batchId, logDate).
   *  Flags (but never blocks) a mismatch between the entered opening stock
   *  and the previous day's closing stock — e.g. after a physical bird
   *  count finds fewer birds than expected. */
  @Post('stock-counts')
  @RequirePermission(Permission.FLOCK_ENTRY_CREATE)
  createStockCount(@Body() body: any, @CurrentUser() user: any) {
    return this.svc.createStockCount(body, user.id);
  }

  /** GET /brooder/batches/:batchId/stock-counts?days=30 */
  @Get('batches/:batchId/stock-counts')
  @RequirePermission(Permission.FLOCK_VIEW)
  listStockCounts(@Param('batchId') batchId: string, @Query('days') days?: string) {
    return this.svc.listStockCounts(batchId, days ? Number(days) : 30);
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

  /** GET /brooder/cages/:cageId/weight-history
   *  Weight samples logged specifically against this occupied cage. */
  @Get('cages/:cageId/weight-history')
  @RequirePermission(Permission.FLOCK_VIEW)
  getCageWeightHistory(@Param('cageId') cageId: string) {
    return this.svc.getCageWeightHistory(cageId);
  }

  /** GET /brooder/batches/:batchId/mortality-check
   *  Returns real-time cumulative mortality % vs HyLine ceiling for the batch. */
  @Get('batches/:batchId/mortality-check')
  @RequirePermission(Permission.FLOCK_VIEW)
  getCumulativeMortalityCheck(@Param('batchId') batchId: string) {
    return this.svc.getCumulativeMortalityCheck(batchId);
  }
}
