// src/modules/data-upload/data-upload.controller.ts
import {
  Controller, Get, Post, Query, Body, UseGuards,
  UploadedFile, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermissionGuard } from '../../common/guards/require-permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { DataUploadService, UploadCategory } from './data-upload.service';

@Controller('data-upload')
@UseGuards(JwtAuthGuard, RequirePermissionGuard)
export class DataUploadController {
  constructor(private readonly svc: DataUploadService) {}

  /** GET /data-upload/templates?category=expenses — column mapping templates */
  @Get('templates')
  @RequirePermission(Permission.AI_REPORTS_VIEW)
  getTemplates(@Query('category') category?: string) {
    return this.svc.getTemplates(category);
  }

  /** POST /data-upload/detect-headers — parse file and return column headers */
  @Post('detect-headers')
  @RequirePermission(Permission.AI_REPORTS_VIEW)
  @UseInterceptors(FileInterceptor('file'))
  detectHeaders(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.svc.detectHeaders(file.buffer, file.originalname);
  }

  /** POST /data-upload/preview — preview first 20 mapped rows */
  @Post('preview')
  @RequirePermission(Permission.AI_REPORTS_VIEW)
  @UseInterceptors(FileInterceptor('file'))
  preview(
    @UploadedFile() file: Express.Multer.File,
    @Body('category') category: UploadCategory,
    @Body('mapping') mappingJson: string,
  ) {
    if (!file)     throw new BadRequestException('No file uploaded');
    if (!category) throw new BadRequestException('category is required');
    let mapping: Record<string, string | null> = {};
    try { mapping = JSON.parse(mappingJson ?? '{}'); } catch { /* ignore */ }
    return this.svc.previewImport(file.buffer, category, mapping);
  }

  /** POST /data-upload/import — commit the import */
  @Post('import')
  @RequirePermission(Permission.AI_REPORTS_VIEW)
  @UseInterceptors(FileInterceptor('file'))
  async importData(
    @UploadedFile() file: Express.Multer.File,
    @Body('category') category: UploadCategory,
    @Body('mapping') mappingJson: string,
    @CurrentUser() user: any,
  ) {
    if (!file)     throw new BadRequestException('No file uploaded');
    if (!category) throw new BadRequestException('category is required');
    let mapping: Record<string, string | null> = {};
    try { mapping = JSON.parse(mappingJson ?? '{}'); } catch { /* ignore */ }
    return this.svc.importRecords(file.buffer, category, mapping, user.id, file.originalname);
  }

  /** GET /data-upload/history — recent upload logs */
  @Get('history')
  @RequirePermission(Permission.AI_REPORTS_VIEW)
  getHistory(@Query('limit') limit?: string) {
    return this.svc.getHistory(limit ? parseInt(limit) : 20);
  }
}
