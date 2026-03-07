import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { HealthService } from './health.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/enums/permissions.enum';

@ApiTags('Health & Biosecurity')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Post('events')
  @RequirePermission(Permission.HEALTH_EVENT_LOG)
  @ApiOperation({ summary: 'Log a health event (disease outbreak, injury, checkup)' })
  logEvent(@Body() body: any, @CurrentUser() user: any) {
    return this.healthService.logHealthEvent(body, user.id);
  }

  @Get('events/:batchId')
  @RequirePermission(Permission.HEALTH_VIEW)
  @ApiOperation({ summary: 'Get health events for a batch' })
  getEvents(@Param('batchId') batchId: string) {
    return this.healthService.getHealthEvents(batchId);
  }

  @Post('vaccinations')
  @RequirePermission(Permission.HEALTH_VACCINATION_LOG)
  @ApiOperation({ summary: 'Log a vaccination administration' })
  logVaccination(@Body() body: any, @CurrentUser() user: any) {
    return this.healthService.logVaccination(body, user.id);
  }

  @Get('vaccination-schedule')
  @RequirePermission(Permission.HEALTH_VIEW)
  @ApiOperation({ summary: 'Get the standard vaccination schedule' })
  getSchedule(@Query('birdType') birdType?: string) {
    return this.healthService.getVaccinationSchedule(birdType);
  }

  @Post('visitors')
  @RequirePermission(Permission.HEALTH_VISITOR_LOG)
  @ApiOperation({ summary: 'Log a visitor biosecurity entry' })
  logVisitor(@Body() body: any, @CurrentUser() user: any) {
    return this.healthService.logVisitor(body, user.id);
  }
}
