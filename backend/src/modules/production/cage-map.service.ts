// src/modules/production/cage-map.service.ts
// Soft-delete enabled (per "Soft Deletes Only" rule).

import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DASHBOARD_REFRESH_EVENT } from '../../common/events/app-event-bus';
import dayjs from 'dayjs';

@Injectable()
export class CageMapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getAllBlocks() {
    return this.prisma.farmBlock.findMany({
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, isActive: true, isUnderConstruction: true },
    });
  }

  async getBlockWithMap(blockCode: string) {
    const block = await this.prisma.farmBlock.findUnique({
      where: { code: blockCode },
      include: {
        sections: {
          orderBy: { sortOrder: 'asc' },
          include: {
            rows: {
              orderBy: { rowCode: 'asc' },
              include: {
                // Only the active assignment per row
                assignments: { where: { isActive: true }, take: 1 } as any,
              },
            },
          },
        },
      },
    });
    if (!block) throw new NotFoundException(`Block ${blockCode} not found`);

    const batchIds = (block as any).sections
      .flatMap((s: any) => s.rows)
      .flatMap((r: any) => (r.assignments?.[0] ? [r.assignments[0].batchId] : []));

    const batches = batchIds.length
      ? await this.prisma.batch.findMany({
          where: { id: { in: batchIds } },
          select: {
            id: true, batchCode: true, strain: true, stage: true,
            currentBirdCount: true, dateOfHatch: true, dateReceived: true,
          },
        })
      : [];

    const hdpMap: Record<string, number> = {};
    for (const b of batches) {
      const latest = await this.prisma.eggCollectionSession.findFirst({
        where: { batchId: b.id, status: 'APPROVED', deletedAt: null },
        orderBy: { sessionDate: 'desc' },
        select: { henDayPercent: true },
      });
      if (latest?.henDayPercent != null) hdpMap[b.id] = Number(latest.henDayPercent);
    }

    const batchMap = Object.fromEntries(batches.map(b => [b.id, b]));

    const sections = (block as any).sections.map((section: any) => ({
      code: section.code,
      rows: section.rows.map((row: any) => {
        const assignment = row.assignments?.[0];
        const batch = assignment ? batchMap[assignment.batchId] : null;
        const ageWeeks = batch ? dayjs().diff(dayjs(batch.dateOfHatch), 'week') : null;
        return {
          rowCode: row.rowCode,
          isActive: row.isActive,
          batch: batch
            ? {
                batchCode: batch.batchCode, strain: batch.strain, stage: batch.stage,
                birdCount: batch.currentBirdCount, ageWeeks,
                hdpPercent: hdpMap[batch.id] ?? null,
                transferDate: assignment!.transferDate,
              }
            : null,
        };
      }),
    }));

    return {
      block: {
        id: block.id, name: block.name, code: block.code,
        isActive: block.isActive, isUnderConstruction: block.isUnderConstruction,
      },
      sections,
    };
  }

  // Soft-deactivate any current active assignment, then create a new active one.
  async assignBatchToRow(rowId: string, batchId: string, transferDate: string, notes: string | undefined, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.batchCageAssignment.updateMany({
        where: { rowId, isActive: true },
        data: { isActive: false, deactivatedAt: new Date(), deactivatedById: userId },
      });
      const result = await tx.batchCageAssignment.create({
        data: {
          rowId, batchId,
          transferDate: new Date(transferDate),
          notes: notes ?? null,
          assignedById: userId,
          isActive: true,
        },
      });
      this.eventEmitter.emit(DASHBOARD_REFRESH_EVENT, { roles: ['MANAGER', 'OWNER'] });
      return result;
    }).catch((e: any) => {
      if (e?.code === 'P2002') throw new ConflictException('Active assignment already exists for this row');
      throw e;
    });
  }

  async removeAssignment(rowId: string, userId: string) {
    const result = await this.prisma.batchCageAssignment.updateMany({
      where: { rowId, isActive: true },
      data: { isActive: false, deactivatedAt: new Date(), deactivatedById: userId },
    });
    this.eventEmitter.emit(DASHBOARD_REFRESH_EVENT, { roles: ['MANAGER', 'OWNER'] });
    return result;
  }
}
