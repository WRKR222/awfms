// src/modules/brooder/brooder-missed-log.cron.ts
//
// The attendant brooder daily log is 3 time-gated popups (Morning ≤9am,
// 11am popup 11am–1pm, 3pm popup 3pm–5pm — see
// common/brooder/brooder-session-window.util.ts, the single source of
// truth for these windows). Once a popup's window closes it can never be
// filled in for that day through the normal flow — there is no "late"
// submission — so a missed popup is a real gap in the record, not just a
// delay. This cron checks, shortly after each window closes, whether every
// active brooder batch has a log for that popup and tells the Director
// (OWNER role) about any that don't.
//
// Cron times follow the same "written as farm-local, since the deployed
// process' wall clock is set to the farm's timezone" convention as every
// other cron in this codebase (see pm-requisition.cron.ts / issuance-plan.cron.ts)
// — farmNow()'s manual UTC-offset shift is only needed for the getUTCHours()
// -based math in feed-standard.util.ts, not for @Cron scheduling itself.
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { NotificationType, UserRole } from '@prisma/client';
import { farmTodayUtcMidnight } from '../../common/feed/feed-standard.util';
import { BROODER_SESSION_WINDOWS, BrooderSessionKey } from '../../common/brooder/brooder-session-window.util';

@Injectable()
export class BrooderMissedLogCron {
  private readonly logger = new Logger(BrooderMissedLogCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** 9:05am — 5 minutes after the Morning popup (3am+6am readings) locks. */
  @Cron('5 9 * * *')
  async checkMorningWindow() {
    await this.checkMissed('MORNING');
  }

  /** 1:05pm — 5 minutes after the 11am popup locks. */
  @Cron('5 13 * * *')
  async checkMiddayWindow() {
    await this.checkMissed('MIDDAY');
  }

  /** 5:05pm — 5 minutes after the 3pm popup locks. */
  @Cron('5 17 * * *')
  async checkEveningWindow() {
    await this.checkMissed('EVENING');
  }

  private async checkMissed(session: BrooderSessionKey) {
    const logDate = farmTodayUtcMidnight();

    const batches: { id: string; batchCode: string }[] = await this.prisma.batch.findMany({
      where: { location: 'BROODER', isActive: true, deletedAt: null },
      select: { id: true, batchCode: true },
    });
    if (batches.length === 0) return;

    const logged: { batchId: string }[] = await this.prisma.brooderLog.findMany({
      where: {
        batchId: { in: batches.map((b: { id: string }) => b.id) },
        logDate,
        logSession: session as any,
      },
      select: { batchId: true },
    });
    const loggedIds = new Set(logged.map((l: { batchId: string }) => l.batchId));
    const missed = batches.filter((b: { id: string }) => !loggedIds.has(b.id));
    if (missed.length === 0) return;

    const w = BROODER_SESSION_WINDOWS[session];
    const codes = missed.map((b: { batchCode: string }) => b.batchCode).join(', ');
    const plural = missed.length !== 1;

    await this.notifications.notifyRole(
      UserRole.OWNER,
      NotificationType.BROODER_LOG_MISSED as any,
      `Brooder ${w.label} — Not Logged`,
      `The ${w.label} popup closed at ${w.closesLabel} and ${plural ? 'these batches were' : 'this batch was'} ` +
        `not logged today: ${codes}.`,
    );

    this.logger.warn(`Brooder ${session} log missed for ${logDate.toISOString().slice(0, 10)} — batches: ${codes}`);
  }
}
