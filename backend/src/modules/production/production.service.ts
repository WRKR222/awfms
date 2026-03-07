import {
  Injectable, NotFoundException, ConflictException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateProductionEntryDto, ReturnProductionEntryDto,
} from './production.dto';
import { RequestUser } from '../../auth/types/request-user.type';
import { EntryStatus } from '@prisma/client';

@Injectable()
export class ProductionService {
  constructor(private readonly prisma: PrismaService) {}

  async createProductionEntry(dto: CreateProductionEntryDto, user: RequestUser) {
    const batch = await this.prisma.batch.findFirst({
      where: { id: dto.batchId, deletedAt: null, stage: { not: 'CLOSED' } },
    });
    if (!batch) throw new NotFoundException('Batch not found or closed');

    // Check for duplicate (same batch + date + collection time)
    const existing = await this.prisma.productionEntry.findFirst({
      where: {
        batchId: dto.batchId,
        entryDate: new Date(dto.entryDate),
        collectionTime: dto.collectionTime,
      },
    });
    if (existing && existing.status !== EntryStatus.RETURNED) {
      throw new ConflictException(
        `A ${dto.collectionTime} production entry already exists for this batch on ${dto.entryDate}`,
      );
    }

    // Hen-day % = (total eggs collected / current hen count) × 100
    // Uses current batch count as the denominator
    const henDayPct = batch.currentCount > 0
      ? Math.round((dto.totalWhole / batch.currentCount) * 10000) / 100
      : null;

    const data = {
      batchId: dto.batchId,
      entryDate: new Date(dto.entryDate),
      collectionTime: dto.collectionTime,
      totalWhole: dto.totalWhole,
      brokenCracked: dto.brokenCracked,
      shellless: dto.shellless,
      deformed: dto.deformed,
      gradeXl: dto.gradeXl,
      gradeL: dto.gradeL,
      gradeM: dto.gradeM,
      gradeS: dto.gradeS,
      gradeReject: dto.gradeReject,
      henDayPct,
      submittedById: user.id,
      status: EntryStatus.PENDING,
    };

    if (existing?.status === EntryStatus.RETURNED) {
      return this.prisma.productionEntry.update({
        where: { id: existing.id },
        data: { ...data, rejectionNote: null, verifiedAt: null, verifiedById: null },
      });
    }

    return this.prisma.productionEntry.create({ data });
  }

  async getProductionEntries(batchId: string) {
    return this.prisma.productionEntry.findMany({
      where: { batchId },
      include: {
        submittedBy: { select: { username: true } },
        verifiedBy: { select: { username: true } },
      },
      orderBy: [{ entryDate: 'desc' }, { collectionTime: 'asc' }],
      take: 60,
    });
  }

  async verifyProductionEntry(id: string, user: RequestUser) {
    const entry = await this.prisma.productionEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Production entry not found');
    if (entry.status !== EntryStatus.PENDING) {
      throw new BadRequestException(`Entry is already ${entry.status.toLowerCase()}`);
    }

    return this.prisma.productionEntry.update({
      where: { id },
      data: {
        status: EntryStatus.VERIFIED,
        verifiedById: user.id,
        verifiedAt: new Date(),
      },
    });
  }

  async returnProductionEntry(id: string, dto: ReturnProductionEntryDto, user: RequestUser) {
    const entry = await this.prisma.productionEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Production entry not found');
    if (entry.status !== EntryStatus.PENDING) {
      throw new BadRequestException(`Entry is already ${entry.status.toLowerCase()}`);
    }

    return this.prisma.productionEntry.update({
      where: { id },
      data: {
        status: EntryStatus.RETURNED,
        rejectionNote: dto.rejectionNote,
        verifiedById: user.id,
        verifiedAt: new Date(),
      },
    });
  }

  async getHenDayTrend(batchId: string, days = 14) {
    const entries = await this.prisma.productionEntry.findMany({
      where: { batchId, status: EntryStatus.VERIFIED },
      orderBy: { entryDate: 'desc' },
      take: days * 2, // AM + PM per day
      select: { entryDate: true, collectionTime: true, totalWhole: true, henDayPct: true },
    });
    return entries;
  }
}
