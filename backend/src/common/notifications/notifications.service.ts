
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType, UserRole } from '@prisma/client';
import { NOTIFICATION_CREATED_EVENT } from '../events/app-event-bus';
import { DEDUPED, filterNewNotifications } from '../prisma/notification-dedupe';

/** Optional extras on every notify call. `dedupeKey` = "this exact data point
 *  was already flagged" — the same recipient never gets that key twice. */
export interface NotifyMeta { entityId?: string; entityType?: string; dedupeKey?: string }

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private emitter: EventEmitter2,
  ) {}

  /** Notify a specific user */
  async notifyUser(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    meta?: NotifyMeta,
  ) {
    const notification = await this.prisma.notification.create({
      data: { userId, type, title, message, ...meta },
    });
    // Repeat of something this user was already told — nothing new to push.
    if ((notification as any)[DEDUPED]) return;

    this.emitter.emit(NOTIFICATION_CREATED_EVENT, {
      userId,
      id: notification.id,
      type,
      title,
      message,
    });

    this.logger.log(`Notification → user ${userId}: ${title}`);
  }

  /** Notify all active users of a given role */
  async notifyRole(
    role: UserRole,
    type: NotificationType,
    title: string,
    message: string,
    meta?: NotifyMeta,
  ) {
    const users = await this.prisma.user.findMany({
      where: { role, isActive: true, deletedAt: null },
      select: { id: true },
    });

    if (users.length === 0) return;

    // Only users who haven't already been told get a row (and a push).
    const { fresh } = await filterNewNotifications(this.prisma, users.map(u => ({
      userId: u.id,
      type,
      title,
      message,
      entityId: meta?.entityId,
      entityType: meta?.entityType,
      dedupeKey: meta?.dedupeKey,
    })));
    if (fresh.length === 0) return;

    await this.prisma.notification.createMany({ data: fresh });

    fresh.forEach(n =>
      this.emitter.emit(NOTIFICATION_CREATED_EVENT, { userId: n.userId, type, title, message }),
    );

    this.logger.log(`Notification → role ${role} (${fresh.length} users): ${title}`);
  }

  /** Get notifications for a user — optionally include read ones */
  async getNotifications(userId: string, includeRead = false, take = 50) {
    return this.prisma.notification.findMany({
      where: {
        userId,
        ...(includeRead ? {} : { isRead: false }),
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /** Get only unread notifications (legacy helper used internally) */
  async getUnread(userId: string) {
    return this.getNotifications(userId, false, 50);
  }

  /** Mark specific notification(s) as read */
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

  /** Count unread notifications for a user */
  async countUnread(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  /**
   * Mark all FEED_LOW_STOCK notifications as read for a given user.
   * Used to clear accumulated stale feed alerts from the DB so they stop
   * appearing in the login modal.
   */
  async dismissFeedLowStockAlerts(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: {
        userId,
        type: 'FEED_LOW_STOCK' as any,
        isRead: false,
      },
      data: { isRead: true, readAt: new Date() },
    });
    return { dismissed: result.count };
  }
}
