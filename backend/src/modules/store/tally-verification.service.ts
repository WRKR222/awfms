// src/modules/store/tally-verification.service.ts
// 3-party morning tally sign-off — PM, Sales, Store all sign;
// Manager may edit until lock; once all 3 signatures present, locks the tally.

import {
  Injectable, NotFoundException, BadRequestException, ForbiddenException,
} from '@nestjs/common';
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
  constructor(private readonly prisma: PrismaService) {}

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
    return this.prisma.eggTallyVerification.findMany({
      where: { isLocked: false },
      include: {
        session: {
          select: {
            id: true, sessionDate: true, shift: true,
            houseId: true, totalGoodEggs: true, totalFullTrays: true,
            batch: { select: { batchCode: true } },
          },
        },
      },
      orderBy: { verificationDate: 'desc' },
    });
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

    // Recompute totals from row data
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
          // Clear all 3 signatures so everyone re-signs the corrected tally
          pmSignedById: null,    pmSignedAt: null,    pmRowData: Prisma.JsonNull,
          salesSignedById: null, salesSignedAt: null, salesRowData: Prisma.JsonNull,
          storeSignedById: null, storeSignedAt: null, storeRowData: Prisma.JsonNull,
          editCount: { increment: 1 },
          lastEditedById: user.id,
          lastEditedAt: new Date(),
        },
      });

      // Notify Sales + Store that the tally needs re-signing
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

    // The session must be Manager-approved (PM verified the prior evening) before
    // morning sign-off can begin.
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

      // ── LOCK ────────────────────────────────────────────────────────────
      const session = tally.session;
      const dailyPrice = await tx.dailyEggPrice.findUnique({
        where: { priceDate: session.sessionDate },
      });
      const expectedRevenueKes = dailyPrice
        ? Number(dailyPrice.pricePerEgg) * session.totalGoodEggs
        : null;

      const locked = await tx.eggTallyVerification.update({
        where: { sessionId },
        data: {
          isLocked: true,
          lockedAt: now,
          finalGoodEggs:       session.totalGoodEggs,
          finalFullTrays:      session.totalFullTrays,
          finalLooseEggs:      session.totalLooseEggs,
          // FIX-04: store per-category finals at lock time for complete audit trail
          finalStarterEggs:    (session as any).totalStarterEggs    ?? 0,
          expectedRevenueKes: expectedRevenueKes ?? undefined,
          revenueSetById: expectedRevenueKes != null ? user.id : null,
          revenueSetAt:   expectedRevenueKes != null ? now : null,
        },
      });

      // Broadcast lock
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
  // FIX-02: Return locked tally egg counts per category for a given date.
  // Called by GET /tally-verifications/totals?date=YYYY-MM-DD
  //
  // Egg category → DailyEggPrice field mapping:
  //   standardEggs   (totalGoodEggs)        ↔  pricePerEgg
  //   starterEggs    (totalStarterEggs)      ↔  pricePerEggStarter
  //   brokenSellable (totalBrokenSellable)   ↔  pricePerEggBroken
  // ─────────────────────────────────────────────────────────────────────────
  async getTallyTotalsForDate(date: string) {
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    // Most recently locked tally for this date or earlier
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
      // Standard names used by sales.service getSalesStock()
      standardEggs:       s.totalGoodEggs,
      starterEggs:        (s as any).totalStarterEggs    ?? 0,
      brokenSellableEggs: (s as any).totalBrokenSellable ?? 0,
      // Aliases used by AccountantPricingPage
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
