// src/modules/store/production-report.controller.ts
import {
  Controller, Get, Post, Body, Param, Query, Res, UseGuards,
  UploadedFile, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../auth/types/request-user.type';
import { ProductionReportService } from './production-report.service';
import { ProductionReportColumnMapping } from './production-report.dto';

function parseMapping(json: string): ProductionReportColumnMapping {
  try {
    const parsed = JSON.parse(json ?? '{}');
    return { fields: parsed.fields ?? {}, items: parsed.items ?? {} };
  } catch {
    throw new BadRequestException('mapping must be valid JSON with "fields" and "items"');
  }
}

@Controller('store/production-reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProductionReportController {
  constructor(private readonly service: ProductionReportService) {}

  /** POST /store/production-reports/detect-headers — read a file's headers + suggest a mapping */
  @Post('detect-headers')
  @RequirePermission(Permission.PRODUCTION_REPORT_UPLOAD)
  @UseInterceptors(FileInterceptor('file'))
  detectHeaders(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.service.detectHeaders(file.buffer);
  }

  /** POST /store/production-reports/preview — see how a mapping reads the file before submitting.
   *  Non-mutating — this is the §2a verify step Store reviews before Approve & Submit. */
  @Post('preview')
  @RequirePermission(Permission.PRODUCTION_REPORT_UPLOAD)
  @UseInterceptors(FileInterceptor('file'))
  preview(@UploadedFile() file: Express.Multer.File, @Body('mapping') mappingJson: string) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.service.preview(file.buffer, parseMapping(mappingJson));
  }

  /** POST /store/production-reports/:batchId/discard — Store rejects the parsed table at the
   *  verify step (§2a) before anything is submitted for reconciliation. Nothing was mutated;
   *  this just records that Store looked at it and discarded it. Plain JSON body (no file). */
  @Post(':batchId/discard')
  @RequirePermission(Permission.PRODUCTION_REPORT_UPLOAD)
  discard(
    @Param('batchId') batchId: string,
    @Body('fileName') fileName: string,
    @Body('mapping') mapping: ProductionReportColumnMapping,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.discardPreview(batchId, fileName, mapping ?? { fields: {}, items: {} }, user);
  }

  /** POST /store/production-reports/:batchId/submit — upload (or re-upload) the current report for a batch.
   *  Applies immediately wherever the sheet doesn't conflict with recorded data; only
   *  conflicts are held back for the Director. */
  @Post(':batchId/submit')
  @RequirePermission(Permission.PRODUCTION_REPORT_UPLOAD)
  @UseInterceptors(FileInterceptor('file'))
  submit(
    @Param('batchId') batchId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('mapping') mappingJson: string,
    @CurrentUser() user: RequestUser,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.service.submit(batchId, file.buffer, parseMapping(mappingJson), file.originalname, user);
  }

  /** POST /store/production-reports/:batchId/match-item — Store manually
   *  matches a report label the automatic matcher couldn't place (e.g.
   *  "chickcrumbs") to an existing store item. Saved as a reusable alias
   *  and re-applied to the current report immediately. */
  @Post(':batchId/match-item')
  @RequirePermission(Permission.PRODUCTION_REPORT_UPLOAD)
  matchItem(
    @Param('batchId') batchId: string,
    @Body('rawLabel') rawLabel: string,
    @Body('storeItemId') storeItemId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.matchItem(batchId, rawLabel, storeItemId, user);
  }

  /** GET /store/production-reports/pending — queue of reports with open discrepancies still
   *  needing a resolution decision. Store resolves its own reports directly; Owner can too. */
  @Get('pending')
  @RequirePermission(Permission.PRODUCTION_REPORT_REVIEW)
  listPending() {
    return this.service.listPending();
  }

  /** GET /store/production-reports — every batch's current report (any status) */
  @Get()
  @RequirePermission(Permission.PRODUCTION_REPORT_VIEW)
  listAll() {
    return this.service.listAll();
  }

  /** GET /store/production-reports/:batchId — the current report for one batch */
  @Get(':batchId')
  @RequirePermission(Permission.PRODUCTION_REPORT_VIEW)
  getByBatch(@Param('batchId') batchId: string) {
    return this.service.getByBatch(batchId);
  }

  /** GET /store/production-reports/:batchId/export — Director pulls the current report as a spreadsheet */
  @Get(':batchId/export')
  @RequirePermission(Permission.PRODUCTION_REPORT_VIEW)
  async exportReport(@Param('batchId') batchId: string, @Res() res: Response) {
    const { buffer, fileName } = await this.service.exportReport(batchId);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });
    res.send(buffer);
  }

  /** POST /store/production-reports/:reportId/approve — trust the report for every still-open
   *  discrepancy on it. Store closes out its own reports here — no separate Director sign-off. */
  @Post(':reportId/approve')
  @RequirePermission(Permission.PRODUCTION_REPORT_REVIEW)
  approve(@Param('reportId') reportId: string, @CurrentUser() user: RequestUser) {
    return this.service.approve(reportId, user);
  }

  /** POST /store/production-reports/:reportId/reject — reject outright; fix the file/mapping and re-upload */
  @Post(':reportId/reject')
  @RequirePermission(Permission.PRODUCTION_REPORT_REVIEW)
  reject(@Param('reportId') reportId: string, @Body('reason') reason: string, @CurrentUser() user: RequestUser) {
    return this.service.reject(reportId, reason, user);
  }

  /** POST /store/production-reports/:reportId/rollback — undo every auto-filled/
   *  auto-corrected daily record this report ever wrote (across all its
   *  uploads/resubmissions). Does not touch anything already approved via
   *  /approve — see ProductionReportRollbackService. */
  @Post(':reportId/rollback')
  @RequirePermission(Permission.PRODUCTION_REPORT_REVIEW)
  rollback(@Param('reportId') reportId: string, @CurrentUser() user: RequestUser) {
    return this.service.rollback(reportId, user);
  }
}
