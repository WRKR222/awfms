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
  FeedType, ProductionReportDiscrepancyType, StoreItem, BatchStage, BrooderLogSession, UserRole,
} from '@prisma/client';
import { ParsedReportRow, ParsedHealthUsage, EnvReading } from './production-report.dto';
import { splitMultiValueCell } from './production-report-parser.service';
import { convertToUnit } from '../../common/units/unit-conversion.util';
import { FeedWastageService } from '../../common/feed/feed-wastage.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { batchAgeWeeks, brooderRequiredFeedKg, requiredFeedKg, checkWeightViolation, hylineGramsPerBirdPerDay, HYLINE_SCHEDULE_MAX_WEEK } from '../../common/feed/feed-standard.util';
import { WeightAlertService } from '../weight/weight-alert.service';
import dayjs from 'dayjs';

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
    // Set for WEIGHT discrepancies — they're informational (nothing to
    // approve/reject; the standard-band comparison is the whole story,
    // already fully captured in the linked ProductionWeightAlert) so
    // they're persisted pre-resolved and never enter the Director's
    // "Needs your input" approval gate — see reconcileWeight().
    preResolved?: boolean;
  }[];
  // Every CREATE/UPDATE/JSON_APPEND the reconciliation pass performed —
  // persisted verbatim into ProductionReportAppliedChange by the caller
  // (ProductionReportService.submit(), in the same transaction as the
  // report upsert) so a report's effects can be traced and rolled back.
  appliedChanges: AppliedChangeInput[];
  autofillCount: number;
  matchedCount: number;
  stage: 'BROODING' | 'PRODUCTION' | 'OTHER';
}

export interface AppliedChangeInput {
  batchId: string;
  rowDate: string;
  entityType: string;
  entityId: string | null;
  // DELETE: a row that existed before this report ran was removed as part
  // of the "report replaces, never duplicates" write path (see
  // deleteAndLog()) — beforeState is the row's full state, afterState is
  // null. Rollback undoes this by recreating the row from beforeState.
  action: 'CREATE' | 'UPDATE' | 'JSON_APPEND' | 'DELETE';
  beforeState: unknown;
  afterState: unknown;
}

/** Outcome of the "report is authoritative" correction policy: whatever the
 *  report says for this exact (item/field, batch, date) is what the system
 *  ends up showing — no held-balance ceiling, no "report shows less, block
 *  it" rule. `deltaToApply` can be NEGATIVE (report shows less than what's
 *  already recorded) as well as positive; callers write it as a correction
 *  entry (or a direct field overwrite, for singleton fields like
 *  EggCollectionSession.feedKg) either way. This intentionally does NOT
 *  raise a discrepancy for a value difference — see reconcileFeed /
 *  reconcileMortality / reconcileStockCount / reconcileHealthUsages etc.,
 *  which call this. Discrepancies are still raised elsewhere, but only for
 *  things this function can't resolve by definition — the report naming an
 *  item that doesn't exist in the store catalogue (nothing to attribute the
 *  quantity to), a unit that can't be converted, or a row with nowhere to
 *  write into yet (e.g. no egg-collection session exists for that date). */
interface CorrectionOutcome {
  resolution: 'MATCHED' | 'AUTOFILLED' | 'DISCREPANCY';
  /** The amount to write as a correction entry (or the new absolute value,
   *  for a direct-overwrite field) — 0 unless resolution is 'AUTOFILLED'.
   *  Can be negative. */
  deltaToApply: number;
  note: string;
}

/** Central "the report is authoritative" decision — shared by mortality,
 *  feed, vaccines/supplements/treatments, and generic items-issued, so the
 *  same policy applies everywhere: whatever the report says for this field
 *  is what gets recorded, whether that's higher or lower than what the
 *  system already has, and regardless of how much was ever issued to this
 *  batch. Never raises a discrepancy on its own — a value difference is
 *  always resolved by correcting to match the report, silently. */
export function resolveReportCorrection(
  alreadyRecorded: number,
  reportQty: number,
  unitLabel: string,
): CorrectionOutcome {
  const delta = reportQty - alreadyRecorded;
  if (Math.abs(delta) < 0.001) {
    return { resolution: 'MATCHED', deltaToApply: 0, note: '' };
  }
  return {
    resolution: 'AUTOFILLED',
    deltaToApply: delta,
    note: delta > 0
      ? `${alreadyRecorded} ${unitLabel} was already recorded; the report shows ${reportQty} ${unitLabel} total, so ${delta.toFixed(2)} ${unitLabel} was added to match it.`
      : `${alreadyRecorded} ${unitLabel} was already recorded; the report shows only ${reportQty} ${unitLabel} total, so ${Math.abs(delta).toFixed(2)} ${unitLabel} was corrected down to match it.`,
  };
}

// Same unit-synonym set as unit-conversion.util's UNIT_TO_BASE, but keyed
// the OTHER direction (every spelling -> one canonical short form) so it can
// be used as a text-substitution pass, not a numeric conversion. This is
// what makes "150G" and "150 GRAMS" (or "12ml" / "12 mls" / "12 millilitres")
// compare as identical during ITEM NAME / free-text matching — separate
// from, and in addition to, the numeric convertToUnit() used once an item is
// already matched and its quantity needs converting to the stock unit.
const UNIT_WORD_CANONICAL: Record<string, string> = {
  milligram: 'mg', milligrams: 'mg', mgs: 'mg',
  gram: 'g', grams: 'g', gs: 'g', gm: 'g', gms: 'g',
  kilogram: 'kg', kilograms: 'kg', kgs: 'kg',
  tonne: 't', tonnes: 't',
  milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml', mls: 'ml',
  liter: 'l', liters: 'l', litre: 'l', litres: 'l', lt: 'l', ltr: 'l', ltrs: 'l',
  sachets: 'sachet', bags: 'bag', doses: 'dose', pieces: 'piece', pcs: 'piece', pc: 'piece',
  rolls: 'roll', boxes: 'box',
};

/** Replaces every "<number><unit-word>" token in free text with its
 *  canonical short form (e.g. "150 Grams" / "150GRAMS" / "150g" all become
 *  "150g") before the normal alnum-only normalisation runs. Without this,
 *  matchInventoryItem()'s substring check happens to work for prefix cases
 *  like "150g" being a prefix of "150grams", but silently fails for
 *  non-prefix spellings (e.g. "150gm" vs "150 grams"), which is exactly the
 *  class of bug that produces a second, seemingly-duplicate StoreItem/log
 *  match instead of recognising the two report cells as the same quantity. */
export function canonicaliseUnitWords(s: string): string {
  return s.replace(/(\d+(?:\.\d+)?)\s*([a-zA-Z]+)/g, (whole, num: string, word: string) => {
    const canon = UNIT_WORD_CANONICAL[word.toLowerCase()];
    return canon ? `${num}${canon}` : whole;
  });
}

