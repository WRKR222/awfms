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

  // ── Cage map ─────────────────────────────────────────────────────────
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

  // ── Level assignment (attendant places/moves chicks onto a level) ──────
  @Post('levels/:levelId/assign')
  @RequirePermission(Permission.FLOCK_ENTRY_CREATE)
  assignLevel(@Param('levelId') levelId: string, @Body() body: any, @CurrentUser() user: any) {
    return this.svc.assignLevel(levelId, body, user.id);
  }

  @Delete('levels/:levelId/assign')
  @RequirePermission(Permission.FLOCK_BATCH_MANAGE)
  removeLevelAssignment(@Param('levelId') levelId: string) {
    return this.svc.removeLevelAssignment(levelId);
  }

  // ── Heat logs (charcoal qty or heat-bulb timer) per row ─────────────────
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

  // ── Per-level feed logs ─────────────────────────────────────────────────
  @Get('levels/:levelId/feed-logs')
  @RequirePermission(Permission.FEED_VIEW)
  listLevelFeedLogs(@Param('levelId') levelId: string, @Query('limit') limit?: string) {
    return this.svc.listLevelFeedLogs(levelId, limit ? Number(limit) : 30);
  }

  @Post('feed-logs')
  @RequirePermission(Permission.FEED_INTAKE_LOG)
  createLevelFeedLog(@Body() body: any, @CurrentUser() user: any) {
    return this.svc.createLevelFeedLog(body, user.id);
  }
}
