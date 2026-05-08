// src/modules/store/tally-verification.controller.ts
import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
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
  list() {
    return this.service.listPending();
  }

  @Get(':sessionId')
  @RequirePermission(Permission.PRODUCTION_SESSION_VIEW)
  get(@Param('sessionId') sessionId: string) {
    return this.service.getBySession(sessionId);
  }

  @Put(':sessionId/edit')
  @RequirePermission(Permission.PRODUCTION_ENTRY_APPROVE)
  edit(
    @Param('sessionId') sessionId: string,
    @Body('rowData') rowData: any[],
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.editAndResubmit(sessionId, rowData, user);
  }

  @Post(':sessionId/sign')
  @RequirePermission(Permission.PRODUCTION_SESSION_VIEW)
  sign(@Param('sessionId') sessionId: string, @CurrentUser() user: RequestUser) {
    return this.service.sign(sessionId, user);
  }
}
