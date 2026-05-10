import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { HealthService } from './health.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermissionGuard } from '../../common/guards/require-permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/enums/permissions.enum';

@UseGuards(JwtAuthGuard, RequirePermissionGuard)
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Post('events')
  @RequirePermission(Permission.HEALTH_EVENT_LOG)
  logEvent(@Body() body: any, @CurrentUser() user: any) { return this.healthService.logHealthEvent(body, user.id); }

  @Get('events')
  @RequirePermission(Permission.HEALTH_VIEW)
  getAllEvents(@Query('limit') limit?: string, @Query('batchId') batchId?: string) {
    return this.healthService.getAllHealthEvents(limit ? parseInt(limit, 10) : 50, batchId);
  }

  @Get('events/:batchId')
  @RequirePermission(Permission.HEALTH_VIEW)
  getEvents(@Param('batchId') batchId: string) { return this.healthService.getHealthEvents(batchId); }

  @Delete('events/:id')
  @RequirePermission(Permission.HEALTH_EVENT_LOG)
  deleteEvent(@Param('id') id: string) { return this.healthService.deleteHealthEvent(id); }

  @Post('vaccinations')
  @RequirePermission(Permission.HEALTH_VACCINATION_LOG)
  logVaccination(@Body() body: any, @CurrentUser() user: any) { return this.healthService.logVaccination(body, user.id); }

  @Get('vaccinations')
  @RequirePermission(Permission.HEALTH_VIEW)
  getVaccinations(@Query('batchId') batchId?: string, @Query('limit') limit?: string) {
    return this.healthService.getVaccinationRecords(batchId, limit ? parseInt(limit, 10) : 50);
  }

  @Get('vaccination-schedule')
  @RequirePermission(Permission.HEALTH_VIEW)
  getSchedule(@Query('birdType') birdType?: string) { return this.healthService.getVaccinationSchedule(birdType); }

  @Post('visitors')
  @RequirePermission(Permission.HEALTH_VISITOR_LOG)
  logVisitor(@Body() body: any, @CurrentUser() user: any) { return this.healthService.logVisitor(body, user.id); }

  @Get('visitors')
  @RequirePermission(Permission.HEALTH_VIEW)
  getVisitors(@Query('days') days?: string) { return this.healthService.getVisitors(days ? parseInt(days, 10) : 30); }

  @Patch('visitors/:id/checkout')
  @RequirePermission(Permission.HEALTH_VISITOR_LOG)
  checkOut(@Param('id') id: string) { return this.healthService.checkOutVisitor(id); }

  @Post('visitors/advance')
  @RequirePermission(Permission.HEALTH_VISITOR_LOG)
  createAdvanceNotice(@Body() body: any, @CurrentUser() user: any) { return this.healthService.createAdvanceNotice(body, user.id); }

  @Get('visitors/advance')
  @RequirePermission(Permission.HEALTH_VIEW)
  getAdvanceNotices(@Query('days') days?: string) { return this.healthService.getAdvanceNotices(days ? parseInt(days, 10) : 30); }

  @Patch('visitors/advance/:id/status')
  @RequirePermission(Permission.VISITOR_NOTICE_APPROVE)
  updateAdvanceStatus(@Param('id') id: string, @Body() body: { status: 'APPROVED' | 'REJECTED'; directorNote?: string }, @CurrentUser() user: any) {
    return this.healthService.updateAdvanceNoticeStatus(id, body.status, body.directorNote, user.id);
  }

  @Post('checklist')
  @RequirePermission(Permission.HEALTH_VIEW)
  submitChecklist(@Body() body: any, @CurrentUser() user: any) { return this.healthService.submitChecklist(body, user.id); }

  @Get('checklist')
  @RequirePermission(Permission.HEALTH_VIEW)
  getChecklists(@Query('days') days?: string) { return this.healthService.getChecklists(days ? parseInt(days, 10) : 14); }

  @Get('checklist/:id')
  @RequirePermission(Permission.HEALTH_VIEW)
  getChecklist(@Param('id') id: string) { return this.healthService.getChecklistById(id); }

  @Post('biosecurity')
  @RequirePermission(Permission.HEALTH_VISITOR_LOG)
  submitBiosecurity(@Body() body: any, @CurrentUser() user: any) { return this.healthService.submitBiosecurityLog(body, user.id); }

  @Get('biosecurity')
  @RequirePermission(Permission.HEALTH_VIEW)
  getBiosecurity(@Query('days') days?: string, @Query('type') type?: string) {
    return this.healthService.getBiosecurityLogs(days ? parseInt(days, 10) : 30, type);
  }
}
