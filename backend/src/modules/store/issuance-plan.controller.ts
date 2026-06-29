// src/modules/store/issuance-plan.controller.ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Res,
  ForbiddenException,
} from '@nestjs/common';
import { IssuancePlanService } from './issuance-plan.service';
import {
  CreateIssuancePlanDto,
  UpdateIssuancePlanDto,
  RejectIssuancePlanItemDto,
  SetFeedConsumptionPlanDto,
} from './issuance-plan.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { Response } from 'express';

@Controller('store/issuance-plans')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class IssuancePlanController {
  constructor(private readonly svc: IssuancePlanService) {}

  // ── List & detail ──────────────────────────────────────────────────────────
  // Viewable by anyone in the chain: Store, Accountant (read-only), Director.

  @Get()
  @RequirePermission(Permission.INVENTORY_VIEW)
  list(
    @Query('type') type?: string,
    @Query('phase') phase?: string,
    @Query('weekStartDate') weekStartDate?: string,
  ) {
    return this.svc.listPlans({ type, phase, weekStartDate });
  }

  @Get(':id')
  @RequirePermission(Permission.INVENTORY_VIEW)
  get(@Param('id') id: string) {
    return this.svc.getPlan(id);
  }

  // ── Create / Submit (Store only) ───────────────────────────────────────────
  // Store can create a DRAFT on any day of the week.
  // Submission of weekly plans is enforced to Saturday by the service.

  @Post()
  @RequirePermission(Permission.INVENTORY_MANAGE)
  create(@Body() dto: CreateIssuancePlanDto, @CurrentUser() user: any) {
    return this.svc.createPlan(dto, user.id);
  }

  @Patch(':id/submit')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  submit(@Param('id') id: string, @CurrentUser() user: any) {
    return this.svc.submitPlan(id, user.id);
  }

  // ── Update (edit line items) — Store (DRAFT) or Director (their queue) ─────

  @Patch(':id')
  @RequirePermission(Permission.INVENTORY_VIEW)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateIssuancePlanDto,
    @CurrentUser() user: any,
  ) {
    return this.svc.updatePlan(id, dto, user.role);
  }

  // ── Per-item approve / reject — Director (OWNER) only ─────────────────────
  // Accountant no longer has an approval role; they receive notifications about
  // Director decisions for visibility and reconciliation only.

  @Patch(':id/items/:itemId/approve')
  @RequirePermission(Permission.INVENTORY_VIEW)
  approveItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: any,
  ) {
    if (user.role !== 'OWNER') {
      throw new ForbiddenException('Only the Director can approve issuance plan items');
    }
    return this.svc.approveItem(id, itemId, user.id, user.role);
  }

  @Patch(':id/items/:itemId/reject')
  @RequirePermission(Permission.INVENTORY_VIEW)
  rejectItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: RejectIssuancePlanItemDto,
    @CurrentUser() user: any,
  ) {
    if (user.role !== 'OWNER') {
      throw new ForbiddenException('Only the Director can reject issuance plan items');
    }
    return this.svc.rejectItem(id, itemId, user.id, user.role, dto.rejectionReason);
  }

  // ── PDF download — once at least one item is APPROVED ─────────────────────

  @Get(':id/pdf')
  @RequirePermission(Permission.INVENTORY_VIEW)
  async pdf(@Param('id') id: string, @Res() res: Response) {
    await this.svc.streamPdf(id, res);
  }

  // ── PM feed consumption plan (Manager only) ────────────────────────────────

  @Post('feed-consumption-plan')
  @RequirePermission(Permission.FEED_INTAKE_LOG)
  setFeedPlan(@Body() dto: SetFeedConsumptionPlanDto, @CurrentUser() user: any) {
    return this.svc.setFeedConsumptionPlan({ ...dto, userId: user.id });
  }

  @Get('feed-consumption-plan/:weekStartDate')
  @RequirePermission(Permission.INVENTORY_VIEW)
  getFeedPlan(@Param('weekStartDate') weekStartDate: string) {
    return this.svc.getFeedConsumptionPlan(weekStartDate);
  }
}
