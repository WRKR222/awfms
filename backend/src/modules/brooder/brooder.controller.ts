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

  @Get('feed-requirement-summary')
  @RequirePermission(Permission.FLOCK_VIEW)
  getFeedRequirementSummary() {
    return this.svc.getFeedRequirementSummary();
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

  /** GET /brooder/batches/:batchId/mortality-check
   *  Returns real-time cumulative mortality % vs HyLine ceiling for the batch. */
  @Get('batches/:batchId/mortality-check')
  @RequirePermission(Permission.FLOCK_VIEW)
  getCumulativeMortalityCheck(@Param('batchId') batchId: string) {
    return this.svc.getCumulativeMortalityCheck(batchId);
  }
}
