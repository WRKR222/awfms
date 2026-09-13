// src/modules/production/egg-collection-missed.cron.ts
//
// Egg collection is two shifts a day, each with its own hard submission
// deadline — AM locks at 12:00pm, PM locks at 4:30pm (farm-local) — see
// common/production/egg-collection-session-window.util.ts, the single
// source of truth for these windows. Once a shift's window closes it can
// never be filled in for that day through the normal flow (assertEggCollectionSessionOpen
// throws), so a missed shift is a real gap in the record, not just a delay.
// This cron checks, shortly after each window closes, whether every active
// production-stage batch has a session for that shift and tells the
// Director (OWNER role) about any that don't.
//
// Exact same pattern as brooder-missed-log.cron.ts. Cron times are written
// as farm-local, since the deployed process' wall clock is set to the
// farm's timezone — farmNow()'s manual UTC-offset shift is only needed for
// the getUTCHours()-based math in feed-standard.util.ts, not for @Cron
// scheduling itself.
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { NotificationType, UserRole } from '@prisma/client';
import { farmTodayUtcMidnight } from '../../common/feed/feed-standard.util';
import {
  EGG_COLLECTION_SESSION_WINDOWS,
  EggCollectionShift,
} from '../../common/production/egg-collection-session-window.util';

@Injectable()
export class EggCollectionMissedCron {
  private readonly logger = new Logger(EggCollectionMissedCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** 12:05pm — 5 minutes after the AM session locks. */
  @Cron('5 12 * * *')
  async checkAmWindow() {
    await this.checkMissed('AM');
  }

  /** 4:35pm — 5 minutes after the PM session locks. */
  @Cron('35 16 * * *')
  async checkPmWindow() {
    await this.checkMissed('PM');
  }

  private async checkMissed(shift: EggCollectionShift) {
    const sessionDate = farmTodayUtcMidnight();

    const batches: { id: string; batchCode: string }[] = await this.prisma.batch.findMany({
      where: { stage: 'PRODUCTION', isActive: true, deletedAt: null },
      select: { id: true, batchCode: true },
    });
    if (batches.length === 0) return;

    const logged: { batchId: string }[] = await this.prisma.eggCollectionSession.findMany({
      where: {
        batchId: { in: batches.map((b: { id: string }) => b.id) },
        sessionDate,
        shift,
        deletedAt: null,
      },
      select: { batchId: true },
    });
    const loggedIds = new Set(logged.map((l: { batchId: string }) => l.batchId));
    const missed = batches.filter((b: { id: string }) => !loggedIds.has(b.id));
    if (missed.length === 0) return;

    const w = EGG_COLLECTION_SESSION_WINDOWS[shift];
    const codes = missed.map((b: { batchCode: string }) => b.batchCode).join(', ');
    const plural = missed.length !== 1;

    await this.notifications.notifyRole(
      UserRole.OWNER,
      NotificationType.EGG_COLLECTION_SESSION_MISSED as any,
      `${w.label} — Not Recorded`,
      `The ${w.label} window closed at ${w.closesLabel} and ${plural ? 'these batches were' : 'this batch was'} ` +
        `not recorded today: ${codes}.`,
    );

    this.logger.warn(`Egg collection ${shift} missed for ${sessionDate.toISOString().slice(0, 10)} — batches: ${codes}`);
  }
}
