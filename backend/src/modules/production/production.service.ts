// src/modules/production/production.service.ts
// CLEANED UP — see migration 20250508_cleanup
//
// Workflow:
//   • Lead Attendant submits AM and PM EggCollectionSession.
//   • Manager verifies the same evening: status PENDING → APPROVED (or RETURNED).
//   • Next morning the 3-party tally is handled by TallyVerificationService.
//     Once locked, the session is frozen for everyone (no re-verify, no edits here).

import {
  Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EntryStatus } from '@prisma/client';
import { RequestUser } from '../../auth/types/request-user.type';
import { NotificationsService } from '../../common/notifications/notifications.service';

export interface RowDataEntry {
  rowCode: string;       // e.g. "D1", "D2", "E1", "E2", "F1", "F2"
  birds: number;
  fullTrays: number;
  looseEggs: number;
  brokenEggs: number;
  softShell: number;
  deformed: number;
  weightKg: number;
}

export interface CreateEggCollectionDto {
  batchId: string;
  houseId: string;
  sessionDate: string;   // YYYY-MM-DD
  shift: 'AM' | 'PM';
  openingPop: number;
  mortalities: number;
  rowData: RowDataEntry[];
  // PM-only footer
  vaccineGiven?: string;
  dailyFeedKg?: number;
  remarks?: string;
}

function rollupRows(rows: RowDataEntry[]) {
  let totalFullTrays = 0, totalLooseEggs = 0, totalBrokenEggs = 0;
  let totalSoftShell = 0, totalDeformed = 0, totalWeightKg = 0;
  for (const r of rows) {
    totalFullTrays  += r.fullTrays  ?? 0;
    totalLooseEggs  += r.looseEggs  ?? 0;
    totalBrokenEggs += r.brokenEggs ?? 0;
    totalSoftShell  += r.softShell  ?? 0;
    totalDeformed   += r.deformed   ?? 0;
    totalWeightKg   += r.weightKg   ?? 0;
  }
  return {
    totalFullTrays, totalLooseEggs, totalBrokenEggs, totalSoftShell, totalDeformed,
    totalWeightKg, totalGoodEggs: totalFullTrays * 30 + totalLooseEggs,
  };
}

@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async createEggCollection(dto: CreateEggCollectionDto, user: RequestUser) {
    // Only Lead Attendant submits collection sessions.
    if (user.role !== 'ATTENDANT') {
      throw new ForbiddenException('Only the Lead Attendant may submit egg collection sessions');
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

    const totals = rollupRows(dto.rowData);
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
      ...totals,
      totalWeightKg: totals.totalWeightKg,
      henDayPercent,
      vaccineGiven: dto.vaccineGiven ?? null,
      dailyFeedKg: dto.dailyFeedKg ?? null,
      remarks: dto.remarks ?? null,
      status: EntryStatus.PENDING,
    };

    const session = existing?.status === EntryStatus.RETURNED
      ? await this.prisma.eggCollectionSession.update({
          where: { id: existing.id },
          data: { ...data, returnReason: null },
        })
      : await this.prisma.eggCollectionSession.create({ data });

    // PM session: notify Manager so they can verify before close-of-day,
    // and pre-create the next-morning EggTallyVerification skeleton.
    if (dto.shift === 'PM') {
      await this._fireVerificationNotifications(session, batch);
      await this.prisma.eggTallyVerification.upsert({
        where: { sessionId: session.id },
        update: {},
        create: {
          sessionId: session.id,
          verificationDate: session.sessionDate,
        },
      });
    }

    return session;
  }

  private async _fireVerificationNotifications(session: any, batch: any) {
    const targets = await this.prisma.user.findMany({
      where: { role: { in: ['MANAGER', 'STORE', 'OWNER'] }, isActive: true },
      select: { id: true, role: true },
    });

    const houseRecord = await this.prisma.house.findUnique({
      where: { id: session.houseId },
      select: { name: true },
    });
    const houseName = houseRecord?.name ?? 'House';

    for (const target of targets) {
      const message = target.role === 'STORE'
        ? `PM egg collection submitted for ${houseName} (${batch.batchCode}). Please log your egg intake — ${session.totalGoodEggs} good eggs, ${session.totalFullTrays} full trays.`
        : `PM egg collection awaiting Manager verification — ${houseName} (${batch.batchCode}). ${session.totalGoodEggs} good eggs · HDP: ${session.henDayPercent ?? '—'}%.`;

      await this.prisma.notification.create({
        data: {
          userId: target.id,
          type: 'EGG_TALLY_TRIGGERED' as any,
          title: `Egg Tally — ${houseName} PM`,
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

  // Same-evening Manager verification of a PENDING session.
  // After this passes, the next-morning 3-party tally takes over.
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
      am,
      pm,
      storeIntake,
      tally: pm?.tally ?? null,
      totalGoodEggs: (am?.totalGoodEggs ?? 0) + (pm?.totalGoodEggs ?? 0),
      totalFullTrays: (am?.totalFullTrays ?? 0) + (pm?.totalFullTrays ?? 0),
    };
  }
}
