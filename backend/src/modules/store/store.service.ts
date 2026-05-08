// src/modules/store/store.service.ts
// CLEANED UP — cosignTally() removed. The 3-party tally lives in TallyVerificationService.
// Store still logs egg intake and feed distribution as before.

import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestUser } from '../../auth/types/request-user.type';

export interface CreateStoreIntakeDto {
  sessionId: string;
  houseId: string;
  intakeDate: string;
  shift: 'AM' | 'PM';
  rowData: Array<{ rowCode: string; fullTrays: number; looseEggs: number; weightKg: number; }>;
  notes?: string;
}

export interface LogFeedDistributionDto {
  houseId: string;
  batchId: string;
  feedType: string;
  distributionDate: string;
  quantityKg: number;
  notes?: string;
}

@Injectable()
export class StoreService {
  constructor(private readonly prisma: PrismaService) {}

  async createEggIntake(dto: CreateStoreIntakeDto, user: RequestUser) {
    const session = await this.prisma.eggCollectionSession.findFirst({
      where: { id: dto.sessionId, deletedAt: null },
      include: { tally: { select: { isLocked: true } } },
    });
    if (!session) throw new NotFoundException('Egg collection session not found');
    if (session.tally?.isLocked) {
      throw new ConflictException('Tally locked — store intake can no longer be modified');
    }

    const existing = await this.prisma.storeEggIntake.findFirst({ where: { sessionId: dto.sessionId } });
    if (existing) throw new ConflictException('Store intake already logged for this collection session');

    let totalFullTrays = 0, totalLooseEggs = 0, totalWeightKg = 0;
    for (const r of dto.rowData) {
      totalFullTrays += r.fullTrays ?? 0;
      totalLooseEggs += r.looseEggs ?? 0;
      totalWeightKg  += r.weightKg  ?? 0;
    }
    const totalGoodEggs = totalFullTrays * 30 + totalLooseEggs;

    return this.prisma.storeEggIntake.create({
      data: {
        sessionId: dto.sessionId,
        houseId: dto.houseId,
        intakeDate: new Date(dto.intakeDate),
        shift: dto.shift,
        receivedById: user.id,
        rowData: dto.rowData as any,
        totalFullTrays, totalLooseEggs, totalGoodEggs, totalWeightKg,
        notes: dto.notes ?? null,
      },
    });
  }

  async getEggIntakes(houseId?: string, intakeDate?: string) {
    return this.prisma.storeEggIntake.findMany({
      where: {
        ...(houseId ? { houseId } : {}),
        ...(intakeDate ? { intakeDate: new Date(intakeDate) } : {}),
      },
      include: {
        session: {
          select: {
            totalGoodEggs: true, totalFullTrays: true, henDayPercent: true, shift: true,
            batch: { select: { batchCode: true } },
          },
        },
      },
      orderBy: [{ intakeDate: 'desc' }, { shift: 'asc' }],
      take: 60,
    });
  }

  async getIntakeById(id: string) {
    const intake = await this.prisma.storeEggIntake.findUnique({
      where: { id }, include: { session: true },
    });
    if (!intake) throw new NotFoundException('Store intake not found');
    return intake;
  }

  async getPendingIntakes() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - 1);

    return this.prisma.eggCollectionSession.findMany({
      where: {
        deletedAt: null,
        shift: 'PM',
        sessionDate: { gte: cutoff },
        storeIntakes: { none: {} },
      },
      include: { batch: { select: { batchCode: true } } },
      orderBy: { sessionDate: 'desc' },
    });
  }

  async logFeedDistribution(dto: LogFeedDistributionDto, user: RequestUser) {
    return this.prisma.feedIntakeLog.create({
      data: {
        batchId: dto.batchId,
        houseId: dto.houseId,
        feedType: dto.feedType as any,
        entryDate: new Date(dto.distributionDate),
        quantityDispensedKg: dto.quantityKg,
        wastageKg: 0,
        status: 'PENDING' as any,
        recordedById: user.id,
        notes: dto.notes ?? null,
      },
    });
  }

  async getFeedDistributions(houseId?: string, entryDate?: string) {
    return this.prisma.feedIntakeLog.findMany({
      where: {
        ...(houseId ? { houseId } : {}),
        ...(entryDate ? { entryDate: new Date(entryDate) } : {}),
      },
      include: { batch: { select: { batchCode: true } } },
      orderBy: { entryDate: 'desc' },
      take: 60,
    });
  }

  async getStoreSummary() {
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const pendingIntakes = await this.getPendingIntakes();

    const todayIntakes = await this.prisma.storeEggIntake.findMany({ where: { intakeDate: today } });
    const todayEggs  = todayIntakes.reduce((s, i) => s + i.totalGoodEggs, 0);
    const todayTrays = todayIntakes.reduce((s, i) => s + i.totalFullTrays, 0);

    const discrepancies = await this.prisma.storeEggIntake.count({ where: { hasDiscrepancy: true } });

    const lockedBookings = await this.prisma.advanceBooking.findMany({
      where: { stockLocked: true, status: { in: ['PENDING', 'CONFIRMED'] }, deletedAt: null },
      include: { customer: { select: { name: true } } },
      orderBy: { requestedDate: 'asc' },
    });
    const totalLockedEggs  = lockedBookings.reduce((s, b) => s + b.quantityEggs, 0);
    const totalLockedTrays = lockedBookings.reduce((s, b) => s + b.quantityTrays, 0);

    // Pending tallies awaiting Store signature
    const pendingTallies = await this.prisma.eggTallyVerification.count({
      where: { isLocked: false, storeSignedById: null },
    });

    return {
      pendingIntakeCount: pendingIntakes.length,
      pendingIntakes,
      todayEggs, todayTrays,
      discrepancyCount: discrepancies,
      pendingTallies,
      lockedBookings, totalLockedEggs, totalLockedTrays,
    };
  }
}
