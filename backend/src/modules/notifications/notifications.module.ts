import { Injectable, Controller, Get, Patch, Param, UseGuards, HttpCode, HttpStatus, Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationType } from '@prisma/client';
import { RequestUser } from '../../auth/types/request-user.type';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermissionGuard } from '../../common/guards/require-permission.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseUUIDPipe } from '@nestjs/common';

// ── Service ──────────────────────────────────────────────────────────────────
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getForUser(userId: string, includeRead = false) {
    return this.prisma.notification.findMany({
      where: {
        userId,
        ...(includeRead ? {} : { isRead: false }),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markAsRead(id: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id, userId }, // userId scope prevents reading other users' notifications
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  /**
   * Creates a notification for a specific user.
   * Called by other services (e.g. feed alert, overdue invoice).
   */
  async create(params: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    relatedEntityType?: string;
    relatedEntityId?: string;
  }) {
    return this.prisma.notification.create({ data: params });
  }

  /**
   * Creates notifications for multiple users at once.
   * Used for broadcast alerts (e.g. feed alert → Manager + Owner).
   */
  async createForUsers(
    userIds: string[],
    params: Omit<Parameters<NotificationsService['create']>[0], 'userId'>,
  ) {
    return this.prisma.notification.createMany({
      data: userIds.map(userId => ({ ...params, userId })),
    });
  }
}

// ── Controller ───────────────────────────────────────────────────────────────
@Controller('notifications')
@UseGuards(JwtAuthGuard, RequirePermissionGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  getNotifications(@CurrentUser() user: RequestUser) {
    return this.notificationsService.getForUser(user.id);
  }

  @Get('unread-count')
  getUnreadCount(@CurrentUser() user: RequestUser) {
    return this.notificationsService.getUnreadCount(user.id).then(count => ({ count }));
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  markAsRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.notificationsService.markAsRead(id, user.id);
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  markAllAsRead(@CurrentUser() user: RequestUser) {
    return this.notificationsService.markAllAsRead(user.id);
  }
}

// ── Module ───────────────────────────────────────────────────────────────────
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
