// src/modules/store/tally-verification.service.ts
// 3-party morning tally sign-off — PM, Sales, Store all sign;
// Manager may edit until lock; once all 3 signatures present, locks the tally.
//
// IMPLEMENTATION PLAN CHANGES:
//   • Tally records are now created in createTallyForSession(), called from
//     the production service when PM session is approved AND AM is already
//     approved. Both AM and PM tally records are created at that point.
//   • listPending() no longer needs a post-filter — tallies only exist when
//     both sessions are approved.
//   • signAndMaybeLock(): after all 6 cosigns (3 parties × 2 sessions),
//     calculates aggregate revenue, writes DailyEggAggregate, and emits
//     a tally.locked event.

import {
  Injectable, NotFoundException, BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestUser } from '../../auth/types/request-user.type';

type Party = 'PM' | 'SALES' | 'STORE';

const ROLE_TO_PARTY: Record<string, Party | undefined> = {
  MANAGER: 'PM',
  OWNER:   'PM',
  SALES:   'SALES',
  STORE:   'STORE',
};

@Injectable()
export class TallyVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  // ─── Called by production.service when PM session is approved ───────────────
  // Creates tally records for BOTH AM and PM sessions so they appear on each
  // party's morning sign-off queue together.
  async createTallyForSession(sessionId: string, sessionDate: Date) {
    // Idempotent — skip if already exists
    const existing = await this.prisma.eggTallyVerification.findUnique({
      where: { sessionId },
    });
    if (existing) return existing;

    const nextDay = new Date(sessionDate);
    nextDay.setDate(nextDay.getDate() + 1);

    return this.prisma.eggTallyVerification.create({
      data: {
        sessionId,
        verificationDate: nextDay,

      },
    });
  }

  async getBySession(sessionId: string) {
    const tally = await this.prisma.eggTallyVerification.findUnique({
      where: { sessionId },
      include: {
        session: {
          include: {
            batch:        { select: { batchCode: true } },
            storeIntakes: true,
          },
        },
      },
    });
    if (!tally) throw new NotFoundException('Tally not found for this session');
    return tally;
  }

  async listPending() {
    // Tallies only exist once both AM+PM are approved (created in createTallyForSession),
    // so no additional filter is needed here.
    const tallies = await this.prisma.eggTallyVerification.findMany({
      where: { isLocked: false },
      include: {
        session: {
          select: {
            id: true, sessionDate: true, shift: true,
            houseId: true, totalGoodEggs: true, totalFullTrays: true,
            totalLooseEggs: true,
            totalStarterEggs: true, totalBrokenSellable: true,
            totalBrokenUnsellable: true, totalSoftShell: true,
            totalDeformed: true, totalWeightKg: true,
            rowData: true,
            batchId: true,
          },
        },
      },
      orderBy: { verificationDate: 'desc' },
    });

    const batchIds = [
      ...new Set(tallies.map(t => t.session?.batchId).filter(Boolean) as string[]),
    ];
    const batches = batchIds.length
      ? await this.prisma.batch.findMany({
          where: { id: { in: batchIds } },
          select: { id: true, batchCode: true },
        })
      : [];
    const batchMap = Object.fromEntries(batches.map(b => [b.id, b.batchCode]));

    return tallies.map(t => ({
      ...t,
      session: t.session
        ? { ...t.session, batch: { batchCode: batchMap[t.session.batchId] ?? '[Batch Removed]' } }
        : null,
    }));
  }

  /** Manager edits the underlying session row data. Clears all 3 signatures. */
  async editAndResubmit(
    sessionId: string,
    rowData: any[],
    user: RequestUser,
  ) {
    if (user.role !== 'MANAGER' && user.role !== 'OWNER') {
      throw new ForbiddenException('Only the Production Manager may edit during tally');
    }

    const tally = await this.prisma.eggTallyVerification.findUnique({ where: { sessionId } });
    if (!tally) throw new NotFoundException('Tally not found');
    if (tally.isLocked) throw new BadRequestException('Tally already locked');

    let totalFullTrays = 0, totalLooseEggs = 0, totalBrokenEggs = 0;
    let totalSoftShell = 0, totalDeformed = 0, totalWeightKg = 0;
    for (const r of rowData) {
      totalFullTrays  += r.fullTrays  ?? 0;
      totalLooseEggs  += r.looseEggs  ?? 0;
      totalBrokenEggs += r.brokenEggs ?? 0;
      totalSoftShell  += r.softShell  ?? 0;
      totalDeformed   += r.deformed   ?? 0;
      totalWeightKg   += r.weightKg   ?? 0;
    }
    const totalGoodEggs = totalFullTrays * 30 + totalLooseEggs;

    return this.prisma.$transaction(async (tx) => {
      await tx.eggCollectionSession.update({
        where: { id: sessionId },
        data: {
          rowData: rowData as any,
          totalFullTrays, totalLooseEggs, totalBrokenEggs, totalSoftShell, totalDeformed,
          totalWeightKg, totalGoodEggs,
          editedAt: new Date(),
          editedById: user.id,
        },
      });

      const updated = await tx.eggTallyVerification.update({
        where: { sessionId },
        data: {
          pmSignedById: null,    pmSignedAt: null,    pmRowData: Prisma.JsonNull,
          salesSignedById: null, salesSignedAt: null, salesRowData: Prisma.JsonNull,
          storeSignedById: null, storeSignedAt: null, storeRowData: Prisma.JsonNull,
          editCount: { increment: 1 },
          lastEditedById: user.id,
          lastEditedAt: new Date(),
        },
      });

      const targets = await tx.user.findMany({
        where: { role: { in: ['SALES', 'STORE'] }, isActive: true },
        select: { id: true },
      });
      for (const t of targets) {
        await tx.notification.create({
          data: {
            userId: t.id,
            type: 'EGG_TALLY_TRIGGERED' as any,
            title: 'Tally edited — re-sign required',
            message: 'Production Manager edited the tally. Please review and re-sign.',
            entityId: sessionId,
            entityType: 'EggCollectionSession',
          },
        });
      }
      return updated;
    });
  }

  /** Sign for the calling user's role. When all 3 signed, locks. */
  async sign(sessionId: string, user: RequestUser) {
    const party = ROLE_TO_PARTY[user.role];
    if (!party) throw new ForbiddenException('Your role cannot sign the tally');

    const tally = await this.prisma.eggTallyVerification.findUnique({
      where: { sessionId },
      include: { session: true },
    });
    if (!tally) throw new NotFoundException('Tally not found');
    if (tally.isLocked) throw new BadRequestException('Tally already locked');

    if (tally.session.status !== 'APPROVED') {
      throw new BadRequestException('Session must be Manager-verified before tally signing');
    }

    const now = new Date();
    const data: any = {};
    if (party === 'PM') {
      if (tally.pmSignedById) throw new BadRequestException('Already signed by Production Manager');
      data.pmSignedById = user.id; data.pmSignedAt = now;
      data.pmRowData = tally.session.rowData;
    } else if (party === 'SALES') {
      if (tally.salesSignedById) throw new BadRequestException('Already signed by Sales');
      data.salesSignedById = user.id; data.salesSignedAt = now;
      data.salesRowData = tally.session.rowData;
    } else {
      if (tally.storeSignedById) throw new BadRequestException('Already signed by Store');
      data.storeSignedById = user.id; data.storeSignedAt = now;
      data.storeRowData = tally.session.rowData;
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.eggTallyVerification.update({
        where: { sessionId }, data,
      });

      const allSigned = !!(updated.pmSignedById && updated.salesSignedById && updated.storeSignedById);
      if (!allSigned) return updated;

      // ── Check if the sibling session's tally is also fully signed ───────────
      const session = tally.session as any;
      const siblingShift = session.shift === 'AM' ? 'PM' : 'AM';
      const siblingSession = await tx.eggCollectionSession.findFirst({
        where: {
          batchId: session.batchId,
          houseId: session.houseId,
          sessionDate: session.sessionDate,
          shift: siblingShift,
          status: 'APPROVED',
        },
      });

      // Lock this tally regardless of sibling status
      const dailyPrice = await tx.dailyEggPrice.findUnique({
        where: { priceDate: session.sessionDate },
      });
      const singleExpectedRevenue = dailyPrice
        ? Number(dailyPrice.pricePerEgg) * session.totalGoodEggs
        : null;

      const locked = await tx.eggTallyVerification.update({
        where: { sessionId },
        data: {
          isLocked: true,
          lockedAt: now,
          finalGoodEggs:    session.totalGoodEggs,
          finalFullTrays:   session.totalFullTrays,
          finalLooseEggs:   session.totalLooseEggs,
          finalStarterEggs: (session as any).totalStarterEggs ?? 0,
          expectedRevenueKes: singleExpectedRevenue ?? undefined,
          revenueSetById: singleExpectedRevenue != null ? user.id : null,
          revenueSetAt:   singleExpectedRevenue != null ? now : null,
        },
      });

      // ── Check if BOTH tallies (AM + PM) are now fully signed and locked ─────
      if (siblingSession) {
        const siblingTally = await tx.eggTallyVerification.findUnique({
          where: { sessionId: siblingSession.id },
        });

        const bothLocked = siblingTally?.isLocked && locked.isLocked;

        if (bothLocked) {
          // Fetch both sessions for aggregate calculation
          const bothSessions = await tx.eggCollectionSession.findMany({
            where: {
              batchId: session.batchId,
              houseId: session.houseId,
              sessionDate: session.sessionDate,
              shift: { in: ['AM', 'PM'] },
              status: 'APPROVED',
            },
          });

          const totalStdEggs = bothSessions.reduce((s, sess) =>
            s + (sess.totalGoodEggs ?? 0) - ((sess as any).totalStarterEggs ?? 0) -
            ((sess as any).totalBrokenSellable ?? 0), 0);
          const totalStarterEggs = bothSessions.reduce((s, sess) =>
            s + ((sess as any).totalStarterEggs ?? 0), 0);
          const totalBrokenSell = bothSessions.reduce((s, sess) =>
            s + ((sess as any).totalBrokenSellable ?? 0), 0);

          const expectedRevenue = dailyPrice
            ? (totalStdEggs     * Number(dailyPrice.pricePerEgg)) +
              (totalStarterEggs * Number((dailyPrice as any).pricePerEggStarter ?? 0)) +
              (totalBrokenSell  * Number((dailyPrice as any).pricePerEggBroken  ?? 0))
            : 0;

          // Update both tallies with aggregate expected revenue
          const allTallyIds = [locked.id, siblingTally!.id];
          await Promise.all(
            allTallyIds.map(id =>
              tx.eggTallyVerification.update({
                where: { id },
                data: {
                  expectedRevenueKes: expectedRevenue,
                  revenueSetById: user.id,
                  revenueSetAt: now,
                },
              })
            )
          );

          // Write DailyEggAggregate
          await tx.dailyEggAggregate.upsert({
            where: {
              aggregateDate_batchId_houseId: {
                aggregateDate: session.sessionDate,
                batchId: session.batchId,
                houseId: session.houseId,
              },
            },
            create: {
              aggregateDate: session.sessionDate,
              batchId: session.batchId,
              houseId: session.houseId,
              totalStdEggs,
              totalStarterEggs,
              totalBrokenSellable: totalBrokenSell,
              totalBrokenUnsellable: 0,
              expectedRevenueKes: expectedRevenue,
            },
            update: {
              totalStdEggs,
              totalStarterEggs,
              totalBrokenSellable: totalBrokenSell,
              expectedRevenueKes: expectedRevenue,
              updatedAt: now,
            },
          });

          // Emit WebSocket event for real-time Sales dashboard update
          this.events.emit('tally.locked', {
            date: session.sessionDate,
            batchId: session.batchId,
            totalStdEggs,
            totalStarterEggs,
            totalBrokenSellable: totalBrokenSell,
            totalBrokenUnsellable: 0,
            expectedRevenue,
          });
        }
      }

      // Broadcast lock notification
      const targets = await tx.user.findMany({
        where: { role: { in: ['MANAGER', 'SALES', 'STORE', 'OWNER', 'ACCOUNTANT'] }, isActive: true },
        select: { id: true },
      });
      for (const t of targets) {
        await tx.notification.create({
          data: {
            userId: t.id,
            type: 'TALLY_LOCKED' as any,
            title: 'Tally locked',
            message: `Tally for session ${sessionId} is fully signed and locked. Final: ${session.totalGoodEggs} eggs.`,
            entityId: sessionId,
            entityType: 'EggCollectionSession',
          },
        });
      }
      return locked;
    });
  }

  /** Accountant / Owner sets the expected morning revenue after the tally is locked. */
  async setRevenue(
    sessionId: string,
    expectedRevenueKes: number,
    user: RequestUser,
  ) {
    if (!['ACCOUNTANT', 'OWNER'].includes(user.role)) {
      throw new ForbiddenException('Only Accountant or Owner may set expected revenue');
    }

    if (!Number.isFinite(expectedRevenueKes) || expectedRevenueKes < 0) {
      throw new BadRequestException('expectedRevenueKes must be a non-negative number');
    }

    const tally = await this.prisma.eggTallyVerification.findUnique({
      where: { sessionId },
    });
    if (!tally) throw new NotFoundException('Tally not found');
    if (!tally.isLocked) {
      throw new BadRequestException(
        'Revenue can only be set after the tally is locked by all three parties',
      );
    }

    return this.prisma.eggTallyVerification.update({
      where: { sessionId },
      data: {
        expectedRevenueKes,
        revenueSetById: user.id,
        revenueSetAt:   new Date(),
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Return locked tally egg counts per category for a given date.
  // ─────────────────────────────────────────────────────────────────────────
  async getTallyTotalsForDate(date: string) {
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    const tally = await this.prisma.eggTallyVerification.findFirst({
      where: {
        isLocked: true,
        session: { sessionDate: { lte: targetDate } },
      },
      include: {
        session: {
          select: {
            sessionDate:         true,
            shift:               true,
            totalGoodEggs:       true,
            totalStarterEggs:    true,
            totalBrokenSellable: true,
            totalFullTrays:      true,
            totalLooseEggs:      true,
          },
        },
      },
      orderBy: { lockedAt: 'desc' },
    });

    if (!tally?.session) return null;

    const s = tally.session;
    return {
      sessionDate:        s.sessionDate,
      isLocked:           true,
      standardEggs:       s.totalGoodEggs,
      starterEggs:        (s as any).totalStarterEggs    ?? 0,
      brokenSellableEggs: (s as any).totalBrokenSellable ?? 0,
      productionEggs:     s.totalGoodEggs,
      fullBrokenEggs:     (s as any).totalBrokenSellable ?? 0,
      totalFullTrays:     s.totalFullTrays,
      totalLooseEggs:     s.totalLooseEggs,
    };
  }

  async listLocked(limit = 30) {
    return this.prisma.eggTallyVerification.findMany({
      where: { isLocked: true },
      include: {
        session: {
          select: {
            id: true, sessionDate: true, shift: true,
            houseId: true, totalGoodEggs: true, totalFullTrays: true,
            batch: { select: { batchCode: true } },
          },
        },
      },
      orderBy: { lockedAt: 'desc' },
      take: limit,
    });
  }
}
