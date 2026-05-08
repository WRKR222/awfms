import { Body, Controller, Get, Post, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermissionGuard } from '../../common/guards/require-permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { VisitorsService } from './visitors.service';

/**
 * Phase 5: Security gate flow.
 * Endpoints consumed by SECURITY1 (Main Gate) and SECURITY2 (Farm Gate)
 * front-ends to list approved visitor advance notices for a date and to
 * record CHECK_IN / CHECK_OUT events at the gate.
 */
@UseGuards(JwtAuthGuard, RequirePermissionGuard)
@Controller('visitors')
export class VisitorsController {
  constructor(private readonly svc: VisitorsService) {}

  @Get('approved')
  @RequirePermission(Permission.HEALTH_VISITOR_VIEW)
  approvedForGate(@Query('gate') gate: string, @Query('date') date?: string) {
    if (!gate) throw new BadRequestException('gate is required');
    return this.svc.getApprovedForGate(gate, date);
  }

  @Get('gate-log')
  @RequirePermission(Permission.HEALTH_VISITOR_VIEW)
  gateLog(@Query('gate') gate: string, @Query('date') date?: string) {
    if (!gate) throw new BadRequestException('gate is required');
    return this.svc.getGateLog(gate, date);
  }

  @Post('gate-log')
  @RequirePermission(Permission.HEALTH_VISITOR_LOG)
  createGateLog(
    @Body() body: { visitorId: string; gate: string; action: 'CHECK_IN' | 'CHECK_OUT'; timestamp?: string; notes?: string },
    @CurrentUser() user: any,
  ) {
    if (!body?.visitorId || !body?.gate || !body?.action) {
      throw new BadRequestException('visitorId, gate and action are required');
    }
    return this.svc.createGateLog(body, user.id);
  }
}
