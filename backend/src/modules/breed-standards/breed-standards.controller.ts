// src/modules/breed-standards/breed-standards.controller.ts
import {
  BadRequestException, Body, Controller, Delete, Get, Header, Param, Patch, Post, Query,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../auth/types/request-user.type';
import { BreedStandardService } from './breed-standard.service';
import { StandardComplianceService } from './standard-compliance.service';
import { BreedGuideUploadService, GuideUploadInput } from './breed-guide-upload.service';

@Controller('breed-standards')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BreedStandardsController {
  constructor(
    private readonly standards: BreedStandardService,
    private readonly compliance: StandardComplianceService,
    private readonly uploads: BreedGuideUploadService,
  ) {}

  // ── Catalogue, breeds, guides ──────────────────────────────────────────

  @Get('catalog')
  @RequirePermission(Permission.FLOCK_VIEW)
  catalog() { return this.standards.metricCatalog(); }

  @Get('breeds')
  @RequirePermission(Permission.FLOCK_VIEW)
  breeds() { return this.standards.listBreeds(); }

  @Post('breeds')
  @RequirePermission(Permission.BREED_STANDARD_MANAGE)
  createBreed(@Body() body: any) { return this.standards.createBreed(body); }

  @Patch('breeds/:id/aliases')
  @RequirePermission(Permission.BREED_STANDARD_MANAGE)
  aliases(@Param('id') id: string, @Body('aliases') aliases: string[] | string) {
    const list = Array.isArray(aliases) ? aliases : String(aliases ?? '').split(',');
    return this.standards.updateBreedAliases(id, list);
  }

  /** GET /breed-standards/guides/template — CSV template for new guides. */
  @Get('guides/template')
  @RequirePermission(Permission.BREED_STANDARD_VIEW)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="breed-guide-template.csv"')
  template() { return this.uploads.templateCsv(); }

  @Get('guides/:id')
  @RequirePermission(Permission.BREED_STANDARD_VIEW)
  guide(@Param('id') id: string) { return this.standards.getGuide(id); }

  /** POST /breed-standards/guides/upload — new breed or new edition (saved as DRAFT). */
  @Post('guides/upload')
  @RequirePermission(Permission.BREED_STANDARD_MANAGE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 32 * 1024 * 1024 } }))
  upload(@UploadedFile() file: Express.Multer.File, @Body() body: GuideUploadInput, @CurrentUser() user: RequestUser) {
    return this.uploads.upload(file, body, user.id);
  }

  @Post('guides/:id/activate')
  @RequirePermission(Permission.BREED_GUIDE_APPROVE)
  activate(@Param('id') id: string, @CurrentUser() user: RequestUser) { return this.standards.activateGuide(id, user.id); }

  @Post('guides/:id/archive')
  @RequirePermission(Permission.BREED_GUIDE_APPROVE)
  archive(@Param('id') id: string) { return this.standards.archiveGuide(id); }

  // ── Batch registration & batch standards ───────────────────────────────

  /** GET /breed-standards/registration-options?strain=Hyline Brown — breed match,
   *  guide edition and the parameters the farmer can choose to record. */
  @Get('registration-options')
  @RequirePermission(Permission.FLOCK_VIEW)
  registrationOptions(@Query('strain') strain = '') { return this.standards.registrationOptions(strain); }

  /** GET /breed-standards/overview — Director's summary: problems + implications, decisions waiting. */
  @Get('overview')
  @RequirePermission(Permission.BREED_STANDARD_VIEW)
  overview() { return this.compliance.overview(); }

  @Get('batches/:id')
  @RequirePermission(Permission.BREED_STANDARD_VIEW)
  batch(@Param('id') id: string) { return this.compliance.getBatchStandards(id); }

  /** PATCH /breed-standards/batches/:id/setup — breed, recording plan, housing, light hours, nutrition programme. */
  @Patch('batches/:id/setup')
  @RequirePermission(Permission.FLOCK_BATCH_MANAGE)
  async setup(@Param('id') id: string, @Body() body: any) {
    await this.standards.applyBatchSetup(id, body, { reresolveBreed: body?.reresolveBreed === true });
    return this.compliance.getBatchStandards(id);
  }

  @Post('batches/:id/evaluate')
  @RequirePermission(Permission.BREED_STANDARD_VIEW)
  evaluate(@Param('id') id: string) { return this.compliance.evaluateBatch(id); }

  @Post('batches/:id/practices')
  @RequirePermission(Permission.BREED_STANDARD_MANAGE)
  addPractice(@Param('id') id: string, @Body() body: any, @CurrentUser() user: RequestUser) {
    return this.compliance.addPracticeNote(id, body, user.id);
  }

  @Patch('practices/:id/end')
  @RequirePermission(Permission.BREED_STANDARD_MANAGE)
  endPractice(@Param('id') id: string) { return this.compliance.endPracticeNote(id); }

  @Delete('practices/:id')
  @RequirePermission(Permission.BREED_STANDARD_MANAGE)
  removePractice(@Param('id') id: string) { return this.compliance.endPracticeNote(id, true); }

  // ── Cross-batch learning & farm standards ──────────────────────────────

  @Get('breeds/:id/compare')
  @RequirePermission(Permission.BREED_STANDARD_VIEW)
  compare(@Param('id') id: string, @Query('metric') metric: string) {
    if (!metric) throw new BadRequestException('metric is required');
    return this.compliance.compareBatches(id, metric);
  }

  @Get('breeds/:id/lessons')
  @RequirePermission(Permission.BREED_STANDARD_VIEW)
  lessons(@Param('id') id: string) { return this.compliance.lessons(id); }

  @Get('breeds/:id/farm-standards')
  @RequirePermission(Permission.BREED_STANDARD_VIEW)
  farmStandards(@Param('id') id: string) { return this.compliance.listFarmStandards(id); }

  @Post('breeds/:id/farm-standards/suggest')
  @RequirePermission(Permission.BREED_STANDARD_MANAGE)
  suggest(@Param('id') id: string, @CurrentUser() user: RequestUser) { return this.compliance.proposeFarmStandards(id, user.id); }

  @Post('farm-standards')
  @RequirePermission(Permission.BREED_STANDARD_MANAGE)
  createFarmStandard(@Body() body: any, @CurrentUser() user: RequestUser) { return this.compliance.createFarmStandard(body, user.id, user.role); }

  @Post('farm-standards/:id/decide')
  @RequirePermission(Permission.BREED_GUIDE_APPROVE)
  decide(@Param('id') id: string, @Body('approve') approve: boolean, @CurrentUser() user: RequestUser) {
    return this.compliance.decideFarmStandard(id, approve === true || String(approve) === 'true', user.id);
  }

  @Post('farm-standards/:id/retire')
  @RequirePermission(Permission.BREED_GUIDE_APPROVE)
  retire(@Param('id') id: string) { return this.compliance.retireFarmStandard(id); }
}
