// src/modules/store/pm-requisition.controller.ts
import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards,
} from '@nestjs/common';
import { PMRequisitionService } from './pm-requisition.service';
import { SavePMRequisitionDraftDto } from './pm-requisition.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/enums/permissions.enum';

@Controller('store/pm-requisitions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PMRequisitionController {
  constructor(private readonly svc: PMRequisitionService) {}

  // Viewable by PM (their own), Store, and Director.
  @Get()
  @RequirePermission(Permission.PM_REQUISITION_VIEW)
  list(@Query('weekStartDate') weekStartDate?: string, @Query('status') status?: string) {
    return this.svc.list({ weekStartDate, status });
  }

  @Get(':id')
  @RequirePermission(Permission.PM_REQUISITION_VIEW)
  get(@Param('id') id: string) {
    return this.svc.getById(id);
  }

  // Create-or-update the DRAFT for a given week in one call.
  @Post('draft')
  @RequirePermission(Permission.PM_REQUISITION_CREATE)
  saveDraft(@Body() dto: SavePMRequisitionDraftDto, @CurrentUser() user: any) {
    return this.svc.saveDraft(dto, user.id);
  }

  // Sends the list to Store — folds every line into the week's issuance plan draft.
  @Patch(':id/submit')
  @RequirePermission(Permission.PM_REQUISITION_CREATE)
  submit(@Param('id') id: string, @CurrentUser() user: any) {
    return this.svc.submit(id, user.id);
  }

  @Delete(':id')
  @RequirePermission(Permission.PM_REQUISITION_CREATE)
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.svc.deleteDraft(id, user.id);
  }
}
