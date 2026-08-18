// src/modules/store/pm-requisition.controller.ts
import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, ForbiddenException,
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

  // PM requisitions are no longer visible to the Director at all — only
  // MANAGER (the PM) and STORE. This can't be expressed through
  // PM_REQUISITION_VIEW alone: OWNER is granted every Permission value
  // automatically (see ROLE_PERMISSIONS[OWNER] = Object.values(Permission)
  // in role-permissions.map.ts), so the permissions guard would always let
  // a Director through regardless of what's (or isn't) granted to that
  // role explicitly. Blocking it here, before the guard's permission check
  // even matters, is the only way to actually exclude OWNER.
  private assertNotDirector(user: any) {
    if (user?.role === 'OWNER') {
      throw new ForbiddenException('PM requisitions are not visible to the Director.');
    }
  }

  // Viewable by PM (their own) and Store — NOT the Director.
  @Get()
  @RequirePermission(Permission.PM_REQUISITION_VIEW)
  list(
    @Query('weekStartDate') weekStartDate?: string,
    @Query('status') status?: string,
    @CurrentUser() user?: any,
  ) {
    this.assertNotDirector(user);
    return this.svc.list({ weekStartDate, status });
  }

  @Get(':id')
  @RequirePermission(Permission.PM_REQUISITION_VIEW)
  get(@Param('id') id: string, @CurrentUser() user: any) {
    this.assertNotDirector(user);
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

  // Full removal — DRAFT or already-SUBMITTED ("past") requisitions alike.
  // See PMRequisitionService.deleteRequisition for the cascade behaviour.
  @Delete(':id')
  @RequirePermission(Permission.PM_REQUISITION_ITEM_DELETE)
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    this.assertNotDirector(user);
    return this.svc.deleteRequisition(id);
  }

  // Delete a single line — works on a DRAFT or an already-SUBMITTED
  // requisition. If the line was already folded into an issuance plan draft,
  // that plan line is cascade-deleted too, so the change is visible to Store
  // and anyone else with plan-view access, not just the PM.
  @Delete(':id/items/:itemId')
  @RequirePermission(Permission.PM_REQUISITION_ITEM_DELETE)
  removeItem(@Param('id') id: string, @Param('itemId') itemId: string, @CurrentUser() user: any) {
    this.assertNotDirector(user);
    return this.svc.deleteItem(id, itemId, user.id);
  }
}
