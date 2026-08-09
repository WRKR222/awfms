// src/modules/store/production-report-rollback.service.ts
// Reverses everything the reconciliation engine auto-applied for a
// production report — the operational counterpart to
// ProductionReportAppliedChange (see schema.prisma for the full field-by-
// field contract). Walks the ledger newest-first (so dependent writes, e.g.
// a cage-map rollup computed after a cage reassignment, unwind in the right
// order) and, per entry:
//
//   CREATE       -> delete the row (guarded: only if it still looks like
//                    the row this report created — see assertUnchanged()).
//   UPDATE       -> write beforeState's fields back onto the row.
//   JSON_APPEND  -> remove the exact appended entry from the JSON array it
//                    was appended to (by deep equality), on the parent row.
//
// SCOPE: only reverses what reconcile() itself auto-applied while parsing
// an upload. It deliberately does NOT touch anything a Director applied via
// approve()/applyDiscrepancy() — that is a distinct, deliberate human sign-
// off (including real stock deductions), not part of "undo my upload", and
// undoing it silently here would be a bigger, separate action than what
// this button promises.
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestUser } from '../../auth/types/request-user.type';

export interface RollbackResult {
  reportId: string;
  batchId: string;
  totalChanges: number;
  reverted: number;
  skipped: { entityType: string; entityId: string | null; reason: string }[];
}

@Injectable()
export class ProductionReportRollbackService {
  private readonly logger = new Logger(ProductionReportRollbackService.name);

  constructor(private readonly prisma: PrismaService) {}

  async rollback(reportId: string, user: RequestUser): Promise<RollbackResult> {
    const report = await this.prisma.storeProductionReport.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Report not found');
    if (report.rolledBackAt) throw new BadRequestException('This report has already been rolled back.');

    const changes = await this.prisma.productionReportAppliedChange.findMany({
      where: { reportId, rolledBack: false },
      orderBy: { createdAt: 'desc' },
    });

    const skipped: RollbackResult['skipped'] = [];
    let reverted = 0;
    const touchedLevelIds = new Set<string>();

    for (const change of changes) {
      try {
        const levelTouched = await this.prisma.$transaction(async (tx) => {
          const outcome = await this.revertOne(tx, change);
          await tx.productionReportAppliedChange.update({
            where: { id: change.id },
            data: { rolledBack: true, rolledBackAt: new Date(), rolledBackById: user.id },
          });
          return outcome;
        });
        if (levelTouched) touchedLevelIds.add(levelTouched);
        reverted++;
      } catch (err: any) {
        this.logger.warn(`Rollback skipped ${change.entityType}/${change.entityId}: ${err.message}`);
        skipped.push({ entityType: change.entityType, entityId: change.entityId, reason: err.message });
      }
    }

    // Cage assignments were reverted individually above; recompute each
    // touched level's rollup once, after all its cages are back to their
    // pre-report state, rather than once per cage.
    for (const levelId of touchedLevelIds) {
      await this.recomputeLevelRollup(levelId, user.id);
    }

    await this.prisma.storeProductionReport.update({
      where: { id: reportId },
      data: { rolledBackAt: new Date(), rolledBackById: user.id },
    });

    return { reportId, batchId: report.batchId, totalChanges: changes.length, reverted, skipped };
  }

