import { Controller, Get, Post, Param, Query, UseGuards, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { AiService } from './ai.service';

// FIX: Added PermissionsGuard to @UseGuards. Previously the @RequirePermission decorators
//      set metadata that nobody read, making all AI routes accessible to any authenticated
//      user regardless of role.

@Controller('ai')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AiController {
  constructor(private ai: AiService) {}

  /** GET /ai/reports — paginated list of all AI reports, Director only */
  @Get('reports')
  @RequirePermission(Permission.AI_REPORTS_VIEW)
  getReports(
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page:  number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('type') type?: string,
  ) {
    return this.ai.getReports(page, limit, type);
  }

  /** GET /ai/reports/summary — latest weekly report snippet for dashboard panel */
  @Get('reports/summary')
  @RequirePermission(Permission.AI_REPORTS_VIEW)
  getLatestSummary() {
    return this.ai.getLatestSummary();
  }

  /** GET /ai/readiness[?batchId=] — is the data complete enough for an AI report? (no AI call) */
  @Get('readiness')
  @RequirePermission(Permission.AI_REPORTS_VIEW)
  readiness(@Query('batchId') batchId?: string) {
    return this.ai.getReadiness(batchId);
  }

  /** POST /ai/reports/trigger — manually trigger weekly report (Director on-demand) */
  @Post('reports/trigger')
  @RequirePermission(Permission.AI_REPORTS_VIEW)
  triggerReport() {
    return this.ai.triggerWeeklyReport();
  }

  /**
   * POST /ai/reports/batch/:batchId/trigger — generate a report for ONE
   * specific batch (active or recently closed/sold/discarded), Director
   * on-demand. Refused (no AI call) when the batch's recent records are too
   * incomplete; returns the previous report when nothing new was recorded.
   */
  @Post('reports/batch/:batchId/trigger')
  @RequirePermission(Permission.AI_REPORTS_VIEW)
  triggerBatchReport(@Param('batchId') batchId: string) {
    return this.ai.generateBatchReport(batchId);
  }
}
