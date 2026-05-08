import { Injectable, Controller, Get, Patch, Param, UseGuards, Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationType } from '@prisma/client';
import { RequestUser } from '../../auth/types/request-user.type';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getForUser(userId: string, includeRead = false) {
    return this.prisma.notification.findMany({
      where: { userId, ...(includeRead ? {} : { isRead: false }) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markAsRead(id: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id, userId },
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
    return this.prisma.notification.count({ where: { userId, isRead: false } });
  }

  async create(params: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    entityId?: string;
    entityType?: string;
  }) {
    return this.prisma.notification.create({ data: params });
  }

  async createForUsers(
    userIds: string[],
    params: Omit<Parameters<NotificationsService['create']>[0], 'userId'>,
  ) {
    return this.prisma.notification.createMany({
      data: userIds.map(userId => ({ ...params, userId })),
    });
  }
}

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  getMyNotifications(@CurrentUser() user: RequestUser) {
    return this.notificationsService.getForUser(user.id);
  }

  @Get('all')
  getAllNotifications(@CurrentUser() user: RequestUser) {
    return this.notificationsService.getForUser(user.id, true);
  }

  @Get('unread-count')
  getUnreadCount(@CurrentUser() user: RequestUser) {
    return this.notificationsService.getUnreadCount(user.id);
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.notificationsService.markAsRead(id, user.id);
  }

  @Patch('read-all')
  markAllRead(@CurrentUser() user: RequestUser) {
    return this.notificationsService.markAllAsRead(user.id);
  }
}

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}