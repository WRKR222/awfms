// src/modules/store/production-report-reconciliation.service.ts
// The core "verification layer" logic: for every parsed report row, compare
// each field against whatever the system already has recorded for that
// batch + date, and decide what happens to it:
//
//   • nothing recorded yet     -> APPLY immediately (autofill)
//   • recorded and it matches  -> no-op
//   • recorded and it conflicts -> hold back, record a discrepancy
//
// IMPORTANT — this service only ever RECORDS, never ISSUES. Feed, vaccines,
// supplements, treatments, and any other store item a report shows as
// "used" are only auto-filled into the daily logs up to whatever has
// ALREADY been issued out of the store to this batch (to the PM or an
// Attendant) and not yet logged as used anywhere — i.e. it closes a data
// gap between "stock left the store" and "someone logged what happened to
// it", it never triggers a new stock-out on its own. If the report claims
// more was used than has ever been issued, that's a discrepancy for Store
// to resolve by actually issuing the difference (through the normal
// Store Inventory flow) or for the Director to knowingly approve.
//
// STAGE-AWARE (§5): a batch in BROODING (or GROWER, which shares the same
// brooder-style daily record sheet until the batch reaches PRODUCTION)
// writes to the brooder tables below; a batch in PRODUCTION writes into
// EggCollectionSession instead, since that's what "the daily record" means
// once birds are laying.
//
// CAGE REASSIGNMENT: a report can also carry per-cage (row/level/cage)
// headcount rows — these are used to keep BrooderCageAssignment (the
// brooder cage map) in sync with what was actually counted on the floor.
// A cage with no assignment yet gets one created; a cage already assigned
// to the SAME batch gets its count corrected; a cage that the map shows as
// belonging to a DIFFERENT batch is never silently reassigned — that always
// needs the Director's sign-off.
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  FeedType, ProductionReportDiscrepancyType, StoreItem, BatchStage,
} from '@prisma/client';
import { ParsedReportRow, ParsedHealthUsage } from './production-report.dto';
import { convertToUnit } from '../../common/units/unit-conversion.util';

export interface ReconcileOutcome {
  rows: ParsedReportRow[];
  discrepancies: {
    rowDate: string;
    field: string;
    discrepancyType: ProductionReportDiscrepancyType;
    locationRef: string | null;
    systemValue: string | null;
    reportValue: string | null;
    notes?: string;
  }[];
  autofillCount: number;
  matchedCount: number;
  stage: 'BROODING' | 'PRODUCTION' | 'OTHER';
}

function normaliseText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Best-effort mapping onto the FeedType enum, which is a required column on
 *  BrooderGeneralFeedLog but currently has no separate "crumb" stage. Prefers
 *  the name of the matched StoreItem (the actual feed present in stores) over
 *  the report's own free-text label, per the rule that feed must always be
 *  reconciled against what stores actually carries. */
function mapFeedType(storeItemName: string | undefined, reportText: string | undefined): FeedType {
  const t = (storeItemName ?? reportText ?? '').toLowerCase();
  if (t.includes('grower')) return FeedType.GROWER_MASH;
  if (t.includes('layer')) return FeedType.LAYER_MASH;
  if (t.includes('kienyeji') && t.includes('grow')) return FeedType.KIENYEJI_GROWER;
  if (t.includes('kienyeji') && t.includes('finish')) return FeedType.KIENYEJI_FINISHER;
  if (t.includes('kienyeji')) return FeedType.KIENYEJI_STARTER;
  // chick mash / chick crumb / chick start all land here — FeedType has no
  // separate "crumb" stage yet.
  return FeedType.CHICK_MASH;
}

/** Generic free-text -> StoreItem matcher: exact match wins outright,
 *  otherwise the longest substring overlap among the candidate list wins.
 *  Used for feed AND (§3) for vaccines/supplements/treatments — same
 *  algorithm, just parameterised by which candidate set to search. */
function matchInventoryItem(reportText: string | undefined, candidates: StoreItem[]): StoreItem | null {
  if (!reportText) return null;
  const norm = normaliseText(reportText);
  if (!norm) return null;
  let best: StoreItem | null = null;
  let bestScore = 0;
  for (const item of candidates) {
    const itemNorm = normaliseText(item.name);
    if (itemNorm === norm) return item; // exact match wins outright
    if (norm.includes(itemNorm) || itemNorm.includes(norm)) {
      const score = Math.min(itemNorm.length, norm.length);
      if (score > bestScore) { bestScore = score; best = item; }
    }
  }
  return best;
}

/** Pulls the leading numeric quantity + trailing unit text out of free text
 *  like "6bags", "2 bags", "39.2mls", "Amprolium 10ml" — mirrors the parser's
 *  extractQuantity() but lives here too since health-usage text isn't run
 *  through the parser's item-column path (it's matched here, not there). */
function extractQuantity(raw: string | undefined): { qty: number; unit?: string } | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const m = text.match(/(\d+(?:\.\d+)?)\s*([a-zA-Z%]*)/);
  if (!m) return null;
  const qty = parseFloat(m[1]);
  if (!Number.isFinite(qty)) return null;
  return { qty, unit: m[2] || undefined };
}