  /** Reverts a single ledger entry. Returns a BrooderLevel id if a cage
   *  assignment was touched (so the caller can batch the rollup recompute),
   *  otherwise undefined. Throws (caller catches, records as skipped) if
   *  the row has moved on since this report touched it — e.g. an attendant
   *  has since edited it — since silently overwriting a human's later edit
   *  would be worse than leaving that one field for manual review. */
  private async revertOne(tx: any, change: {
    entityType: string; entityId: string | null; action: string; beforeState: any; afterState: any;
  }): Promise<string | undefined> {
    const { entityType, entityId, action, beforeState, afterState } = change;

    switch (entityType) {
      case 'BrooderGeneralMortalityLog':
        if (action === 'CREATE') { await this.deleteIfUnchanged(tx.brooderGeneralMortalityLog, entityId, afterState); return; }
        break;

      case 'BrooderGeneralFeedLog':
        if (action === 'CREATE') { await this.deleteIfUnchanged(tx.brooderGeneralFeedLog, entityId, afterState); return; }
        break;

      case 'BrooderStockCount':
        if (action === 'CREATE') { await this.deleteIfUnchanged(tx.brooderStockCount, entityId, afterState); return; }
        if (action === 'UPDATE') {
          const existing = await tx.brooderStockCount.findUnique({ where: { id: entityId } });
          if (!existing) throw new Error('Stock count row no longer exists.');
          for (const key of Object.keys(afterState ?? {})) {
            if (JSON.stringify((existing as any)[key]) !== JSON.stringify((afterState as any)[key])) {
              throw new Error(`${key} has changed since the report set it — leaving as-is for manual review.`);
            }
          }
          await tx.brooderStockCount.update({ where: { id: entityId }, data: beforeState });
          return;
        }
        break;

      case 'BrooderTreatmentLog':
        if (action === 'CREATE') { await this.deleteIfUnchanged(tx.brooderTreatmentLog, entityId, afterState); return; }
        break;

      case 'BrooderLog':
        // Whole row was created solely to hold one vaccine/supplement entry,
        // OR one session's environmental readings — either way, nothing
        // else needed the row, so rollback removes it entirely.
        if (action === 'CREATE') { await this.deleteIfUnchanged(tx.brooderLog, entityId, afterState); return; }
        break;

      case 'BrooderLog.environmental': {
        if (action !== 'UPDATE') break;
        const existing = await tx.brooderLog.findUnique({ where: { id: entityId } });
        if (!existing) throw new Error('Log entry no longer exists.');
        for (const key of Object.keys(afterState ?? {})) {
          if (JSON.stringify((existing as any)[key]) !== JSON.stringify((afterState as any)[key])) {
            throw new Error(`${key} has changed since the report set it — leaving as-is for manual review.`);
          }
        }
        await tx.brooderLog.update({ where: { id: entityId }, data: beforeState });
        return;
      }

      case 'BrooderLog.vaccinesJson':
      case 'BrooderLog.supplementsJson': {
        const key = entityType.endsWith('vaccinesJson') ? 'vaccinesJson' : 'supplementsJson';
        const row = await tx.brooderLog.findUnique({ where: { id: entityId } });
        if (!row) return; // already gone — nothing to undo
        const current: any[] = Array.isArray((row as any)[key]) ? (row as any)[key] : [];
        const idx = current.findIndex(e => deepEqual(e, afterState));
        if (idx === -1) {
          throw new Error('Entry no longer present in the JSON array (edited since) — leaving as-is for manual review.');
        }
        const next = [...current.slice(0, idx), ...current.slice(idx + 1)];
        await tx.brooderLog.update({ where: { id: entityId }, data: { [key]: next } });
        return;
      }

      case 'BrooderCageAssignment': {
        const existing = await tx.brooderCageAssignment.findUnique({ where: { cageId: entityId }, include: { cage: true } });
        if (action === 'CREATE') {
          if (!existing) return; // already gone
          if (!statesRoughlyMatch(existing, afterState)) {
            throw new Error('Cage assignment has changed since the report set it — leaving as-is for manual review.');
          }
          const levelId = existing.cage.levelId;
          await tx.brooderCageAssignment.delete({ where: { cageId: entityId } });
          return levelId;
        }
        if (action === 'UPDATE') {
          if (!existing) throw new Error('Cage assignment no longer exists — cannot restore its previous state.');
          if (!statesRoughlyMatch(existing, afterState)) {
            throw new Error('Cage assignment has changed since the report updated it — leaving as-is for manual review.');
          }
          const levelId = existing.cage.levelId;
          await tx.brooderCageAssignment.update({ where: { cageId: entityId }, data: beforeState });
          return levelId;
        }
        break;
      }

      case 'EggCollectionSession.mortalities':
      case 'EggCollectionSession.feedKg':
      case 'EggCollectionSession.vaccineGiven': {
        if (action !== 'UPDATE') break;
        const field = entityType.split('.')[1];
        const existing = await tx.eggCollectionSession.findUnique({ where: { id: entityId } });
        if (!existing) throw new Error('Egg-collection session no longer exists.');
        if (JSON.stringify((existing as any)[field]) !== JSON.stringify(afterState[field])) {
          throw new Error(`${field} has changed since the report set it — leaving as-is for manual review.`);
        }
        await tx.eggCollectionSession.update({ where: { id: entityId }, data: { [field]: beforeState[field] } });
        return;
      }
    }

    throw new Error(`No rollback handler for ${entityType}/${action} — leaving as-is for manual review.`);
  }

  /** Deletes a row only if it still matches the state this report created
   *  it with (best-effort shallow compare of the fields we recorded) — a
   *  guard against deleting a row someone has since hand-edited. */
  private async deleteIfUnchanged(delegate: any, id: string | null, expected: any) {
    if (!id) return;
    const existing = await delegate.findUnique({ where: { id } });
    if (!existing) return; // already gone
    if (!statesRoughlyMatch(existing, expected)) {
      throw new Error('Row has been edited since the report created it — leaving as-is for manual review.');
    }
    await delegate.delete({ where: { id } });
  }

  /** Mirrors ProductionReportReconciliationService.recomputeLevelRollup —
   *  duplicated for the same reason (avoids a circular module dependency;
   *  see that service's own comment). Kept intentionally in lockstep with
   *  it; if one changes, check the other. */
  private async recomputeLevelRollup(levelId: string, userId: string) {
    const cageAssignments = await this.prisma.brooderCageAssignment.findMany({ where: { cage: { levelId } } });
    if (cageAssignments.length === 0) {
      await this.prisma.brooderLevelAssignment.deleteMany({ where: { levelId } });
      return;
    }
    const birdCount = cageAssignments.reduce((s, a) => s + a.birdCount, 0);
    const batchId = cageAssignments[0].batchId;
    const placedDate = cageAssignments.map(a => a.placedDate).reduce((min, d) => (d < min ? d : min));
    await this.prisma.brooderLevelAssignment.upsert({
      where: { levelId },
      create: { levelId, batchId, birdCount, placedDate, notes: 'Auto-maintained rollup of this level\'s cage assignments.', assignedById: userId },
      update: { batchId, birdCount, placedDate, assignedById: userId },
    });
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Loose "is this still basically the row we created/updated" check — only
 *  compares the fields present on `expected`, so it tolerates unrelated
 *  columns (updatedAt, computed fields) drifting without blocking rollback,
 *  while still catching the case that matters: someone changed the actual
 *  values this report set. */
function statesRoughlyMatch(actual: any, expected: any): boolean {
  if (!expected || typeof expected !== 'object') return true;
  for (const key of Object.keys(expected)) {
    if (key === 'id' || key === 'createdAt' || key === 'updatedAt') continue;
    const a = actual?.[key];
    const e = (expected as any)[key];
    const an = typeof a === 'number' || (a && a.toString && !isNaN(Number(a))) ? Number(a) : a;
    const en = typeof e === 'number' || (e && e.toString && !isNaN(Number(e))) ? Number(e) : e;
    if (JSON.stringify(an) !== JSON.stringify(en)) return false;
  }
  return true;
}
