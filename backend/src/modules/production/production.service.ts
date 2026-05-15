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

import {
  Injectable, NotFoundException, ConflictException,
  BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EntryStatus, VaccinationRoute } from '@prisma/client';
import { RequestUser } from '../../auth/types/request-user.type';
import { NotificationsService } from '../../common/notifications/notifications.service';
import type { CreateEggCollectionSessionDto } from './production.dto';

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
          data: { ...data, returnReason: null },
        })
      : await this.prisma.eggCollectionSession.create({ data });

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

    // FIX H1: Create EggTallyVerification for BOTH AM and PM sessions.
    // Spec: "it should not be editable after submission and should be
    //        immediately verified by the production manager" — applies to both shifts.
    // AM sessions now appear in the PM's VerificationQueue "Egg Collection Sessions"
    // tab alongside PM sessions, enabling the PM to verify them from the UI.
    await this._fireVerificationNotifications(session, batch);
    await this.prisma.eggTallyVerification.upsert({
      where: { sessionId: session.id },
      update: {},
      create: { sessionId: session.id, verificationDate: session.sessionDate },
    });

    return session;
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
      include: { storeIntakes: true, tally: true },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.tally?.isLocked) {
      throw new BadRequestException('Tally is locked — verification already finalised');
    }
    if (session.status !== EntryStatus.PENDING) {
      throw new BadRequestException(`Session is already ${session.status.toLowerCase()}`);
    }

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
      return this.prisma.eggCollectionSession.update({
        where: { id },
        data: { status: EntryStatus.APPROVED },
      });
    }

    if (!returnReason) throw new BadRequestException('Return reason is required');
    return this.prisma.eggCollectionSession.update({
      where: { id },
      data: { status: EntryStatus.RETURNED, returnReason },
    });
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
