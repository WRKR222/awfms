// src/modules/production/production.service.ts
//
// Lead Attendant submission flow per changes.pdf + Anza Whole Foods Summary:
//   • One bundled submission contains egg counts, session feed, environmental
//     readings and (optional) vaccines/supplements.
//   • Block 1 only — units A, B, C with two rows each (Block 2 is under
//     construction and rejected here as a guard).
//   • Per-row counters renamed: brokenUnsellable / brokenSellable / starterEggs.
//   • starterEggs roll up to a session field consumed by the Accountant for
//     per-category pricing and by the Sales person's stock.
//   • Vaccines / supplements are forwarded to VaccinationRecord so they appear
//     in the Production Manager's Health page as a historical log.
//   • Once the Production Manager verifies, the entry is locked.
//
// CORRECTIONS APPLIED:
//   FIX-1: Approving AM session now notifies the attendant that AM is approved
//           and opens the PM session for data recording.
//   FIX-2: Once BOTH AM and PM sessions are approved, both are locked (no
//           further data can be recorded for that day).
//   FIX-3: "Return to Attendant" now notifies the attendant with the reason
//           and restores Block 1 units for editing.
//   FIX-4: Tally sign-off is only triggered after BOTH AM and PM sessions
//           are approved on the same day.

import {
  Injectable, NotFoundException, ConflictException,
  BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EntryStatus, VaccinationRoute } from '@prisma/client';
import { RequestUser } from '../../auth/types/request-user.type';
import { NotificationsService } from '../../common/notifications/notifications.service';
import type { CreateEggCollectionSessionDto } from './production.dto';
import { TallyVerificationService } from '../store/tally-verification.service';

interface RowDataEntry {
  rowCode: string;
  totalBirds: number;
  totalEggs: number;
  starterEggs: number;
  brokenUnsellable: number;
  brokenSellable: number;
  softShell: number;
  deformed: number;
  weightKg: number;
  attendantName: string;
}

function rollupRows(rows: RowDataEntry[]) {
  let totalEggs = 0, totalStarter = 0, totalBrokenUnsellable = 0, totalBrokenSellable = 0;
  let totalSoftShell = 0, totalDeformed = 0, totalWeightKg = 0;
  for (const r of rows) {
    totalEggs              += r.totalEggs        ?? 0;
    totalStarter           += r.starterEggs      ?? 0;
    totalBrokenUnsellable  += r.brokenUnsellable ?? 0;
    totalBrokenSellable    += r.brokenSellable   ?? 0;
    totalSoftShell         += r.softShell        ?? 0;
    totalDeformed          += r.deformed         ?? 0;
    totalWeightKg          += Number(r.weightKg ?? 0);
  }
  // good = standard whole eggs (NOT starter, NOT broken, NOT soft, NOT deformed)
  const totalGoodEggs = Math.max(0, totalEggs - totalStarter);
  const totalFullTrays = Math.floor(totalGoodEggs / 30);
  const totalLooseEggs = totalGoodEggs % 30;
  return {
    totalEggs, totalStarter, totalBrokenUnsellable, totalBrokenSellable,
    totalSoftShell, totalDeformed, totalWeightKg,
    totalGoodEggs, totalFullTrays, totalLooseEggs,
    // legacy aggregate kept for downstream reads
    totalBrokenEggs: totalBrokenUnsellable + totalBrokenSellable,
  };
}

