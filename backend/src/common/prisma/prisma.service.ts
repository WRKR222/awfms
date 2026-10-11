import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { DEDUPED, duplicateWhere, filterNewNotifications, notificationDedupeKey } from './notification-dedupe';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'error' },
        { emit: 'stdout', level: 'warn' },
      ],
    });

    // Notification anti-spam (see notification-dedupe.ts): every
    // notification.create/createMany — including inside $transaction —
    // passes through here, so repeats are dropped no matter which service
    // raised them. The extended client keeps every PrismaService member
    // (lifecycle hooks, softDelete) because it proxies this instance.
    // Arrow functions keep `this` = the un-extended client for the look-ups.
    const logger = this.logger;
    return this.$extends({
      query: {
        notification: {
          create: async ({ args, query }) => {
            const { fresh } = await filterNewNotifications(this, [args.data as any]);
            if (fresh.length === 0) {
              const data = args.data as any;
              const existing = await this.notification.findFirst({
                where: duplicateWhere([data.userId], [notificationDedupeKey(data)]),
                orderBy: { createdAt: 'desc' },
              });
              logger.debug(`Notification skipped (repeat): ${(args.data as any).title}`);
              return Object.assign(existing ?? { ...(args.data as any), id: null }, { [DEDUPED]: true }) as any;
            }
            return query({ ...args, data: { ...(args.data as any), dedupeKey: fresh[0].dedupeKey } });
          },
          createMany: async ({ args, query }) => {
            const rows = (Array.isArray(args.data) ? args.data : [args.data]) as any[];
            const { fresh, skipped } = await filterNewNotifications(this, rows);
            if (skipped) logger.debug(`Notifications skipped (repeat): ${skipped}`);
            if (fresh.length === 0) return { count: 0 };
            return query({ ...args, data: fresh });
          },
        },
      },
    }) as unknown as PrismaService;
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('PostgreSQL connected via Prisma');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  // Helper: soft-delete aware find
  async softDelete(model: string, id: string): Promise<void> {
    await (this as any)[model].update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