@Injectable()
export class ProductionReportReconciliationService {
  private readonly logger = new Logger(ProductionReportReconciliationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Run the full cross-check + autofill pass over every parsed row for a
   *  batch. Mutates the real brooder/production/cage-map tables for anything
   *  that can be safely auto-applied; returns the annotated rows + open
   *  discrepancies. Never issues store stock — see the header note above. */
  async reconcile(batchId: string, rows: ParsedReportRow[], uploaderId: string, fileName: string): Promise<ReconcileOutcome> {
    const discrepancies: ReconcileOutcome['discrepancies'] = [];
    let autofillCount = 0;
    let matchedCount = 0;
    const noteSuffix = `(from store production report "${fileName}")`;

    // ── Stage detection (§5) ────────────────────────────────────────────────
    const batch = await this.prisma.batch.findUnique({
      where: { id: batchId },
      select: { batchCode: true, stage: true, houseId: true, currentBirdCount: true },
    });
    if (!batch) throw new BadRequestException('Batch not found');
    const isProduction = batch.stage === BatchStage.PRODUCTION;
    // BROODING and GROWER both use the brooder-style daily record sheet —
    // only PRODUCTION (birds laying) switches the write target to
    // EggCollectionSession. SOLD/DISCARDED/CLOSED batches shouldn't normally
    // have reports uploaded against them, but are treated as "brooder-style"
    // (a no-op write path, since those tables just won't be queried again)
    // rather than crashing the upload.
    const stageBucket: ReconcileOutcome['stage'] = isProduction ? 'PRODUCTION' : (batch.stage === BatchStage.BROODING || batch.stage === BatchStage.GROWER ? 'BROODING' : 'OTHER');

    // Preload store items referenced by any row so we can label + reconcile them.
    const itemIds = new Set<string>();
    for (const r of rows) for (const it of r.itemsIssued) itemIds.add(it.storeItemId);
    const storeItems = itemIds.size
      ? await this.prisma.storeItem.findMany({ where: { id: { in: [...itemIds] } } })
      : [];
    const storeItemMap = new Map(storeItems.map(si => [si.id, si]));

    // Feed/vaccine/supplement/treatment must always be reconciled against
    // what's actually present in stores, never against a guessed label alone
    // — preload every relevant active StoreItem once (§3).
    const feedItems = await this.prisma.storeItem.findMany({ where: { category: 'FEED', isActive: true } });
    const vaccineItems = await this.prisma.storeItem.findMany({ where: { category: 'MEDICATION', isActive: true } });
    const supplementItems = await this.prisma.storeItem.findMany({
      where: { category: { in: ['SUPPLEMENT', 'FEED_SUPPLEMENT'] }, isActive: true },
    });
    const treatmentItems = vaccineItems; // treatments also live under MEDICATION per spec §3

    for (const row of rows) {
      const logDate = new Date(row.date);
      const isCageRow = stageBucket === 'BROODING' && row.cageNumber != null;

      // ── Mortality ────────────────────────────────────────────────────────
      if (row.mortality !== undefined) {
        await this.reconcileMortality(row, batchId, logDate, uploaderId, noteSuffix, stageBucket, batch.houseId, discrepancies, () => { autofillCount++; }, () => { matchedCount++; });
      }

      // ── Feed ─────────────────────────────────────────────────────────────
      if (row.feedKg !== undefined) {
        await this.reconcileFeed(row, batchId, logDate, uploaderId, noteSuffix, stageBucket, batch, feedItems, discrepancies, () => { autofillCount++; }, () => { matchedCount++; });
      }

      // ── Opening/closing stock — whole-batch rows only. Per-cage rows with
      // opening/closing counts are cage-map data (below), not a whole-brooder
      // BrooderStockCount entry (which is one row per DAY, not per cage). ──
      if (stageBucket === 'BROODING' && !isCageRow && row.openingStock !== undefined && row.closingStock !== undefined) {
        await this.reconcileStockCount(row, batchId, logDate, uploaderId, noteSuffix, discrepancies, () => { autofillCount++; }, () => { matchedCount++; });
      }

      // ── Cage reassignment / recount — per-cage rows only ────────────────
      if (isCageRow && (row.closingStock !== undefined || row.openingStock !== undefined)) {
        await this.reconcileCageAssignment(row, batchId, batch, logDate, uploaderId, noteSuffix, discrepancies, () => { autofillCount++; }, () => { matchedCount++; });
      }

      // ── Vaccines / supplements / treatments (§3) ────────────────────────
      await this.reconcileHealthUsages(
        row, batchId, logDate, uploaderId, noteSuffix, stageBucket, batch,
        vaccineItems, supplementItems, treatmentItems, discrepancies,
        () => { autofillCount++; }, () => { matchedCount++; },
      );

      // ── Generic items issued (e.g. charcoal bags used) ──────────────────
      for (const usage of row.itemsIssued) {
        const item = storeItemMap.get(usage.storeItemId);
        if (!item) continue;
        usage.storeItemName = item.name;
        await this.reconcileItemUsage(row, item, usage.quantity, usage.unit, usage.rawText, batchId, logDate, discrepancies,
          (res) => { usage.resolution = res; if (res === 'AUTOFILLED') autofillCount++; else if (res === 'MATCHED') matchedCount++; });
      }
    }

    return { rows, discrepancies, autofillCount, matchedCount, stage: stageBucket };
  }

  // ── Mortality ────────────────────────────────────────────────────────────
  private async reconcileMortality(
    row: ParsedReportRow, batchId: string, logDate: Date, uploaderId: string, noteSuffix: string,
    stageBucket: 'BROODING' | 'PRODUCTION' | 'OTHER', houseId: string,
    discrepancies: ReconcileOutcome['discrepancies'], onAutofill: () => void, onMatch: () => void,
  ) {
    if (stageBucket === 'PRODUCTION') {
      const existing = await this.prisma.eggCollectionSession.findUnique({
        where: { batchId_houseId_sessionDate_shift: { batchId, houseId, sessionDate: logDate, shift: 'AM' } },
      });
      if (!existing) {
        // No session recorded yet for this date — can't create a full
        // EggCollectionSession from a production report alone (it requires
        // egg-count fields this report doesn't carry), so this always needs
        // manual reconciliation for a production-stage batch until an
        // attendant has logged the base session.
        row.resolution.mortality = 'DISCREPANCY';
        discrepancies.push({
          rowDate: row.date, field: 'mortality', discrepancyType: ProductionReportDiscrepancyType.MORTALITY,
          locationRef: row.locationRef, systemValue: null, reportValue: String(row.mortality),
          notes: 'No egg-collection session exists yet for this date — mortality can\'t be auto-filled into a session that hasn\'t been created by an attendant.',
        });
        return;
      }
      if (existing.mortalities === row.mortality) {
        row.resolution.mortality = 'MATCHED';
        onMatch();
      } else if (existing.mortalities === 0) {
        await this.prisma.eggCollectionSession.update({ where: { id: existing.id }, data: { mortalities: row.mortality! } });
        row.resolution.mortality = 'AUTOFILLED';
        onAutofill();
      } else {
        row.resolution.mortality = 'DISCREPANCY';
        discrepancies.push({
          rowDate: row.date, field: 'mortality', discrepancyType: ProductionReportDiscrepancyType.MORTALITY,
          locationRef: row.locationRef, systemValue: String(existing.mortalities), reportValue: String(row.mortality),
        });
      }
      return;
    }

    const existing = await this.prisma.brooderGeneralMortalityLog.findMany({ where: { batchId, logDate } });
    if (existing.length === 0) {
      if (row.mortality! > 0) {
        await this.prisma.brooderGeneralMortalityLog.create({
          data: {
            batchId, logDate, mortalityCount: row.mortality!, cullingCount: row.culling ?? 0,
            notes: `Auto-filled ${noteSuffix}`, loggedById: uploaderId,
          },
        });
        row.resolution.mortality = 'AUTOFILLED';
        onAutofill();
      } else {
        row.resolution.mortality = 'MATCHED';
        onMatch();
      }
    } else {
      const systemTotal = existing.reduce((s, e) => s + e.mortalityCount, 0);
      if (systemTotal === row.mortality) {
        row.resolution.mortality = 'MATCHED';
        onMatch();
      } else {
        row.resolution.mortality = 'DISCREPANCY';
        discrepancies.push({
          rowDate: row.date, field: 'mortality', discrepancyType: ProductionReportDiscrepancyType.MORTALITY,
          locationRef: row.locationRef, systemValue: String(systemTotal), reportValue: String(row.mortality),
        });
      }
    }
  }

  // ── Feed ─────────────────────────────────────────────────────────────────
  private async reconcileFeed(
    row: ParsedReportRow, batchId: string, logDate: Date, uploaderId: string, noteSuffix: string,
    stageBucket: 'BROODING' | 'PRODUCTION' | 'OTHER',
    batch: { batchCode: string; houseId: string },
    feedItems: StoreItem[], discrepancies: ReconcileOutcome['discrepancies'], onAutofill: () => void, onMatch: () => void,
  ) {
    const matchedFeedItem = matchInventoryItem(row.feedType, feedItems);

    if (stageBucket === 'PRODUCTION') {
      const existing = await this.prisma.eggCollectionSession.findUnique({
        where: { batchId_houseId_sessionDate_shift: { batchId, houseId: batch.houseId, sessionDate: logDate, shift: 'AM' } },
      });
      if (!existing) {
        row.resolution.feedKg = 'DISCREPANCY';
        discrepancies.push({
          rowDate: row.date, field: 'feedKg', discrepancyType: ProductionReportDiscrepancyType.FEED,
          locationRef: row.locationRef, systemValue: null, reportValue: `${row.feedKg} kg`,
          notes: 'No egg-collection session exists yet for this date.',
        });
        return;
      }
      const systemFeed = existing.feedKg != null ? Number(existing.feedKg) : null;
      if (systemFeed != null && Math.abs(systemFeed - row.feedKg!) < 0.01) {
        row.resolution.feedKg = 'MATCHED';
        onMatch();
        return;
      }
      if (systemFeed == null || systemFeed === 0) {
        if (matchedFeedItem) {
          await this.recordUsageAgainstHeldBalance(row, matchedFeedItem, row.feedKg!, undefined, `${row.feedKg} kg feed`, batchId, logDate, discrepancies);
        } else {
          this.pushUnmatchedFeedDiscrepancy(row, discrepancies);
        }
        await this.prisma.eggCollectionSession.update({
          where: { id: existing.id },
          data: { feedKg: row.feedKg, feedTypeName: matchedFeedItem?.name ?? row.feedType ?? existing.feedTypeName },
        });
        row.resolution.feedKg = 'AUTOFILLED';
        onAutofill();
        return;
      }
      row.resolution.feedKg = 'DISCREPANCY';
      discrepancies.push({
        rowDate: row.date, field: 'feedKg', discrepancyType: ProductionReportDiscrepancyType.FEED,
        locationRef: row.locationRef, systemValue: `${systemFeed} kg`, reportValue: `${row.feedKg} kg`,
      });
      return;
    }

    // ── Brooder/grower stage (unchanged from the original MVP logic) ──────
    const existing = await this.prisma.brooderGeneralFeedLog.findMany({ where: { batchId, entryDate: logDate } });
    if (existing.length === 0) {
      if (row.feedKg! > 0) {
        if (!matchedFeedItem) this.pushUnmatchedFeedDiscrepancy(row, discrepancies);
        else await this.recordUsageAgainstHeldBalance(row, matchedFeedItem, row.feedKg!, undefined, `${row.feedKg} kg feed`, batchId, logDate, discrepancies);
        await this.prisma.brooderGeneralFeedLog.create({
          data: {
            batchId, entryDate: logDate,
            feedType: mapFeedType(matchedFeedItem?.name, row.feedType),
            storeItemId: matchedFeedItem?.id, unit: matchedFeedItem?.unit,
            quantityDispensedKg: row.feedKg!,
            notes: [`Auto-filled ${noteSuffix}`, row.feedType ? `sheet feed type: "${row.feedType}"` : null].filter(Boolean).join(' — '),
            loggedById: uploaderId,
          },
        });
        row.resolution.feedKg = 'AUTOFILLED';
        onAutofill();
      } else {
        row.resolution.feedKg = 'MATCHED';
        onMatch();
      }
    } else {
      const systemTotal = existing.reduce((s, e) => s + e.quantityDispensedKg, 0);
      if (Math.abs(systemTotal - row.feedKg!) < 0.01) {
        row.resolution.feedKg = 'MATCHED';
        onMatch();
      } else {
        row.resolution.feedKg = 'DISCREPANCY';
        discrepancies.push({
          rowDate: row.date, field: 'feedKg', discrepancyType: ProductionReportDiscrepancyType.FEED,
          locationRef: row.locationRef, systemValue: `${systemTotal} kg`, reportValue: `${row.feedKg} kg`,
        });
      }
    }
  }

  private pushUnmatchedFeedDiscrepancy(row: ParsedReportRow, discrepancies: ReconcileOutcome['discrepancies']) {
    discrepancies.push({
      rowDate: row.date, field: 'feedType', discrepancyType: ProductionReportDiscrepancyType.FEED,
      locationRef: row.locationRef, systemValue: null, reportValue: row.feedType ?? null,
      notes: 'Could not match this feed type to any store item — add/rename the store item or fix the sheet.',
    });
  }

  // ── Opening/closing stock (whole-batch) ─────────────────────────────────
  private async reconcileStockCount(
    row: ParsedReportRow, batchId: string, logDate: Date, uploaderId: string, noteSuffix: string,
    discrepancies: ReconcileOutcome['discrepancies'], onAutofill: () => void, onMatch: () => void,
  ) {
    const existing = await this.prisma.brooderStockCount.findUnique({ where: { batchId_logDate: { batchId, logDate } } });
    if (!existing) {
      await this.prisma.brooderStockCount.create({
        data: {
          batchId, logDate,
          openingStock: row.openingStock!, closingStock: row.closingStock!,
          mortalityCount: row.mortality ?? 0, cullingCount: row.culling ?? 0,
          notes: `Auto-filled ${noteSuffix}`, loggedById: uploaderId,
        },
      });
      row.resolution.stockCount = 'AUTOFILLED';
      onAutofill();
    } else if (existing.openingStock === row.openingStock && existing.closingStock === row.closingStock) {
      row.resolution.stockCount = 'MATCHED';
      onMatch();
    } else {
      row.resolution.stockCount = 'DISCREPANCY';
      discrepancies.push({
        rowDate: row.date, field: 'stockCount', discrepancyType: ProductionReportDiscrepancyType.STOCK_COUNT,
        locationRef: row.locationRef,
        systemValue: `O:${existing.openingStock} / C:${existing.closingStock}`,
        reportValue: `O:${row.openingStock} / C:${row.closingStock}`,
      });
    }
  }

  // ── Cage reassignment / recount (per-cage rows) ─────────────────────────
  /** Keeps BrooderCageAssignment (the cage map) in sync with a report's
   *  per-cage headcount. Reuses the same match/autofill/discrepancy pattern
   *  as everything else here, plus the two safety invariants the brooder
   *  module's own cage-assignment code enforces: a level's cages must all
   *  belong to one batch, and a batch can't be assigned more birds across
   *  its cages than it currently has alive. A cage the map shows as
   *  belonging to a DIFFERENT batch is never silently reassigned. */
  private async reconcileCageAssignment(
    row: ParsedReportRow, batchId: string, batch: { batchCode: string; currentBirdCount: number },
    logDate: Date, uploaderId: string, noteSuffix: string,
    discrepancies: ReconcileOutcome['discrepancies'], onAutofill: () => void, onMatch: () => void,
  ) {
    const reportCount = row.closingStock ?? row.openingStock!;
    const cageLabel = row.locationRef ?? `Row ${row.rowNumber ?? '?'} / Level ${row.levelNumber ?? '?'} / Cage ${row.cageNumber}`;

    if (row.rowNumber == null || row.levelNumber == null || row.cageNumber == null) {
      row.resolution.cageAssignment = 'DISCREPANCY';
      discrepancies.push({
        rowDate: row.date, field: 'cageAssignment', discrepancyType: ProductionReportDiscrepancyType.CAGE_REASSIGNMENT,
        locationRef: row.locationRef, systemValue: null, reportValue: String(reportCount),
        notes: `Row, Level, and Cage must all be present to resolve a specific cage (got: ${cageLabel}).`,
      });
      return;
    }

    const brooderRow = await this.prisma.brooderRow.findUnique({ where: { rowNumber: row.rowNumber } });
    if (!brooderRow) return this.pushCageLookupFailure(row, cageLabel, reportCount, `Row ${row.rowNumber} not found in the cage map.`, discrepancies);

    const level = await this.prisma.brooderLevel.findUnique({ where: { rowId_levelNumber: { rowId: brooderRow.id, levelNumber: row.levelNumber } } });
    if (!level) return this.pushCageLookupFailure(row, cageLabel, reportCount, `Level ${row.levelNumber} not found under Row ${row.rowNumber}.`, discrepancies);

    const cage = await this.prisma.brooderCage.findUnique({ where: { levelId_cageNumber: { levelId: level.id, cageNumber: row.cageNumber } } });
    if (!cage) return this.pushCageLookupFailure(row, cageLabel, reportCount, `Cage ${row.cageNumber} not found under Row ${row.rowNumber} / Level ${row.levelNumber}.`, discrepancies);

    const existing = await this.prisma.brooderCageAssignment.findUnique({ where: { cageId: cage.id } });

    if (existing && existing.batchId !== batchId) {
      row.resolution.cageAssignment = 'DISCREPANCY';
      const otherBatch = await this.prisma.batch.findUnique({ where: { id: existing.batchId }, select: { batchCode: true } });
      discrepancies.push({
        rowDate: row.date, field: 'cageAssignment', discrepancyType: ProductionReportDiscrepancyType.CAGE_REASSIGNMENT,
        locationRef: cageLabel, systemValue: `${otherBatch?.batchCode ?? existing.batchId}: ${existing.birdCount}`,
        reportValue: `${batch.batchCode}: ${reportCount}`,
        notes: 'This cage is currently mapped to a different batch — needs the Director to confirm the handover before it can be reassigned.',
      });
      return;
    }

    if (existing && existing.birdCount === reportCount) {
      row.resolution.cageAssignment = 'MATCHED';
      onMatch();
      return;
    }

    // A level's cages must all belong to one batch (feed-schedule assumption
    // shared with the brooder module's own assignCage()).
    const otherBatchInLevel = await this.prisma.brooderCageAssignment.findFirst({
      where: { batchId: { not: batchId }, cage: { levelId: level.id, id: { not: cage.id } } },
    });
    if (otherBatchInLevel) {
      row.resolution.cageAssignment = 'DISCREPANCY';
      discrepancies.push({
        rowDate: row.date, field: 'cageAssignment', discrepancyType: ProductionReportDiscrepancyType.CAGE_REASSIGNMENT,
        locationRef: cageLabel, systemValue: 'level holds a different batch', reportValue: `${batch.batchCode}: ${reportCount}`,
        notes: `Level ${row.levelNumber} already has cages assigned to a different batch — all cages on one level must hold the same batch.`,
      });
      return;
    }

    // Overflow guard — same rule assignCage() enforces: a batch's cages
    // can't sum to more birds than it currently has alive.
    const siblingsTotal = await this.prisma.brooderCageAssignment.aggregate({
      where: { batchId, cageId: { not: cage.id } },
      _sum: { birdCount: true },
    });
    const newTotal = Number(siblingsTotal._sum.birdCount ?? 0) + reportCount;
    if (newTotal > batch.currentBirdCount) {
      row.resolution.cageAssignment = 'DISCREPANCY';
      discrepancies.push({
        rowDate: row.date, field: 'cageAssignment', discrepancyType: ProductionReportDiscrepancyType.CAGE_REASSIGNMENT,
        locationRef: cageLabel, systemValue: existing ? String(existing.birdCount) : '(unassigned)', reportValue: String(reportCount),
        notes: `Would bring this batch's cage total to ${newTotal}, but it only has ${batch.currentBirdCount} live birds.`,
      });
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.brooderCageAssignment.upsert({
        where: { cageId: cage.id },
        create: {
          cageId: cage.id, batchId, birdCount: reportCount, placedDate: logDate,
          notes: `Auto-filled ${noteSuffix}`, assignedById: uploaderId,
        },
        update: { batchId, birdCount: reportCount, assignedById: uploaderId },
      });
      await this.recomputeLevelRollup(tx, level.id, uploaderId);
    });
    row.resolution.cageAssignment = 'AUTOFILLED';
    onAutofill();
  }