@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly tallyVerificationService: TallyVerificationService,
  ) {}

  async createEggCollection(dto: CreateEggCollectionSessionDto, user: RequestUser) {
    if (user.role !== 'ATTENDANT') {
      throw new ForbiddenException('Only the Lead Attendant may submit egg collection sessions');
    }
    if (dto.block && dto.block !== 'BLOCK1') {
      throw new BadRequestException('Block 2 is under construction and cannot accept submissions yet');
    }

    const batch = await this.prisma.batch.findFirst({
      where: { id: dto.batchId, deletedAt: null, stage: { not: 'CLOSED' } },
    });
    if (!batch) throw new NotFoundException('Batch not found or closed');

    // FIX-2: Block same-day recording if both sessions are already approved (day is locked)
    if (dto.shift === 'PM') {
      const amSession = await this.prisma.eggCollectionSession.findFirst({
        where: {
          batchId: dto.batchId,
          houseId: dto.houseId,
          sessionDate: new Date(dto.sessionDate),
          shift: 'AM',
          deletedAt: null,
        },
      });
      if (!amSession || amSession.status !== EntryStatus.APPROVED) {
        throw new ConflictException(
          'AM session must be approved by the Production Manager before PM data can be recorded.',
        );
      }
    }

    const existing = await this.prisma.eggCollectionSession.findFirst({
      where: {
        batchId: dto.batchId,
        houseId: dto.houseId,
        sessionDate: new Date(dto.sessionDate),
        shift: dto.shift,
        deletedAt: null,
      },
      include: { tally: true },
    });

    if (existing && existing.status !== EntryStatus.RETURNED) {
      throw new ConflictException(
        `A ${dto.shift} egg collection session already exists for this house on ${dto.sessionDate}`,
      );
    }
    if (existing?.tally?.isLocked) {
      throw new ConflictException('Tally for this session is locked. No further submissions accepted.');
    }

    const totals = rollupRows(dto.rowData as RowDataEntry[]);
    const closingStock = dto.openingPop - dto.mortalities;
    const henDayPercent = closingStock > 0
      ? Math.round((totals.totalGoodEggs / closingStock) * 10000) / 100
      : null;

    const data = {
      batchId: dto.batchId,
      houseId: dto.houseId,
      sessionDate: new Date(dto.sessionDate),
      shift: dto.shift,
      collectedById: user.id,
      openingPop: dto.openingPop,
      mortalities: dto.mortalities,
      closingStock,
      rowData: dto.rowData as any,
      totalFullTrays: totals.totalFullTrays,
      totalLooseEggs: totals.totalLooseEggs,
      totalBrokenEggs: totals.totalBrokenEggs,
      totalSoftShell: totals.totalSoftShell,
      totalDeformed: totals.totalDeformed,
      totalWeightKg: totals.totalWeightKg,
      totalGoodEggs: totals.totalGoodEggs,
      totalStarterEggs: totals.totalStarter ?? 0,
      totalBrokenSellable: totals.totalBrokenSellable ?? 0,
      totalBrokenUnsellable: totals.totalBrokenUnsellable ?? 0,
      feedKg: dto.sessionFeed?.feedKg ?? null,
      feedTypeName: dto.sessionFeed?.feedTypeName ?? null,
      waterLiters: dto.environment?.waterLiters ?? null,
      houseTempC: dto.environment?.houseTempC ?? null,
      dailyFeedKg: dto.sessionFeed?.feedKg ?? null,
      vaccineGiven: (dto.vaccinesGiven ?? [])
        .map((v: any) => (v.kind === 'VACCINE' ? 'V: ' : 'S: ') + v.name + ' (' + v.dosage + ')')
        .join('; ') || null,
      henDayPercent,
      remarks: dto.remarks ?? null,
      status: EntryStatus.PENDING,
    };

    const session = existing?.status === EntryStatus.RETURNED
      ? await this.prisma.eggCollectionSession.update({
          where: { id: existing.id },
          data: { ...data, status: EntryStatus.PENDING, returnReason: null, verifiedById: null, verifiedAt: null, },
        })
      : await this.prisma.eggCollectionSession.create({ data });

    // Deduct feed from stock if feed was recorded
    if (data.feedKg && data.feedTypeName) {
      try {
        const feedType = data.feedTypeName as any;
        await this.prisma.feedIntakeLog.create({
          data: {
            batchId: dto.batchId,
            houseId: dto.houseId,
            feedType: feedType,
            entryDate: new Date(dto.sessionDate),
            quantityDispensedKg: Number(data.feedKg),
            wastageKg: 0,
            recommendedMinKg: 0,
            recommendedMaxKg: 0,
            notes: 'Logged from ' + dto.shift + ' egg collection session',
            recordedById: user.id,
          },
        });
      } catch (_) { /* best-effort feed deduction */ }
    }

    // Forward vaccines/supplements to VaccinationRecord so the Production
    // Manager Health page surfaces them as a historical log.
    for (const v of (dto.vaccinesGiven ?? [])) {
      await this.prisma.vaccinationRecord.create({
        data: {
          batchId: dto.batchId,
          vaccineName: `${v.kind === 'SUPPLEMENT' ? '[Supplement] ' : ''}${v.name}`,
          administeredDate: new Date(dto.sessionDate),
          route: VaccinationRoute.OTHER,
          batchSize: closingStock,
          dosageUnits: v.dosage,
          notes: `Logged via Lead Attendant ${dto.shift} session`,
          recordedById: user.id,
        },
      });
    }

    // Auto-log collection-time breakage expenses (soft shell, deformed, broken unsellable, broken sellable)
    try {
      const collDate = new Date(dto.sessionDate);
      collDate.setHours(0, 0, 0, 0);
      const pricing = await this.prisma.dailyEggPrice.findUnique({ where: { priceDate: collDate } });
      const costPerEgg        = pricing?.pricePerEgg       ? Number(pricing.pricePerEgg)       : 0;
      const pricePerEggBroken = pricing?.pricePerEggBroken ? Number(pricing.pricePerEggBroken) : 0;

      const softShellQty     = totals.totalSoftShell         ?? 0;
      const deformedQty      = totals.totalDeformed          ?? 0;
      const brokenSellQty    = totals.totalBrokenSellable     ?? 0;
      const brokenUnsellQty  = totals.totalBrokenUnsellable   ?? 0;

      // softShell + deformed: cost = costPerEgg × qty (not sold)
      const softDeformedLoss   = (softShellQty + deformedQty) * costPerEgg;
      // brokenSellable: cost = (costPerEgg − pricePerEggBroken) × qty
      const brokenSellLoss     = brokenSellQty  * Math.max(0, costPerEgg - pricePerEggBroken);
      // brokenUnsellable: cost = costPerEgg × qty (not sold)
      const brokenUnsellLoss   = brokenUnsellQty * costPerEgg;
      const totalCollLoss      = softDeformedLoss + brokenSellLoss + brokenUnsellLoss;

      if (totalCollLoss > 0 && costPerEgg > 0) {
        let cat = await this.prisma.expenseCategory.findUnique({ where: { name: 'Egg Breakage' } });
        if (!cat) {
          cat = await this.prisma.expenseCategory.create({
            data: { name: 'Egg Breakage', description: 'Auto-logged egg breakage losses', createdById: user.id },
          });
        }
        const parts: string[] = [];
        if (softShellQty  > 0) parts.push(`Soft shell: ${softShellQty}`);
        if (deformedQty   > 0) parts.push(`Deformed: ${deformedQty}`);
        if (brokenSellQty > 0) parts.push(`Broken sellable: ${brokenSellQty}`);
        if (brokenUnsellQty > 0) parts.push(`Broken unsellable: ${brokenUnsellQty}`);

        await this.prisma.expenseLog.create({
          data: {
            categoryId:   cat.id,
            description:  `${dto.shift} collection breakage — Batch ${batch.batchCode ?? dto.batchId}. ${parts.join(', ')}.`,
            amount:       totalCollLoss,
            expenseDate:  collDate,
            vendorName:   null,
            receiptRef:   `COLL-${session.id.slice(0, 8)}`,
            recordedById: user.id,
          },
        });
      }
    } catch (_) { /* best-effort collection expense logging */ }

    // Create EggTallyVerification placeholder for both AM and PM sessions.
    // Tally sign-off is only triggered once BOTH sessions are APPROVED (see verifySession).
    await this._fireVerificationNotifications(session, batch);
    await this.prisma.eggTallyVerification.upsert({
      where: { sessionId: session.id },
      update: {},
      create: { sessionId: session.id, verificationDate: session.sessionDate },
    });

    return session;
  }

  async getDailyAggregate(date?: string) {
    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);

    const aggregate = await this.prisma.dailyEggAggregate.findFirst({
      where: {
        aggregateDate: { lte: targetDate },
      },
      orderBy: { aggregateDate: 'desc' },
    });

    if (!aggregate) return null;

    // Fetch the pricing for that day so the frontend can show the formula breakdown
    const pricing = await this.prisma.dailyEggPrice.findUnique({
      where: { priceDate: aggregate.aggregateDate },
      select: {
        pricePerEgg:        true,
        pricePerEggStarter: true,
        pricePerEggBroken:  true,
      },
    });

    return {
      ...aggregate,
      pricing: pricing ?? null,
    };
  }

  private async _fireVerificationNotifications(session: any, batch: any) {
    const targets = await this.prisma.user.findMany({
      where: { role: { in: ['MANAGER', 'STORE', 'OWNER'] }, isActive: true },
      select: { id: true, role: true },
    });
    const houseRecord = await this.prisma.house.findUnique({
      where: { id: session.houseId }, select: { name: true },
    });
    const houseName = houseRecord?.name ?? 'House';

    for (const target of targets) {
      const message = target.role === 'STORE'
        ? `${session.shift} egg collection submitted for ${houseName} (${batch.batchCode}). Please log your egg intake — ${session.totalGoodEggs} good eggs, ${session.totalFullTrays} full trays.`
        : `${session.shift} egg collection awaiting Manager verification — ${houseName} (${batch.batchCode}). ${session.totalGoodEggs} good eggs · HDP: ${session.henDayPercent ?? '—'}%.`;
      await this.prisma.notification.create({
        data: {
          userId: target.id,
          type: 'EGG_TALLY_TRIGGERED' as any,
          title: `Egg Collection — ${houseName} ${session.shift}`,
          message,
          entityId: session.id,
          entityType: 'EggCollectionSession',
        },
      });
    }
  }

  async getEggCollections(houseId?: string, batchId?: string, sessionDate?: string) {
    return this.prisma.eggCollectionSession.findMany({
      where: {
        deletedAt: null,
        ...(houseId ? { houseId } : {}),
        ...(batchId ? { batchId } : {}),
        ...(sessionDate ? { sessionDate: new Date(sessionDate) } : {}),
      },
      include: {
        batch: { select: { batchCode: true } },
        storeIntakes: {
          select: { id: true, totalGoodEggs: true, totalFullTrays: true, hasDiscrepancy: true },
        },
        tally: {
          select: {
            isLocked: true, lockedAt: true,
            pmSignedAt: true, salesSignedAt: true, storeSignedAt: true,
          },
        },
      },
      orderBy: [{ sessionDate: 'desc' }, { shift: 'asc' }],
      take: 100,
    });
  }

  async getSessionById(id: string) {
    const session = await this.prisma.eggCollectionSession.findFirst({
      where: { id, deletedAt: null },
      include: {
        batch: { select: { batchCode: true, currentBirdCount: true } },
        storeIntakes: true,
        tally: true,
      },
    });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  async verifySession(
    id: string,
    action: 'approve' | 'return',
    returnReason: string | undefined,
    user: RequestUser,
  ) {
    if (user.role !== 'MANAGER' && user.role !== 'OWNER') {
      throw new ForbiddenException('Only the Production Manager may verify a session');
    }
    const session = await this.prisma.eggCollectionSession.findFirst({
      where: { id, deletedAt: null },
      include: { storeIntakes: true, tally: true, batch: true },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.tally?.isLocked) {
      throw new BadRequestException('Tally is locked — verification already finalised');
    }
    if (session.status !== EntryStatus.PENDING) {
      throw new BadRequestException(`Session is already ${session.status.toLowerCase()}`);
    }

    const houseRecord = await this.prisma.house.findUnique({
      where: { id: session.houseId }, select: { name: true },
    });
    const houseName = houseRecord?.name ?? 'House';

    if (action === 'approve') {
      const storeIntake = session.storeIntakes[0];
      if (storeIntake && session.totalGoodEggs !== storeIntake.totalGoodEggs) {
        await this.prisma.storeEggIntake.update({
          where: { id: storeIntake.id },
          data: {
            hasDiscrepancy: true,
            discrepancyNote: `Attendant: ${session.totalGoodEggs} eggs. Store: ${storeIntake.totalGoodEggs} eggs. Difference: ${Math.abs(session.totalGoodEggs - storeIntake.totalGoodEggs)}.`,
          },
        });
      }

      const approved = await this.prisma.eggCollectionSession.update({
        where: { id },
        data: { status: EntryStatus.APPROVED },
      });

      // FIX-1: Notify attendant that their session has been approved
      const attendant = await this.prisma.user.findUnique({
        where: { id: session.collectedById },
        select: { id: true },
      });
      if (attendant) {
        if (session.shift === 'AM') {
          // AM approved → tell attendant they can now submit PM session
          await this.prisma.notification.create({
            data: {
              userId: attendant.id,
              type: 'EGG_TALLY_TRIGGERED' as any,
              title: `AM Session Approved — ${houseName}`,
              message: `Your AM egg collection for ${houseName} (${(session as any).batch?.batchCode ?? ''}) has been approved. You may now submit the PM session.`,
              entityId: session.id,
              entityType: 'EggCollectionSession',
            },
          });
        } else {
          // PM approved → notify attendant; day is now fully locked
          await this.prisma.notification.create({
            data: {
              userId: attendant.id,
              type: 'EGG_TALLY_TRIGGERED' as any,
              title: `PM Session Approved — ${houseName}`,
              message: `Your PM egg collection for ${houseName} (${(session as any).batch?.batchCode ?? ''}) has been approved. Both AM and PM sessions are now locked for today.`,
              entityId: session.id,
              entityType: 'EggCollectionSession',
            },
          });
        }
      }

      // FIX-4: Only trigger tally sign-off when BOTH AM and PM sessions are approved
      if (session.shift === 'PM') {
        const amSession = await this.prisma.eggCollectionSession.findFirst({
          where: {
            batchId: session.batchId,
            houseId: session.houseId,
            sessionDate: session.sessionDate,
            shift: 'AM',
            status: EntryStatus.APPROVED,
            deletedAt: null,
          },
        });
   
        if (amSession) {
          // Both AM and PM are approved — create tally records for each session
          await this.tallyVerificationService.createTallyForSession(
            amSession.id,
            session.sessionDate,
          );
          await this.tallyVerificationService.createTallyForSession(
            session.id,
            session.sessionDate,
          );
   
          // Notify all three tally parties
          const tallyTargets = await this.prisma.user.findMany({
            where: { role: { in: ['MANAGER', 'SALES', 'STORE'] }, isActive: true },
            select: { id: true },
          });
          for (const t of tallyTargets) {
            await this.prisma.notification.create({
              data: {
                userId: t.id,
                type: 'EGG_TALLY_TRIGGERED' as any,
                title: `Next Morning Sign-off Ready — ${houseName}`,
                message: `Both AM and PM sessions for ${houseName} (${session.batch?.batchCode ?? ''}) are approved. The morning three-party sign-off is now available.`,
                entityId: session.id,
                entityType: 'EggCollectionSession',
              },
            });
          }
        }
      }

      return approved;
    }

    if (!returnReason) throw new BadRequestException('Return reason is required');

    const returned = await this.prisma.eggCollectionSession.update({
      where: { id },
      data: { status: EntryStatus.RETURNED, returnReason },
    });

    // FIX-3: Notify attendant of the return with the reason so they know to recount
    const attendant = await this.prisma.user.findUnique({
      where: { id: session.collectedById },
      select: { id: true },
    });
    if (attendant) {
      await this.prisma.notification.create({
        data: {
          userId: attendant.id,
          type: 'EGG_TALLY_TRIGGERED' as any,
          title: `${session.shift} Session Returned — Recount Required`,
          message: `Your ${session.shift} egg collection for ${houseName} has been returned for a recount. Reason: ${returnReason}. Please review and resubmit.`,
          entityId: session.id,
          entityType: 'EggCollectionSession',
        },
      });
    }

    return returned;
  }

  async getHenDayTrend(batchId: string, days = 14) {
    return this.prisma.eggCollectionSession.findMany({
      where: { batchId, shift: 'PM', status: EntryStatus.APPROVED, deletedAt: null },
      orderBy: { sessionDate: 'desc' },
      take: days,
      select: { sessionDate: true, totalGoodEggs: true, henDayPercent: true },
    });
  }

  async getTodaySummary(houseId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sessions = await this.prisma.eggCollectionSession.findMany({
      where: { houseId, sessionDate: today, deletedAt: null },
      include: { storeIntakes: true, tally: true },
      orderBy: { shift: 'asc' },
    });
    const am = sessions.find(s => s.shift === 'AM') ?? null;
    const pm = sessions.find(s => s.shift === 'PM') ?? null;
    const storeIntake = pm?.storeIntakes?.[0] ?? am?.storeIntakes?.[0] ?? null;
    return {
      am, pm, storeIntake,
      tally: pm?.tally ?? null,
      totalGoodEggs: (am?.totalGoodEggs ?? 0) + (pm?.totalGoodEggs ?? 0),
      totalStarterEggs: (am?.totalStarterEggs ?? 0) + (pm?.totalStarterEggs ?? 0),
      totalBrokenSellable: (am?.totalBrokenSellable ?? 0) + (pm?.totalBrokenSellable ?? 0),
      totalFullTrays: (am?.totalFullTrays ?? 0) + (pm?.totalFullTrays ?? 0),
    };
  }
}
