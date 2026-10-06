// src/modules/store/production-report-reconciliation.service.ts
// The core "verification layer" logic: for every parsed report row, compare
// each field against whatever the system already has recorded for that
// batch + date — the WHOLE day (both AM and PM egg-collection sessions; all
// of a brooder day's session rows / entries), never one record in isolation
// — and decide what happens to it:
//
//   • nothing recorded yet       -> fill the gap with the report's figure
//   • recorded and it matches    -> no-op
//   • recorded and it disagrees  -> REPLACE what's recorded with the
//                                   report's figure — never add the report's
//                                   figure on top (601 kg + 600 kg ≠ 1201 kg)
//
// The report is the farm's daily record sheet and is authoritative, for
// laying batches and brooder/grower batches alike. Every replaced or
// removed record is written to the applied-change ledger, so rejecting or
// rolling back the report restores exactly what was there before.
// Discrepancies are only raised for what can't be resolved by replacing a
// figure — e.g. no egg-collection session exists yet for a laying day, an
// item name that matches nothing in the store, a unit that can't convert.
//
// IMPORTANT — this service only ever RECORDS, never ISSUES: it never
// triggers a store stock-out on its own.
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
  EggCollectionSession,
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

/** How a report's figure for one day replaces what's recorded when that day
 *  is spread across several records (a laying batch's AM + PM sessions, or a
 *  brooder day's session rows). The report's figure is the WHOLE day's
 *  figure, so it's compared against the sum of every record — never just
 *  one of them — and when it differs, the record already holding the most
 *  (the one being corrected) takes the report's value while every other
 *  record holding a value is cleared. The day total then equals the report
 *  exactly: e.g. PM 601 kg + report 600 kg leaves the day at 600, not 1201;
 *  AM 385 kg + report 600 kg replaces the 385 with 600. */
export function planDayReplacement<T extends { id: string }>(
  records: T[], valueOf: (r: T) => number, reportValue: number, tolerance = 0.001,
): { matched: boolean; dayTotal: number; target: T | null; clearIds: string[] } {
  const dayTotal = records.reduce((s, r) => s + valueOf(r), 0);
  if (Math.abs(dayTotal - reportValue) < tolerance) {
    return { matched: true, dayTotal, target: null, clearIds: [] };
  }
  let target: T | null = records[0] ?? null;
  for (const r of records) if (target && valueOf(r) > valueOf(target)) target = r;
  const clearIds = records.filter(r => r !== target && valueOf(r) !== 0).map(r => r.id);
  return { matched: false, dayTotal, target, clearIds };
}

/** Whether a day's existing feed entries are exactly the report's feed
 *  lines — same feed (key) and same kg, one entry per line, nothing extra.
 *  Anything else (a missing line, a different amount, an extra entry) means
 *  the day gets replaced with the report's lines. */
export function feedLinesMatch(
  wanted: { key: string; kg: number }[], existing: { key: string; kg: number }[], tolerance = 0.001,
): boolean {
  if (wanted.length !== existing.length) return false;
  const remaining = [...existing];
  for (const w of wanted) {
    const i = remaining.findIndex(e => e.key === w.key && Math.abs(e.kg - w.kg) < tolerance);
    if (i === -1) return false;
    remaining.splice(i, 1);
  }
  return true;
}

const toNum = (v: unknown): number | null => (v == null ? null : Number(v));

/** Days whose feed-related figures differ between the previous version of
 *  a report and a re-upload (including days new to the re-upload). A
 *  re-upload re-applies every day from scratch, so this is what limits the
 *  Director's over-feeding notifications to days that actually changed. */
export function changedFeedDates(
  previousRows: Pick<ParsedReportRow, 'date' | 'feedKg' | 'feedType' | 'feedSplit' | 'openingStock'>[],
  newRows: Pick<ParsedReportRow, 'date' | 'feedKg' | 'feedType' | 'feedSplit' | 'openingStock'>[],
): Set<string> {
  const signatures = (rows: typeof newRows) => {
    const byDate = new Map<string, string[]>();
    for (const r of rows) {
      const sig = JSON.stringify([r.feedKg ?? null, r.feedType ?? null, r.feedSplit ?? null, r.openingStock ?? null]);
      byDate.set(r.date, [...(byDate.get(r.date) ?? []), sig]);
    }
    return new Map([...byDate].map(([d, sigs]) => [d, sigs.sort().join('|')]));
  };
  const before = signatures(previousRows);
  const after = signatures(newRows);
  return new Set([...after].filter(([d, sig]) => before.get(d) !== sig).map(([d]) => d));
}

/** BrooderLog columns a report's per-session reading maps onto. MIDDAY and
 *  EVENING use the single field; MORNING keeps its readings in the 3am/6am
 *  pair, so a Morning reading is matched against whichever of those holds a
 *  value (single field first, for older rows) and written into 6am if none. */
const ENV_FIELDS = {
  temperature: { single: 'temperature', morning: ['temperature', 'reading6amTemperature', 'reading3amTemperature'], morningDefault: 'reading6amTemperature' },
  humidity: { single: 'humidityPercent', morning: ['humidityPercent', 'reading6amHumidityPercent', 'reading3amHumidityPercent'], morningDefault: 'reading6amHumidityPercent' },
  lux: { single: 'lightIntensityLux', morning: ['lightIntensityLux', 'reading6amLightIntensityLux', 'reading3amLightIntensityLux'], morningDefault: 'reading6amLightIntensityLux' },
} as const;

/** Item names out of an egg-collection session's free-text vaccineGiven —
 *  the attendant form writes "V: Newcastle (10ml); T: Amprolium (5g)", and
 *  report-filled lines read "Amprolium 20% (5G) — …". */
