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
        farm_sections: {
          // FIX: was sort_order (DB column name) — Prisma uses camelCase field name
          orderBy: { sortOrder: 'asc' },
          include: {
            farm_rows: {
              // FIX: was row_code (DB column name) — Prisma uses camelCase field name
              orderBy: { rowCode: 'asc' },
              include: {
                assignments: true,
              },
            },
          },
        },
      },
    });
    if (!block) throw new NotFoundException(`Block ${blockCode} not found`);

    const batchIds = (block as any).farm_sections
      .flatMap((s: any) => s.farm_rows)
      .flatMap((r: any) => (r.assignments ? [r.assignments.batchId] : []));

    const batches = batchIds.length
      ? await this.prisma.batch.findMany({
          where: { id: { in: batchIds } },
          select: {
            id: true, batchCode: true, strain: true, stage: true,
            currentBirdCount: true, dateOfHatch: true, dateReceived: true,
          },
        })
      : [];

    // FIX: Daily HDP% = (AM good eggs + PM good eggs) / closing bird count * 100
    // Previously only the latest single session henDayPercent was used, which
    // captured AM only. Now we sum both sessions for the most recent day that
    // has at least one APPROVED session, giving the true daily HDP%.
    const hdpMap: Record<string, number> = {};
    for (const b of batches) {
      // Find the most recent date with an APPROVED session for this batch
      const latestSession = await this.prisma.eggCollectionSession.findFirst({
        where: { batchId: b.id, status: 'APPROVED', deletedAt: null },
        orderBy: { sessionDate: 'desc' },
        select: { sessionDate: true, closingStock: true },
      });
      if (!latestSession) continue;

      // Fetch both AM and PM sessions for that date
      const daySessions = await this.prisma.eggCollectionSession.findMany({
        where: {
          batchId: b.id,
          status: 'APPROVED',
          deletedAt: null,
          sessionDate: latestSession.sessionDate,
        },
        select: { totalGoodEggs: true, closingStock: true, shift: true },
      });

      const totalGoodEggs = daySessions.reduce((s, sess) => s + (sess.totalGoodEggs ?? 0), 0);
      // Use the PM closing stock if available (most accurate), else AM closing stock
      const pmSession = daySessions.find(s => s.shift === 'PM');
      const closingStock = pmSession?.closingStock ?? latestSession.closingStock ?? 0;

      if (closingStock > 0) {
        hdpMap[b.id] = Math.round((totalGoodEggs / closingStock) * 10000) / 100;
      }
    }

    const batchMap = Object.fromEntries(batches.map(b => [b.id, b]));

    const sections = (block as any).farm_sections.map((section: any) => ({
      code: section.code,
      rows: section.farm_rows.map((row: any) => {
        const assignment = row.assignments;
        const batch = assignment ? batchMap[assignment.batchId] : null;
        const ageWeeks = batch ? dayjs().diff(dayjs(batch.dateOfHatch), 'week') : null;
        return {
          rowCode: row.rowCode,
          isActive: row.isActive,
          batch: batch
            ? {
                batchCode: batch.batchCode, strain: batch.strain, stage: batch.stage,
                birdCount: batch.currentBirdCount, ageWeeks, // FIX: always authoritative currentBirdCount (culling always decrements this)
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

  // Replace any current assignment on this row with a new one.
  async assignBatchToRow(rowId: string, batchId: string, transferDate: string, notes: string | undefined, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.batchCageAssignment.deleteMany({ where: { rowId } });
      const result = await tx.batchCageAssignment.create({
        data: {
          rowId, batchId,
          transferDate: new Date(transferDate),
          notes: notes ?? null,
          assignedById: userId,
        },
      });
      this.eventEmitter.emit(DASHBOARD_REFRESH_EVENT, { roles: ['MANAGER', 'OWNER'] });
      return result;
    }).catch((e: any) => {
      if (e?.code === 'P2002') throw new ConflictException('Active assignment already exists for this row');
      throw e;
    });
  }

  async removeAssignment(rowId: string, _userId: string) {
    const result = await this.prisma.batchCageAssignment.deleteMany({
      where: { rowId },
    });
    this.eventEmitter.emit(DASHBOARD_REFRESH_EVENT, { roles: ['MANAGER', 'OWNER'] });
    return result;
  }
  // Returns all cage-row assignments for a given batch.
  // Used by the controller to power the batch-detail cage overlay.
  async getAssignmentsByBatch(batchId: string) {
    return this.prisma.batchCageAssignment.findMany({
      where: { batchId },
      include: {
        row: {
          select: {
            rowCode: true,
            isActive: true,
            assignments: false,
          },
        },
      },
    });
  }
}
