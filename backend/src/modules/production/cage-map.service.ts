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
                assignments: {
                  select: {
                    id: true, batchId: true, birdCount: true, transferDate: true,
                  },
                },
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

    // Count how many rows ACROSS ALL BLOCKS are assigned to each batch.
    // IMPORTANT: A batch can span multiple blocks (e.g. 6 rows in Block A + Block B).
    // If we only counted rows in the currently-viewed block the divisor would be wrong,
    // producing inflated per-row bird counts (e.g. 3952 ÷ 3 = 1317 instead of 3952 ÷ 6 = 658).
    // After a cull, currentBirdCount is the authoritative total — we must divide by the
    // GLOBAL row count so every row reflects (post-cull total ÷ total rows), not
    // (post-cull total ÷ rows in this block only).
    const globalAssignments = batchIds.length
      ? await this.prisma.batchCageAssignment.findMany({
          where: { batchId: { in: batchIds } },
          select: { batchId: true },
        })
      : [];

    const rowsPerBatch: Record<string, number> = {};
    for (const a of globalAssignments) {
      rowsPerBatch[a.batchId] = (rowsPerBatch[a.batchId] ?? 0) + 1;
    }

    const sections = (block as any).farm_sections.map((section: any) => ({
      code: section.code,
      rows: section.farm_rows.map((row: any) => {
        const assignment = row.assignments;
        const batch = assignment ? batchMap[assignment.batchId] : null;
        const ageWeeks = batch ? dayjs().diff(dayjs(batch.dateOfHatch), 'week') : null;

        // birdsInRow: prefer the stored bird_count on the assignment record
        // (set at registration time and updated by culling events).
        // Fall back to evenly dividing currentBirdCount only if stored value is 0 or missing.
        const storedBirdCount = assignment?.birdCount ?? 0;
        const birdsInRow = batch
          ? (storedBirdCount > 0
              ? storedBirdCount
              : Math.floor(batch.currentBirdCount / (rowsPerBatch[batch.id] ?? 1)))
          : null;

        return {
          rowCode: row.rowCode,
          isActive: row.isActive,
          batch: batch
            ? {
                batchCode: batch.batchCode, strain: batch.strain, stage: batch.stage,
                // birdCount reflects birds in THIS row only; totalBirdCount is
                // the authoritative whole-batch figure (post-cull).
                birdCount: birdsInRow!,
                totalBirdCount: batch.currentBirdCount,
                rowCount: rowsPerBatch[batch.id] ?? 1,
                ageWeeks,
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
  /**
   * Syncs each row's stored bird count from the attendant's per-row egg
   * collection totals (RowEntry.totalBirds), so the cage map reflects
   * whatever headcount was actually reported for that row instead of
   * drifting (it previously only ever moved via mortality-event decrements
   * off a `birdCount` that started at 0 and was never otherwise set to a
   * known absolute headcount — see ProductionService.verifySession).
   *
   * `totalBirds` is an absolute count for that row as of the session (it
   * already reflects that day's mortalities), so this SETS birdCount rather
   * than decrementing it — matches the pattern used by
   * ProductionReportReconciliationService when reconciling a row's headcount
   * against an externally-reported figure. Called only when a PM approves a
   * session (not on raw attendant submission), so unverified numbers never
   * reach the cage map.
   *
   * Rows are matched by rowCode against the batch's OWN current assignments
   * (rowCode isn't guaranteed globally unique — see getBlockWithMap), so a
   * rowCode with no active assignment for this batch is skipped rather than
   * guessed at.
   */
  async syncRowPopulations(batchId: string, rowData: Array<{ rowCode: string; totalBirds: number }>) {
    if (!Array.isArray(rowData) || rowData.length === 0) return;

    const assignments = await this.prisma.batchCageAssignment.findMany({
      where: { batchId },
      include: { row: { select: { rowCode: true } } },
    });
    if (assignments.length === 0) return;

    const byRowCode = new Map(assignments.map(a => [(a as any).row?.rowCode, a]));

    let changed = false;
    for (const entry of rowData) {
      const totalBirds = Number(entry?.totalBirds);
      if (!entry?.rowCode || !Number.isFinite(totalBirds) || totalBirds < 0) continue;

      const match = byRowCode.get(entry.rowCode.toUpperCase());
      if (!match || match.birdCount === totalBirds) continue;

      await this.prisma.batchCageAssignment.update({
        where: { id: match.id },
        data: { birdCount: totalBirds },
      });
      changed = true;
    }

    if (changed) {
      this.eventEmitter.emit(DASHBOARD_REFRESH_EVENT, { roles: ['MANAGER', 'OWNER'] });
    }
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
