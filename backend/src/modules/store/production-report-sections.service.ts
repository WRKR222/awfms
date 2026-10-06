// src/modules/store/production-report-sections.service.ts
// Applies the extra tabs of a production report workbook (see
// report-workbook-sections.util.ts):
//   • Stock per cage -> the brooder cage map is set to exactly the sheet's
//     layout for this batch: cages it lists get its bird counts, cages the
//     batch held that the sheet leaves out are cleared. Written as one
//     'BrooderCageLayout' ledger entry so a rollback (or the next upload,
//     which first undoes this one) puts the previous layout back.
//   • Weight track -> BatchWeightTrackPoint rows for the PM/Director graph.
import { Injectable } from '@nestjs/common';
import { BatchStage } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { farmTodayUtcMidnight } from '../../common/feed/feed-standard.util';
import { AppliedChangeInput } from './production-report-reconciliation.service';
import { CageStockSection, SectionsApplyResult, WeightTrackPoint } from './production-report.dto';

type CageLayoutResult = NonNullable<SectionsApplyResult['cageStock']>;

/** One cage assignment as recorded in the BrooderCageLayout ledger entry. */
export interface LayoutCage {
  cageId: string;
  levelId: string;
  birdCount: number;
  placedDate: string;
  notes: string | null;
  isIsolation: boolean;
  isolationReason: string | null;
  assignedById: string;
}

/** Recompute a level's BrooderLevelAssignment rollup from its cages — same
 *  rule as BrooderService/reconciliation (duplicated there to avoid a
 *  module cycle: BrooderModule imports StoreModule). Run inside the same
 *  transaction as the cage writes. */
export async function recomputeBrooderLevelRollup(tx: any, levelId: string, userId: string) {
  const cageAssignments = await tx.brooderCageAssignment.findMany({ where: { cage: { levelId } } });
  if (cageAssignments.length === 0) {
    await tx.brooderLevelAssignment.deleteMany({ where: { levelId } });
    return;
  }
  const birdCount = cageAssignments.reduce((s: number, a: any) => s + a.birdCount, 0);
  const batchId = cageAssignments[0].batchId;
  const placedDate = cageAssignments.map((a: any) => a.placedDate as Date).reduce((min: Date, d: Date) => (d < min ? d : min));
  await tx.brooderLevelAssignment.upsert({
    where: { levelId },
    create: { levelId, batchId, birdCount, placedDate, notes: 'Auto-maintained rollup of this level\'s cage assignments.', assignedById: userId },
    update: { batchId, birdCount, placedDate, assignedById: userId },
  });
}

/** Replaces `batchId`'s cage assignments with `cages` (cages held by another
 *  batch are never touched) and recomputes every level involved. Shared by
 *  apply and rollback so both directions write the same way. */
export async function writeCageLayout(tx: any, batchId: string, cages: LayoutCage[], userId: string) {
  const current = await tx.brooderCageAssignment.findMany({ where: { batchId }, include: { cage: { select: { levelId: true } } } });
  const levelIds = new Set<string>([...current.map((a: any) => a.cage.levelId), ...cages.map(c => c.levelId)]);
  await tx.brooderCageAssignment.deleteMany({ where: { batchId } });
  const takenByOthers = new Set<string>(
    (await tx.brooderCageAssignment.findMany({ where: { cageId: { in: cages.map(c => c.cageId) } }, select: { cageId: true } }))
      .map((a: any) => a.cageId),
  );
  const rows = cages.filter(c => c.birdCount > 0 && !takenByOthers.has(c.cageId));
  if (rows.length) {
    await tx.brooderCageAssignment.createMany({
      data: rows.map(c => ({
        cageId: c.cageId, batchId, birdCount: c.birdCount, placedDate: new Date(c.placedDate), notes: c.notes,
        isIsolation: c.isIsolation, isolationReason: c.isolationReason, assignedById: c.assignedById,
      })),
    });
  }
  for (const levelId of levelIds) if (levelId) await recomputeBrooderLevelRollup(tx, levelId, userId);
}

/** cageId -> birdCount for a layout, for comparing layouts. */
export function layoutCounts(cages: { cageId: string; birdCount: number }[]): Map<string, number> {
  return new Map(cages.filter(c => c.birdCount > 0).map(c => [c.cageId, c.birdCount]));
}