  private pushCageLookupFailure(
    row: ParsedReportRow, cageLabel: string, reportCount: number, note: string,
    discrepancies: ReconcileOutcome['discrepancies'],
  ) {
    row.resolution.cageAssignment = 'DISCREPANCY';
    discrepancies.push({
      rowDate: row.date, field: 'cageAssignment', discrepancyType: ProductionReportDiscrepancyType.CAGE_REASSIGNMENT,
      locationRef: cageLabel, systemValue: null, reportValue: String(reportCount), notes: note,
    });
  }

  /** Recompute a level's aggregate BrooderLevelAssignment from its cages —
   *  mirrors BrooderService's own recomputeLevelRollup exactly, duplicated
   *  here (rather than injected) to avoid a circular module dependency
   *  (BrooderModule already imports StoreModule). Call inside the same
   *  transaction as any cage-assignment write. */
  private async recomputeLevelRollup(tx: any, levelId: string, userId: string) {
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

  // ── Vaccines / supplements / treatments (§3) ────────────────────────────
  private async reconcileHealthUsages(
    row: ParsedReportRow, batchId: string, logDate: Date, uploaderId: string, noteSuffix: string,
    stageBucket: 'BROODING' | 'PRODUCTION' | 'OTHER',
    batch: { batchCode: string; houseId: string },
    vaccineItems: StoreItem[], supplementItems: StoreItem[], treatmentItems: StoreItem[],
    discrepancies: ReconcileOutcome['discrepancies'], onAutofill: () => void, onMatch: () => void,
  ) {
    type Candidate = { kind: ParsedHealthUsage['kind']; text: string | undefined; pool: StoreItem[] };
    const candidates: Candidate[] = [];
    if (row.vaccineText) candidates.push({ kind: 'vaccine', text: row.vaccineText, pool: vaccineItems });
    if (row.supplementText) candidates.push({ kind: 'supplement', text: row.supplementText, pool: supplementItems });
    if (row.treatmentText) candidates.push({ kind: 'treatment', text: row.treatmentText, pool: treatmentItems });
    // Blended fallback column: try it against all three pools and keep
    // whichever kind actually matches, per §3's "let matching sort out which
    // items to try".
    if (row.drugsVaccines && !row.vaccineText && !row.supplementText && !row.treatmentText) {
      const allPools: [ParsedHealthUsage['kind'], StoreItem[]][] = [
        ['vaccine', vaccineItems], ['supplement', supplementItems], ['treatment', treatmentItems],
      ];
      let bestKind: ParsedHealthUsage['kind'] = 'treatment';
      let bestItem: StoreItem | null = null;
      for (const [kind, pool] of allPools) {
        const m = matchInventoryItem(row.drugsVaccines, pool);
        if (m) { bestItem = m; bestKind = kind; break; }
      }
      candidates.push({ kind: bestKind, text: row.drugsVaccines, pool: bestItem ? [bestItem] : [...vaccineItems, ...supplementItems, ...treatmentItems] });
    }

    for (const c of candidates) {
      const matched = matchInventoryItem(c.text, c.pool);
      const qty = extractQuantity(c.text);
      const usage: ParsedHealthUsage = {
        kind: c.kind, rawText: c.text!, storeItemId: matched?.id ?? null, storeItemName: matched?.name ?? null,
        quantity: qty?.qty, unit: qty?.unit, resolution: 'MATCHED',
      };
      row.healthUsages.push(usage);

      if (!matched) {
        usage.resolution = 'DISCREPANCY';
        discrepancies.push({
          rowDate: row.date, field: c.kind, discrepancyType: ProductionReportDiscrepancyType.ITEM_ISSUANCE,
          locationRef: row.locationRef, systemValue: null, reportValue: c.text ?? null,
          notes: `Could not match this ${c.kind} to any store item — add/rename the store item or fix the sheet.`,
        });
        continue;
      }
      if (!qty) {
        // Text present (e.g. "Newcastle vaccine given") but no parseable
        // quantity — still worth recording the event, just with no stock
        // impact. Not a discrepancy: nothing was expected to be deducted.
        usage.resolution = 'MATCHED';
        onMatch();
        await this.writeHealthUsageLog(stageBucket, batchId, logDate, uploaderId, batch.houseId, c.kind, matched, usage, noteSuffix);
        continue;
      }

      await this.recordUsageAgainstHeldBalance(
        row, matched, qty.qty, qty.unit, c.text!, batchId, logDate, discrepancies,
        (res) => { usage.resolution = res; if (res === 'AUTOFILLED') onAutofill(); else if (res === 'MATCHED') onMatch(); },
      );
      // The event itself (what was given, and roughly how much) is always
      // worth recording even when the quantity side is short — same
      // "always log what happened, only the stock side is conditional"
      // philosophy the feed path uses.
      await this.writeHealthUsageLog(stageBucket, batchId, logDate, uploaderId, batch.houseId, c.kind, matched, usage, noteSuffix);
    }
  }

  /** Persists one matched vaccine/supplement/treatment usage into the
   *  stage-appropriate log. Brooder: BrooderTreatmentLog for treatments,
   *  BrooderLog.vaccinesJson/supplementsJson (once-daily entry) for
   *  vaccines/supplements. Production: EggCollectionSession.vaccineGiven —
   *  the only health-adjacent column that model currently has (see §5: a
   *  dedicated ProductionHealthLog is a bigger schema change, deferred). */
  private async writeHealthUsageLog(
    stageBucket: 'BROODING' | 'PRODUCTION' | 'OTHER', batchId: string, logDate: Date, uploaderId: string, houseId: string,
    kind: ParsedHealthUsage['kind'], item: StoreItem, usage: ParsedHealthUsage, noteSuffix: string,
  ) {
    if (stageBucket === 'PRODUCTION') {
      const existing = await this.prisma.eggCollectionSession.findUnique({
        where: { batchId_houseId_sessionDate_shift: { batchId, houseId, sessionDate: logDate, shift: 'AM' } },
      });
      if (!existing) return; // nothing to attach to — already flagged as a mortality/feed discrepancy for this date if relevant
      const line = `${item.name}${usage.quantity ? ` (${usage.quantity}${usage.unit ?? item.unit})` : ''} ${noteSuffix}`;
      await this.prisma.eggCollectionSession.update({
        where: { id: existing.id },
        data: { vaccineGiven: existing.vaccineGiven ? `${existing.vaccineGiven}; ${line}` : line },
      });
      return;
    }

    if (kind === 'treatment') {
      await this.prisma.brooderTreatmentLog.create({
        data: {
          batchId, treatmentDate: logDate, drugName: item.name, storeItemId: item.id,
          dose: usage.quantity ? `${usage.quantity}${usage.unit ?? item.unit}` : usage.rawText,
          doseUnit: usage.unit ?? item.unit, quantityUsed: usage.quantity, quantityUsedUnit: item.unit,
          notes: `Auto-filled ${noteSuffix}`, loggedById: uploaderId,
        },
      });
      return;
    }

    // vaccine / supplement — append to the once-daily BrooderLog row
    // (logSession: null), creating it if this is the first daily entry.
    const entry = {
      name: item.name, dose: usage.quantity ? `${usage.quantity}${usage.unit ?? item.unit}` : usage.rawText,
      storeItemId: item.id, quantityUsed: usage.quantity, unit: item.unit,
    };
    const existing = await this.prisma.brooderLog.findFirst({ where: { batchId, logDate, logSession: null } });
    if (existing) {
      const key = kind === 'vaccine' ? 'vaccinesJson' : 'supplementsJson';
      const current = Array.isArray((existing as any)[key]) ? (existing as any)[key] : [];
      await this.prisma.brooderLog.update({
        where: { id: existing.id },
        data: { [key]: [...current, entry] } as any,
      });
    } else {
      await this.prisma.brooderLog.create({
        data: {
          batchId, logDate, logSession: null,
          vaccinesJson: kind === 'vaccine' ? [entry] : undefined,
          supplementsJson: kind === 'supplement' ? [entry] : undefined,
          notes: `Auto-filled ${noteSuffix}`, loggedById: uploaderId,
        } as any,
      });
    }
  }

  // ── Generic bulk-item quantity reconciliation ───────────────────────────
  /** Reconciles "the report says N of item X was used" for the charcoal-
   *  style items-issued loop — every item goes through the same
   *  held-balance-only recording as feed and health usages.
   *
   *  NOTE — scope limitation: unlike feed/vaccines/supplements/treatments,
   *  generic items (e.g. charcoal, cleaning supplies) have no dedicated
   *  per-batch usage-log table in this schema to write an AUTOFILLED result
   *  into (BrooderHeatLog tracks charcoal, but per ROW+day, not per batch,
   *  and isn't a safe generic target for arbitrary OTHER-category items).
   *  Their resolved outcome is still captured durably in the report's own
   *  rawRows (what StoreProductionReport persists and /export reads from) —
   *  just not projected into a second operational table the way feed and
   *  health usages are. Extending this to write BrooderHeatLog specifically
   *  for charcoal would be a reasonable follow-up if that's the main
   *  generic-item case in practice. */
  private async reconcileItemUsage(
    row: ParsedReportRow, item: StoreItem, reportQty: number, reportUnit: string | undefined, rawText: string,
    batchId: string, logDate: Date,
    discrepancies: ReconcileOutcome['discrepancies'], setResolution: (r: 'MATCHED' | 'AUTOFILLED' | 'DISCREPANCY') => void,
  ) {
    await this.recordUsageAgainstHeldBalance(row, item, reportQty, reportUnit, rawText, batchId, logDate, discrepancies, setResolution);
  }

  /** The core "record only, never issue" decision (§4 unit conversion + held
   *  balance), shared by feed, the generic items-issued loop, and the
   *  vaccine/supplement/treatment loop.
   *
   *  Held balance = everything ever issued to this batch (StoreStockOut,
   *  which in this codebase is how stock reaches either the PM or an
   *  Attendant — there's no separate structured "recipient role" field to
   *  split on) minus everything already logged as used against this item
   *  for this batch. If the report's usage fits within that balance, it's
   *  recorded — purely closing the gap between "issued" and "logged", no
   *  new stock-out. If it doesn't fit, nothing is auto-applied: the
   *  shortfall is flagged so Store can issue it (or the Director can
   *  knowingly approve trusting the report). */
  private async recordUsageAgainstHeldBalance(
    row: ParsedReportRow, item: StoreItem, reportQty: number, reportUnit: string | undefined, rawText: string,
    batchId: string, logDate: Date,
    discrepancies: ReconcileOutcome['discrepancies'], setResolution?: (r: 'MATCHED' | 'AUTOFILLED' | 'DISCREPANCY') => void,
  ): Promise<string> {
    const resolve = setResolution ?? (() => {});

    // §4 — convert the report's unit to the item's stock unit before
    // comparing anything. Never guess across incompatible units.
    let neededQty = reportQty;
    if (reportUnit && reportUnit.toLowerCase() !== item.unit.toLowerCase()) {
      const converted = convertToUnit(reportQty, reportUnit, item.unit);
      if (converted === null) {
        resolve('DISCREPANCY');
        discrepancies.push({
          rowDate: row.date, field: `item:${item.name}`, discrepancyType: ProductionReportDiscrepancyType.ITEM_ISSUANCE,
          locationRef: row.locationRef, systemValue: null, reportValue: `${reportQty} ${reportUnit}`,
          notes: `Unit "${reportUnit}" on the report could not be reconciled against stock unit "${item.unit}" — needs manual conversion.`,
        });
        return 'Unit mismatch — needs manual conversion.';
      }
      neededQty = converted;
    }

    // Has this exact (item, batch, date) already been logged as used
    // elsewhere (e.g. an attendant already recorded it)? If so, this is a
    // plain match/mismatch check, not a held-balance question.
    const alreadyLoggedToday = await this.sumTodaysLoggedUsage(item.id, batchId, logDate);
    if (alreadyLoggedToday > 0) {
      if (Math.abs(alreadyLoggedToday - neededQty) < 0.001) { resolve('MATCHED'); return ''; }
      resolve('DISCREPANCY');
      discrepancies.push({
        rowDate: row.date, field: `item:${item.name}`, discrepancyType: ProductionReportDiscrepancyType.ITEM_ISSUANCE,
        locationRef: row.locationRef, systemValue: `${alreadyLoggedToday} ${item.unit}`, reportValue: `${reportQty} ${reportUnit ?? item.unit}`,
      });
      return '';
    }

    const heldBalance = await this.computeHeldBalance(item.id, batchId);
    if (heldBalance >= neededQty) {
      resolve('AUTOFILLED');
      return `Recorded against stock already issued to this batch (${heldBalance.toFixed(2)} ${item.unit} held) — no new stock movement.`;
    }

    // Not enough has ever been issued to this batch to cover what the
    // report says was used — this is never auto-applied. Store needs to
    // issue the shortfall (through the normal Store Inventory flow), or the
    // Director can approve this discrepancy to trust the report anyway.
    resolve('DISCREPANCY');
    const shortfall = neededQty - heldBalance;
    discrepancies.push({
      rowDate: row.date, field: `item:${item.name}`, discrepancyType: ProductionReportDiscrepancyType.ITEM_ISSUANCE,
      locationRef: row.locationRef,
      systemValue: `${heldBalance.toFixed(2)} ${item.unit} issued & unrecorded`,
      reportValue: `${reportQty} ${reportUnit ?? item.unit}`,
      notes: heldBalance > 0
        ? `Only ${heldBalance.toFixed(2)} ${item.unit} has been issued to this batch and not yet recorded — ${shortfall.toFixed(2)} ${item.unit} short. Issue the difference to reconcile, or approve to record it anyway.`
        : `Nothing has been issued to this batch for ${item.name} yet — issue it first (or approve this discrepancy to record the usage anyway).`,
    });
    return `${shortfall.toFixed(2)} ${item.unit} short of what's been issued — not auto-recorded.`;
  }

  /** How much of `storeItemId` has already been logged as used for this
   *  (batch, date) — feed log / treatment log / brooder vaccine-supplement
   *  JSON, whichever applies. Used to detect "an attendant already recorded
   *  this" vs. "nothing recorded yet, check the held balance" before
   *  double-counting a report row against an existing log entry. */
  private async sumTodaysLoggedUsage(storeItemId: string, batchId: string, logDate: Date): Promise<number> {
    const [feedLogs, treatmentLogs, brooderLog] = await Promise.all([
      this.prisma.brooderGeneralFeedLog.findMany({ where: { batchId, entryDate: logDate, storeItemId } }),
      this.prisma.brooderTreatmentLog.findMany({ where: { batchId, treatmentDate: logDate, storeItemId } }),
      this.prisma.brooderLog.findFirst({ where: { batchId, logDate, logSession: null } }),
    ]);
    let total = feedLogs.reduce((s, l) => s + l.quantityDispensedKg, 0);
    total += treatmentLogs.reduce((s, l) => s + Number(l.quantityUsed ?? 0), 0);
    for (const arr of [brooderLog?.vaccinesJson, brooderLog?.supplementsJson]) {
      if (!Array.isArray(arr)) continue;
      for (const entry of arr as any[]) {
        if (entry?.storeItemId === storeItemId && typeof entry?.quantityUsed === 'number') total += entry.quantityUsed;
      }
    }
    return total;
  }

  /** §8/§9 — recipient-held balance for an item: everything issued to this
   *  batch, minus everything already logged as used against it, computed
   *  rather than separately tracked (avoids a second source of truth).
   *  Pooled across recipient (PM vs. Attendant) since the codebase has no
   *  structured field distinguishing who physically holds it — every
   *  StoreStockOut with issuedToBatchId set is treated as one custody pool
   *  for that batch. Never negative. */
  private async computeHeldBalance(storeItemId: string, batchId: string): Promise<number> {
    const issuedAgg = await this.prisma.storeStockOut.aggregate({
      where: { storeItemId, issuedToBatchId: batchId },
      _sum: { quantityOut: true },
    });
    const issued = Number(issuedAgg._sum.quantityOut ?? 0);

    const feedAgg = await this.prisma.brooderGeneralFeedLog.aggregate({
      where: { batchId, storeItemId },
      _sum: { quantityDispensedKg: true },
    });
    const feedUsed = Number(feedAgg._sum.quantityDispensedKg ?? 0);

    const treatmentAgg = await this.prisma.brooderTreatmentLog.aggregate({
      where: { batchId, storeItemId },
      _sum: { quantityUsed: true },
    });
    const treatmentUsed = Number(treatmentAgg._sum.quantityUsed ?? 0);

    // vaccinesJson/supplementsJson are JSON arrays — no SQL-level aggregate
    // available, so reduce in JS. Scoped to the once-daily (logSession: null)
    // rows, which is the only place they're ever written, and to this batch,
    // so row counts stay small.
    const logs = await this.prisma.brooderLog.findMany({
      where: { batchId, logSession: null },
      select: { vaccinesJson: true, supplementsJson: true },
    });
    let jsonUsed = 0;
    for (const log of logs) {
      for (const arr of [log.vaccinesJson, log.supplementsJson]) {
        if (!Array.isArray(arr)) continue;
        for (const entry of arr as any[]) {
          if (entry?.storeItemId === storeItemId && typeof entry?.quantityUsed === 'number') jsonUsed += entry.quantityUsed;
        }
      }
    }

    return Math.max(0, issued - feedUsed - treatmentUsed - jsonUsed);
  }

  /** Director trusts the report's value for one discrepancy and applies an
   *  ADJUSTING entry on top of the existing record (never mutates/deletes the
   *  attendant's original entry — keeps the audit trail intact). Only
   *  positive deltas (system under-recorded vs. the report) are auto-applied;
   *  a negative delta (system recorded MORE than the report) is flagged back
   *  for manual correction rather than guessed at. This is the one place a
   *  store-item deduction can happen without a prior stock-out record — it's
   *  an explicit, one-off human sign-off, not the automatic upload path. */
  async applyDiscrepancy(
    discrepancy: { rowDate: Date; field: string; discrepancyType: ProductionReportDiscrepancyType; locationRef: string | null; systemValue: string | null; reportValue: string | null },
    batchId: string,
    userId: string,
  ): Promise<{ applied: boolean; note: string }> {
    const logDate = discrepancy.rowDate;

    if (discrepancy.discrepancyType === ProductionReportDiscrepancyType.MORTALITY) {
      const system = Number(discrepancy.systemValue ?? 0);
      const report = Number(discrepancy.reportValue ?? 0);
      const delta = report - system;
      if (delta <= 0) return { applied: false, note: 'System already recorded more than the report — needs manual correction, not auto-applied.' };
      await this.prisma.brooderGeneralMortalityLog.create({
        data: {
          batchId, logDate, mortalityCount: delta,
          notes: 'Director-approved correction from store production report',
          loggedById: userId,
        },
      });
      return { applied: true, note: `Added ${delta} to mortality for ${logDate.toISOString().slice(0, 10)}.` };
    }

    if (discrepancy.discrepancyType === ProductionReportDiscrepancyType.FEED) {
      if (discrepancy.field === 'feedType') {
        return { applied: false, note: 'Report feed type still needs to be matched to a store item manually — no store item to apply.' };
      }
      const system = parseFloat(discrepancy.systemValue ?? '0');
      const report = parseFloat(discrepancy.reportValue ?? '0');
      const delta = report - system;
      if (delta <= 0) return { applied: false, note: 'System already recorded more feed than the report — needs manual correction, not auto-applied.' };
      await this.prisma.brooderGeneralFeedLog.create({
        data: {
          batchId, entryDate: logDate, feedType: FeedType.CHICK_MASH, quantityDispensedKg: delta,
          notes: 'Director-approved correction from store production report',
          loggedById: userId,
        },
      });
      return { applied: true, note: `Added ${delta} kg to feed for ${logDate.toISOString().slice(0, 10)}.` };
    }

    if (discrepancy.discrepancyType === ProductionReportDiscrepancyType.STOCK_COUNT) {
      const m = /O:(-?\d+)\s*\/\s*C:(-?\d+)/.exec(discrepancy.reportValue ?? '');
      if (!m) return { applied: false, note: 'Could not parse report stock values.' };
      const openingStock = parseInt(m[1], 10);
      await this.prisma.brooderStockCount.update({
        where: { batchId_logDate: { batchId, logDate } },
        data: {
          openingStock, closingStock: parseInt(m[2], 10),
          varianceReason: 'Corrected to match Director-approved store production report',
        },
      });

      // §10 — propagate the Director-approved opening count to the batch's
      // live bird count, then apply that day's recorded mortalities forward
      // to derive the closing count. Cage-map/cage-level counts are handled
      // separately by the CAGE_REASSIGNMENT path — this only touches the
      // batch-level rollup count.
      const mortalityAgg = await this.prisma.brooderGeneralMortalityLog.aggregate({
        where: { batchId, logDate },
        _sum: { mortalityCount: true, cullingCount: true },
      });
      const dayLosses = Number(mortalityAgg._sum.mortalityCount ?? 0) + Number(mortalityAgg._sum.cullingCount ?? 0);
      const newBirdCount = Math.max(0, openingStock - dayLosses);
      await this.prisma.batch.update({ where: { id: batchId }, data: { currentBirdCount: newBirdCount } });

      return {
        applied: true,
        note: `Opening/closing stock corrected to match the report. Batch bird count updated to ${newBirdCount} ` +
          `(opening ${openingStock} − ${dayLosses} recorded mortality/culling that day).`,
      };
    }

    if (discrepancy.discrepancyType === ProductionReportDiscrepancyType.CAGE_REASSIGNMENT) {
      // Director confirms the handover implied by the report — reassign the
      // cage to the reporting batch with the report's headcount. reportValue
      // is formatted "BATCHCODE: count" by reconcileCageAssignment().
      const m = /^(.+?):\s*(-?\d+(?:\.\d+)?)$/.exec(discrepancy.reportValue ?? '');
      if (!m) return { applied: false, note: 'Could not parse the report value for this cage.' };
      const reportBatchCode = m[1].trim();
      const birdCount = parseFloat(m[2]);
      if (reportBatchCode !== (await this.prisma.batch.findUnique({ where: { id: batchId }, select: { batchCode: true } }))?.batchCode) {
        return { applied: false, note: 'This discrepancy belongs to a different batch\'s report — resolve it from that batch\'s report instead.' };
      }
      // discrepancy.locationRef carries the cage label built in
      // reconcileCageAssignment (e.g. "Row 3 / Level 2 / Cage 07") — re-parse
      // it back into numbers to find the cage again.
      const rowM = /Row (\d+)/.exec(discrepancy.locationRef ?? '');
      const levelM = /Level (\d+)/.exec(discrepancy.locationRef ?? '');
      const cageM = /Cage (\d+)/.exec(discrepancy.locationRef ?? '');
      if (!rowM || !levelM || !cageM) return { applied: false, note: 'Could not identify the cage from this discrepancy — resolve it manually via the cage map.' };
      const brooderRow = await this.prisma.brooderRow.findUnique({ where: { rowNumber: parseInt(rowM[1], 10) } });
      const level = brooderRow && await this.prisma.brooderLevel.findUnique({ where: { rowId_levelNumber: { rowId: brooderRow.id, levelNumber: parseInt(levelM[1], 10) } } });
      const cage = level && await this.prisma.brooderCage.findUnique({ where: { levelId_cageNumber: { levelId: level.id, cageNumber: parseInt(cageM[1], 10) } } });
      if (!cage || !level) return { applied: false, note: 'Cage no longer exists in the cage map — resolve manually.' };

      await this.prisma.$transaction(async (tx) => {
        const previous = await tx.brooderCageAssignment.findUnique({ where: { cageId: cage.id } });
        await tx.brooderCageAssignment.upsert({
          where: { cageId: cage.id },
          create: { cageId: cage.id, batchId, birdCount, placedDate: logDate, notes: 'Director-approved reassignment from store production report', assignedById: userId },
          update: { batchId, birdCount, assignedById: userId, notes: 'Director-approved reassignment from store production report' },
        });
        await this.recomputeLevelRollup(tx, level.id, userId);
        // The cage's previous occupant (if any, and a different batch) lost
        // this cage — recompute its old level's rollup too, if it's a
        // different level than the one we just updated.
        if (previous && previous.batchId !== batchId) {
          const previousBatchOtherCages = await tx.brooderCageAssignment.count({ where: { batchId: previous.batchId } });
          if (previousBatchOtherCages === 0) {
            this.logger.warn(`Cage reassignment left batch ${previous.batchId} with zero cages — its BrooderLevelAssignment rollups may need a manual check.`);
          }
        }
      });
      return { applied: true, note: `Cage reassigned to ${reportBatchCode} with a headcount of ${birdCount}.` };
    }

    if (discrepancy.discrepancyType === ProductionReportDiscrepancyType.ITEM_ISSUANCE) {
      const itemName = discrepancy.field.replace(/^item:/, '');
      const item = await this.prisma.storeItem.findFirst({ where: { name: itemName } });
      if (!item) return { applied: false, note: `Store item "${itemName}" not found.` };
      // systemValue here is "X <unit> issued & unrecorded" from
      // recordUsageAgainstHeldBalance — pull the leading number back out.
      const systemQty = parseFloat(discrepancy.systemValue ?? '0');
      const reportQty = parseFloat(discrepancy.reportValue ?? '0');
      const delta = reportQty - systemQty;
      if (delta > 0) {
        if (Number(item.currentStock) < delta) {
          return { applied: false, note: `Insufficient stock (${item.currentStock} ${item.unit}) to apply the extra ${delta} ${item.unit} — needs manual reconciliation.` };
        }
        await this.prisma.$transaction([
          this.prisma.storeStockOut.create({
            data: {
              storeItemId: item.id, issuedDate: logDate, quantityOut: delta,
              unitCostKes: item.unitCostKes, totalCostKes: delta * Number(item.unitCostKes),
              issuedToBatchId: batchId, issuedToName: 'Brooder (via production report)',
              purpose: 'Director-approved correction from store production report',
              issuedById: userId,
            },
          }),
          this.prisma.storeItem.update({ where: { id: item.id }, data: { currentStock: { decrement: delta } } }),
        ]);
        return { applied: true, note: `Deducted an additional ${delta} ${item.unit} of ${item.name} (Director-approved — this is the one path that can move stock without a prior issuance).` };
      } else if (delta < 0) {
        // Report says less was used than the system deducted — credit the difference back.
        await this.prisma.storeItem.update({ where: { id: item.id }, data: { currentStock: { increment: -delta } } });
        return { applied: true, note: `Credited back ${-delta} ${item.unit} of ${item.name} (report showed less usage than recorded).` };
      }
      return { applied: false, note: 'No difference to apply.' };
    }

    return { applied: false, note: 'Unrecognised discrepancy type — needs manual review.' };
  }
}