export function normaliseText(s: string): string {
  return canonicaliseUnitWords(s).toLowerCase().replace(/[^a-z0-9]/g, '');
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

/** matchInventoryItem(), but checks Store's manually-recorded aliases
 *  (StoreItemAlias, keyed by normaliseText()) FIRST — a label Store has
 *  already matched once always wins outright, even if it would otherwise
 *  fuzzy-match a different/no item. Falls back to matchInventoryItem()
 *  when there's no alias for this exact text. */
function resolveItemMatch(reportText: string | undefined, candidates: StoreItem[], aliasMap: Map<string, StoreItem>): StoreItem | null {
  if (!reportText) return null;
  const norm = normaliseText(reportText);
  if (norm && aliasMap.has(norm)) return aliasMap.get(norm)!;
  return matchInventoryItem(reportText, candidates);
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

/** Runs `fn` over `items` with at most `limit` in flight at once — plain
 *  `Promise.all(items.map(fn))` would fire every row's DB work at the same
 *  instant, which for a multi-week report can spike well past the Postgres
 *  connection pool size and start failing with connection-timeout errors
 *  instead of actually going faster. This keeps a steady `limit`-wide window
 *  of work in flight, refilling as each item finishes, without pulling in an
 *  external dependency (p-limit) for one function. Order of results doesn't
 *  matter here — every caller only cares about side effects, not a return
 *  value — so this only needs to await completion, not collect outputs. */
async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

// How many rows' worth of (mortality/weight/feed/water/health-usage/
// environmental/item-usage) reconciliation run concurrently during a single
// submit. Tuned well under Prisma's default connection pool size (num_cpus*2+1)
// since each in-flight row can itself issue several queries at once — pushing
// this too high trades one bottleneck (serial awaits) for another (pool
// exhaustion). Revisit alongside DATABASE_URL's connection_limit if this ever
// needs to go higher.
const RECONCILE_CONCURRENCY = 6;

@Injectable()
export class ProductionReportReconciliationService {
  private readonly logger = new Logger(ProductionReportReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly feedWastage: FeedWastageService,
    private readonly notifications: NotificationsService,
    private readonly weightAlerts: WeightAlertService,
  ) {}

  // BROODER_MGMT_IS_READ_ONLY: Store's uploaded production reports must
  // never auto-fill or overwrite anything an attendant records in brooder
  // management (BrooderLog, BrooderGeneralFeedLog/BrooderLevelFeedLog,
  // BrooderGeneralMortalityLog/BrooderLevelMortalityLog,
  // BrooderTreatmentLog, vaccinesJson/supplementsJson, BrooderStockCount).
  // For a BROODING/GROWER-stage batch every reconcile* method below only
  // ever COMPARES the report's figure against what's already recorded and,
  // on a mismatch, raises a ProductionReportDiscrepancy for the Director to
  // review — it never creates, updates, or deletes a brooder row. This is
  // the opposite of the PRODUCTION-stage (EggCollectionSession) behaviour
  // in the same methods, which is unchanged and still autofills.
  private brooderReadOnlyNote(field: string): string {
    return `Brooder management is read-only from Store's production reports — this ${field} figure is shown ` +
      'here for the Director to review, but the attendant\'s own brooder record was not changed. Resolve by ' +
      'correcting either the paper/Store record or the attendant\'s brooder entry directly.';
  }

  /** Run the full cross-check + autofill pass over every parsed row for a
   *  batch. Mutates the real brooder/production/cage-map tables for anything
   *  that can be safely auto-applied; returns the annotated rows + open
   *  discrepancies. Never issues store stock — see the header note above. */
  async reconcile(batchId: string, rows: ParsedReportRow[], uploaderId: string, fileName: string): Promise<ReconcileOutcome> {
    const discrepancies: ReconcileOutcome['discrepancies'] = [];
    const appliedChanges: AppliedChangeInput[] = [];
    let autofillCount = 0;
    let matchedCount = 0;
    const noteSuffix = `(from store production report "${fileName}")`;

    // ── Stage detection (§5) ────────────────────────────────────────────────
    const batch = await this.prisma.batch.findUnique({
      where: { id: batchId },
      select: { batchCode: true, stage: true, houseId: true, currentBirdCount: true, dateReceived: true, dateOfHatch: true },
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

    // Store's manually-resolved "this label means this item" corrections
    // (see resolveItemMatch above) — checked before the fuzzy matcher at
    // every match site below, so a label Store has matched once never
    // re-flags as unmatched on a later report.
    const aliasRows = await this.prisma.storeItemAlias.findMany({ include: { storeItem: true } });
    const aliasMap: Map<string, StoreItem> = new Map(aliasRows.map(a => [a.normalisedAlias, a.storeItem] as [string, StoreItem]));

    // ── Stock-count timeline (BROODING only) — reconcileStockCount's
    // "expected opening stock" is the most recent PRIOR count's closing
    // figure, which used to mean one `findFirst` DB round-trip PER ROW,
    // and forced every OTHER field below to wait its turn in the same
    // sequential loop even though nothing else depends on row order.
    // Preloading the batch's full history once and walking report rows in
    // date order purely in memory removes both problems at once. ─────────
    let stockTimeline: { logDate: Date; closingStock: number }[] = [];
    if (stageBucket === 'BROODING') {
      stockTimeline = await this.prisma.brooderStockCount.findMany({
        where: { batchId },
        select: { logDate: true, closingStock: true },
        orderBy: { logDate: 'asc' },
      });
    }

    // Rows are normally already in date order (sheet order), but the
    // timeline walk below REQUIRES it, so don't assume — sort explicitly.
    const orderedRows = [...rows].sort((a, b) => a.date.localeCompare(b.date));

    // ── Phase 1 — stock count, sequential but DB-free. This is the ONLY
    // part of reconciliation with a genuine cross-row dependency (each
    // day's "expected opening stock" is the previous day's own outcome),
    // so it stays a plain for-loop — but it no longer awaits the database
    // inside that loop: outcomes are computed purely against the in-memory
    // timeline, which is fed back into itself as each row is processed, and
    // the actual DB writes are queued for the concurrent flush below. ─────
    const stockWrites: (() => Promise<void>)[] = [];
    let latestClosingStockRow: { logDate: Date; closingStock: number } | null = null;

    for (const row of orderedRows) {
      const logDate = new Date(row.date);
      const isCageRow = stageBucket === 'BROODING' && row.cageNumber != null;
      if (stageBucket === 'BROODING' && !isCageRow && row.openingStock !== undefined && row.closingStock !== undefined) {
        const outcome = this.computeStockCountOutcome(row, logDate, stockTimeline);
        // Feed this row's own result back into the timeline immediately —
        // in memory — so the NEXT row (later date) sees it as "prior",
        // exactly as a fresh DB query would have, minus the round-trip.
        stockTimeline.push({ logDate, closingStock: row.closingStock! });
        stockWrites.push(() => this.applyStockCountOutcome(
          row, batchId, logDate, uploaderId, noteSuffix, outcome, discrepancies, appliedChanges,
          () => { autofillCount++; }, () => { matchedCount++; },
        ));
        latestClosingStockRow = { logDate, closingStock: row.closingStock! };
      }
    }

    await mapWithConcurrency(stockWrites, RECONCILE_CONCURRENCY, w => w());

    // Batch.currentBirdCount only ever needs to reflect the SINGLE most
    // recent closing-stock figure in the whole report, not be recomputed
    // once per stock-count row — collapses what used to be up to N
    // triple-queries (one set per row) into at most one.
    if (latestClosingStockRow) {
      await this.syncGeneralPopulationFromClosingStock(
        batchId, latestClosingStockRow.logDate, latestClosingStockRow.closingStock,
        dayjs(latestClosingStockRow.logDate).format('YYYY-MM-DD'), appliedChanges,
      );
    }

    // ── Phase 2 — every other field, per row. ───────────────────────────────
    // IMPORTANT — read-then-write races on same-day rows:
    // Every reconciler below (mortality, feed, water, health usages, item
    // usage) follows the same "report is authoritative" pattern: read the
    // CURRENT total already recorded for (batchId, this row's date), diff it
    // against the report's figure, and CREATE a correction row for the
    // delta. That read-then-write is only safe if nothing else touches the
    // same (batchId, date) aggregate in between the read and the write.
    //
    // A report frequently has MORE THAN ONE ROW for the same calendar date
    // — e.g. one row per cage/level within a BROODING house on a given day.
    // Those rows previously ran here with unrestricted concurrency
    // (RECONCILE_CONCURRENCY workers pulling straight from a flat
    // orderedRows list), so two same-date rows could both read the SAME
    // "existing total so far" before either had committed its own write,
    // then both create a full delta on top of that stale snapshot —
    // silently double-booking that day's feed/mortality/water instead of
    // the second row correcting against the first. This is what was behind
    // batches showing feed logged twice for a single backdated day (and the
    // resulting doubled entries in the Director's feed-wastage view), even
    // though each row individually reported "autofilled" correctly.
    //
    // Fix: group rows by date first. Rows that share a date are processed
    // SEQUENTIALLY (one row's write fully commits, including its DB round
    // trip, before the next same-date row reads), so each row's "existing
    // total" read is always up to date. Different dates have no shared
    // aggregate, so date-groups themselves still run with bounded
    // concurrency, preserving the original performance characteristics for
    // the common case (one row per date). ─────────────────────────────────
    const rowsByDate = new Map<string, ParsedReportRow[]>();
    for (const row of orderedRows) {
      const bucket = rowsByDate.get(row.date);
      if (bucket) bucket.push(row);
      else rowsByDate.set(row.date, [row]);
    }
    const dateGroups = [...rowsByDate.values()];

    await mapWithConcurrency(dateGroups, RECONCILE_CONCURRENCY, async (group) => {
      for (const row of group) {
        const logDate = new Date(row.date);
        const isCageRow = stageBucket === 'BROODING' && row.cageNumber != null;

        // ── Mortality ──────────────────────────────────────────────────────
        if (row.mortality !== undefined) {
          await this.reconcileMortality(row, batchId, logDate, uploaderId, noteSuffix, stageBucket, batch.houseId, discrepancies, appliedChanges, () => { autofillCount++; }, () => { matchedCount++; });
        }

        // ── Bird weight vs. HyLine standard band (§ ProductionWeightAlert) ──
        // Unlike every other field here, this is never "corrected" — there's
        // nothing in the report to autofill or overwrite; it's purely a
        // cross-check against the standard table, with a Director-facing
        // flag (+ cross-referenced feed/mortality context + AI read) raised
        // when the sampled average falls outside the band for the batch's
        // age at this row's date. See WeightAlertService.
        if (row.avgWeight !== undefined) {
          await this.reconcileWeight(row, batchId, logDate, batch.dateOfHatch, discrepancies, () => { matchedCount++; });
        }

        // ── Feed ───────────────────────────────────────────────────────────
        if (row.feedKg !== undefined) {
          await this.reconcileFeed(row, batchId, logDate, uploaderId, noteSuffix, stageBucket, batch, feedItems, aliasMap, discrepancies, appliedChanges, () => { autofillCount++; }, () => { matchedCount++; });
        }

        // ── Cage reassignment / recount — per-cage rows only ────────────────
        if (isCageRow && (row.closingStock !== undefined || row.openingStock !== undefined)) {
          await this.reconcileCageAssignment(row, batchId, batch, logDate, uploaderId, noteSuffix, discrepancies, appliedChanges, () => { autofillCount++; }, () => { matchedCount++; });
        }

        // ── Water consumption ─────────────────────────────────────────────
        if (row.waterLts !== undefined) {
          await this.reconcileWater(row, batchId, logDate, uploaderId, noteSuffix, stageBucket, batch.houseId, discrepancies, appliedChanges, () => { autofillCount++; }, () => { matchedCount++; });
        }

        // ── Vaccines / supplements / treatments (§3) ──────────────────────
        await this.reconcileHealthUsages(
          row, batchId, logDate, uploaderId, noteSuffix, stageBucket, batch,
          vaccineItems, supplementItems, treatmentItems, aliasMap, discrepancies, appliedChanges,
          () => { autofillCount++; }, () => { matchedCount++; },
        );

        // ── Temperature / humidity / lux, per session (morning/midday/
        // evening) — brooder stage only; EggCollectionSession (production
        // stage) has no humidity/lux fields and only one temperature value
        // per shift, so there's nothing session-shaped to reconcile there. ──
        if (stageBucket === 'BROODING') {
          await this.reconcileEnvironmental(row, batchId, logDate, uploaderId, noteSuffix, discrepancies, appliedChanges, () => { autofillCount++; }, () => { matchedCount++; });
        }

        // ── Generic items issued (e.g. charcoal bags used) ────────────────
        for (const usage of row.itemsIssued) {
          const item = storeItemMap.get(usage.storeItemId);
          if (!item) continue;
          usage.storeItemName = item.name;
          await this.reconcileItemUsage(row, item, usage.quantity, usage.unit, usage.rawText, batchId, logDate, discrepancies, appliedChanges,
            (res) => { usage.resolution = res; if (res === 'AUTOFILLED') autofillCount++; else if (res === 'MATCHED') matchedCount++; });
        }
      }
    });

    return { rows, discrepancies, appliedChanges, autofillCount, matchedCount, stage: stageBucket };
  }

  /** Mirrors BrooderService.assertNoLevelSpecificFeedLog — the write path
   *  here (reconcileFeed/reconcileFeedSplit) writes BrooderGeneralFeedLog
   *  directly via Prisma rather than through BrooderService's guarded
   *  createGeneralFeedLog(), so it never went through that clash check.
   *  Root cause of the "feed recorded twice" bug: when a batch is being
   *  tracked at row/level detail for a date and a production report is
   *  then reconciled for that SAME date, this path used to create a
   *  general-record row anyway — the two are meant to be mutually
   *  exclusive per (batch, date) (see assertNoLevelSpecificFeedLog's
   *  comment), but nothing enforced that here, so
   *  getPopulationRecordSheet's rollup silently added both totals
   *  together, doubling the figure shown in history. Called before every
   *  BrooderGeneralFeedLog write in this file; when it returns true the
   *  caller must hold the row back as a discrepancy instead of writing. */
  private async hasLevelSpecificFeedLog(batchId: string, entryDate: Date): Promise<boolean> {
    const levelIds = await this.prisma.brooderLevelAssignment.findMany({
      where: { batchId }, select: { levelId: true },
    });
    if (levelIds.length === 0) return false;
    const existing = await this.prisma.brooderLevelFeedLog.findFirst({
      where: { levelId: { in: levelIds.map(l => l.levelId) }, entryDate },
    });
    return !!existing;
  }

  /** Deletes every row in `rows` and logs a DELETE ledger entry (full
   *  beforeState, no afterState) for each one, so ProductionReportRollbackService
   *  can recreate them exactly if this report is later undone. Used by the
   *  "report replaces, never duplicates" write path (feed, mortality) —
   *  see reconcileFeed/reconcileFeedSplit/reconcileMortality — instead of
   *  the old "write a delta correction on top" approach. Any
   *  BrooderFeedWastageLog row pointing at a doomed BrooderGeneralFeedLog
   *  id is deleted first (and logged) so a stale wastage entry never
   *  outlives the feed row that triggered it. */
  private async deleteAndLog(
    delegate: any, rows: { id: string }[], entityType: string, batchId: string, rowDate: string,
    appliedChanges: AppliedChangeInput[],
  ) {
    for (const row of rows) {
      if (entityType === 'BrooderGeneralFeedLog') {
        const wastageRows = await this.prisma.brooderFeedWastageLog.findMany({ where: { generalFeedLogId: row.id } });
        for (const w of wastageRows) {
          this.logChange(appliedChanges, batchId, rowDate, 'BrooderFeedWastageLog', w.id, 'DELETE', w, null);
        }
        if (wastageRows.length) {
          await this.prisma.brooderFeedWastageLog.deleteMany({ where: { generalFeedLogId: row.id } });
        }
      }
      this.logChange(appliedChanges, batchId, rowDate, entityType, row.id, 'DELETE', row, null);
    }
    if (rows.length) {
      await delegate.deleteMany({ where: { id: { in: rows.map(r => r.id) } } });
    }
  }

  /** Records one ledger entry describing a write the reconciliation engine
   *  just made. Called right after the mutation it describes (see the model
   *  doc-comment for why this is collected in-memory here and persisted by
   *  the caller in the same transaction as the report upsert, rather than
   *  written directly to the DB from inside reconcile()). */
  private logChange(
    appliedChanges: AppliedChangeInput[], batchId: string, rowDate: string, entityType: string,
    entityId: string | null, action: AppliedChangeInput['action'], beforeState: unknown, afterState: unknown,
  ) {
    appliedChanges.push({ batchId, rowDate, entityType, entityId, action, beforeState, afterState });
  }

  // ── Mortality ────────────────────────────────────────────────────────────
  private async reconcileMortality(
    row: ParsedReportRow, batchId: string, logDate: Date, uploaderId: string, noteSuffix: string,
    stageBucket: 'BROODING' | 'PRODUCTION' | 'OTHER', houseId: string,
    discrepancies: ReconcileOutcome['discrepancies'], appliedChanges: AppliedChangeInput[], onAutofill: () => void, onMatch: () => void,
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
        // attendant has logged the base session. (This is a "nowhere to
        // write yet" case, not a value difference, so it's still flagged.)
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
        return;
      }
      // Report is authoritative — correct the session to match it, whether
      // that's higher or lower than what's currently recorded.
      const before = existing.mortalities;
      await this.prisma.eggCollectionSession.update({ where: { id: existing.id }, data: { mortalities: row.mortality! } });
      this.logChange(appliedChanges, batchId, row.date, 'EggCollectionSession.mortalities', existing.id, 'UPDATE', { mortalities: before }, { mortalities: row.mortality! });
      row.resolution.mortality = 'AUTOFILLED';
      onAutofill();
      return;
    }

    // BROODING/GROWER: brooder management is the attendant's own record.
    // Store's production report is read-only here — compare against what's
    // recorded and surface a discrepancy for the Director if it disagrees,
    // but never create/update/delete a brooder mortality log from it (see
    // file header, §5 and the class-level BROODER_MGMT_IS_READ_ONLY note).
    const existing = await this.prisma.brooderGeneralMortalityLog.findMany({ where: { batchId, logDate } });
    const systemTotal = existing.reduce((s, e) => s + e.mortalityCount, 0);
    if (Math.abs(systemTotal - row.mortality!) < 0.001) {
      row.resolution.mortality = 'MATCHED';
      onMatch();
      return;
    }
    row.resolution.mortality = 'DISCREPANCY';
    discrepancies.push({
      rowDate: row.date, field: 'mortality', discrepancyType: ProductionReportDiscrepancyType.MORTALITY,
      locationRef: row.locationRef, systemValue: existing.length ? String(systemTotal) : null, reportValue: String(row.mortality),
      notes: this.brooderReadOnlyNote('mortality'),
    });
  }

  // ── Bird weight vs. HyLine standard band ───────────────────────────────
  /** row.avgWeight is free text off the sheet (e.g. "612", "612g", "612 g")
   *  — parse the leading number, compare it to the HyLine min/max band for
   *  the batch's age AT THIS ROW'S DATE (not "today" — a re-uploaded
   *  historical report must be checked against the band for the week it
   *  actually covers), and record both a lightweight `weightCheck` summary
   *  on the row (for the report review table) and — only when the sample
   *  is outside the band — a full ProductionWeightAlert via
   *  WeightAlertService (cross-referenced feed/mortality context, AI
   *  analysis, Director notification). Never raises a discrepancy that
   *  blocks report approval — see the ProductionReportDiscrepancyType.WEIGHT
   *  doc-comment in schema.prisma — it's informational, not a
   *  match/autofill/conflict in the sense the rest of this file uses. */
  private async reconcileWeight(
    row: ParsedReportRow, batchId: string, logDate: Date, dateOfHatch: Date,
    discrepancies: ReconcileOutcome['discrepancies'], onMatch: () => void,
  ) {
    const parsed = parseFloat(String(row.avgWeight ?? '').replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      row.resolution.avgWeight = 'SKIPPED';
      return;
    }

    const ageWeeks = batchAgeWeeks(dateOfHatch, logDate);
    const check = checkWeightViolation(parsed, ageWeeks);

    if (!check.violated) {
      row.resolution.avgWeight = 'MATCHED';
      row.weightCheck = {
        averageWeightG: parsed, standardMinG: check.standard.weightMinG, standardMaxG: check.standard.weightMaxG,
        ageWeeks, direction: null, deviationG: 0,
      };
      onMatch();
      return;
    }

    const direction = parsed < check.standard.weightMinG ? 'BELOW_MIN' : 'ABOVE_MAX';
    const boundary = direction === 'BELOW_MIN' ? check.standard.weightMinG : check.standard.weightMaxG;
    row.resolution.avgWeight = 'DISCREPANCY';
    row.weightCheck = {
      averageWeightG: parsed, standardMinG: check.standard.weightMinG, standardMaxG: check.standard.weightMaxG,
      ageWeeks, direction, deviationG: Math.round((parsed - boundary) * 100) / 100,
    };
    discrepancies.push({
      rowDate: row.date, field: 'avgWeight', discrepancyType: ProductionReportDiscrepancyType.WEIGHT,
      locationRef: row.locationRef, systemValue: `${check.standard.weightMinG}-${check.standard.weightMaxG}g (Week ${check.standard.week} standard)`,
      reportValue: `${parsed}g`, notes: check.message, preResolved: true,
    });

    const alert = await this.weightAlerts.evaluateWeightSample({
      batchId, sampleDate: logDate, averageWeightG: parsed,
      source: 'PRODUCTION_REPORT',
    }).catch(() => null);
    if (alert) row.weightCheck.alertId = alert.id;
  }

  // ── Water consumption ────────────────────────────────────────────────────
  /** Writes the report's water figure into the same place its unit already
   *  implies — BrooderLog.waterConsumptionL (once-daily, logSession: null)
   *  for BROODING/GROWER, EggCollectionSession.waterLiters for PRODUCTION —
   *  using the same match/autofill/discrepancy pattern as every other single-
   *  value field here (cf. reconcileStockCount). This field was previously
   *  parsed off the sheet (ParsedReportRow.waterLts) but never actually
   *  written anywhere by reconcile(), so report-recorded water consumption
   *  silently never reached either table. */
  private async reconcileWater(
    row: ParsedReportRow, batchId: string, logDate: Date, uploaderId: string, noteSuffix: string,
    stageBucket: 'BROODING' | 'PRODUCTION' | 'OTHER', houseId: string,
    discrepancies: ReconcileOutcome['discrepancies'], appliedChanges: AppliedChangeInput[], onAutofill: () => void, onMatch: () => void,
  ) {
    const reportWater = row.waterLts!;

    if (stageBucket === 'PRODUCTION') {
      const existing = await this.prisma.eggCollectionSession.findUnique({
        where: { batchId_houseId_sessionDate_shift: { batchId, houseId, sessionDate: logDate, shift: 'AM' } },
      });
      if (!existing) {
        // Same "nowhere to write yet" case as reconcileMortality — a
        // production-stage water figure can't be auto-filled into a
        // session an attendant hasn't created yet.
        row.resolution.water = 'DISCREPANCY';
        discrepancies.push({
          rowDate: row.date, field: 'water', discrepancyType: ProductionReportDiscrepancyType.OTHER,
          locationRef: row.locationRef, systemValue: null, reportValue: String(reportWater),
          notes: 'No egg-collection session exists yet for this date — water consumption can\'t be auto-filled into a session that hasn\'t been created by an attendant.',
        });
        return;
      }
      const existingWater = existing.waterLiters != null ? Number(existing.waterLiters) : null;
      if (existingWater != null && Math.abs(existingWater - reportWater) < 0.01) {
        row.resolution.water = 'MATCHED';
        onMatch();
        return;
      }
      // Report is authoritative — correct it, whether nothing was logged
      // yet or the logged figure conflicts with the report.
      await this.prisma.eggCollectionSession.update({ where: { id: existing.id }, data: { waterLiters: reportWater } });
      this.logChange(appliedChanges, batchId, row.date, 'EggCollectionSession.waterLiters', existing.id, 'UPDATE', { waterLiters: existingWater }, { waterLiters: reportWater });
      row.resolution.water = 'AUTOFILLED';
      onAutofill();
      return;
    }

    // BROODING / GROWER — read-only (see BROODER_MGMT_IS_READ_ONLY): compare
    // against the attendant's own BrooderLog row, never write to it.
    const existing = await this.prisma.brooderLog.findFirst({ where: { batchId, logDate, logSession: null } });
    if (existing && existing.waterConsumptionL != null && Math.abs(existing.waterConsumptionL - reportWater) < 0.01) {
      row.resolution.water = 'MATCHED';
      onMatch();
      return;
    }
    row.resolution.water = 'DISCREPANCY';
    discrepancies.push({
      rowDate: row.date, field: 'water', discrepancyType: ProductionReportDiscrepancyType.OTHER,
      locationRef: row.locationRef,
      systemValue: existing?.waterConsumptionL != null ? String(existing.waterConsumptionL) : null,
      reportValue: String(reportWater),
      notes: this.brooderReadOnlyNote('water consumption'),
    });
  }

  // ── Feed ─────────────────────────────────────────────────────────────────
  private async reconcileFeed(
    row: ParsedReportRow, batchId: string, logDate: Date, uploaderId: string, noteSuffix: string,
    stageBucket: 'BROODING' | 'PRODUCTION' | 'OTHER',
    batch: { batchCode: string; houseId: string; currentBirdCount: number; dateReceived: Date },
    feedItems: StoreItem[], aliasMap: Map<string, StoreItem>, discrepancies: ReconcileOutcome['discrepancies'], appliedChanges: AppliedChangeInput[], onAutofill: () => void, onMatch: () => void,
  ) {
    // ── Split feed cell (e.g. "chickcrumbs/growers 75:25%") ────────────────
    // Each portion is matched + reconciled against its OWN StoreItem
    // (Crumbs vs Growers), independently, since stores already issued that
    // day's stock-out split to the report's ratio — see reconcileFeedSplit.
    if (row.feedSplit && row.feedSplit.length >= 2) {
      await this.reconcileFeedSplit(row, batchId, logDate, uploaderId, noteSuffix, stageBucket, batch, feedItems, aliasMap, discrepancies, appliedChanges, onAutofill, onMatch);
      return;
    }

    const matchedFeedItem = resolveItemMatch(row.feedType, feedItems, aliasMap);

    if (stageBucket === 'PRODUCTION') {
      const existing = await this.prisma.eggCollectionSession.findUnique({
        where: { batchId_houseId_sessionDate_shift: { batchId, houseId: batch.houseId, sessionDate: logDate, shift: 'AM' } },
      });
      if (!existing) {
        // Nowhere to write yet — not a value difference, still flagged.
        row.resolution.feedKg = 'DISCREPANCY';
        discrepancies.push({
          rowDate: row.date, field: 'feedKg', discrepancyType: ProductionReportDiscrepancyType.FEED,
          locationRef: row.locationRef, systemValue: null, reportValue: `${row.feedKg} kg`,
          notes: 'No egg-collection session exists yet for this date.',
        });
        return;
      }
      const systemFeed = existing.feedKg != null ? Number(existing.feedKg) : 0;
      if (Math.abs(systemFeed - row.feedKg!) < 0.01) {
        row.resolution.feedKg = 'MATCHED';
        onMatch();
        await this.checkProductionFeedWastage(row, batchId, batch, logDate, existing.id, systemFeed, matchedFeedItem, uploaderId, appliedChanges);
        return;
      }
      // Report is authoritative — correct to match it, whether higher or
      // lower, regardless of whether a store item was matched (the field
      // itself is just a number + a display label, no per-item balance to
      // check for a single-value session field).
      await this.prisma.eggCollectionSession.update({
        where: { id: existing.id },
        data: { feedKg: row.feedKg!, feedTypeName: matchedFeedItem?.name ?? row.feedType ?? existing.feedTypeName },
      });
      this.logChange(appliedChanges, batchId, row.date, 'EggCollectionSession.feedKg', existing.id, 'UPDATE', { feedKg: systemFeed }, { feedKg: row.feedKg! });
      row.resolution.feedKg = 'AUTOFILLED';
      onAutofill();
      await this.checkProductionFeedWastage(row, batchId, batch, logDate, existing.id, row.feedKg!, matchedFeedItem, uploaderId, appliedChanges);
      return;
    }

    // ── Brooder/grower stage — read-only (see BROODER_MGMT_IS_READ_ONLY) ──
    // Compare the report's feed figure against what the attendant already
    // recorded and raise a discrepancy on a mismatch; never create, delete,
    // or replace a BrooderGeneralFeedLog/BrooderLevelFeedLog row from it.
    const hasLevelDetail = await this.hasLevelSpecificFeedLog(batchId, logDate);
    const existing = await this.prisma.brooderGeneralFeedLog.findMany({ where: { batchId, entryDate: logDate } });
    const systemTotal = existing.reduce((s, e) => s + e.quantityDispensedKg, 0);

    if (!hasLevelDetail && existing.length === 0 && row.feedKg! <= 0) {
      row.resolution.feedKg = 'MATCHED';
      onMatch();
      return;
    }

    const wastagePopulation = row.openingStock ?? batch.currentBirdCount;
    const ageWeeks = batchAgeWeeks(batch.dateReceived, logDate);
    const dailyRationKg = brooderRequiredFeedKg(wastagePopulation, ageWeeks, 1);

    if (!hasLevelDetail && Math.abs(systemTotal - row.feedKg!) < 0.001) {
      row.resolution.feedKg = 'MATCHED';
      onMatch();
      // Nothing to reconcile this call, but the day itself may still be
      // over ration on the attendant's OWN figures — this only reads
      // BrooderGeneralFeedLog rows the attendant already wrote, so it's
      // Director-facing analytics, not a change to brooder management data.
      try {
        const backfilled = await this.feedWastage.backfillDayIfOverIssued({
          batch: { id: batchId, batchCode: batch.batchCode },
          entryDate: logDate,
          dailyRationKg,
          loggedById: uploaderId,
          notify: true,
        });
        if (backfilled) {
          this.logChange(appliedChanges, batchId, row.date, 'BrooderFeedWastageLog', backfilled.id, 'CREATE', null, backfilled);
        }
      } catch (wastageErr: any) {
        this.logger.warn(
          `[ProductionReportReconciliation] Feed-wastage backfill check failed for batch ${batchId} ` +
          `on ${row.date} (${wastageErr?.code ?? wastageErr?.message}).`,
        );
      }
      return;
    }

    row.resolution.feedKg = 'DISCREPANCY';
    discrepancies.push({
      rowDate: row.date, field: 'feedKg', discrepancyType: ProductionReportDiscrepancyType.FEED,
      locationRef: row.locationRef,
      systemValue: hasLevelDetail ? null : (existing.length ? `${systemTotal} kg` : null),
      reportValue: `${row.feedKg} kg`,
      notes: hasLevelDetail
        ? 'Feed is already logged at row/level detail for this batch on this date — shown here for the ' +
          'Director to compare against the report; resolve manually at row/level if it needs correcting.'
        : this.brooderReadOnlyNote('feed'),
    });
  }

  // ── PRODUCTION-stage feed wastage: population from the report's OPENING
  // STOCK only ─────────────────────────────────────────────────────────────
  //
  // Same rule the brooder path above now applies too (see wastagePopulation
  // in reconcileFeed/reconcileFeedSplit) — a laying batch's day-to-day
  // population for feed-wastage purposes comes from the report itself: the
  // "O.stock" (opening stock) column on that day's row, never
  // Batch.currentBirdCount, which is only today's live count and is wrong
  // for pricing a HISTORICAL report date. This is deliberate — once a batch
  // is in PRODUCTION, the farm's own daily record sheet IS the population of
  // record for that day (closing stock is
  // end-of-day, after that day's own losses/culls, so it's not what was
  // actually present and eating feed that day — opening stock is).
  //
  // Best-effort, same as the brooder check: never let a failure here
  // surface as a reconciliation error, and skip silently (no throw) if the
  // row didn't carry an opening-stock figure at all — there's no population
  // to compare against, so there's nothing to flag.
  private async checkProductionFeedWastage(
    row: ParsedReportRow, batchId: string,
    batch: { batchCode: string; dateReceived: Date },
    logDate: Date, sessionId: string, actualFeedKg: number,
    matchedFeedItem: StoreItem | null, uploaderId: string,
    appliedChanges: AppliedChangeInput[],
  ) {
    if (row.openingStock == null || row.openingStock <= 0) return;
    try {
      const ageWeeks = batchAgeWeeks(batch.dateReceived, logDate);
      const feedType = mapFeedType(matchedFeedItem?.name, row.feedType);

      // TODO(reminder — confirm with Director): g/bird/day for this check
      // is now sourced from the SAME live HYLINE_SCHEDULE table shown on the
      // Director/Manager dashboard (BrooderControlStandardPanel — the one
      // with the weekly feed AND min/max weight columns), via
      // hylineGramsPerBirdPerDay(), instead of the old flat 115g
      // "production phase" bracket in gramsPerBirdPerDay(). Requested
      // 2026-08-18 while the current batch is still at week 8, so this
      // hasn't been exercised past the table's last real row yet.
      //
      // HYLINE_SCHEDULE only has rows through week 19 (Prelayer) — it's a
      // REARING chart, not an in-lay one — so hylineStandard() clamps any
      // ageWeeks beyond that to week 19's figure (89g/bird). The Director
      // still needs to supply real production-phase (in-lay, week 20+)
      // g/bird/day figures to extend the table; until that happens, every
      // row for a batch past week 19 is under-priced against week 19's
      // pre-lay ration, not a true in-lay one. The warning below fires the
      // first time that clamp is actually hit so it doesn't go unnoticed.
      if (ageWeeks > HYLINE_SCHEDULE_MAX_WEEK) {
        this.logger.warn(
          `[ProductionReportReconciliation] Batch ${batch.batchCode} is at week ${ageWeeks}, ` +
          `past the HYLINE_SCHEDULE table's last row (week ${HYLINE_SCHEDULE_MAX_WEEK}). ` +
          `Feed-wastage requiredKg for ${row.date} is being clamped to week ${HYLINE_SCHEDULE_MAX_WEEK}'s ` +
          `pre-lay ration — real in-lay g/bird/day figures still need to be added to the schedule.`,
        );
      }

      const requiredKg = requiredFeedKg(
        row.openingStock, FeedType.LAYER_MASH, ageWeeks, 1,
        (_feedType, aw) => hylineGramsPerBirdPerDay(aw),
      );
      const mortalityFeedCreditKg = await this.getProductionMortalityFeedCreditKg(sessionId);
      const wastageLog = await this.feedWastage.recordProductionOverIssuance({
        batch: { id: batchId, batchCode: batch.batchCode },
        entryDate: logDate,
        populationOpeningStock: row.openingStock,
        requiredKg,
        actualKg: actualFeedKg,
        sourceEntityId: sessionId,
        feedType,
        storeItemId: matchedFeedItem?.id ?? null,
        loggedById: uploaderId,
        mortalityFeedCreditKg,
      });
      if (wastageLog) {
        this.logChange(appliedChanges, batchId, row.date, 'BrooderFeedWastageLog', wastageLog.id, 'CREATE', null, wastageLog);
      }
    } catch (wastageErr: any) {
      this.logger.warn(
        `[ProductionReportReconciliation] Production feed-wastage check failed for batch ${batchId} ` +
        `on ${row.date} (${wastageErr?.code ?? wastageErr?.message}). Report row was still applied.`,
      );
    }
  }

  /** Feed not consumed that session because of mortality — the
   *  EggCollectionSession-side equivalent of
   *  FeedWastageService.getBrooderMortalityFeedCreditKg. GENERAL mode reads
   *  the scalar mortalityFeedAlreadyEatenKg; PER_ROW mode sums
   *  feedAlreadyEatenKg across mortalityRowBreakdown's entries. */
  private async getProductionMortalityFeedCreditKg(sessionId: string): Promise<number> {
    const session = await this.prisma.eggCollectionSession.findUnique({
      where: { id: sessionId },
      select: { mortalityMode: true, mortalityFeedAlreadyEatenKg: true, mortalityRowBreakdown: true },
    });
    if (!session) return 0;
    if (session.mortalityMode === 'PER_ROW') {
      const rows = Array.isArray(session.mortalityRowBreakdown) ? session.mortalityRowBreakdown as any[] : [];
      return rows.reduce((sum, r) => sum + (Number(r?.feedAlreadyEatenKg) || 0), 0);
    }
    return Number(session.mortalityFeedAlreadyEatenKg ?? 0);
  }

  /** Reconciles a two-way split feed cell — e.g. "chickcrumbs/growers
   *  75:25%" on a 387kg row means 75% (290.25kg) is Chick Crumbs and 25%
   *  (96.75kg) is Growers Mash. Each portion is matched to its own StoreItem
   *  and corrected to match the report exactly (§report-is-authoritative) —
   *  no held-balance ceiling, no blocking a lower figure.
   *
   *  BROODING/GROWER (and OTHER, same brooder-style sheet): each portion
   *  becomes its own BrooderGeneralFeedLog row — the table already supports
   *  multiple same-day entries with different feedType/storeItemId, so a
   *  split maps onto it cleanly. PRODUCTION (egg-laying): EggCollectionSession
   *  has only ONE combined feedKg/feedTypeName field, so a split is written
   *  as the report's total kg with a descriptive feedTypeName (e.g. "Chick
   *  Crumbs 75% / Growers 25%") — there's no per-item breakdown to store at
   *  that stage, same as the single-item PRODUCTION path above. */
  private async reconcileFeedSplit(
    row: ParsedReportRow, batchId: string, logDate: Date, uploaderId: string, noteSuffix: string,
    stageBucket: 'BROODING' | 'PRODUCTION' | 'OTHER',
    batch: { batchCode: string; houseId: string; currentBirdCount: number; dateReceived: Date },
    feedItems: StoreItem[], aliasMap: Map<string, StoreItem>, discrepancies: ReconcileOutcome['discrepancies'], appliedChanges: AppliedChangeInput[], onAutofill: () => void, onMatch: () => void,
  ) {
    const portions = row.feedSplit!;
    const splitSummary = portions.map(p => `${p.label} ${p.percent}%`).join(' / ');

    if (stageBucket === 'PRODUCTION') {
      const existing = await this.prisma.eggCollectionSession.findUnique({
        where: { batchId_houseId_sessionDate_shift: { batchId, houseId: batch.houseId, sessionDate: logDate, shift: 'AM' } },
      });
      if (!existing) {
        row.resolution.feedKg = 'DISCREPANCY';
        discrepancies.push({
          rowDate: row.date, field: 'feedKg', discrepancyType: ProductionReportDiscrepancyType.FEED,
          locationRef: row.locationRef, systemValue: null, reportValue: `${row.feedKg} kg (${splitSummary})`,
          notes: 'No egg-collection session exists yet for this date.',
        });
        return;
      }
      const systemFeed = existing.feedKg != null ? Number(existing.feedKg) : 0;
      if (Math.abs(systemFeed - row.feedKg!) < 0.01) {
        row.resolution.feedKg = 'MATCHED';
        onMatch();
        return;
      }
      const labelText = portions.map(p => {
        const m = resolveItemMatch(p.label, feedItems, aliasMap);
        return `${m?.name ?? p.label} ${p.percent}%`;
      }).join(' / ');
      await this.prisma.eggCollectionSession.update({
        where: { id: existing.id },
        data: { feedKg: row.feedKg!, feedTypeName: labelText },
      });
      this.logChange(appliedChanges, batchId, row.date, 'EggCollectionSession.feedKg', existing.id, 'UPDATE', { feedKg: systemFeed }, { feedKg: row.feedKg! });
      row.resolution.feedKg = 'AUTOFILLED';
      onAutofill();
      return;
    }

    // ── Brooder/grower stage — read-only (see BROODER_MGMT_IS_READ_ONLY) ──
    // Compare each portion against the attendant's own per-item records and
    // raise a discrepancy on a mismatch; never create/delete a
    // BrooderGeneralFeedLog row from a report split.
    const hasLevelDetail = await this.hasLevelSpecificFeedLog(batchId, logDate);
    const existing = await this.prisma.brooderGeneralFeedLog.findMany({ where: { batchId, entryDate: logDate } });

    if (!hasLevelDetail && existing.length === 0 && (row.feedKg ?? 0) <= 0) {
      row.resolution.feedKg = 'MATCHED';
      onMatch();
      return;
    }

    const wastagePopulation = row.openingStock ?? batch.currentBirdCount;
    const ageWeeks = batchAgeWeeks(batch.dateReceived, logDate);
    const dailyRationKg = brooderRequiredFeedKg(wastagePopulation, ageWeeks, 1);

    let anyMatched = false;
    let anyMismatch = false;

    if (!hasLevelDetail) {
      for (const portion of portions) {
        const matchedItem = resolveItemMatch(portion.label, feedItems, aliasMap);
        if (!matchedItem) {
          anyMismatch = true;
          discrepancies.push({
            rowDate: row.date, field: `feedType:${portion.label}`, discrepancyType: ProductionReportDiscrepancyType.FEED,
            locationRef: row.locationRef, systemValue: null, reportValue: portion.label,
            notes: `Could not match split portion "${portion.label}" (${portion.percent}% of ${row.feedKg} kg) to any store item.`,
          });
          continue;
        }
        const existingForItem = existing.filter(e => e.storeItemId === matchedItem.id);
        const systemQtyForItem = existingForItem.reduce((s, e) => s + e.quantityDispensedKg, 0);
        if (Math.abs(systemQtyForItem - portion.kg) < 0.001) {
          anyMatched = true;
          continue;
        }
        anyMismatch = true;
        discrepancies.push({
          rowDate: row.date, field: `feedType:${portion.label}`, discrepancyType: ProductionReportDiscrepancyType.FEED,
          locationRef: row.locationRef,
          systemValue: existingForItem.length ? `${systemQtyForItem} kg` : null,
          reportValue: `${portion.kg} kg (${portion.percent}% of sheet total "${row.feedType}")`,
          notes: this.brooderReadOnlyNote('feed'),
        });
      }
    } else {
      anyMismatch = true;
      discrepancies.push({
        rowDate: row.date, field: 'feedKg', discrepancyType: ProductionReportDiscrepancyType.FEED,
        locationRef: row.locationRef, systemValue: null, reportValue: `${row.feedKg} kg (${splitSummary})`,
        notes: 'Feed is already logged at row/level detail for this batch on this date — shown here for the ' +
          'Director to compare against the report.',
      });
    }

    if (anyMismatch) {
      row.resolution.feedKg = 'DISCREPANCY';
      return;
    }
    row.resolution.feedKg = 'MATCHED';
    onMatch();
    if (anyMatched) {
      // Every portion already matches the attendant's own records — the day
      // may still be over ration on those figures alone; this only reads
      // existing BrooderGeneralFeedLog rows, so it's Director-facing
      // analytics, not a change to brooder management data.
      try {
        const backfilled = await this.feedWastage.backfillDayIfOverIssued({
          batch: { id: batchId, batchCode: batch.batchCode },
          entryDate: logDate,
          dailyRationKg,
          loggedById: uploaderId,
          notify: true,
        });
        if (backfilled) {
          this.logChange(appliedChanges, batchId, row.date, 'BrooderFeedWastageLog', backfilled.id, 'CREATE', null, backfilled);
        }
      } catch (wastageErr: any) {
        this.logger.warn(
          `[ProductionReportReconciliation] Feed-wastage backfill check failed for batch ${batchId} ` +
          `on ${row.date} (split, ${wastageErr?.code ?? wastageErr?.message}).`,
        );
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
  //
  // This is also the ONLY place BrooderStockCount rows ever get written —
  // there's no manual attendant endpoint for it (see brooder.controller.ts),
  // so a batch's opening/closing stock only ever comes from an uploaded
  // report. That makes this report's closingStock the most authoritative
  // whole-batch headcount the farm has: a physical count of what's actually
  // in the brooder at end of day, as opposed to Batch.currentBirdCount,
  // which only ever moves by SUBTRACTING logged mortality/culling from
  // whatever it started at — so it silently drifts from reality if any
  // death ever went unlogged (bird escaped, uncounted DOA found late,
  // logging gap, etc.) without a physical count ever correcting it back.
  // See syncGeneralPopulationFromClosingStock below for how that correction
  // is applied, and why it's gated on this being the MOST RECENT stock
  // count/mortality data point the system has for the batch.
  /** Finds the most recent entry in an in-memory stock-count timeline with a
   *  date strictly before `logDate`. Replaces what used to be a `findFirst`
   *  DB round-trip per row — see the timeline setup in reconcile() — with a
   *  plain scan over a list that's small even across a batch's whole life
   *  (one entry per day it's been in the brooder). */
  private findPriorStockEntry(
    timeline: { logDate: Date; closingStock: number }[], logDate: Date,
  ): { logDate: Date; closingStock: number } | null {
    let best: { logDate: Date; closingStock: number } | null = null;
    for (const entry of timeline) {
      if (entry.logDate.getTime() < logDate.getTime() && (!best || entry.logDate.getTime() > best.logDate.getTime())) {
        best = entry;
      }
    }
    return best;
  }

  /** How many consecutive days immediately BEFORE logDate already have a
   *  non-zero recorded stock-count variance — i.e. how long this mismatch
   *  has already been recurring. Purely used to escalate wording (a 4th
   *  consecutive day is a very different problem than a one-off recount),
   *  never to change what gets written. Capped at 14 days back so a very
   *  old, long-since-fixed batch can't make every new report pay for an
   *  unbounded walk. */
  private async computeStockVarianceStreak(batchId: string, logDate: Date): Promise<number> {
    let streak = 0;
    let cursor = logDate;
    for (let i = 0; i < 14; i++) {
      cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
      const entry = await this.prisma.brooderStockCount.findUnique({
        where: { batchId_logDate: { batchId, logDate: cursor } }, select: { variance: true },
      });
      if (!entry || !entry.variance) break;
      streak++;
    }
    return streak;
  }

  /** Pure computation half of stock-count reconciliation — no DB access, so
   *  it's safe (and cheap) to run for every row in the sequential timeline
   *  pass in reconcile(). Everything that used to live inline in
   *  reconcileStockCount before the DB writes now lives here instead. */
  private computeStockCountOutcome(
    row: ParsedReportRow, logDate: Date, timeline: { logDate: Date; closingStock: number }[],
  ) {
    const priorEntry = this.findPriorStockEntry(timeline, logDate);
    const expectedOpeningStock = priorEntry?.closingStock ?? null;
    const openingVariance = expectedOpeningStock != null ? row.openingStock! - expectedOpeningStock : 0;

    const dayLosses = (row.mortality ?? 0) + (row.culling ?? 0);
    const expectedClosingFromRow = Math.max(0, row.openingStock! - dayLosses);
    const arithmeticMismatch = row.closingStock! !== expectedClosingFromRow;

    const varianceReason = openingVariance !== 0
      ? `Opening stock (${row.openingStock}) differs from the previous count's closing stock (${expectedOpeningStock}) by ${Math.abs(openingVariance)} bird(s).`
      : null;

    return { priorEntry, expectedOpeningStock, openingVariance, dayLosses, expectedClosingFromRow, arithmeticMismatch, varianceReason };
  }

  /** DB-writing half of stock-count reconciliation, given an outcome already
   *  computed by computeStockCountOutcome(). Queued and run concurrently
   *  (see reconcile()'s stockWrites flush) since, unlike the compute step,
   *  nothing here depends on another row's write having landed first. */
  private async applyStockCountOutcome(
    row: ParsedReportRow, batchId: string, logDate: Date, uploaderId: string, noteSuffix: string,
    outcome: ReturnType<ProductionReportReconciliationService['computeStockCountOutcome']>,
    discrepancies: ReconcileOutcome['discrepancies'], appliedChanges: AppliedChangeInput[], onAutofill: () => void, onMatch: () => void,
  ) {
    const { priorEntry, expectedOpeningStock, openingVariance, dayLosses, expectedClosingFromRow, arithmeticMismatch, varianceReason } = outcome;

    const existing = await this.prisma.brooderStockCount.findUnique({ where: { batchId_logDate: { batchId, logDate } } });
    if (!existing) {
      const created = await this.prisma.brooderStockCount.create({
        data: {
          batchId, logDate,
          openingStock: row.openingStock!, closingStock: row.closingStock!,
          expectedOpeningStock, variance: openingVariance, varianceReason,
          mortalityCount: row.mortality ?? 0, cullingCount: row.culling ?? 0,
          notes: `Auto-filled ${noteSuffix}`, loggedById: uploaderId,
        },
      });
      this.logChange(appliedChanges, batchId, row.date, 'BrooderStockCount', created.id, 'CREATE', null, created);
      row.resolution.stockCount = 'AUTOFILLED';
      onAutofill();
    } else if (existing.openingStock === row.openingStock && existing.closingStock === row.closingStock) {
      row.resolution.stockCount = 'MATCHED';
      onMatch();
      // Even an unchanged row gets its variance figures backfilled if this
      // is the first time a prior count exists to compare against (e.g. the
      // previous day's report was only uploaded after this one).
      if (existing.expectedOpeningStock !== expectedOpeningStock || existing.variance !== openingVariance) {
        await this.prisma.brooderStockCount.update({
          where: { id: existing.id },
          data: { expectedOpeningStock, variance: openingVariance, varianceReason },
        });
      }
    } else {
      // Report is authoritative — correct to match it.
      const before = { openingStock: existing.openingStock, closingStock: existing.closingStock };
      await this.prisma.brooderStockCount.update({
        where: { id: existing.id },
        data: {
          openingStock: row.openingStock!, closingStock: row.closingStock!,
          expectedOpeningStock, variance: openingVariance, varianceReason,
        },
      });
      this.logChange(appliedChanges, batchId, row.date, 'BrooderStockCount', existing.id, 'UPDATE', before, { openingStock: row.openingStock!, closingStock: row.closingStock! });
      row.resolution.stockCount = 'AUTOFILLED';
      onAutofill();
    }

    // ── Flag 1: opening count doesn't match the previous count's closing
    // figure — a physical recount found more/fewer birds than expected.
    //
    // Previously this only ever fired a notification — it never became a
    // ProductionReportDiscrepancy, so it never showed up in Store's own
    // report-review screen, never entered the audit trail, and (since
    // reconciliation "corrects to match the report" unconditionally either
    // way — see the write above) nothing stopped the exact same mismatch
    // from recurring silently on every single future upload. It's now
    // recorded as a real (pre-resolved, since the correction above already
    // applied it) discrepancy — same pattern as WEIGHT — specifically so it
    // has a queryable history: computeStockVarianceStreak() below turns
    // that history into an escalating warning the moment it starts
    // repeating, instead of treating day 7 of the same drift exactly like
    // day 1. ──────────────────────────────────────────────────────────────
    if (openingVariance !== 0 && expectedOpeningStock != null) {
      const direction = openingVariance > 0 ? 'increased' : 'decreased';
      const streak = await this.computeStockVarianceStreak(batchId, logDate);
      const streakNote = streak > 0
        ? ` This is day ${streak + 1} in a row this has happened — worth checking WHY the physical count keeps drifting (a systematic counting habit, a cage move that isn't being logged, chicks moved between cages same-day) rather than re-accepting a new figure each time.`
        : '';
      discrepancies.push({
        rowDate: row.date, field: 'openingStock', discrepancyType: ProductionReportDiscrepancyType.STOCK_COUNT,
        locationRef: row.locationRef, systemValue: `O:${expectedOpeningStock}/C:${Math.max(0, expectedOpeningStock - dayLosses)}`,
        reportValue: `O:${row.openingStock}/C:${row.closingStock}`, preResolved: true,
        notes: `Opening stock (${row.openingStock}) differs from the previous count's closing stock ` +
          `(${expectedOpeningStock}) by ${Math.abs(openingVariance)} bird(s) — the count has ${direction} with ` +
          `no recorded reason.${streakNote}`,
      });
      await this.alertStockMismatch(
        batchId,
        streak >= 2 ? `Recurring Stock Count Mismatch (${streak + 1} days running) — Batch` : `Stock Count Mismatch — Batch`,
        `The opening stock reported for ${row.date} is ${row.openingStock!.toLocaleString()}, but the previous count ` +
        `(${dayjs(priorEntry!.logDate).format('YYYY-MM-DD')}) closed at ${expectedOpeningStock.toLocaleString()} — ` +
        `the count has ${direction} by ${Math.abs(openingVariance).toLocaleString()} bird(s) with no recorded reason.${streakNote}`,
        streak >= 2,
      );
    }

    // ── Flag 2: this row's own closing stock doesn't reconcile against its
    // own opening stock minus its own recorded mortality/culling. Same
    // "now a real discrepancy, not just a notification" treatment as Flag 1
    // above — this is very often a report simply not carrying a separate
    // culling column (see ProductionReportTemplateService, which now checks
    // for exactly this pattern when recommending the NEXT batch's columns).
    if (arithmeticMismatch) {
      const gap = row.closingStock! - expectedClosingFromRow;
      discrepancies.push({
        rowDate: row.date, field: 'closingStock', discrepancyType: ProductionReportDiscrepancyType.STOCK_COUNT,
        locationRef: row.locationRef, systemValue: `O:${row.openingStock}/C:${expectedClosingFromRow}`,
        reportValue: `O:${row.openingStock}/C:${row.closingStock}`, preResolved: true,
        notes: `On ${row.date}, the report shows opening stock ${row.openingStock} minus ${dayLosses} mortality/culling, ` +
          `which should leave ${expectedClosingFromRow}, but the reported closing stock is ${row.closingStock} instead — ` +
          `a ${Math.abs(gap)}-bird discrepancy in how the sheet's own figures were calculated.`,
      });
      await this.alertStockMismatch(
        batchId,
        `Stock Count Doesn't Add Up — Batch`,
        `On ${row.date}, the report shows opening stock ${row.openingStock} minus ${dayLosses} mortality/culling, ` +
        `which should leave ${expectedClosingFromRow}, but the reported closing stock is ${row.closingStock} instead — ` +
        `a ${Math.abs(gap)}-bird discrepancy in how the sheet's own figures were calculated.`,
      );
    }
    // NOTE: syncGeneralPopulationFromClosingStock is now called ONCE from
    // reconcile() itself, for the report's single latest-dated row — not
    // here per row — see the Phase 1 comment above for why.
  }

  // ── BROODER_STOCK_MISMATCH — Manager + Owner facing, best-effort ────────
  // Covers two distinct kinds of stock-count problems (see the two call
  // sites in reconcileStockCount): a cross-day drift between one count's
  // closing figure and the next count's opening figure, and a same-day
  // arithmetic error where a row's own closing stock doesn't follow from
  // its own opening stock minus its own recorded losses. Both are
  // visibility-only — never blocks the report's auto-fill — since the farm
  // still needs the raw sheet figures captured even when they don't add up;
  // this just makes sure a human looks at it.
  private async alertStockMismatch(batchId: string, title: string, message: string, escalate = false) {
    try {
      const batch = await this.prisma.batch.findUnique({ where: { id: batchId }, select: { batchCode: true } });
      const fullTitle = `${title} ${batch?.batchCode ?? ''}`.trim();
      const roles = escalate ? [UserRole.MANAGER, UserRole.OWNER, UserRole.STORE] : [UserRole.MANAGER, UserRole.OWNER];
      await Promise.all(
        roles.map(role => this.notifications.notifyRole(role, 'BROODER_STOCK_MISMATCH', fullTitle, message, { entityId: batchId, entityType: 'Brooder' })),
      );
    } catch (err: any) {
      this.logger.warn(`[ProductionReportReconciliation] Stock-mismatch alert failed for batch ${batchId} (${err?.message}).`);
    }
  }

  // ── Sync Batch.currentBirdCount ("general population") to a report's
  // closing stock ──────────────────────────────────────────────────────────
  //
  // Batch.currentBirdCount is otherwise a pure decrement counter — every
  // BrooderGeneralMortalityLog entry subtracts from it, but nothing ever
  // corrects it back up against an actual physical count. A closing-stock
  // figure on the daily record sheet IS that physical count, so once a
  // report carries one, it should become the batch's general population —
  // not just be filed away in BrooderStockCount for reference.
  //
  // Guarded to only apply when this row's date is the MOST RECENT
  // population data point the system has for the batch (the latest of any
  // existing BrooderStockCount or BrooderGeneralMortalityLog entry) — a
  // backdated/historical report being reconciled after the fact must never
  // roll the live count backward to an old closing-stock figure, since
  // mortality logged since then has already moved it further.
  private async syncGeneralPopulationFromClosingStock(
    batchId: string, logDate: Date, closingStock: number, rowDateStr: string,
    appliedChanges: AppliedChangeInput[],
  ) {
    const [latestStockCount, latestMortality, batch] = await Promise.all([
      this.prisma.brooderStockCount.findFirst({
        where: { batchId, logDate: { not: logDate } }, orderBy: { logDate: 'desc' }, select: { logDate: true },
      }),
      this.prisma.brooderGeneralMortalityLog.findFirst({
        where: { batchId }, orderBy: { logDate: 'desc' }, select: { logDate: true },
      }),
      this.prisma.batch.findUnique({ where: { id: batchId }, select: { currentBirdCount: true } }),
    ]);
    if (!batch) return;

    const latestKnownDate = [latestStockCount?.logDate, latestMortality?.logDate]
      .filter((d): d is Date => !!d)
      .reduce<Date | undefined>((max, d) => (!max || d.getTime() > max.getTime() ? d : max), undefined);

    if (latestKnownDate && logDate.getTime() < latestKnownDate.getTime()) {
      // A more recent stock count or mortality entry already exists — this
      // report row is backdated, so leave the live count alone.
      return;
    }

    if (batch.currentBirdCount === closingStock) return;

    const before = batch.currentBirdCount;
    await this.prisma.batch.update({ where: { id: batchId }, data: { currentBirdCount: closingStock } });
    this.logChange(
      appliedChanges, batchId, rowDateStr, 'Batch.currentBirdCount', batchId, 'UPDATE',
      { currentBirdCount: before }, { currentBirdCount: closingStock },
    );
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
    discrepancies: ReconcileOutcome['discrepancies'], appliedChanges: AppliedChangeInput[], onAutofill: () => void, onMatch: () => void,
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
      const before = existing ? { batchId: existing.batchId, birdCount: existing.birdCount } : null;
      const saved = await tx.brooderCageAssignment.upsert({
        where: { cageId: cage.id },
        create: {
          cageId: cage.id, batchId, birdCount: reportCount, placedDate: logDate,
          notes: `Auto-filled ${noteSuffix}`, assignedById: uploaderId,
        },
        update: { batchId, birdCount: reportCount, assignedById: uploaderId },
      });
      this.logChange(
        appliedChanges, batchId, row.date, 'BrooderCageAssignment', cage.id,
        existing ? 'UPDATE' : 'CREATE', before, { batchId: saved.batchId, birdCount: saved.birdCount },
      );
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
  // Maps the parser's time-of-day labels onto the DB's session enum — kept
  // as a single source of truth so a relabelling in one place doesn't
  // silently desync from the other. Uses the enum's string values directly
  // (Prisma string enums ARE their string value at runtime) rather than
  // referencing `BrooderLogSession.MORNING` etc., so this never depends on
  // the generated client being loaded before this class is — it's just a
  // plain string map, type-checked against the enum at compile time.
  private static readonly SESSION_BY_LABEL: Record<string, BrooderLogSession> = {
    Morning: 'MORNING' as BrooderLogSession,
    Midday: 'MIDDAY' as BrooderLogSession,
    Evening: 'EVENING' as BrooderLogSession,
  };

  /** Auto-records temperature/humidity/lux into the per-session BrooderLog
   *  rows (morning/midday/evening — §screenshot). Two source shapes feed
   *  this, both already normalised into `row.<field>Readings` by the
   *  parser: a sheet with one column per session ("Temp AM"/"Temp Noon"/
   *  "Temp PM"), or — the more common paper-sheet shorthand — a single
   *  "Temp" column whose cell packs all of a day's readings together
   *  ("32,31,30"), split by the parser into the same shape. Either way,
   *  only the first 3 readings are ever used (extras ignored); 2 readings
   *  map to Morning+Midday, 1 to Morning only.
   *
   *  Unlike feed/mortality, a sensor reading isn't additive — a session can
   *  only ever have had ONE actual temperature/humidity/lux at a given
   *  time, so a differing report value is a correction, not a delta: it
   *  overwrites the existing reading to match the report (§report-is-
   *  authoritative), same as every other field here. */
  private async reconcileEnvironmental(
    row: ParsedReportRow, batchId: string, logDate: Date, uploaderId: string, noteSuffix: string,
    discrepancies: ReconcileOutcome['discrepancies'], appliedChanges: AppliedChangeInput[], onAutofill: () => void, onMatch: () => void,
  ) {
    const bySession = this.buildSessionReadings(row);
    if (bySession.length === 0) return;

    // Read-only (see BROODER_MGMT_IS_READ_ONLY): compare against the
    // attendant's own BrooderLog readings; never write to it from a report.
    let anyMismatch = false, anyMatch = false;

    for (const { session, temperature, humidity, lux } of bySession) {
      if (temperature === undefined && humidity === undefined && lux === undefined) continue;

      const existing = await this.prisma.brooderLog.findFirst({ where: { batchId, logDate, logSession: session } });

      for (const [label, dbField, rawValue] of [
        ['temperature', 'temperature', temperature],
        ['humidity', 'humidityPercent', humidity],
        ['lux', 'lightIntensityLux', lux],
      ] as const) {
        if (rawValue === undefined) continue;
        const num = parseFloat(rawValue);
        if (!Number.isFinite(num)) continue;
        const existingVal = existing ? (existing as any)[dbField] as number | null : null;
        if (existingVal != null && Math.abs(existingVal - num) < 0.5) {
          anyMatch = true;
        } else {
          anyMismatch = true;
          discrepancies.push({
            rowDate: row.date, field: `${label}:${session}`, discrepancyType: ProductionReportDiscrepancyType.OTHER,
            locationRef: row.locationRef, systemValue: existingVal != null ? String(existingVal) : null, reportValue: String(num),
            notes: this.brooderReadOnlyNote(label),
          });
        }
      }
    }

    row.resolution.environmental = anyMismatch ? 'DISCREPANCY' : anyMatch ? 'MATCHED' : undefined;
    if (!anyMismatch && anyMatch) onMatch();
  }

  /** Merges each metric's per-session readings (favouring the multi-reading
   *  array when present, falling back to wrapping the single-value field as
   *  a one-element "Morning" reading) into one row-per-session shape. */
  private buildSessionReadings(row: ParsedReportRow): { session: BrooderLogSession; temperature?: string; humidity?: string; lux?: string }[] {
    const toArray = (readings: EnvReading[] | undefined, single: string | undefined): EnvReading[] => {
      if (readings && readings.length) return readings;
      if (single !== undefined) return [{ label: 'Morning', value: single }];
      return [];
    };
    const temp = toArray(row.temperatureReadings, row.temperature);
    const hum = toArray(row.humidityReadings, row.humidity);
    const lux = toArray(row.luxReadings, row.lux);

    const sessions = new Set<string>([...temp, ...hum, ...lux].map(r => r.label));
    return [...sessions]
      .filter((label): label is keyof typeof ProductionReportReconciliationService.SESSION_BY_LABEL => label in ProductionReportReconciliationService.SESSION_BY_LABEL)
      .map(label => ({
        session: ProductionReportReconciliationService.SESSION_BY_LABEL[label],
        temperature: temp.find(r => r.label === label)?.value,
        humidity: hum.find(r => r.label === label)?.value,
        lux: lux.find(r => r.label === label)?.value,
      }));
  }

  private async reconcileHealthUsages(
    row: ParsedReportRow, batchId: string, logDate: Date, uploaderId: string, noteSuffix: string,
    stageBucket: 'BROODING' | 'PRODUCTION' | 'OTHER',
    batch: { batchCode: string; houseId: string },
    vaccineItems: StoreItem[], supplementItems: StoreItem[], treatmentItems: StoreItem[], aliasMap: Map<string, StoreItem>,
    discrepancies: ReconcileOutcome['discrepancies'], appliedChanges: AppliedChangeInput[], onAutofill: () => void, onMatch: () => void,
  ) {
    // reconcile() can run more than once over the SAME already-parsed rows
    // — e.g. matchItem() re-reconciles the current report's saved rawRows
    // after Store manually matches an item name, without re-parsing the
    // file. row.healthUsages was already populated by the first pass, so
    // without clearing it here every re-run would append a second (third,
    // fourth, ...) copy of every vaccine/supplement/treatment entry onto
    // the row instead of replacing it.
    row.healthUsages = [];

    // A single cell can legitimately carry more than one item — e.g. a
    // "Drugs/Vaccine/Supplement" column reading "Amprolium, Vitalyte" or a
    // Vaccine column reading "ND vaccine/Gumboro vaccine". Matching the
    // WHOLE cell as one item name silently lost every item after the first
    // (the combined string never equals any single store item's name, so it
    // just fell straight to "could not match" and Store could only pick
    // ONE replacement — the rest of the cell's content was never recorded
    // at all). Splitting on comma/semicolon/slash first — the same
    // separators splitMultiValueCell() already uses for multi-reading
    // Temp/Humidity/Lux cells — and resolving each piece independently
    // means every item on the cell gets its own match attempt, its own
    // quantity, and (if unmatched) its own specific discrepancy, while a
    // cell with only one item behaves exactly as before (splitting text
    // with no separator returns a single-element array unchanged).
    type Candidate = { kind: ParsedHealthUsage['kind']; text: string; pool: StoreItem[]; sourceCell?: string };
    const candidates: Candidate[] = [];

    const pushSplitCandidates = (cellText: string | undefined, kind: ParsedHealthUsage['kind'], pool: StoreItem[]) => {
      if (!cellText) return;
      const tokens = splitMultiValueCell(cellText);
      for (const token of tokens) {
        candidates.push({ kind, text: token, pool, sourceCell: tokens.length > 1 ? cellText : undefined });
      }
    };

    pushSplitCandidates(row.vaccineText, 'vaccine', vaccineItems);
    pushSplitCandidates(row.supplementText, 'supplement', supplementItems);
    pushSplitCandidates(row.treatmentText, 'treatment', treatmentItems);
    // Blended fallback column: try each split-out piece against all three
    // pools independently and keep whichever kind actually matches it, per
    // §3's "let matching sort out which items to try" — a blended cell can
    // mix kinds within itself (e.g. "ND vaccine, Amprolium"), so the kind is
    // resolved per piece, not once for the whole cell.
    if (row.drugsVaccines && !row.vaccineText && !row.supplementText && !row.treatmentText) {
      const allPools: [ParsedHealthUsage['kind'], StoreItem[]][] = [
        ['vaccine', vaccineItems], ['supplement', supplementItems], ['treatment', treatmentItems],
      ];
      const tokens = splitMultiValueCell(row.drugsVaccines);
      for (const token of tokens) {
        let bestKind: ParsedHealthUsage['kind'] = 'treatment';
        let bestItem: StoreItem | null = null;
        for (const [kind, pool] of allPools) {
          const m = resolveItemMatch(token, pool, aliasMap);
          if (m) { bestItem = m; bestKind = kind; break; }
        }
        candidates.push({
          kind: bestKind, text: token, sourceCell: tokens.length > 1 ? row.drugsVaccines : undefined,
          pool: bestItem ? [bestItem] : [...vaccineItems, ...supplementItems, ...treatmentItems],
        });
      }
    }

    for (const c of candidates) {
      // Defensive: a blank/whitespace-only token should never reach here
      // (splitMultiValueCell() already trims and drops empty tokens), but
      // skip it outright rather than raising a discrepancy for text nobody
      // can act on if one ever slips through.
      if (!c.text || !c.text.trim()) continue;
      const matched = resolveItemMatch(c.text, c.pool, aliasMap);
      const qty = extractQuantity(c.text);
      const usage: ParsedHealthUsage = {
        kind: c.kind, rawText: c.text, storeItemId: matched?.id ?? null, storeItemName: matched?.name ?? null,
        quantity: qty?.qty, unit: qty?.unit, resolution: 'MATCHED',
      };
      row.healthUsages.push(usage);

      if (!matched) {
        usage.resolution = 'DISCREPANCY';
        // Name the exact field ("vaccine"/"supplement"/"treatment") AND
        // quote the exact raw text the sheet carried, in the note itself —
        // the frontend's UnmatchedItemRow only has `reportValue` to show as
        // the item's display label, so if that's ever blank the row renders
        // with nothing for Store to go on. Spelling it out here means the
        // note alone is always enough to diagnose the mismatch, even before
        // the "could not match" branch above.
        discrepancies.push({
          rowDate: row.date, field: c.kind, discrepancyType: ProductionReportDiscrepancyType.ITEM_ISSUANCE,
          locationRef: row.locationRef, systemValue: null, reportValue: c.text ?? null,
          notes: `Could not match this ${c.kind} — the report says "${c.text}" — to any store item. `
            + `Add a store item with that name, add it as an alias for an existing item, or fix the wording on the sheet.`
            + (c.sourceCell ? ` (This was one of several items packed into a single cell: "${c.sourceCell}" — matched items from that cell were still recorded normally.)` : ''),
        });
        continue;
      }

      const alreadyLoggedEvent = await this.hasHealthLogEntryToday(stageBucket, batchId, logDate, batch.houseId, c.kind, matched.id);

      if (stageBucket !== 'PRODUCTION') {
        // BROODING/GROWER — read-only (see BROODER_MGMT_IS_READ_ONLY): the
        // report can only confirm what the attendant already logged
        // (vaccinesJson/supplementsJson/BrooderTreatmentLog); it never
        // appends a new entry or corrects an existing one.
        if (alreadyLoggedEvent) {
          usage.resolution = 'MATCHED';
          onMatch();
        } else {
          usage.resolution = 'DISCREPANCY';
          discrepancies.push({
            rowDate: row.date, field: c.kind, discrepancyType: ProductionReportDiscrepancyType.ITEM_ISSUANCE,
            locationRef: row.locationRef, systemValue: null,
            reportValue: qty ? `${c.text} (${qty.qty}${qty.unit ?? ''})` : c.text,
            notes: this.brooderReadOnlyNote(c.kind),
          });
        }
        continue;
      }

      if (!qty) {
        // Text present (e.g. "Newcastle vaccine given") but no parseable
        // quantity — still worth recording the event, just with no stock
        // impact. Not a discrepancy: nothing was expected to be deducted.
        // Only write it once per (batch, date, item) though — re-running
        // reconciliation over a row that's already been recorded must never
        // append a second identical event line (§ the exact duplicate-
        // record bug this fix targets).
        usage.resolution = 'MATCHED';
        onMatch();
        if (!alreadyLoggedEvent) {
          const created = await this.writeHealthUsageLog(stageBucket, batchId, logDate, uploaderId, batch.houseId, c.kind, matched, usage, noteSuffix);
          this.logChange(appliedChanges, batchId, row.date, created.entityType, created.entityId, created.action, created.beforeState, created.afterState);
        }
        continue;
      }

      // §held-balance-aware delta correction: never write the full report
      // quantity again on top of what's already logged today for this
      // exact item — only the difference, and only if it's covered.
      const alreadyLoggedQty = await this.sumTodaysLoggedUsage(matched.id, batchId, logDate);
      const correction = await this.resolveItemCorrection(row, matched, alreadyLoggedQty, qty.qty, qty.unit, c.text!, batchId, logDate, discrepancies);
      usage.resolution = correction.resolution;
      if (correction.resolution === 'MATCHED') { onMatch(); continue; }
      if (correction.resolution === 'DISCREPANCY') continue; // never write on a blocked/short correction
      // AUTOFILLED — write only the delta amount, not the full report figure.
      onAutofill();
      // `correction.deltaToApply` comes out of resolveItemCorrection() already
      // converted into the store item's own stock unit (e.g. report said
      // "12MLS", item is stocked in litres -> deltaToApply is 0.012, in
      // litres) — `usage.unit` stays the REPORT's raw unit ("MLS") on
      // purpose here; writeHealthUsageLog() is the one place that decides
      // which of the two (raw dose vs. converted quantityUsed) each field
      // gets, so it needs both.
      const deltaUsage: ParsedHealthUsage = { ...usage, quantity: correction.deltaToApply };
      const created = await this.writeHealthUsageLog(stageBucket, batchId, logDate, uploaderId, batch.houseId, c.kind, matched, deltaUsage, noteSuffix, alreadyLoggedQty > 0 ? correction.note : undefined);
      this.logChange(appliedChanges, batchId, row.date, created.entityType, created.entityId, created.action, created.beforeState, created.afterState);
    }
  }

  /** Whether ANY entry already exists today for this (batch, date, item) —
   *  including zero-quantity "event only" entries, which sumTodaysLoggedUsage
   *  can't see since it only sums numeric quantityUsed. Used to stop the
   *  no-quantity health-usage branch from re-appending an identical line on
   *  every re-run of reconciliation over the same report row. */
  private async hasHealthLogEntryToday(
    stageBucket: 'BROODING' | 'PRODUCTION' | 'OTHER', batchId: string, logDate: Date, houseId: string,
    kind: ParsedHealthUsage['kind'], storeItemId: string,
  ): Promise<boolean> {
    if (stageBucket === 'PRODUCTION') {
      const existing = await this.prisma.eggCollectionSession.findUnique({
        where: { batchId_houseId_sessionDate_shift: { batchId, houseId, sessionDate: logDate, shift: 'AM' } },
      });
      return !!existing?.vaccineGiven;
    }
    if (kind === 'treatment') {
      const existing = await this.prisma.brooderTreatmentLog.findFirst({ where: { batchId, treatmentDate: logDate, storeItemId } });
      return !!existing;
    }
    const log = await this.prisma.brooderLog.findFirst({ where: { batchId, logDate, logSession: null } });
    for (const arr of [log?.vaccinesJson, log?.supplementsJson]) {
      if (!Array.isArray(arr)) continue;
      if ((arr as any[]).some(e => e?.storeItemId === storeItemId)) return true;
    }
    return false;
  }

  /** Shared wrapper around resolveReportCorrection() for a single matched
   *  StoreItem's health-usage quantity. Handles the §4 unit-conversion step
   *  first — a unit that can't be converted still needs a human (can't know
   *  what number to write), but once the quantity is in the item's own
   *  unit, whatever the report says is what gets recorded. */
  private async resolveItemCorrection(
    row: ParsedReportRow, item: StoreItem, alreadyRecorded: number, reportQty: number, reportUnit: string | undefined,
    rawText: string, batchId: string, logDate: Date, discrepancies: ReconcileOutcome['discrepancies'],
  ): Promise<CorrectionOutcome> {
    let neededQty = reportQty;
    if (reportUnit && reportUnit.toLowerCase() !== item.unit.toLowerCase()) {
      const converted = convertToUnit(reportQty, reportUnit, item.unit);
      if (converted === null) {
        discrepancies.push({
          rowDate: row.date, field: `item:${item.name}`, discrepancyType: ProductionReportDiscrepancyType.ITEM_ISSUANCE,
          locationRef: row.locationRef, systemValue: null, reportValue: `${reportQty} ${reportUnit}`,
          notes: `Unit "${reportUnit}" on the report could not be reconciled against stock unit "${item.unit}" — needs manual conversion.`,
        });
        return { resolution: 'DISCREPANCY', deltaToApply: 0, note: 'Unit mismatch — needs manual conversion.' };
      }
      neededQty = converted;
    }
    return resolveReportCorrection(alreadyRecorded, neededQty, item.unit);
  }

  /** Persists one matched vaccine/supplement/treatment usage into the
   *  stage-appropriate log. Brooder: BrooderTreatmentLog for treatments,
   *  BrooderLog.vaccinesJson/supplementsJson (once-daily entry) for
   *  vaccines/supplements. Production: EggCollectionSession.vaccineGiven —
   *  the only health-adjacent column that model currently has (see §5: a
   *  dedicated ProductionHealthLog is a bigger schema change, deferred). */
  private async writeHealthUsageLog(
    stageBucket: 'BROODING' | 'PRODUCTION' | 'OTHER', batchId: string, logDate: Date, uploaderId: string, houseId: string,
    kind: ParsedHealthUsage['kind'], item: StoreItem, usage: ParsedHealthUsage, noteSuffix: string, correctionNote?: string,
  ): Promise<{ entityType: string; entityId: string | null; action: AppliedChangeInput['action']; beforeState: unknown; afterState: unknown }> {
    const suffix = correctionNote ? `Correction: ${correctionNote} ${noteSuffix}` : `Auto-filled ${noteSuffix}`;

    if (stageBucket === 'PRODUCTION') {
      const existing = await this.prisma.eggCollectionSession.findUnique({
        where: { batchId_houseId_sessionDate_shift: { batchId, houseId, sessionDate: logDate, shift: 'AM' } },
      });
      if (!existing) return { entityType: 'EggCollectionSession.vaccineGiven', entityId: null, action: 'CREATE', beforeState: null, afterState: null }; // nothing to attach to
      // `usage.rawText` is the dosage exactly as the report wrote it (e.g.
      // "12MLS/120LTS") — never rebuilt from the converted quantity, which
      // would pair a converted number with the report's un-converted unit
      // (e.g. "0.012MLS" instead of "0.012L"). `usage.quantity`, when
      // present, is already expressed in the store item's own unit
      // (`item.unit`), not the report's.
      const line = `${item.name} (${usage.rawText})${usage.quantity != null ? ` — ${usage.quantity}${item.unit} used` : ''} — ${suffix}`;
      const before = existing.vaccineGiven;
      const after = existing.vaccineGiven ? `${existing.vaccineGiven}; ${line}` : line;
      await this.prisma.eggCollectionSession.update({ where: { id: existing.id }, data: { vaccineGiven: after } });
      return { entityType: 'EggCollectionSession.vaccineGiven', entityId: existing.id, action: 'UPDATE', beforeState: { vaccineGiven: before }, afterState: { vaccineGiven: after } };
    }

    if (kind === 'treatment') {
      const created = await this.prisma.brooderTreatmentLog.create({
        data: {
          batchId, treatmentDate: logDate, drugName: item.name, storeItemId: item.id,
          // `dose` is the clinical dosage description as written on the
          // report — always the raw text, never rebuilt from the converted
          // quantityUsed figure (see note above).
          dose: usage.rawText, doseUnit: usage.unit ?? item.unit,
          quantityUsed: usage.quantity, quantityUsedUnit: item.unit,
          notes: suffix, loggedById: uploaderId,
        },
      });
      return { entityType: 'BrooderTreatmentLog', entityId: created.id, action: 'CREATE', beforeState: null, afterState: created };
    }

    // vaccine / supplement — append to the once-daily BrooderLog row
    // (logSession: null), creating it if this is the first daily entry.
    const entry = {
      // Same rule as above: `dose` always keeps the report's original
      // dosage text; `quantityUsed`/`unit` carry the converted, store-unit
      // figure that's actually deducted from stock.
      name: item.name, dose: usage.rawText,
      storeItemId: item.id, quantityUsed: usage.quantity, unit: item.unit,
    };
    const existing = await this.prisma.brooderLog.findFirst({ where: { batchId, logDate, logSession: null } });
    const key = kind === 'vaccine' ? 'vaccinesJson' : 'supplementsJson';
    if (existing) {
      const current = Array.isArray((existing as any)[key]) ? (existing as any)[key] : [];
      await this.prisma.brooderLog.update({ where: { id: existing.id }, data: { [key]: [...current, entry] } as any });
      // JSON_APPEND: rollback only needs to know the parent row id + the
      // exact entry that was appended, so it can be filtered back out —
      // not the whole before/after array (which could be large).
      return { entityType: `BrooderLog.${key}`, entityId: existing.id, action: 'JSON_APPEND', beforeState: null, afterState: entry };
    }
    const created = await this.prisma.brooderLog.create({
      data: {
        batchId, logDate, logSession: null,
        vaccinesJson: kind === 'vaccine' ? [entry] : undefined,
        supplementsJson: kind === 'supplement' ? [entry] : undefined,
        notes: suffix, loggedById: uploaderId,
      } as any,
    });
    // The parent row itself was newly created solely to hold this entry —
    // ledger it as a CREATE (rollback deletes the whole row) rather than a
    // JSON_APPEND (which would only strip the entry from an existing row).
    return { entityType: 'BrooderLog', entityId: created.id, action: 'CREATE', beforeState: null, afterState: created };
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
    discrepancies: ReconcileOutcome['discrepancies'], appliedChanges: AppliedChangeInput[],
    setResolution: (r: 'MATCHED' | 'AUTOFILLED' | 'DISCREPANCY') => void,
  ) {
    let neededQty = reportQty;
    if (reportUnit && reportUnit.toLowerCase() !== item.unit.toLowerCase()) {
      const converted = convertToUnit(reportQty, reportUnit, item.unit);
      if (converted === null) {
        setResolution('DISCREPANCY');
        discrepancies.push({
          rowDate: row.date, field: `item:${item.name}`, discrepancyType: ProductionReportDiscrepancyType.ITEM_ISSUANCE,
          locationRef: row.locationRef, systemValue: null, reportValue: `${reportQty} ${reportUnit}`,
          notes: `Unit "${reportUnit}" on the report could not be reconciled against stock unit "${item.unit}" — needs manual conversion.`,
        });
        return;
      }
      neededQty = converted;
    }
    const alreadyLoggedToday = await this.sumTodaysLoggedUsage(item.id, batchId, logDate);
    const outcome = resolveReportCorrection(alreadyLoggedToday, neededQty, item.unit);
    setResolution(outcome.resolution);
    // NOTE — scope limitation (unchanged from before this fix): generic
    // items (charcoal, cleaning supplies, ...) have no dedicated per-batch
    // usage-log table to write an AUTOFILLED delta into (see class doc
    // comment on the old version of this method) — the resolved outcome is
    // still captured in the report's own rawRows either way.
  }

  // (The old recordUsageAgainstHeldBalance held-balance/unit-conversion
  // decision now lives in resolveItemCorrection() above, generalised via
  // resolveReportCorrection().)

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

    // BROODER_MGMT_IS_READ_ONLY applies here too: a Director "applying" a
    // MORTALITY/FEED discrepancy still writes into the attendant's brooder
    // logs, which is exactly what §5/this file's header now forbids for a
    // BROODING/GROWER-stage batch — the report stays informational only.
    // STOCK_COUNT/CAGE_REASSIGNMENT are unaffected: neither has an attendant
    // recording path in brooder management (see their handlers below), so
    // the report/Director sign-off remains the only way those get entered.
    if (discrepancy.discrepancyType === ProductionReportDiscrepancyType.MORTALITY
      || discrepancy.discrepancyType === ProductionReportDiscrepancyType.FEED
      || discrepancy.discrepancyType === ProductionReportDiscrepancyType.ENVIRONMENTAL) {
      const batchStage = await this.prisma.batch.findUnique({ where: { id: batchId }, select: { stage: true } });
      if (batchStage?.stage === BatchStage.BROODING || batchStage?.stage === BatchStage.GROWER) {
        return {
          applied: false,
          note: 'Brooder management data cannot be corrected from a store production report — this report is ' +
            'informational for review only. Edit the attendant\'s brooder entry directly if it needs correcting.',
        };
      }
    }

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
              issuedToBatchId: batchId, issuedToType: 'BROODER', issuedToName: 'Brooder (via production report)',
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

    if (discrepancy.discrepancyType === ProductionReportDiscrepancyType.ENVIRONMENTAL) {
      // field is "<temperature|humidity|lux>:<MORNING|MIDDAY|EVENING>", set by reconcileEnvironmental().
      const [metric, sessionLabel] = discrepancy.field.split(':');
      const dbField = metric === 'temperature' ? 'temperature' : metric === 'humidity' ? 'humidityPercent' : 'lightIntensityLux';
      const value = parseFloat(discrepancy.reportValue ?? '');
      if (!Number.isFinite(value)) return { applied: false, note: 'Could not parse the report value.' };
      const existing = await this.prisma.brooderLog.findFirst({ where: { batchId, logDate, logSession: sessionLabel as BrooderLogSession } });
      if (!existing) return { applied: false, note: 'No log entry exists for this session anymore — resolve manually.' };
      await this.prisma.brooderLog.update({
        where: { id: existing.id },
        data: { [dbField]: dbField === 'lightIntensityLux' ? Math.round(value) : value },
      });
      return { applied: true, note: `${metric[0].toUpperCase()}${metric.slice(1)} for ${sessionLabel.toLowerCase()} corrected to ${value}.` };
    }

    if (discrepancy.discrepancyType === ProductionReportDiscrepancyType.WEIGHT) {
      // Informational only — persisted pre-resolved by reconcileWeight()
      // so this path shouldn't normally run, but handle it defensively
      // (e.g. a manual re-application) rather than falling through to the
      // generic "unrecognised type" message below.
      return { applied: false, note: 'Weight-vs-standard flag is informational — see the Weight Alerts panel for the full cross-referenced analysis; no report data to apply.' };
    }

    return { applied: false, note: 'Unrecognised discrepancy type — needs manual review.' };
  }
}
