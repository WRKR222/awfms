// src/modules/production/egg-collection-missed.cron.ts
//
// Egg collection is two shifts a day, each with its own hard submission
// deadline — AM locks at 12:00pm, PM locks at 4:30pm (farm-local) — see
// common/production/egg-collection-session-window.util.ts, the single
// source of truth for these windows. Once a shift's window closes it can
// never be filled in for that day through the normal flow (assertEggCollectionSessionOpen
// throws), so a missed shift is a real gap in the record, not just a delay.
// This cron checks, shortly after each window closes, whether every
// production house (Block 1 / Block 2) holding birds has a session for that
// shift and tells the Director (OWNER role) about any that don't.
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

  /** Each production house that holds birds must be recorded once per shift. */
  private async checkMissed(shift: EggCollectionShift) {
    const sessionDate = farmTodayUtcMidnight();

    const blocks = await this.prisma.farmBlock.findMany({
      where: { code: { in: ['BLK1', 'BLK2'] }, isActive: true, isUnderConstruction: false },
      select: { id: true, code: true },
    });
    const occupied: string[] = [];
    for (const b of blocks) {
      const birds = await this.prisma.productionCageAssignment.count({
        where: { cage: { blockId: b.id }, batch: { stage: 'PRODUCTION', isActive: true, deletedAt: null } },
      });
      if (birds > 0) occupied.push(b.code === 'BLK2' ? 'BLOCK2' : 'BLOCK1');
    }
    // Legacy fallback: production batches with no per-cage placement live in Block 1.
    if (!occupied.includes('BLOCK1')) {
      const legacy = await this.prisma.batch.count({
        where: { stage: 'PRODUCTION', isActive: true, deletedAt: null, productionCageAssignments: { none: {} } },
      });
      if (legacy > 0) occupied.push('BLOCK1');
    }
    if (occupied.length === 0) return;

    const logged = await this.prisma.eggCollectionSession.findMany({
      where: { block: { in: occupied }, sessionDate, shift, deletedAt: null },
      select: { block: true },
    });
    const loggedBlocks = new Set(logged.map(l => l.block));
    const missed = occupied.filter(b => !loggedBlocks.has(b)).map(b => (b === 'BLOCK2' ? 'Block 2' : 'Block 1'));
    if (missed.length === 0) return;

    const w = EGG_COLLECTION_SESSION_WINDOWS[shift];
    const names = missed.join(' and ');

    await this.notifications.notifyRole(
      UserRole.OWNER,
      NotificationType.EGG_COLLECTION_SESSION_MISSED as any,
      `${w.label} — Not Recorded`,
      `The ${w.label} window closed at ${w.closesLabel} and Production House ${names} ` +
        `${missed.length === 1 ? 'was' : 'were'} not recorded today.`,
    );

    this.logger.warn(`Egg collection ${shift} missed for ${sessionDate.toISOString().slice(0, 10)} — ${names}`);
  }
}
