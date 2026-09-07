// src/modules/production/hdp-control.controller.ts
import {
  Controller, Get, Post, Body, Param, UseGuards,
  UploadedFile, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../auth/types/request-user.type';
import { HdpControlService } from './hdp-control.service';
import { UploadHdpControlsSchema } from './hdp-control.dto';

@Controller('production/hdp-controls')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class HdpControlController {
  constructor(private readonly service: HdpControlService) {}

  /** POST /production/hdp-controls/upload — PM uploads the target HDP% curve (PDF/Excel/Word/image — FIX: image uploads are read with Claude's vision API). */
  @Post('upload')
  @RequirePermission(Permission.HDP_CONTROL_UPLOAD)
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('granularity') granularity: string,
    @Body('notes') notes: string | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    const parsed = UploadHdpControlsSchema.safeParse({ granularity, notes });
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map(i => i.message).join('; '));
    }
    return this.service.upload(file, parsed.data, user);
  }

  /** GET /production/hdp-controls/active — the currently active control curve. */
  @Get('active')
  @RequirePermission(Permission.HDP_CONTROL_VIEW)
  getActive() { return this.service.getActive(); }

  /** GET /production/hdp-controls — upload history. */
  @Get()
  @RequirePermission(Permission.HDP_CONTROL_VIEW)
  list() { return this.service.listUploads(); }

  /** GET /production/hdp-controls/comparison/:batchId — actual vs. target HDP% for a batch. */
  @Get('comparison/:batchId')
  @RequirePermission(Permission.HDP_CONTROL_VIEW)
  getComparison(@Param('batchId') batchId: string) {
    return this.service.getComparison(batchId);
  }
}