export function vaccineGivenNames(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(';')
    .map(part => part.trim().replace(/^[VST]:\s*/i, '').split(' (')[0].split(' — ')[0].trim())
    .filter(Boolean);
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

  /** Run the full cross-check + autofill pass over every parsed row for a
   *  batch. Mutates the real brooder/production/cage-map tables for anything
   *  that can be safely auto-applied; returns the annotated rows + open
   *  discrepancies. Never issues store stock — see the header note above. */
  async reconcile(
    batchId: string, rows: ParsedReportRow[], uploaderId: string, fileName: string,
    // When set, only days in this set may page the Director about over-
    // feeding — used for a re-upload, which re-applies every day from
    // scratch, so days whose figures didn't change aren't announced twice.
    opts: { notifyDates?: Set<string> } = {},
  ): Promise<ReconcileOutcome> {
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
          const notify = !opts.notifyDates || opts.notifyDates.has(row.date);
          await this.reconcileFeed(row, batchId, logDate, uploaderId, noteSuffix, stageBucket, batch, feedItems, aliasMap, discrepancies, appliedChanges, () => { autofillCount++; }, () => { matchedCount++; }, notify);
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

  /** Every live egg-collection session for a laying batch on one date, AM
   *  first. A laying day is split across AM and PM sessions that each carry
   *  their own feed/mortality/water, so a report's daily figure has to be
   *  compared against both — this file used to read only AM, which made a
   *  figure logged on PM invisible and stacked the report's value on top. */
  private async getDaySessions(batchId: string, logDate: Date): Promise<EggCollectionSession[]> {
    const sessions = await this.prisma.eggCollectionSession.findMany({
      where: { batchId, sessionDate: logDate, deletedAt: null },
    });
    return sessions.sort((a, b) => (a.shift === b.shift ? 0 : a.shift === 'AM' ? -1 : 1));
  }

  /** Replaces one daily figure on a laying batch's sessions (see
   *  planDayReplacement): the target session takes the report's value and
   *  any other session holding a value is cleared. Keeps each session's
   *  derived fields in step — dailyFeedKg/feedBreakdownJson with feedKg, and
   *  closingStock/henDayPercent with mortalities. Returns the session now
   *  carrying the day's figure. */
  private async replaceProductionDayField(
    field: 'feed' | 'mortality' | 'water', sessions: EggCollectionSession[], reportValue: number,
    plan: { target: EggCollectionSession | null; clearIds: string[] },
    batchId: string, rowDate: string, appliedChanges: AppliedChangeInput[],
    feed?: { label: string | null; breakdown: { feedType: string; kg: number }[] },
  ): Promise<EggCollectionSession | null> {
    const target = plan.target;
    if (!target) return null;

    const buildData = (s: EggCollectionSession, value: number, isTarget: boolean): Record<string, unknown> => {
      if (field === 'feed') {
        const feedTypeName = feed?.label ?? s.feedTypeName;
        return isTarget
          ? {
              feedKg: value, dailyFeedKg: value, feedTypeName,
              feedBreakdownJson: feed?.breakdown?.length ? feed.breakdown : [{ feedType: feedTypeName ?? 'Feed', kg: value }],
            }
          : { feedKg: 0, dailyFeedKg: 0, feedBreakdownJson: [] };
      }
      if (field === 'water') return { waterLiters: isTarget ? value : null };
      // mortality — closing stock and hen-day % are derived from it.
      const closingStock = Math.max(0, s.openingPop - value);
      const oldHdp = toNum(s.henDayPercent);
      const hdpEggs = oldHdp != null && s.closingStock > 0 ? Math.round((oldHdp * s.closingStock) / 100) : null;
      const henDayPercent = hdpEggs != null && closingStock > 0 ? Math.round((hdpEggs / closingStock) * 10000) / 100 : null;
      return { mortalities: value, closingStock, henDayPercent };
    };

    const snapshot = (s: EggCollectionSession, keys: string[]) => Object.fromEntries(keys.map(k => {
      const v = (s as any)[k];
      return [k, v != null && typeof v === 'object' && 'toNumber' in v ? Number(v) : v];
    }));

    const writes: { session: EggCollectionSession; value: number; isTarget: boolean }[] = [
      { session: target, value: reportValue, isTarget: true },
      ...sessions.filter(s => plan.clearIds.includes(s.id)).map(s => ({ session: s, value: 0, isTarget: false })),
    ];
    for (const w of writes) {
      const data = buildData(w.session, w.value, w.isTarget);
      const before = snapshot(w.session, Object.keys(data));
      await this.prisma.eggCollectionSession.update({ where: { id: w.session.id }, data: data as any });
      this.logChange(appliedChanges, batchId, rowDate, 'EggCollectionSession', w.session.id, 'UPDATE', before, data);
    }
    return target;
  }

  /** Brooder levels currently assigned to this batch — the same lookup
   *  BrooderService uses to find a batch's row/level feed entries (those
   *  rows carry a levelId, not a batchId). */
  private async getBatchLevelIds(batchId: string): Promise<string[]> {
    const assignments = await this.prisma.brooderLevelAssignment.findMany({ where: { batchId }, select: { levelId: true } });
    return assignments.map(a => a.levelId);
  }

  // ── Mortality ────────────────────────────────────────────────────────────
  private async reconcileMortality(
    row: ParsedReportRow, batchId: string, logDate: Date, uploaderId: string, noteSuffix: string,
    stageBucket: 'BROODING' | 'PRODUCTION' | 'OTHER', houseId: string,
    discrepancies: ReconcileOutcome['discrepancies'], appliedChanges: AppliedChangeInput[], onAutofill: () => void, onMatch: () => void,
  ) {
    if (stageBucket === 'PRODUCTION') {
      const sessions = await this.getDaySessions(batchId, logDate);
      if (!sessions.length) {
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
          notes: 'No egg-collection session (AM or PM) exists yet for this date — mortality can\'t be auto-filled into a session that hasn\'t been created by an attendant.',
        });
        return;
      }
      const plan = planDayReplacement(sessions, s => s.mortalities, row.mortality!);
      if (plan.matched) {
        row.resolution.mortality = 'MATCHED';
        onMatch();
        return;
      }
      await this.replaceProductionDayField('mortality', sessions, row.mortality!, plan, batchId, row.date, appliedChanges);
      row.resolution.mortality = 'AUTOFILLED';
      onAutofill();
      return;
    }

    // BROODING/GROWER — the report is the farm's daily record sheet, i.e.
    // the GENERAL population sheet, so it replaces that sheet's entries for
    // the day. Cage-map (per-level) mortality is a separate, independent
    // track by design (see the Req 1 note in brooder.service.ts) and is left
    // alone. "Replace, never add": every general entry for the date is
    // removed (ledgered, so rollback restores it) and one entry carrying the
    // report's figure is written — never a correction stacked on top.
    const replaced = await this.replaceBrooderMortalityDay(batchId, logDate, row.date, row.mortality!, row.culling, uploaderId, noteSuffix, appliedChanges);
    if (!replaced) {
      row.resolution.mortality = 'MATCHED';
      onMatch();
      return;
    }
    row.resolution.mortality = 'AUTOFILLED';
    onAutofill();
  }

  /** Replaces a brooder day's general-sheet mortality with the report's
   *  figure: every general entry for the date is removed (ledgered) and one
   *  entry with the report's count is written. Culling is carried over from
   *  the removed entries unless the report gives its own. Returns false
   *  (writes nothing) when the day already matches. */
  private async replaceBrooderMortalityDay(
    batchId: string, logDate: Date, rowDate: string, mortality: number, culling: number | undefined,
    uploaderId: string, noteSuffix: string, appliedChanges: AppliedChangeInput[],
  ): Promise<boolean> {
    const existing = await this.prisma.brooderGeneralMortalityLog.findMany({ where: { batchId, logDate } });
    const systemTotal = existing.reduce((s, e) => s + e.mortalityCount, 0);
    const priorCulling = existing.reduce((s, e) => s + e.cullingCount, 0);
    if (systemTotal === mortality && (culling === undefined || culling === priorCulling)) return false;

    await this.deleteAndLog(this.prisma.brooderGeneralMortalityLog, existing, 'BrooderGeneralMortalityLog', batchId, rowDate, appliedChanges);
    const cullingCount = culling ?? priorCulling;
    if (mortality > 0 || cullingCount > 0) {
      const created = await this.prisma.brooderGeneralMortalityLog.create({
        data: {
          batchId, logDate, mortalityCount: mortality, cullingCount,
          cause: existing.find(e => e.cause)?.cause ?? null,
          notes: existing.length === 0
            ? `Auto-filled ${noteSuffix}`
            : `Replaced ${systemTotal} bird(s) previously recorded with the report's ${mortality} ${noteSuffix}`,
          loggedById: uploaderId,
        },
      });
      this.logChange(appliedChanges, batchId, rowDate, 'BrooderGeneralMortalityLog', created.id, 'CREATE', null, created);
    }
    return true;
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
      const sessions = await this.getDaySessions(batchId, logDate);
      if (!sessions.length) {
        // Same "nowhere to write yet" case as reconcileMortality — a
        // production-stage water figure can't be auto-filled into a
        // session an attendant hasn't created yet.
        row.resolution.water = 'DISCREPANCY';
        discrepancies.push({
          rowDate: row.date, field: 'water', discrepancyType: ProductionReportDiscrepancyType.OTHER,
          locationRef: row.locationRef, systemValue: null, reportValue: String(reportWater),
          notes: 'No egg-collection session (AM or PM) exists yet for this date — water consumption can\'t be auto-filled into a session that hasn\'t been created by an attendant.',
        });
        return;
      }
      const plan = planDayReplacement(sessions, s => toNum(s.waterLiters) ?? 0, reportWater, 0.01);
      if (plan.matched) {
        row.resolution.water = 'MATCHED';
        onMatch();
        return;
      }
      await this.replaceProductionDayField('water', sessions, reportWater, plan, batchId, row.date, appliedChanges);
      row.resolution.water = 'AUTOFILLED';
      onAutofill();
      return;
    }

    // BROODING / GROWER — the attendant's 3-popup log records water per
    // SESSION (Morning/Midday/Evening, each its own BrooderLog row), so the
    // report's single daily figure is compared against the SUM of the day's
    // rows and, when it differs, replaces it (see planDayReplacement) rather
    // than being written as one more row on top of them.
    const dayLogs = await this.prisma.brooderLog.findMany({ where: { batchId, logDate } });
    const plan = planDayReplacement(dayLogs, l => l.waterConsumptionL ?? 0, reportWater, 0.01);
    if (plan.matched) {
      row.resolution.water = 'MATCHED';
      onMatch();
      return;
    }
    if (!plan.target) {
      const created = await this.prisma.brooderLog.create({
        data: { batchId, logDate, logSession: null, waterConsumptionL: reportWater, notes: `Auto-filled ${noteSuffix}`, loggedById: uploaderId },
      });
      this.logChange(appliedChanges, batchId, row.date, 'BrooderLog', created.id, 'CREATE', null, created);
    } else {
      const writes = [
        { log: plan.target, value: reportWater as number | null },
        ...dayLogs.filter(l => plan.clearIds.includes(l.id)).map(l => ({ log: l, value: null as number | null })),
      ];
      for (const w of writes) {
        await this.prisma.brooderLog.update({ where: { id: w.log.id }, data: { waterConsumptionL: w.value } });
        this.logChange(appliedChanges, batchId, row.date, 'BrooderLog.waterConsumptionL', w.log.id, 'UPDATE',
          { waterConsumptionL: w.log.waterConsumptionL }, { waterConsumptionL: w.value });
      }
    }
    row.resolution.water = 'AUTOFILLED';
    onAutofill();
  }

  // ── Feed ─────────────────────────────────────────────────────────────────
  private async reconcileFeed(
    row: ParsedReportRow, batchId: string, logDate: Date, uploaderId: string, noteSuffix: string,
    stageBucket: 'BROODING' | 'PRODUCTION' | 'OTHER',
    batch: { batchCode: string; houseId: string; currentBirdCount: number; dateReceived: Date },
    feedItems: StoreItem[], aliasMap: Map<string, StoreItem>, discrepancies: ReconcileOutcome['discrepancies'], appliedChanges: AppliedChangeInput[], onAutofill: () => void, onMatch: () => void,
    notify = true,
  ) {
    // ── Split feed cell (e.g. "chickcrumbs/growers 75:25%") ────────────────
    // Each portion is matched + reconciled against its OWN StoreItem
    // (Crumbs vs Growers), independently, since stores already issued that
    // day's stock-out split to the report's ratio — see reconcileFeedSplit.
    if (row.feedSplit && row.feedSplit.length >= 2) {
      await this.reconcileFeedSplit(row, batchId, logDate, uploaderId, noteSuffix, stageBucket, batch, feedItems, aliasMap, discrepancies, appliedChanges, onAutofill, onMatch, notify);
      return;
    }

    const matchedFeedItem = resolveItemMatch(row.feedType, feedItems, aliasMap);

    if (stageBucket === 'PRODUCTION') {
      const sessions = await this.getDaySessions(batchId, logDate);
      if (!sessions.length) {
        // Nowhere to write yet — not a value difference, still flagged.
        row.resolution.feedKg = 'DISCREPANCY';
        discrepancies.push({
          rowDate: row.date, field: 'feedKg', discrepancyType: ProductionReportDiscrepancyType.FEED,
          locationRef: row.locationRef, systemValue: null, reportValue: `${row.feedKg} kg`,
          notes: 'No egg-collection session (AM or PM) exists yet for this date.',
        });
        return;
      }
      const daySessionIds = sessions.map(s => s.id);
      const plan = planDayReplacement(sessions, s => toNum(s.feedKg) ?? 0, row.feedKg!, 0.01);
      if (plan.matched) {
        row.resolution.feedKg = 'MATCHED';
        onMatch();
        const holder = sessions.reduce((a, b) => ((toNum(b.feedKg) ?? 0) > (toNum(a.feedKg) ?? 0) ? b : a));
        await this.checkProductionFeedWastage(row, batchId, batch, logDate, holder.id, daySessionIds, plan.dayTotal, matchedFeedItem, uploaderId, appliedChanges, notify);
        return;
      }
      const label = matchedFeedItem?.name ?? row.feedType ?? null;
      const target = await this.replaceProductionDayField('feed', sessions, row.feedKg!, plan, batchId, row.date, appliedChanges,
        { label, breakdown: [{ feedType: label ?? 'Feed', kg: row.feedKg! }] });
      row.resolution.feedKg = 'AUTOFILLED';
      onAutofill();
      await this.checkProductionFeedWastage(row, batchId, batch, logDate, target!.id, daySessionIds, row.feedKg!, matchedFeedItem, uploaderId, appliedChanges, notify);
      return;
    }

    // ── Brooder/grower stage ────────────────────────────────────────────
    const { generalLogs, levelLogs, conflict, systemTotal } = await this.loadBrooderFeedDay(batchId, logDate);
    const wastagePopulation = row.openingStock ?? batch.currentBirdCount;
    const ageWeeks = batchAgeWeeks(batch.dateReceived, logDate);
    const dailyRationKg = brooderRequiredFeedKg(wastagePopulation, ageWeeks, 1);

    if (!conflict && Math.abs(systemTotal - row.feedKg!) < 0.001) {
      row.resolution.feedKg = 'MATCHED';
      onMatch();
      if (generalLogs.length) await this.backfillBrooderWastage(batchId, batch.batchCode, logDate, row.date, dailyRationKg, uploaderId, appliedChanges, notify);
      return;
    }

    await this.replaceBrooderFeedDay(
      batchId, batch.batchCode, logDate, row.date,
      [{ item: matchedFeedItem, label: row.feedType, kg: row.feedKg!, note: row.feedType ? `sheet feed type: "${row.feedType}"` : undefined }],
      generalLogs, levelLogs, systemTotal, uploaderId, noteSuffix, dailyRationKg, appliedChanges, notify,
    );
    row.resolution.feedKg = 'AUTOFILLED';
    onAutofill();
  }

  /** A brooder day's recorded feed, read the same way the brooder History
   *  view reads it (BrooderService.getPopulationRecordSheet): the row/level
   *  entries when there are any, otherwise the general-sheet entries — the
   *  two are meant to be mutually exclusive per day, so having both is a
   *  conflict that the report's figure should clear up. */
  private async loadBrooderFeedDay(batchId: string, logDate: Date) {
    const levelIds = await this.getBatchLevelIds(batchId);
    const generalLogs = await this.prisma.brooderGeneralFeedLog.findMany({ where: { batchId, entryDate: logDate } });
    const levelLogs = levelIds.length
      ? await this.prisma.brooderLevelFeedLog.findMany({ where: { levelId: { in: levelIds }, entryDate: logDate } })
      : [];
    const generalKg = generalLogs.reduce((s, e) => s + e.quantityDispensedKg, 0);
    const levelKg = levelLogs.reduce((s, e) => s + e.quantityDispensedKg, 0);
    return {
      generalLogs, levelLogs,
      conflict: generalLogs.length > 0 && levelLogs.length > 0,
      systemTotal: levelLogs.length ? levelKg : generalKg,
    };
  }

  /** "Replace, never add" for a brooder day's feed: every general and
   *  row/level feed entry for the date is removed (ledgered, so rolling the
   *  report back restores them exactly) and the report's figure is written
   *  as fresh general entries — one per feed line (one line normally, one
   *  per portion for a split cell). The report's daily figure is a
   *  whole-batch total, so it lands on the general sheet; per-level entries
   *  can't stay alongside it without double counting the day. Feed no longer
   *  needs a store item to be logged, so a line whose name didn't match one
   *  is still written (feed type mapped from the sheet's label). */
  private async replaceBrooderFeedDay(
    batchId: string, batchCode: string, logDate: Date, rowDate: string,
    lines: { item: StoreItem | null; label: string | undefined; kg: number; note?: string }[],
    generalLogs: { id: string }[], levelLogs: { id: string }[], previousTotal: number,
    uploaderId: string, noteSuffix: string, dailyRationKg: number, appliedChanges: AppliedChangeInput[],
    notify = true,
  ) {
    await this.deleteAndLog(this.prisma.brooderGeneralFeedLog, generalLogs, 'BrooderGeneralFeedLog', batchId, rowDate, appliedChanges);
    await this.deleteAndLog(this.prisma.brooderLevelFeedLog, levelLogs, 'BrooderLevelFeedLog', batchId, rowDate, appliedChanges);
    const hadRecords = generalLogs.length + levelLogs.length > 0;

    for (const line of lines) {
      if (!(line.kg > 0)) continue;
      const created = await this.prisma.brooderGeneralFeedLog.create({
        data: {
          batchId, entryDate: logDate,
          feedType: mapFeedType(line.item?.name, line.label),
          storeItemId: line.item?.id ?? null, unit: line.item?.unit ?? null,
          quantityDispensedKg: line.kg,
          notes: [
            hadRecords ? `Replaced ${previousTotal} kg previously recorded for the day with the report's figure ${noteSuffix}` : `Auto-filled ${noteSuffix}`,
            line.note,
          ].filter(Boolean).join(' — '),
          loggedById: uploaderId,
        },
      });
      this.logChange(appliedChanges, batchId, rowDate, 'BrooderGeneralFeedLog', created.id, 'CREATE', null, created);

      // Director-facing over-ration check, same as the attendant's own
      // general-sheet path runs. Best-effort — never fails the report.
      try {
        const wastageLog = await this.feedWastage.recordIfOverIssued({
          batch: { id: batchId, batchCode }, entryDate: logDate, dailyRationKg,
          generalFeedLogId: created.id, feedType: created.feedType, storeItemId: line.item?.id ?? null,
          thisEntryKg: line.kg, loggedById: uploaderId, notify,
        });
        if (wastageLog) this.logChange(appliedChanges, batchId, rowDate, 'BrooderFeedWastageLog', wastageLog.id, 'CREATE', null, wastageLog);
      } catch (wastageErr: any) {
        this.logger.warn(`[ProductionReportReconciliation] Feed-wastage check failed for batch ${batchId} on ${rowDate} (${wastageErr?.code ?? wastageErr?.message}). Report row was still applied.`);
      }
    }
  }

  /** The day's feed already matches the report, but the day may still be
   *  over ration on those figures — backfillDayIfOverIssued is idempotent per
   *  (batch, day), so this never records the same excess twice. */
  private async backfillBrooderWastage(
    batchId: string, batchCode: string, logDate: Date, rowDate: string, dailyRationKg: number,
    uploaderId: string, appliedChanges: AppliedChangeInput[], notify = true,
  ) {
    try {
      const backfilled = await this.feedWastage.backfillDayIfOverIssued({
        batch: { id: batchId, batchCode }, entryDate: logDate, dailyRationKg, loggedById: uploaderId, notify,
      });
      if (backfilled) this.logChange(appliedChanges, batchId, rowDate, 'BrooderFeedWastageLog', backfilled.id, 'CREATE', null, backfilled);
    } catch (wastageErr: any) {
      this.logger.warn(`[ProductionReportReconciliation] Feed-wastage backfill check failed for batch ${batchId} on ${rowDate} (${wastageErr?.code ?? wastageErr?.message}).`);
    }
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
    logDate: Date, sessionId: string, daySessionIds: string[], actualFeedKg: number,
    matchedFeedItem: StoreItem | null, uploaderId: string,
    appliedChanges: AppliedChangeInput[], notify = true,
  ) {
    if (row.openingStock == null || row.openingStock <= 0) return;
    try {
      // One over-ration record per laying day, not one per upload: an
      // earlier record for this day (keyed by any of its sessions) that
      // already reflects this exact feed figure means there's nothing new to
      // say; a stale one is replaced (ledgered, so rollback restores it).
      const prior = await this.prisma.brooderFeedWastageLog.findMany({
        where: { batchId, generalFeedLogId: { in: daySessionIds } },
      });
      if (prior.some(w => Math.abs(w.dispensedKgTotal - actualFeedKg) < 0.01)) return;
      for (const w of prior) this.logChange(appliedChanges, batchId, row.date, 'BrooderFeedWastageLog', w.id, 'DELETE', w, null);
      if (prior.length) await this.prisma.brooderFeedWastageLog.deleteMany({ where: { id: { in: prior.map(w => w.id) } } });

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
        notify,
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
    notify = true,
  ) {
    const portions = row.feedSplit!;
    const splitSummary = portions.map(p => `${p.label} ${p.percent}%`).join(' / ');
    const lines = portions.map(p => ({
      item: resolveItemMatch(p.label, feedItems, aliasMap),
      label: p.label, kg: p.kg, percent: p.percent,
      note: `split portion: "${p.label}" — ${p.percent}% of sheet total "${row.feedType}"`,
    }));

    if (stageBucket === 'PRODUCTION') {
      const sessions = await this.getDaySessions(batchId, logDate);
      if (!sessions.length) {
        row.resolution.feedKg = 'DISCREPANCY';
        discrepancies.push({
          rowDate: row.date, field: 'feedKg', discrepancyType: ProductionReportDiscrepancyType.FEED,
          locationRef: row.locationRef, systemValue: null, reportValue: `${row.feedKg} kg (${splitSummary})`,
          notes: 'No egg-collection session (AM or PM) exists yet for this date.',
        });
        return;
      }
      const plan = planDayReplacement(sessions, s => toNum(s.feedKg) ?? 0, row.feedKg!, 0.01);
      if (plan.matched) {
        row.resolution.feedKg = 'MATCHED';
        onMatch();
        return;
      }
      const labelText = lines.map(l => `${l.item?.name ?? l.label} ${l.percent}%`).join(' / ');
      await this.replaceProductionDayField('feed', sessions, row.feedKg!, plan, batchId, row.date, appliedChanges, {
        label: labelText,
        breakdown: lines.map(l => ({ feedType: l.item?.name ?? l.label, kg: l.kg })),
      });
      row.resolution.feedKg = 'AUTOFILLED';
      onAutofill();
      return;
    }

    // ── Brooder/grower stage — the day already matches only if it carries
    // exactly these portions (same feed, same kg) on the general sheet;
    // otherwise the whole day is replaced with the report's portions. ──────
    const { generalLogs, levelLogs, systemTotal } = await this.loadBrooderFeedDay(batchId, logDate);
    const wastagePopulation = row.openingStock ?? batch.currentBirdCount;
    const ageWeeks = batchAgeWeeks(batch.dateReceived, logDate);
    const dailyRationKg = brooderRequiredFeedKg(wastagePopulation, ageWeeks, 1);

    const lineKey = (itemId: string | null | undefined, feedType: string) => (itemId ? `item:${itemId}` : `type:${feedType}`);
    const alreadyRecorded = levelLogs.length === 0 && feedLinesMatch(
      lines.filter(l => l.kg > 0).map(l => ({ key: lineKey(l.item?.id, mapFeedType(l.item?.name, l.label)), kg: l.kg })),
      generalLogs.map(g => ({ key: lineKey(g.storeItemId, g.feedType), kg: g.quantityDispensedKg })),
    );
    if (alreadyRecorded) {
      row.resolution.feedKg = 'MATCHED';
      onMatch();
      if (generalLogs.length) await this.backfillBrooderWastage(batchId, batch.batchCode, logDate, row.date, dailyRationKg, uploaderId, appliedChanges, notify);
      return;
    }

    await this.replaceBrooderFeedDay(
      batchId, batch.batchCode, logDate, row.date, lines,
      generalLogs, levelLogs, systemTotal, uploaderId, noteSuffix, dailyRationKg, appliedChanges, notify,
    );
    row.resolution.feedKg = 'AUTOFILLED';
    onAutofill();
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

    // Fill a missing reading, replace one that disagrees with the report.
    // The Morning popup stores its readings in the 3am/6am fields and leaves
    // the plain temperature/humidity/lux fields empty, so a report's Morning
    // reading is compared against (and written into) whichever of those
    // already holds a value — 6am by default — rather than added alongside
    // them as a second reading.
    let anyWrite = false, anyMatch = false;

    for (const { session, temperature, humidity, lux } of bySession) {
      if (temperature === undefined && humidity === undefined && lux === undefined) continue;

      const existing = await this.prisma.brooderLog.findFirst({ where: { batchId, logDate, logSession: session } });
      const toWrite: Record<string, number> = {};

      for (const [metric, rawValue] of [['temperature', temperature], ['humidity', humidity], ['lux', lux]] as const) {
        if (rawValue === undefined) continue;
        const num = parseFloat(rawValue);
        if (!Number.isFinite(num)) continue;
        const fields = ENV_FIELDS[metric];
        const candidates = session === 'MORNING' ? fields.morning : [fields.single];
        const holder = existing ? candidates.find(f => (existing as any)[f] != null) : undefined;
        const existingVal = holder ? Number((existing as any)[holder]) : null;
        if (existingVal != null && Math.abs(existingVal - num) < 0.5) {
          anyMatch = true;
          continue;
        }
        const target = holder ?? (session === 'MORNING' ? fields.morningDefault : fields.single);
        toWrite[target] = metric === 'lux' ? Math.round(num) : num;
      }

      if (Object.keys(toWrite).length === 0) continue;
      anyWrite = true;
      if (existing) {
        const before = Object.fromEntries(Object.keys(toWrite).map(k => [k, (existing as any)[k]]));
        await this.prisma.brooderLog.update({ where: { id: existing.id }, data: toWrite });
        this.logChange(appliedChanges, batchId, row.date, 'BrooderLog.environmental', existing.id, 'UPDATE', before, toWrite);
      } else {
        const created = await this.prisma.brooderLog.create({
          data: { batchId, logDate, logSession: session, ...toWrite, notes: `Auto-filled ${noteSuffix}`, loggedById: uploaderId },
        });
        this.logChange(appliedChanges, batchId, row.date, 'BrooderLog', created.id, 'CREATE', null, created);
      }
    }

    row.resolution.environmental = anyWrite ? 'AUTOFILLED' : anyMatch ? 'MATCHED' : undefined;
    if (anyWrite) onAutofill();
    else if (anyMatch) onMatch();
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

      if (stageBucket === 'PRODUCTION') {
        await this.reconcileProductionHealthUsage(row, c.kind, c.text, matched, usage, batchId, logDate, noteSuffix, discrepancies, appliedChanges, onAutofill, onMatch);
        continue;
      }

      const alreadyLoggedEvent = await this.hasHealthLogEntryToday(batchId, logDate, c.kind, matched.id);

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
          const created = await this.writeHealthUsageLog(batchId, logDate, uploaderId, c.kind, matched, usage, noteSuffix);
          this.logChange(appliedChanges, batchId, row.date, created.entityType, created.entityId, created.action, created.beforeState, created.afterState);
        }
        continue;
      }

      // Compare the day's recorded quantity of this exact item against the
      // report's, in the item's own stock unit.
      const alreadyLoggedQty = await this.sumTodaysLoggedUsage(matched.id, batchId, logDate);
      const correction = await this.resolveItemCorrection(row, matched, alreadyLoggedQty, qty.qty, qty.unit, c.text!, batchId, logDate, discrepancies);
      usage.resolution = correction.resolution;
      if (correction.resolution === 'MATCHED') { onMatch(); continue; }
      if (correction.resolution === 'DISCREPANCY') continue; // unit couldn't be converted — nothing safe to write
      onAutofill();
      // "Replace, never add": remove every entry already recorded for this
      // item today (treatment log or vaccine/supplement entry — whichever
      // kind the attendant used), then write ONE entry with the report's full
      // quantity, instead of stacking a +/- correction entry on top.
      // `reportQtyInItemUnit` is already converted into the store item's
      // stock unit; `usage.unit` stays the report's raw unit on purpose —
      // writeHealthUsageLog() needs both (raw dose text vs. quantityUsed).
      const reportQtyInItemUnit = alreadyLoggedQty + correction.deltaToApply;
      await this.removeBrooderHealthEntries(matched.id, batchId, logDate, row.date, appliedChanges);
      if (reportQtyInItemUnit > 0) {
        const fullUsage: ParsedHealthUsage = { ...usage, quantity: reportQtyInItemUnit };
        const replacedNote = alreadyLoggedQty > 0 ? `replaced ${alreadyLoggedQty} ${matched.unit} previously recorded with the report's ${reportQtyInItemUnit} ${matched.unit}` : undefined;
        const created = await this.writeHealthUsageLog(batchId, logDate, uploaderId, c.kind, matched, fullUsage, noteSuffix, replacedNote);
        this.logChange(appliedChanges, batchId, row.date, created.entityType, created.entityId, created.action, created.beforeState, created.afterState);
      }
    }
  }

  /** Laying batches record vaccines/supplements/treatments as free text on
   *  the egg-collection session (EggCollectionSession.vaccineGiven — e.g.
   *  "V: Newcastle (10ml); T: Amprolium (5g)"), with no per-item quantity to
   *  compare. So the report fills a gap (appends a line) only when no
   *  session that day already names this item — this used to look at AM
   *  only and never at what was already there, so every re-upload appended
   *  the same line again. */
  private async reconcileProductionHealthUsage(
    row: ParsedReportRow, kind: ParsedHealthUsage['kind'], rawText: string, item: StoreItem, usage: ParsedHealthUsage,
    batchId: string, logDate: Date, noteSuffix: string,
    discrepancies: ReconcileOutcome['discrepancies'], appliedChanges: AppliedChangeInput[], onAutofill: () => void, onMatch: () => void,
  ) {
    const sessions = await this.getDaySessions(batchId, logDate);
    if (!sessions.length) {
      usage.resolution = 'DISCREPANCY';
      discrepancies.push({
        rowDate: row.date, field: kind, discrepancyType: ProductionReportDiscrepancyType.OTHER,
        locationRef: row.locationRef, systemValue: null, reportValue: rawText,
        notes: `No egg-collection session (AM or PM) exists yet for this date — the ${kind} "${rawText}" can't be recorded until an attendant has logged the session.`,
      });
      return;
    }
    // Names under 3 characters (e.g. "ND") would substring-match almost any
    // item name, so they can't confirm this item was already recorded.
    const alreadyNoted = sessions.some(s => vaccineGivenNames(s.vaccineGiven)
      .some(name => normaliseText(name).length >= 3 && matchInventoryItem(name, [item]) !== null));
    if (alreadyNoted) {
      usage.resolution = 'MATCHED';
      onMatch();
      return;
    }
    const target = sessions[0];
    const line = `${item.name} (${rawText})${usage.quantity != null ? ` — ${usage.quantity}${usage.unit ?? ''} used` : ''} — Auto-filled ${noteSuffix}`;
    const after = target.vaccineGiven ? `${target.vaccineGiven}; ${line}` : line;
    await this.prisma.eggCollectionSession.update({ where: { id: target.id }, data: { vaccineGiven: after } });
    this.logChange(appliedChanges, batchId, row.date, 'EggCollectionSession.vaccineGiven', target.id, 'UPDATE', { vaccineGiven: target.vaccineGiven }, { vaccineGiven: after });
    usage.resolution = 'AUTOFILLED';
    onAutofill();
  }

  /** Removes every health entry already recorded for one store item on one
   *  brooder day — BrooderTreatmentLog rows, and matching entries in any of
   *  the day's BrooderLog vaccinesJson/supplementsJson arrays — each
   *  ledgered so rolling the report back puts them back. All kinds are
   *  removed (not just the kind the report names) because the day's
   *  recorded quantity counts all of them; leaving one behind would double
   *  count the item once the report's entry is written. */
  private async removeBrooderHealthEntries(
    storeItemId: string, batchId: string, logDate: Date, rowDate: string, appliedChanges: AppliedChangeInput[],
  ) {
    const treatments = await this.prisma.brooderTreatmentLog.findMany({ where: { batchId, treatmentDate: logDate, storeItemId } });
    await this.deleteAndLog(this.prisma.brooderTreatmentLog, treatments, 'BrooderTreatmentLog', batchId, rowDate, appliedChanges);

    const dayLogs = await this.prisma.brooderLog.findMany({ where: { batchId, logDate } });
    for (const log of dayLogs) {
      for (const key of ['vaccinesJson', 'supplementsJson'] as const) {
        const arr = Array.isArray(log[key]) ? (log[key] as any[]) : null;
        if (!arr) continue;
        const kept = arr.filter(e => e?.storeItemId !== storeItemId);
        if (kept.length === arr.length) continue;
        await this.prisma.brooderLog.update({ where: { id: log.id }, data: { [key]: kept } as any });
        this.logChange(appliedChanges, batchId, rowDate, `BrooderLog.${key}`, log.id, 'UPDATE', { [key]: arr }, { [key]: kept });
      }
    }
  }

  /** Whether ANY entry already exists today for this (batch, date, item) —
   *  including zero-quantity "event only" entries, which sumTodaysLoggedUsage
   *  can't see since it only sums numeric quantityUsed. Used to stop the
   *  no-quantity health-usage branch from re-appending an identical line on
   *  every re-run of reconciliation over the same report row. */
  private async hasHealthLogEntryToday(
    batchId: string, logDate: Date, kind: ParsedHealthUsage['kind'], storeItemId: string,
  ): Promise<boolean> {
    if (kind === 'treatment') {
      const existing = await this.prisma.brooderTreatmentLog.findFirst({ where: { batchId, treatmentDate: logDate, storeItemId } });
      return !!existing;
    }
    // Vaccines/supplements can land in any of the day's session rows (the
    // 3-popup attendant log, or a legacy once-daily logSession:null row) —
    // check across all of them, not just one.
    const dayLogs = await this.prisma.brooderLog.findMany({ where: { batchId, logDate } });
    for (const log of dayLogs) {
      for (const arr of [log.vaccinesJson, log.supplementsJson]) {
        if (!Array.isArray(arr)) continue;
        if ((arr as any[]).some(e => e?.storeItemId === storeItemId)) return true;
      }
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

  /** Persists one matched vaccine/supplement/treatment usage into a brooder
   *  day's log: BrooderTreatmentLog for treatments, the once-daily BrooderLog
   *  row's vaccinesJson/supplementsJson for vaccines/supplements. (Laying
   *  batches record these as text on the egg-collection session instead —
   *  see reconcileProductionHealthUsage.) */
  private async writeHealthUsageLog(
    batchId: string, logDate: Date, uploaderId: string,
    kind: ParsedHealthUsage['kind'], item: StoreItem, usage: ParsedHealthUsage, noteSuffix: string, correctionNote?: string,
  ): Promise<{ entityType: string; entityId: string | null; action: AppliedChangeInput['action']; beforeState: unknown; afterState: unknown }> {
    const suffix = correctionNote ? `Correction: ${correctionNote} ${noteSuffix}` : `Auto-filled ${noteSuffix}`;

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
    const [feedLogs, treatmentLogs, brooderLogs] = await Promise.all([
      this.prisma.brooderGeneralFeedLog.findMany({ where: { batchId, entryDate: logDate, storeItemId } }),
      this.prisma.brooderTreatmentLog.findMany({ where: { batchId, treatmentDate: logDate, storeItemId } }),
      // Every session row for the day (Morning/Midday/Evening, or a legacy
      // once-daily logSession:null row) can carry its own vaccinesJson /
      // supplementsJson entries — sum across all of them, not just one.
      this.prisma.brooderLog.findMany({ where: { batchId, logDate } }),
    ]);
    let total = feedLogs.reduce((s, l) => s + l.quantityDispensedKg, 0);
    total += treatmentLogs.reduce((s, l) => s + Number(l.quantityUsed ?? 0), 0);
    for (const brooderLog of brooderLogs) {
      for (const arr of [brooderLog?.vaccinesJson, brooderLog?.supplementsJson]) {
        if (!Array.isArray(arr)) continue;
        for (const entry of arr as any[]) {
          if (entry?.storeItemId === storeItemId && typeof entry?.quantityUsed === 'number') total += entry.quantityUsed;
        }
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

    if (discrepancy.discrepancyType === ProductionReportDiscrepancyType.MORTALITY
      || discrepancy.discrepancyType === ProductionReportDiscrepancyType.FEED) {
      // Approving trusts the report's figure as the WHOLE day's figure and
      // replaces what's recorded with it — the same rule as the upload path.
      // This used to add (report − system) as one more entry, always into
      // the brooder tables, even for a laying batch.
      const isMortality = discrepancy.discrepancyType === ProductionReportDiscrepancyType.MORTALITY;
      if (discrepancy.field !== 'mortality' && discrepancy.field !== 'feedKg') {
        return { applied: false, note: 'This feed line still needs its name matched to a store item — no single figure to apply.' };
      }
      const reportValue = parseFloat(discrepancy.reportValue ?? '');
      if (!Number.isFinite(reportValue)) return { applied: false, note: 'Could not read the report value.' };
      const rowDate = logDate.toISOString().slice(0, 10);
      const what = isMortality ? 'Mortality' : 'Feed';
      const unit = isMortality ? 'bird(s)' : 'kg';
      // Approve-path writes are a separate human sign-off and deliberately
      // stay out of the upload's rollback ledger (see the rollback service).
      const notLedgered: AppliedChangeInput[] = [];
      const note = '(Director-approved from store production report)';

      const batch = await this.prisma.batch.findUnique({ where: { id: batchId }, select: { stage: true, batchCode: true } });
      if (!batch) return { applied: false, note: 'Batch not found.' };

      if (batch.stage === BatchStage.PRODUCTION) {
        const sessions = await this.getDaySessions(batchId, logDate);
        if (!sessions.length) {
          return { applied: false, note: 'Still no egg-collection session (AM or PM) for this date — an attendant needs to log the session first.' };
        }
        const plan = planDayReplacement(sessions, s => (isMortality ? s.mortalities : toNum(s.feedKg) ?? 0), reportValue, 0.01);
        if (plan.matched) return { applied: true, note: `${what} for ${rowDate} already matches the report — nothing changed.` };
        await this.replaceProductionDayField(isMortality ? 'mortality' : 'feed', sessions, reportValue, plan, batchId, rowDate, notLedgered,
          isMortality ? undefined : { label: null, breakdown: [] });
        return { applied: true, note: `${what} for ${rowDate} set to ${reportValue} ${unit} to match the report (replaced ${plan.dayTotal}, not added to it).` };
      }

      if (isMortality) {
        const replaced = await this.replaceBrooderMortalityDay(batchId, logDate, rowDate, reportValue, undefined, userId, note, notLedgered);
        return { applied: true, note: replaced ? `Mortality for ${rowDate} set to ${reportValue} to match the report.` : 'Already matches the report — nothing changed.' };
      }
      const { generalLogs, levelLogs, conflict, systemTotal } = await this.loadBrooderFeedDay(batchId, logDate);
      if (!conflict && Math.abs(systemTotal - reportValue) < 0.001) return { applied: true, note: 'Already matches the report — nothing changed.' };
      await this.replaceBrooderFeedDay(batchId, batch.batchCode, logDate, rowDate, [{ item: null, label: undefined, kg: reportValue }],
        generalLogs, levelLogs, systemTotal, userId, note, 0, notLedgered);
      return { applied: true, note: `Feed for ${rowDate} set to ${reportValue} kg to match the report (replaced ${systemTotal} kg, not added to it).` };
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
