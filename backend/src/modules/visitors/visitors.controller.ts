import {
  Body, Controller, Get, Param, Patch, Post, Query, UseGuards, BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard }           from '../../common/guards/jwt-auth.guard';
import { RequirePermissionGuard } from '../../common/guards/require-permission.guard';
import { RequirePermission }      from '../../common/decorators/require-permission.decorator';
import { CurrentUser }            from '../../common/decorators/current-user.decorator';
import { Permission }             from '../../common/enums/permissions.enum';
import { VisitorsService }        from './visitors.service';

/**
 * Security gate flow.
 * FIX: Permission.VISITOR_LOG_CREATE → Permission.HEALTH_VISITOR_LOG on checkout().
 * Gate ordering for both entry and exit enforced in service.
 */
@UseGuards(JwtAuthGuard, RequirePermissionGuard)
@Controller('visitors')
export class VisitorsController {
  constructor(private readonly svc: VisitorsService) {}

  /**
   * GET /visitors/approved?gate=MAIN_GATE&date=YYYY-MM-DD
   * Returns the approved visitor list for a given gate and date.
   * Used by Security1 and Security2 home pages.
   */
  @Get('approved')
  @RequirePermission(Permission.HEALTH_VISITOR_VIEW)
  approvedForGate(@Query('gate') gate: string, @Query('date') date?: string) {
    if (!gate) throw new BadRequestException('gate is required');
    return this.svc.getApprovedForGate(gate, date);
  }

  /**
   * GET /visitors/gate-log?gate=MAIN_GATE&date=YYYY-MM-DD
   * Returns check-in/out log entries for a gate on a given date.
   */
  @Get('gate-log')
  @RequirePermission(Permission.HEALTH_VISITOR_VIEW)
  gateLog(@Query('gate') gate: string, @Query('date') date?: string) {
    if (!gate) throw new BadRequestException('gate is required');
    return this.svc.getGateLog(gate, date);
  }

  /**
   * POST /visitors/gate-log
   * Record a CHECK_IN or CHECK_OUT at a gate.
   * Gate ordering rules enforced in service:
   *   Entry: FARM_GATE requires prior MAIN_GATE CHECK_IN
   *   Exit:  MAIN_GATE CHECK_OUT requires prior FARM_GATE CHECK_OUT (if entered farm)
   */
  @Post('gate-log')
  @RequirePermission(Permission.HEALTH_VISITOR_LOG)
  createGateLog(
    @Body() body: {
      visitorId: string;
      gate: string;
      action: 'CHECK_IN' | 'CHECK_OUT';
      timestamp?: string;
      notes?: string;
    },
    @CurrentUser() user: any,
  ) {
    if (!body?.visitorId || !body?.gate || !body?.action) {
      throw new BadRequestException('visitorId, gate and action are required');
    }
    return this.svc.createGateLog(body, user.id);
  }

  /**
   * PATCH /visitors/gate-log/:id/checkout
   * Alternative checkout via log entry ID.
   * FIX: Changed permission from Permission.VISITOR_LOG_CREATE (undefined) to
   *      Permission.HEALTH_VISITOR_LOG (correct security permission).
   */
  @Patch('gate-log/:id/checkout')
  @RequirePermission(Permission.HEALTH_VISITOR_LOG)
  checkout(
    @Param('id') id: string,
    @Body() body: { gate: string; notes?: string },
    @CurrentUser() user: any,
  ) {
    if (!body?.gate) throw new BadRequestException('gate is required for checkout');
    return this.svc.createGateLog(
      { visitorId: id, gate: body.gate, action: 'CHECK_OUT', notes: body.notes },
      user.id,
    );
  }
}
