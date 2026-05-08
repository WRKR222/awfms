
import {
  Controller, Get, Patch, Body, Param, Query, UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  /**
   * GET /notifications
   * Query params:
   *   includeRead=true   — include already-read notifications (default: false)
   *   limit=N            — max records (default: 50, max: 200)
   */
  @Get()
  getNotifications(
    @Request() req: any,
    @Query('includeRead') includeRead?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = req.user.id;
    const include = includeRead === 'true';
    const take = Math.min(parseInt(limit ?? '50', 10), 200);
    return this.svc.getNotifications(userId, include, take);
  }

  /** PATCH /notifications/read-all — mark all (or selected) as read */
  @Patch('read-all')
  markAllRead(@Request() req: any, @Body() body?: { ids?: string[] }) {
    if (body?.ids?.length) {
      return this.svc.markRead(body.ids, req.user.id);
    }
    return this.svc.markAllRead(req.user.id);
  }

  /** PATCH /notifications/:id/read — mark single notification read */
  @Patch(':id/read')
  markRead(@Param('id') id: string, @Request() req: any) {
    return this.svc.markRead([id], req.user.id);
  }

  
}
