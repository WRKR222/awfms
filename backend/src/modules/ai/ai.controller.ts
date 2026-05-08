import { Controller, Get, Post, Query, UseGuards, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { AiService } from './ai.service';

@Controller('ai')
@UseGuards(JwtAuthGuard)
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

  /** POST /ai/reports/trigger — manually trigger weekly report (Director on-demand) */
  @Post('reports/trigger')
  @RequirePermission(Permission.AI_REPORTS_VIEW)
  triggerReport() {
    return this.ai.triggerWeeklyReport();
  }
}
