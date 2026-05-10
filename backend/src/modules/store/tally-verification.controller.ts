// src/modules/store/tally-verification.controller.ts
import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../auth/types/request-user.type';
import { TallyVerificationService } from './tally-verification.service';

@Controller('tally-verifications')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TallyVerificationController {
  constructor(private readonly service: TallyVerificationService) {}

  // ── List pending (unlocked) tallies ──────────────────────────────────────
  @Get('pending')
  @RequirePermission(Permission.PRODUCTION_SESSION_VIEW)
  list() {
    return this.service.listPending();
  }

  // ── Get tally by sessionId ────────────────────────────────────────────────
  @Get(':sessionId')
  @RequirePermission(Permission.PRODUCTION_SESSION_VIEW)
  get(@Param('sessionId') sessionId: string) {
    return this.service.getBySession(sessionId);
  }

  // ── Manager edits row data (clears all 3 signatures so everyone re-signs) ──
  @Put(':sessionId/edit')
  @RequirePermission(Permission.PRODUCTION_ENTRY_APPROVE)
  edit(
    @Param('sessionId') sessionId: string,
    @Body('rowData') rowData: any[],
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.editAndResubmit(sessionId, rowData, user);
  }

  // ── Sign the tally (PM / Sales / Store) ──────────────────────────────────
  // When all 3 parties have signed the tally is automatically locked.
  @Post(':sessionId/sign')
  @RequirePermission(Permission.PRODUCTION_SESSION_VIEW)
  sign(@Param('sessionId') sessionId: string, @CurrentUser() user: RequestUser) {
    return this.service.sign(sessionId, user);
  }

  // ── Set expected morning revenue (Accountant / Owner only) ───────────────
  // Only callable after the tally is locked (all 3 parties signed).
  // FIX: was /tally/:id/revenue (wrong prefix + id type).
  // Frontend now calls: api.patch(`/tally-verifications/${tally.sessionId}/revenue`, ...)
  @Patch(':sessionId/revenue')
  @RequirePermission(Permission.PRICING_MANAGE)
  setRevenue(
    @Param('sessionId') sessionId: string,
    @Body('expectedRevenueKes') expectedRevenueKes: number,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.setRevenue(sessionId, expectedRevenueKes, user);
  }

  // ── FIX-02: Egg category totals for Accountant pricing ───────────────────
  // Returns standardEggs / starterEggs / brokenSellableEggs from the latest
  // locked tally at or before the given date.
  // Feeds into AccountantPricingPage expected-revenue auto-calculation.
  @Get('totals')
  @RequirePermission(Permission.PRICING_MANAGE)
  async getTotals(@Query('date') date: string) {
    if (!date) {
      throw new BadRequestException('date query param is required (YYYY-MM-DD)');
    }
    return this.service.getTallyTotalsForDate(date);
  }

}
