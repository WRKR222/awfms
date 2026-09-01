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
    const nextDay = new Date(sessionDate);
    nextDay.setDate(nextDay.getDate() + 1);

    // Upsert instead of create-or-skip: production.service creates a placeholder
    // at submission time with verificationDate = sessionDate (the collection day).
    // When both AM and PM are approved we must correct it to nextDay so that
    // listPending() ordering puts AM before PM and both cards appear together in
    // the next-morning queue. The old find-then-return-early meant the AM card
    // kept sessionDate as its verificationDate, so it sorted after the PM card
    // (which had a later DB createdAt). PM and Sales would then sign PM first,
    // leaving AM with no PM/Sales signatures — causing Store to get a 400
    // ("Sales must sign first") when trying to sign the AM card.
    return this.prisma.eggTallyVerification.upsert({
      where:  { sessionId },
      update: { verificationDate: nextDay },
      create: { sessionId, verificationDate: nextDay },
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
    // NOTE: A placeholder EggTallyVerification row is created at submission time
    // (in production.service.createEggCollection), while the session is still
    // PENDING. That placeholder must NOT show up in the sign-off queue yet —
    // only once BOTH AM+PM sessions are APPROVED and createTallyForSession()
    // has corrected the verificationDate does a tally become eligible for
    // signing. Without this filter, the PM/Sales/Store could see and attempt
    // to sign a tally whose session.status is still PENDING, causing
    // sign() to reject with "Session must be Manager-verified before tally signing".
    const tallies = await this.prisma.eggTallyVerification.findMany({
      where: { isLocked: false, session: { status: 'APPROVED' } },
      include: {
        session: {
          select: {
            id: true, sessionDate: true, shift: true, status: true,
            houseId: true, totalGoodEggs: true,
            totalFullTrays: true, totalLooseEggs: true,
            totalStarterEggs: true, totalBrokenSellable: true,
            totalBrokenUnsellable: true, totalBrokenEggs: true, totalSoftShell: true,
            totalDeformed: true, totalDamaged: true, totalWeightKg: true,
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

    return (tallies as any[]).map((t: any) => ({
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

    // Row fields match what the frontend (EggCollectionPage) sends:
    // totalEggs, starterEggs, broken, damaged, softShell, deformed, weightKg
    let totalEggs = 0, totalStarterEggs = 0, totalBroken = 0, totalDamaged = 0;
    let totalSoftShell = 0, totalDeformed = 0, totalWeightKg = 0;
    for (const r of rowData) {
      totalEggs              += Number(r.totalEggs   ?? 0);
      totalStarterEggs       += Number(r.starterEggs ?? 0);
      totalBroken             += Number(r.broken      ?? 0);
      totalDamaged            += Number(r.damaged     ?? 0);
      totalSoftShell          += Number(r.softShell   ?? 0);
      totalDeformed           += Number(r.deformed    ?? 0);
      totalWeightKg           += Number(r.weightKg    ?? 0);
    }
    // All-starter special case: totalEggs === nonStandardTotal means every
    // non-broken egg is a starter; totalGoodEggs = 0. HDP must use totalStarterEggs
    // as the effective egg count so hen-day is not falsely reported as 0%.
    const nonStandardTotal = totalStarterEggs + totalBroken + totalDamaged + totalSoftShell + totalDeformed;
    const isAllStarter     = totalStarterEggs > 0 && totalEggs > 0 && totalEggs === nonStandardTotal;
    const totalGoodEggs    = Math.max(0, totalEggs - nonStandardTotal);
    const totalFullTrays = Math.floor(totalGoodEggs / 30);
    const totalLooseEggs = totalGoodEggs % 30;

    return this.prisma.$transaction(async (tx) => {
      await tx.eggCollectionSession.update({
        where: { id: sessionId },
        data: {
          rowData: rowData as any,
          totalFullTrays, totalLooseEggs, totalBrokenEggs: totalBroken,
          totalDamaged, totalSoftShell, totalDeformed, totalWeightKg, totalGoodEggs,
          totalStarterEggs,
          // Edits reset the broken split back to the conservative default —
          // Sales must re-sign and re-classify against the new broken total.
          totalBrokenSellable: 0,
          totalBrokenUnsellable: totalBroken,
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
          brokenSellableQty: null, brokenUnsellableQty: null,
          brokenSplitSetById: null, brokenSplitSetAt: null,
          editCount: { increment: 1 },
          lastEditedById: user.id,
          lastEditedAt: new Date(),
        },
      });

      const targets = await tx.user.findMany({
        where: { role: { in: ['SALES', 'STORE', 'MANAGER', 'OWNER'] }, isActive: true },
        select: { id: true },
      });
      for (const t of targets) {
        await tx.notification.create({
          data: {
            userId: t.id,
            type: 'EGG_TALLY_TRIGGERED' as any,
            title: 'Tally edited — re-sign required',
            message: 'Production Manager edited the tally row data. All parties must review and re-sign.',
            entityId: sessionId,
            entityType: 'EggCollectionSession',
          },
        });
      }
      return updated;
    });
  }

  /**
   * Retract (un-sign) for the calling user's role.
   *
   * Rules:
   *  - Tally must NOT be locked (locked = immutable forever).
   *  - PM (MANAGER/OWNER) can retract their own signature at any time while unlocked.
   *    Retracting PM also clears the Sales and Store signatures because the sign
   *    order is PM → Sales → Store; any downstream signature becomes invalid.
   *  - Sales can retract their own signature only if Store has NOT yet signed
   *    (Store signing after Sales constitutes a downstream confirmation — clearing
   *    it silently would mislead the Store party).
   *    Retracting Sales also clears the Store signature.
   *  - Store cannot retract — once all three have signed the tally locks
   *    automatically; if only Store has signed that means PM and Sales haven't
   *    which is an impossible state, so Store retract is not needed.
   *
   * After retracting, PM can edit row data via editAndResubmit() as normal.
   */
  async retractSign(sessionId: string, user: RequestUser) {
    const party = ROLE_TO_PARTY[user.role];
    if (!party) throw new ForbiddenException('Your role cannot sign or retract the tally');
    if (party === 'STORE') {
      throw new ForbiddenException(
        'Store cannot retract independently. Ask Production Manager to retract — this will clear all signatures.',
      );
    }

    const tally = await this.prisma.eggTallyVerification.findUnique({ where: { sessionId } });
    if (!tally) throw new NotFoundException('Tally not found');
    if (tally.isLocked) {
      throw new BadRequestException('Tally is already locked and cannot be changed');
    }

    if (party === 'PM') {
      if (!tally.pmSignedById) {
        throw new BadRequestException('Production Manager has not signed this tally yet');
      }
      // PM retract: clear PM + all downstream (Sales, Store)
      const updated = await this.prisma.eggTallyVerification.update({
        where: { sessionId },
        data: {
          pmSignedById:    null, pmSignedAt:    null, pmRowData:    Prisma.JsonNull,
          salesSignedById: null, salesSignedAt: null, salesRowData: Prisma.JsonNull,
          storeSignedById: null, storeSignedAt: null, storeRowData: Prisma.JsonNull,
        },
      });
      // Notify Sales and Store that signatures were cleared
      await this._notifyRetract(sessionId, 'Production Manager has retracted their sign-off. All signatures cleared — PM may now edit data. Everyone must re-sign after edits.');
      return updated;
    }

    // party === 'SALES'
    if (!tally.salesSignedById) {
      throw new BadRequestException('Sales has not signed this tally yet');
    }
    if (tally.storeSignedById) {
      throw new BadRequestException(
        'Store has already signed after Sales. Ask Production Manager to retract to clear all signatures.',
      );
    }
    // Sales retract: clear Sales + downstream Store (Store hasn't signed yet per check above)
    const updated = await this.prisma.eggTallyVerification.update({
      where: { sessionId },
      data: {
        salesSignedById: null, salesSignedAt: null, salesRowData: Prisma.JsonNull,
        storeSignedById: null, storeSignedAt: null, storeRowData: Prisma.JsonNull,
      },
    });
    await this._notifyRetract(sessionId, 'Sales has retracted their sign-off. Store signature cleared. Sales must re-sign before Store.');
    return updated;
  }

  private async _notifyRetract(sessionId: string, message: string) {
    const targets = await this.prisma.user.findMany({
      where: { role: { in: ['SALES', 'STORE', 'MANAGER', 'OWNER'] }, isActive: true },
      select: { id: true },
    });
    await this.prisma.notification.createMany({
      data: targets.map(t => ({
        userId: t.id,
        type: 'EGG_TALLY_TRIGGERED' as any,
        title: 'Tally sign-off retracted',
        message,
        entityId: sessionId,
        entityType: 'EggCollectionSession',
      })),
    });
  }

  /**
   * Sign for the calling user's role. When all 3 signed, locks.
   *
   * Sales must additionally submit the actual broken-egg classification —
   * how many of the session's (unsplit) broken eggs are sellable-as-broken
   * vs. a total loss. This is the "three-person verification" step that
   * replaces the old attendant-time Broken Sellable / Broken Unsellable
   * columns: the split now happens here, from the person who actually
   * handles and sells the eggs, instead of being guessed at collection time.
   */
  async sign(
    sessionId: string,
    user: RequestUser,
    brokenSplit?: { brokenSellableQty: number; brokenUnsellableQty: number },
  ) {
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
    let brokenSplitToApply: { sellable: number; unsellable: number } | null = null;

    if (party === 'PM') {
      if (tally.pmSignedById) throw new BadRequestException('Already signed by Production Manager');
      data.pmSignedById = user.id; data.pmSignedAt = now;
      data.pmRowData = tally.session.rowData;
    } else if (party === 'SALES') {
      // FIX: Sales must wait for PM to sign first
      if (!tally.pmSignedById) {
        throw new BadRequestException('Production Manager must sign off before Sales can sign');
      }
      if (tally.salesSignedById) throw new BadRequestException('Already signed by Sales');

      // Sales must classify the session's raw broken-egg count into
      // sellable vs. unsellable — the two numbers must sum to exactly what
      // the attendant recorded as "Broken" for this session.
      const totalBroken = (tally.session as any).totalBrokenEggs ?? 0;
      if (totalBroken > 0) {
        if (!brokenSplit) {
          throw new BadRequestException(
            `This session has ${totalBroken} broken egg(s). Enter how many are sellable and how many are ` +
            `unsellable before signing.`,
          );
        }
        const { brokenSellableQty, brokenUnsellableQty } = brokenSplit;
        if (
          !Number.isInteger(brokenSellableQty) || brokenSellableQty < 0 ||
          !Number.isInteger(brokenUnsellableQty) || brokenUnsellableQty < 0
        ) {
          throw new BadRequestException('Broken sellable/unsellable quantities must be non-negative whole numbers');
        }
        if (brokenSellableQty + brokenUnsellableQty !== totalBroken) {
          throw new BadRequestException(
            `Broken sellable (${brokenSellableQty}) + unsellable (${brokenUnsellableQty}) must sum to the ` +
            `session's total broken eggs (${totalBroken}).`,
          );
        }
        brokenSplitToApply = { sellable: brokenSellableQty, unsellable: brokenUnsellableQty };
      } else if (brokenSplit) {
        // Nothing to split — ignore any submitted split rather than erroring.
        brokenSplitToApply = { sellable: 0, unsellable: 0 };
      }

      data.salesSignedById = user.id; data.salesSignedAt = now;
      data.salesRowData = tally.session.rowData;
      if (brokenSplitToApply) {
        data.brokenSellableQty = brokenSplitToApply.sellable;
        data.brokenUnsellableQty = brokenSplitToApply.unsellable;
        data.brokenSplitSetById = user.id;
        data.brokenSplitSetAt = now;
      }
    } else {
      // FIX: Store must wait for both PM and Sales to sign first
      if (!tally.pmSignedById) {
        throw new BadRequestException('Production Manager must sign off before Store can sign');
      }
      if (!tally.salesSignedById) {
        throw new BadRequestException('Sales must sign off before Store can sign');
      }
      if (tally.storeSignedById) throw new BadRequestException('Already signed by Store');
      data.storeSignedById = user.id; data.storeSignedAt = now;
      data.storeRowData = tally.session.rowData;
    }

    return this.prisma.$transaction(async (tx) => {
      // Correct the session's broken sellable/unsellable split (was
      // conservatively defaulted to 100% unsellable at collection time) and
      // log an adjusting expense entry for the difference, now that the
      // actual classification is known.
      if (brokenSplitToApply) {
        const session = tally.session as any;
        await tx.eggCollectionSession.update({
          where: { id: sessionId },
          data: {
            totalBrokenSellable: brokenSplitToApply.sellable,
            totalBrokenUnsellable: brokenSplitToApply.unsellable,
          },
        });

        try {
          const collDate = new Date(session.sessionDate);
          collDate.setHours(0, 0, 0, 0);
          const pricing = await tx.dailyEggPrice.findUnique({ where: { priceDate: collDate } });
          const costPerEgg        = pricing?.pricePerEgg       ? Number(pricing.pricePerEgg)       : 0;
          const pricePerEggBroken = pricing?.pricePerEggBroken ? Number(pricing.pricePerEggBroken) : 0;
          if (costPerEgg > 0) {
            const provisionalLoss = (session.totalBrokenEggs ?? 0) * costPerEgg;
            const actualLoss =
              brokenSplitToApply.unsellable * costPerEgg +
              brokenSplitToApply.sellable   * Math.max(0, costPerEgg - pricePerEggBroken);
            const diff = Math.round((actualLoss - provisionalLoss) * 100) / 100;
            if (diff !== 0) {
              let cat = await tx.expenseCategory.findUnique({ where: { name: 'Egg Breakage' } });
              if (!cat) {
                cat = await tx.expenseCategory.create({
                  data: { name: 'Egg Breakage', description: 'Auto-logged egg breakage losses', createdById: user.id },
                });
              }
              await tx.expenseLog.create({
                data: {
                  categoryId:   cat.id,
                  description:  `Broken-egg classification adjustment — Sales split ${session.shift} session ` +
                    `${sessionId.slice(0, 8)} into ${brokenSplitToApply.sellable} sellable / ` +
                    `${brokenSplitToApply.unsellable} unsellable (was provisionally all unsellable).`,
                  amount:       diff,
                  expenseDate:  collDate,
                  vendorName:   null,
                  receiptRef:   `COLL-ADJ-${sessionId.slice(0, 8)}`,
                  recordedById: user.id,
                },
              });
            }
          }
        } catch (_) { /* best-effort adjustment logging — split itself already saved above */ }
      }

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

          // FIX: totalGoodEggs already excludes starter, brokenSellable,
          // brokenUnsellable, softShell, and deformed eggs (see editAndResubmit:
          // totalGoodEggs = totalEggs - (starter + brokenSellable + brokenUnsellable
          // + softShell + deformed)). Subtracting starter/brokenSellable again here
          // double-counted them, undercounting standard eggs. "Standard eggs" is
          // simply the sum of totalGoodEggs across both sessions.
          const totalStdEggs = bothSessions.reduce((s, sess) =>
            s + (sess.totalGoodEggs ?? 0), 0);
          const totalStarterEggs = bothSessions.reduce((s, sess) =>
            s + ((sess as any).totalStarterEggs ?? 0), 0);
          const totalBrokenSell = bothSessions.reduce((s, sess) =>
            s + ((sess as any).totalBrokenSellable ?? 0), 0);
          // FIX: was hardcoded to 0 — now sums broken-unsellable across both sessions.
          const totalBrokenUnsell = bothSessions.reduce((s, sess) =>
            s + ((sess as any).totalBrokenUnsellable ?? 0), 0);

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
              totalBrokenUnsellable: totalBrokenUnsell,
              expectedRevenueKes: expectedRevenue,
            },
            update: {
              totalStdEggs,
              totalStarterEggs,
              totalBrokenSellable: totalBrokenSell,
              totalBrokenUnsellable: totalBrokenUnsell,
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
            totalBrokenUnsellable: totalBrokenUnsell,
            expectedRevenue,
          });
        }
      }

      // Broadcast lock notification
      // NOTE: use EGG_TALLY_TRIGGERED — TALLY_LOCKED does not exist in the
      // NotificationType enum and causes a Prisma runtime error (500) when
      // Prisma validates the value against the database enum on INSERT.
      const targets = await tx.user.findMany({
        where: { role: { in: ['MANAGER', 'SALES', 'STORE', 'OWNER', 'ACCOUNTANT'] }, isActive: true },
        select: { id: true },
      });
      for (const t of targets) {
        await tx.notification.create({
          data: {
            userId: t.id,
            type: 'EGG_TALLY_TRIGGERED' as any,
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
  //
  // FIX: Expected revenue = total eggs collected (AM + PM) × price per standard egg.
  // "Total eggs" per session = sum of every row's totalEggs column, which is
  // derived from stored session fields as:
  //   totalGoodEggs + totalStarterEggs + totalBrokenSellable +
  //   totalBrokenUnsellable + totalSoftShell + totalDeformed
  // Sum this across both AM and PM locked tally sessions for the date.
  // ─────────────────────────────────────────────────────────────────────────
  async getTallyTotalsForDate(date: string) {
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    // Fetch all locked tally sessions for this date (AM + PM)
    const tallies = await this.prisma.eggTallyVerification.findMany({
      where: {
        isLocked: true,
        session: { sessionDate: targetDate },
      },
      include: {
        session: {
          select: {
            sessionDate:          true,
            shift:                true,
            totalGoodEggs:        true,
            totalStarterEggs:     true,
            totalBrokenSellable:  true,
            totalBrokenUnsellable:true,
            totalSoftShell:       true,
            totalDeformed:        true,
            totalDamaged:         true,
            totalFullTrays:       true,
            totalLooseEggs:       true,
          },
        },
      },
    });

    if (tallies.length === 0) return null;

    // Derive totalEggs per session (mirrors editAndResubmit formula):
    //   totalEggs = totalGoodEggs + totalStarterEggs + totalBrokenSellable
    //             + totalBrokenUnsellable + totalSoftShell + totalDeformed
    //             + totalDamaged
    const totalCollectedEggs = tallies.reduce((sum, t) => {
      const s = t.session as any;
      if (!s) return sum;
      return sum
        + (s.totalGoodEggs         ?? 0)
        + (s.totalStarterEggs      ?? 0)
        + (s.totalBrokenSellable   ?? 0)
        + (s.totalBrokenUnsellable ?? 0)
        + (s.totalSoftShell        ?? 0)
        + (s.totalDeformed         ?? 0)
        + (s.totalDamaged          ?? 0);
    }, 0);

    // FIX: Sum per-category counts across all locked sessions (was hardcoded to 0).
    // productionEggs = standard (good) eggs only.
    // starterEggs    = early-lay eggs (own price tier).
    // fullBrokenEggs = consumable broken (sellable at reduced price).
    const totalProductionEggs = tallies.reduce((sum, t) => {
      const s = t.session as any;
      if (!s) return sum;
      return sum + (s.totalGoodEggs ?? 0);
    }, 0);
    const totalStarterEggs = tallies.reduce((sum, t) => {
      const s = t.session as any;
      if (!s) return sum;
      return sum + (s.totalStarterEggs ?? 0);
    }, 0);
    const totalBrokenSellable = tallies.reduce((sum, t) => {
      const s = t.session as any;
      if (!s) return sum;
      return sum + (s.totalBrokenSellable ?? 0);
    }, 0);

    const totalFullTrays = tallies.reduce((s, t) => s + (t.session?.totalFullTrays ?? 0), 0);
    const totalLooseEggs = tallies.reduce((s, t) => s + (t.session?.totalLooseEggs ?? 0), 0);
    const firstDate      = tallies[0].session?.sessionDate ?? targetDate;

    return {
      sessionDate:        firstDate,
      isLocked:           true,
      // productionEggs = standard (good) eggs only — used for expected revenue calc
      productionEggs:     totalProductionEggs,
      standardEggs:       totalProductionEggs,
      // starterEggs and fullBrokenEggs now reflect real tally totals
      starterEggs:        totalStarterEggs,
      brokenSellableEggs: totalBrokenSellable,
      fullBrokenEggs:     totalBrokenSellable,
      totalFullTrays,
      totalLooseEggs,
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
