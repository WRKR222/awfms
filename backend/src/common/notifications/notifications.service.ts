import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType, UserRole } from '@prisma/client';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private prisma: PrismaService) {}

  /** Notify a specific user */
  async notifyUser(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    meta?: { entityId?: string; entityType?: string },
  ) {
    await this.prisma.notification.create({
      data: { userId, type, title, message, ...meta },
    });
    this.logger.log(`Notification → user ${userId}: ${title}`);
  }

  /** Notify all active users of a given role */
  async notifyRole(
    role: UserRole,
    type: NotificationType,
    title: string,
    message: string,
    meta?: { entityId?: string; entityType?: string },
  ) {
    const users = await this.prisma.user.findMany({
      where: { role, isActive: true, deletedAt: null },
      select: { id: true },
    });

    await this.prisma.notification.createMany({
      data: users.map(u => ({
        userId: u.id,
        type,
        title,
        message,
        entityId: meta?.entityId,
        entityType: meta?.entityType,
      })),
    });
    this.logger.log(`Notification → role ${role} (${users.length} users): ${title}`);
  }

  /** Get unread notifications for a user */
  async getUnread(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId, isRead: false },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /** Mark notification(s) as read */
  async markRead(notificationIds: string[], userId: string) {
    return this.prisma.notification.updateMany({
      where: { id: { in: notificationIds }, userId },
      data: { isRead: true, readAt: new Date() },
    });
  }

  /** Mark all notifications as read for a user */
  async markAllRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  }
}
