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

  @Get('pending')
  @RequirePermission(Permission.PRODUCTION_SESSION_VIEW)
  list() { return this.service.listPending(); }

  @Get('totals')
  @RequirePermission(Permission.PRICING_MANAGE)
  async getTotals(@Query('date') date: string) {
    if (!date) throw new BadRequestException('date query param is required (YYYY-MM-DD)');
    return this.service.getTallyTotalsForDate(date);
  }

  @Get('locked')
  @RequirePermission(Permission.PRODUCTION_SESSION_VIEW)
  listLocked(@Query('limit') limit?: string) { return this.service.listLocked(limit ? parseInt(limit, 10) : 30); }

  @Get(':sessionId')
  @RequirePermission(Permission.PRODUCTION_SESSION_VIEW)
  get(@Param('sessionId') sessionId: string) { return this.service.getBySession(sessionId); }

  @Put(':sessionId/edit')
  @RequirePermission(Permission.PRODUCTION_ENTRY_APPROVE)
  edit(@Param('sessionId') sessionId: string, @Body('rowData') rowData: any[], @CurrentUser() user: RequestUser) {
    return this.service.editAndResubmit(sessionId, rowData, user);
  }

  @Post(':sessionId/sign')
  @RequirePermission(Permission.PRODUCTION_SESSION_VIEW)
  sign(
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: RequestUser,
    @Body('brokenSellableQty') brokenSellableQty?: number,
    @Body('brokenUnsellableQty') brokenUnsellableQty?: number,
  ) {
    // brokenSellableQty/brokenUnsellableQty are only meaningful (and only
    // required) when the signer is Sales and the session has broken eggs —
    // the service validates that; both are optional at the HTTP layer so PM
    // and Store sign-off (which don't send them) aren't affected.
    const brokenSplit = (brokenSellableQty !== undefined || brokenUnsellableQty !== undefined)
      ? { brokenSellableQty: Number(brokenSellableQty ?? 0), brokenUnsellableQty: Number(brokenUnsellableQty ?? 0) }
      : undefined;
    return this.service.sign(sessionId, user, brokenSplit);
  }

  /**
   * POST /tally-verifications/:sessionId/retract
   * PM or Sales retracts their own signature.
   * PM retract clears PM + Sales + Store.
   * Sales retract clears Sales + Store (only if Store hasn't signed yet).
   */
  @Post(':sessionId/retract')
  @RequirePermission(Permission.PRODUCTION_SESSION_VIEW)
  retract(@Param('sessionId') sessionId: string, @CurrentUser() user: RequestUser) { return this.service.retractSign(sessionId, user); }

  @Patch(':sessionId/revenue')
  @RequirePermission(Permission.PRICING_MANAGE)
  setRevenue(@Param('sessionId') sessionId: string, @Body('expectedRevenueKes') expectedRevenueKes: number, @CurrentUser() user: RequestUser) {
    return this.service.setRevenue(sessionId, expectedRevenueKes, user);
  }
}
