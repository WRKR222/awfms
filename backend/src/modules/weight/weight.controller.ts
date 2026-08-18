// src/modules/weight/weight.controller.ts
import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards,
  UploadedFile, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../auth/types/request-user.type';
import { WeightAlertService } from './weight-alert.service';
import { BirdWeightReportService } from './bird-weight-report.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('weight')
export class WeightController {
  constructor(
    private readonly alerts: WeightAlertService,
    private readonly reports: BirdWeightReportService,
  ) {}

  // ── Director-facing weight-standard alerts ──────────────────────────────

  /** GET /weight/alerts — list ProductionWeightAlert records (Director's
   *  cross-referenced "weight outside standard band" queue). Optional
   *  ?status=OPEN|ACKNOWLEDGED|RESOLVED and ?batchId=... filters. */
  @Get('alerts')
  @RequirePermission(Permission.WEIGHT_ALERT_VIEW)
  listAlerts(@Query('status') status?: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED', @Query('batchId') batchId?: string) {
    return this.alerts.listAlerts({ status, batchId });
  }

  /** GET /weight/alerts/:id — one alert with its full cross-reference
   *  context (feed, mortality, AI analysis) for the detail view. */
  @Get('alerts/:id')
  @RequirePermission(Permission.WEIGHT_ALERT_VIEW)
  getAlert(@Param('id') id: string) {
    return this.alerts.getAlert(id);
  }

  /** PATCH /weight/alerts/:id/status — Director acknowledges or resolves
   *  a flag after investigating (e.g. confirmed underfeeding and corrected
   *  the ration, or confirmed a sampling error and dismissed it). */
  @Patch('alerts/:id/status')
  @RequirePermission(Permission.WEIGHT_ALERT_MANAGE)
  updateAlertStatus(
    @Param('id') id: string,
    @Body('status') status: 'ACKNOWLEDGED' | 'RESOLVED',
    @CurrentUser() user: RequestUser,
  ) {
    if (status !== 'ACKNOWLEDGED' && status !== 'RESOLVED') {
      throw new BadRequestException('status must be ACKNOWLEDGED or RESOLVED');
    }
    return this.alerts.updateAlertStatus(id, status, user.id);
  }

  // ── PM bird weight report upload / autofill ─────────────────────────────

  /** POST /weight/reports/upload — PM uploads a spreadsheet of bird weights
   *  (individual per-bird weights, or a sample-count + total-weight
   *  aggregate) taken outside the app. Parses + persists it; does not write
   *  into any batch's records yet — see /weight/reports/autofill. */
  @Post('reports/upload')
  @RequirePermission(Permission.BIRD_WEIGHT_REPORT_UPLOAD)
  @UseInterceptors(FileInterceptor('file'))
  upload(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: RequestUser) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.reports.uploadAndParse(file.buffer, file.originalname, user.id);
  }

  /** GET /weight/reports/autofill?batchId=&date=YYYY-MM-DD — the Farm
   *  Events "Bird Weighing" form calls this once a batch + date is picked,
   *  to prefill sample count / individual weights / totals from the most
   *  recently uploaded report that covers that batch + date. */
  @Get('reports/autofill')
  @RequirePermission(Permission.BIRD_WEIGHT_REPORT_UPLOAD)
  autofill(@Query('batchId') batchId: string, @Query('date') date: string) {
    if (!batchId || !date) throw new BadRequestException('batchId and date are required');
    return this.reports.autofill(batchId, date);
  }

  /** GET /weight/reports — recent uploads, for the PM's own reference. */
  @Get('reports')
  @RequirePermission(Permission.BIRD_WEIGHT_REPORT_UPLOAD)
  listUploads(@Query('limit') limit?: string) {
    return this.reports.listUploads(limit ? parseInt(limit, 10) : 20);
  }

  /** GET /weight/reports/:id — one upload's full parsed row set. */
  @Get('reports/:id')
  @RequirePermission(Permission.BIRD_WEIGHT_REPORT_UPLOAD)
  getUpload(@Param('id') id: string) {
    return this.reports.getUpload(id);
  }
}