export function sameLayout(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

@Injectable()
export class ProductionReportSectionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Sets the batch's brooder cage map to the sheet's layout. Returns the
   *  ledger entry to record (none when nothing changed) and a summary for
   *  Store. Cages the cage map doesn't have, or that hold another batch,
   *  are skipped and listed in the warnings rather than failing the upload. */
  async applyCageLayout(
    batchId: string, section: CageStockSection, userId: string,
  ): Promise<{ changes: AppliedChangeInput[]; result: CageLayoutResult }> {
    const batch = await this.prisma.batch.findUnique({
      where: { id: batchId }, select: { batchCode: true, stage: true, currentBirdCount: true },
    });
    const warnings = [...section.warnings];
    const base = {
      sheetName: section.sheetName, totalBirds: section.totalBirds,
      liveBirdCount: batch?.currentBirdCount ?? 0, cagesAssigned: 0, warnings,
    };
    if (!batch) return { changes: [], result: { ...base, applied: false, note: 'Batch not found.' } };
    if (batch.stage !== BatchStage.BROODING && batch.stage !== BatchStage.GROWER) {
      return {
        changes: [],
        result: { ...base, applied: false, note: `${batch.batchCode} is not in the brooder (stage: ${batch.stage}), so the brooder cage map was left as it is.` },
      };
    }

    const rows = await this.prisma.brooderRow.findMany({
      where: { isActive: true },
      include: { levels: { include: { cages: { select: { id: true, cageNumber: true, levelId: true } } } } },
    });
    const findRow = (label: string) => {
      const l = label.trim().toLowerCase();
      return rows.find(r => r.label.toLowerCase() === l || r.label.toLowerCase() === `row ${l}` || String(r.rowNumber) === l);
    };

    const today = farmTodayUtcMidnight();
    const current = await this.prisma.brooderCageAssignment.findMany({ where: { batchId } });
    const currentByCage = new Map(current.map(a => [a.cageId, a]));
    const heldByOthers = new Map(
      (await this.prisma.brooderCageAssignment.findMany({
        where: { batchId: { not: batchId } }, include: { batch: { select: { batchCode: true } } },
      })).map(a => [a.cageId, a.batch.batchCode]),
    );

    const missing: string[] = [];
    const blocked: string[] = [];
    const target: LayoutCage[] = [];
    for (const c of section.cages) {
      if (c.birdCount <= 0) continue;
      const name = `Row ${c.rowLabel} · Level ${c.levelNumber} · Cage ${c.cageNumber}`;
      const cage = findRow(c.rowLabel)?.levels.find(l => l.levelNumber === c.levelNumber)?.cages.find(x => x.cageNumber === c.cageNumber);
      if (!cage) { missing.push(name); continue; }
      const other = heldByOthers.get(cage.id);
      if (other) { blocked.push(`${name} (${other})`); continue; }
      const existing = currentByCage.get(cage.id);
      target.push({
        cageId: cage.id, levelId: cage.levelId, birdCount: c.birdCount,
        // A cage the batch already sits in keeps its placement details;
        // only the count follows the sheet.
        placedDate: (existing?.placedDate ?? today).toISOString().slice(0, 10),
        notes: existing ? existing.notes : 'Set from the production report\'s stock-per-cage sheet.',
        isIsolation: existing?.isIsolation ?? false,
        isolationReason: existing?.isolationReason ?? null,
        assignedById: existing?.assignedById ?? userId,
      });
    }
    const list = (items: string[]) => items.slice(0, 5).join(', ') + (items.length > 5 ? ` and ${items.length - 5} more` : '');
    if (missing.length) warnings.push(`${missing.length} cage(s) on the sheet aren't on the brooder cage map and were skipped: ${list(missing)}.`);
    if (blocked.length) warnings.push(`${blocked.length} cage(s) hold another batch and were left alone: ${list(blocked)}.`);

    const assigned = target.reduce((s, c) => s + c.birdCount, 0);
    if (assigned > batch.currentBirdCount) {
      warnings.push(`The sheet places ${assigned.toLocaleString()} birds but ${batch.batchCode} has ${batch.currentBirdCount.toLocaleString()} live birds on record.`);
    }

    const result: CageLayoutResult = { ...base, applied: true, cagesAssigned: target.length, totalBirds: assigned };
    if (target.length === 0) {
      return { changes: [], result: { ...result, applied: false, note: 'No cage on the sheet could be placed, so the cage map was left as it is.' } };
    }

    const before: LayoutCage[] = current.map(a => ({
      cageId: a.cageId, levelId: '', birdCount: a.birdCount, placedDate: a.placedDate.toISOString().slice(0, 10),
      notes: a.notes, isIsolation: a.isIsolation, isolationReason: a.isolationReason, assignedById: a.assignedById,
    }));
    if (sameLayout(layoutCounts(before), layoutCounts(target))) {
      return { changes: [], result: { ...result, note: 'The cage map already matches the sheet.' } };
    }
    // Level ids for the "before" layout (needed to rebuild rollups on undo).
    const cageLevels = new Map(rows.flatMap(r => r.levels.flatMap(l => l.cages.map(c => [c.id, c.levelId] as const))));
    for (const b of before) b.levelId = cageLevels.get(b.cageId) ?? '';

    await this.prisma.$transaction(
      tx => writeCageLayout(tx, batchId, target, userId),
      { timeout: 60_000, maxWait: 10_000 },
    );

    return {
      changes: [{
        batchId, rowDate: today.toISOString().slice(0, 10), entityType: 'BrooderCageLayout', entityId: batchId,
        action: 'UPDATE', beforeState: { cages: before }, afterState: { cages: target },
      }],
      result,
    };
  }

  /** Replaces the batch's weight-track rows with this report's. Run inside
   *  the report-save transaction. */
  async saveWeightTrack(tx: any, batchId: string, reportId: string, points: WeightTrackPoint[] | undefined) {
    await tx.batchWeightTrackPoint.deleteMany({ where: { batchId } });
    if (!points?.length) return 0;
    await tx.batchWeightTrackPoint.createMany({
      data: points.map(p => ({
        batchId, reportId, sampleDate: new Date(p.date), weekNumber: p.week ?? null, dayNumber: p.day ?? null,
        minExpectedG: p.minExpectedG ?? null, maxExpectedG: p.maxExpectedG ?? null,
        avgExpectedG: p.avgExpectedG ?? null, avgActualG: p.avgActualG ?? null,
      })),
    });
    return points.length;
  }
}
