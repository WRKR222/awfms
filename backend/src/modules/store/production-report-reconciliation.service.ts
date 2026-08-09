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
  FeedType, ProductionReportDiscrepancyType, StoreItem, BatchStage, BrooderLogSession,
} from '@prisma/client';
import { ParsedReportRow, ParsedHealthUsage, EnvReading } from './production-report.dto';
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
  action: 'CREATE' | 'UPDATE' | 'JSON_APPEND';
  beforeState: unknown;
  afterState: unknown;
}

/** Outcome of the shared "additive-only correction" policy (§ delta
 *  correction): report says more happened than the system currently has
 *  recorded for this exact (item/field, batch, date) — rather than either
 *  (a) silently duplicating a whole new full-amount entry, or (b) always
 *  punting to a manual discrepancy, we record ONLY the difference, and only
 *  when that difference is actually covered by what's available (held
 *  stock balance for items, or nothing extra to check for pure counts like
 *  mortality). A report showing LESS than what's already recorded is never
 *  auto-applied — that would mean silently shrinking/deleting an existing
 *  entry, which always needs a human to confirm. */
interface CorrectionOutcome {
  resolution: 'MATCHED' | 'AUTOFILLED' | 'DISCREPANCY';
  /** The amount to actually write as a NEW log entry — 0 unless resolution
   *  is 'AUTOFILLED'. Never the full report amount when something was
   *  already recorded; only the top-up delta. */
  deltaToApply: number;
  note: string;
}

/** Central "does the report's higher figure fit within what's actually
 *  available, and if so top up by the difference" decision — shared by
 *  feed, vaccines/supplements/treatments, and generic items-issued so the
 *  same never-duplicate / never-overissue policy applies everywhere.
 *  `alreadyRecorded` is whatever the system currently has logged for this
 *  exact (batch, date, item/field); `availableBalance` is resolved by the
 *  caller — day-scoped for feed (§ only issued what stores actually gave
 *  out that specific day), cumulative-since-ever for bulk items like
 *  charcoal/vaccines/supplements (issued in bulk to production to manage
 *  over time, per spec). */
export function resolveAdditiveCorrection(
  alreadyRecorded: number,
  reportQty: number,
  availableBalance: number,
  unitLabel: string,
): CorrectionOutcome {
  const delta = reportQty - alreadyRecorded;
  if (Math.abs(delta) < 0.001) {
    return { resolution: 'MATCHED', deltaToApply: 0, note: '' };
  }
  if (delta < 0) {
    // Report shows LESS than what's already recorded — never silently
    // reduce/delete an existing entry. Flag for a human to reconcile.
    return {
      resolution: 'DISCREPANCY', deltaToApply: 0,
      note: `System already has ${alreadyRecorded} ${unitLabel} recorded, but the report shows only ${reportQty} ${unitLabel} — needs manual correction, not auto-reduced.`,
    };
  }
  if (availableBalance >= delta - 0.001) {
    return {
      resolution: 'AUTOFILLED', deltaToApply: delta,
      note: `${alreadyRecorded} ${unitLabel} was already recorded; the report confirms ${reportQty} ${unitLabel} total, so ${delta.toFixed(2)} ${unitLabel} was added as a correction (not duplicated).`,
    };
  }
  const shortfall = delta - availableBalance;
  return {
    resolution: 'DISCREPANCY', deltaToApply: 0,
    note: availableBalance > 0
      ? `Report confirms ${reportQty} ${unitLabel} total (system has ${alreadyRecorded} ${unitLabel}, +${delta.toFixed(2)} ${unitLabel} needed) but only ${availableBalance.toFixed(2)} ${unitLabel} is available to cover it — ${shortfall.toFixed(2)} ${unitLabel} short. Issue the difference to reconcile, or approve to record it anyway.`
      : `Report confirms ${reportQty} ${unitLabel} total (system has ${alreadyRecorded} ${unitLabel}) but nothing further is available to cover the +${delta.toFixed(2)} ${unitLabel} needed — issue it first, or approve this discrepancy to record it anyway.`,
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
    const appliedChanges: AppliedChangeInput[] = [];
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
        await this.reconcileMortality(row, batchId, logDate, uploaderId, noteSuffix, stageBucket, batch.houseId, discrepancies, appliedChanges, () => { autofillCount++; }, () => { matchedCount++; });
      }

      // ── Feed ─────────────────────────────────────────────────────────────
      if (row.feedKg !== undefined) {
        await this.reconcileFeed(row, batchId, logDate, uploaderId, noteSuffix, stageBucket, batch, feedItems, discrepancies, appliedChanges, () => { autofillCount++; }, () => { matchedCount++; });
      }

      // ── Opening/closing stock — whole-batch rows only. Per-cage rows with
      // opening/closing counts are cage-map data (below), not a whole-brooder
      // BrooderStockCount entry (which is one row per DAY, not per cage). ──
      if (stageBucket === 'BROODING' && !isCageRow && row.openingStock !== undefined && row.closingStock !== undefined) {
        await this.reconcileStockCount(row, batchId, logDate, uploaderId, noteSuffix, discrepancies, appliedChanges, () => { autofillCount++; }, () => { matchedCount++; });
      }

      // ── Cage reassignment / recount — per-cage rows only ────────────────
      if (isCageRow && (row.closingStock !== undefined || row.openingStock !== undefined)) {
        await this.reconcileCageAssignment(row, batchId, batch, logDate, uploaderId, noteSuffix, discrepancies, appliedChanges, () => { autofillCount++; }, () => { matchedCount++; });
      }

      // ── Vaccines / supplements / treatments (§3) ────────────────────────
      await this.reconcileHealthUsages(
        row, batchId, logDate, uploaderId, noteSuffix, stageBucket, batch,
        vaccineItems, supplementItems, treatmentItems, discrepancies, appliedChanges,
        () => { autofillCount++; }, () => { matchedCount++; },
      );

      // ── Temperature / humidity / lux, per session (morning/midday/
      // evening) — brooder stage only; EggCollectionSession (production
      // stage) has no humidity/lux fields and only one temperature value
      // per shift, so there's nothing session-shaped to reconcile there. ──
      if (stageBucket === 'BROODING') {
        await this.reconcileEnvironmental(row, batchId, logDate, uploaderId, noteSuffix, discrepancies, appliedChanges, () => { autofillCount++; }, () => { matchedCount++; });
      }

      // ── Generic items issued (e.g. charcoal bags used) ──────────────────
      for (const usage of row.itemsIssued) {
        const item = storeItemMap.get(usage.storeItemId);
        if (!item) continue;
        usage.storeItemName = item.name;
        await this.reconcileItemUsage(row, item, usage.quantity, usage.unit, usage.rawText, batchId, logDate, discrepancies, appliedChanges,
          (res) => { usage.resolution = res; if (res === 'AUTOFILLED') autofillCount++; else if (res === 'MATCHED') matchedCount++; });
      }
    }

    return { rows, discrepancies, appliedChanges, autofillCount, matchedCount, stage: stageBucket };
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
        this.logChange(appliedChanges, batchId, row.date, 'EggCollectionSession.mortalities', existing.id, 'UPDATE', { mortalities: existing.mortalities }, { mortalities: row.mortality! });
        row.resolution.mortality = 'AUTOFILLED';
        onAutofill();
      } else if (row.mortality! > existing.mortalities) {
        // §delta correction — report confirms a higher mortality count than
        // recorded; top up rather than leaving the whole field blocked.
        const before = existing.mortalities;
        await this.prisma.eggCollectionSession.update({ where: { id: existing.id }, data: { mortalities: row.mortality! } });
        this.logChange(appliedChanges, batchId, row.date, 'EggCollectionSession.mortalities', existing.id, 'UPDATE', { mortalities: before }, { mortalities: row.mortality! });
        row.resolution.mortality = 'AUTOFILLED';
        onAutofill();
      } else {
        row.resolution.mortality = 'DISCREPANCY';
        discrepancies.push({
          rowDate: row.date, field: 'mortality', discrepancyType: ProductionReportDiscrepancyType.MORTALITY,
          locationRef: row.locationRef, systemValue: String(existing.mortalities), reportValue: String(row.mortality),
          notes: 'System already recorded more mortality than the report shows — needs manual correction, not auto-reduced.',
        });
      }
      return;
    }

    const existing = await this.prisma.brooderGeneralMortalityLog.findMany({ where: { batchId, logDate } });
    const systemTotal = existing.reduce((s, e) => s + e.mortalityCount, 0);
    const outcome = resolveAdditiveCorrection(systemTotal, row.mortality!, Number.POSITIVE_INFINITY, 'bird(s)');
    // Mortality has no "stock balance" ceiling to check — it's a headcount,
    // not something issued from a limited pool — so availableBalance is
    // unbounded and only the MATCHED / (report lower -> DISCREPANCY) /
    // (report higher -> AUTOFILLED delta) branches ever apply here.
    if (outcome.resolution === 'MATCHED') {
      row.resolution.mortality = 'MATCHED';
      onMatch();
      return;
    }
    if (outcome.resolution === 'AUTOFILLED') {
      const created = await this.prisma.brooderGeneralMortalityLog.create({
        data: {
          batchId, logDate, mortalityCount: outcome.deltaToApply, cullingCount: existing.length === 0 ? (row.culling ?? 0) : 0,
          notes: existing.length === 0 ? `Auto-filled ${noteSuffix}` : `Correction: ${outcome.note} ${noteSuffix}`,
          loggedById: uploaderId,
        },
      });
      this.logChange(appliedChanges, batchId, row.date, 'BrooderGeneralMortalityLog', created.id, 'CREATE', null, created);
      row.resolution.mortality = 'AUTOFILLED';
      onAutofill();
      return;
    }
    row.resolution.mortality = 'DISCREPANCY';
    discrepancies.push({
      rowDate: row.date, field: 'mortality', discrepancyType: ProductionReportDiscrepancyType.MORTALITY,
      locationRef: row.locationRef, systemValue: String(systemTotal), reportValue: String(row.mortality), notes: outcome.note,
    });
  }

  // ── Feed ─────────────────────────────────────────────────────────────────
  private async reconcileFeed(
    row: ParsedReportRow, batchId: string, logDate: Date, uploaderId: string, noteSuffix: string,
    stageBucket: 'BROODING' | 'PRODUCTION' | 'OTHER',
    batch: { batchCode: string; houseId: string },
    feedItems: StoreItem[], discrepancies: ReconcileOutcome['discrepancies'], appliedChanges: AppliedChangeInput[], onAutofill: () => void, onMatch: () => void,
  ) {
    // ── Split feed cell (e.g. "chickcrumbs/growers 75:25%") ────────────────
    // Each portion is matched + reconciled against its OWN StoreItem
    // (Crumbs vs Growers), independently, since stores already issued that
    // day's stock-out split to the report's ratio — see reconcileFeedSplit.
    if (row.feedSplit && row.feedSplit.length >= 2) {
      await this.reconcileFeedSplit(row, batchId, logDate, uploaderId, noteSuffix, stageBucket, batch, feedItems, discrepancies, appliedChanges, onAutofill, onMatch);
      return;
    }

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
      const systemFeed = existing.feedKg != null ? Number(existing.feedKg) : 0;
      // §feed-is-day-specific — feed's available balance is only what was
      // actually issued for THIS date, unlike bulk items (charcoal/vaccines
      // /supplements) which draw down a cumulative held balance built up
      // over time. This is what stops feed being "auto-recorded" on a day
      // Store never actually issued any.
      const dayBalance = matchedFeedItem ? await this.computeHeldBalanceForDate(matchedFeedItem.id, batchId, logDate) : 0;
      const outcome = matchedFeedItem
        ? resolveAdditiveCorrection(systemFeed, row.feedKg!, dayBalance, 'kg')
        : (Math.abs(systemFeed - row.feedKg!) < 0.01
            ? { resolution: 'MATCHED' as const, deltaToApply: 0, note: '' }
            : { resolution: 'DISCREPANCY' as const, deltaToApply: 0, note: '' });

      if (outcome.resolution === 'MATCHED') {
        row.resolution.feedKg = 'MATCHED';
        onMatch();
        return;
      }
      if (outcome.resolution === 'AUTOFILLED' && matchedFeedItem) {
        const newTotal = systemFeed + outcome.deltaToApply;
        await this.prisma.eggCollectionSession.update({
          where: { id: existing.id },
          data: { feedKg: newTotal, feedTypeName: matchedFeedItem.name ?? row.feedType ?? existing.feedTypeName },
        });
        this.logChange(appliedChanges, batchId, row.date, 'EggCollectionSession.feedKg', existing.id, 'UPDATE', { feedKg: systemFeed }, { feedKg: newTotal });
        row.resolution.feedKg = 'AUTOFILLED';
        onAutofill();
        return;
      }
      row.resolution.feedKg = 'DISCREPANCY';
      if (!matchedFeedItem) this.pushUnmatchedFeedDiscrepancy(row, discrepancies);
      else discrepancies.push({
        rowDate: row.date, field: 'feedKg', discrepancyType: ProductionReportDiscrepancyType.FEED,
        locationRef: row.locationRef, systemValue: `${systemFeed} kg`, reportValue: `${row.feedKg} kg`, notes: outcome.note,
      });
      return;
    }

    // ── Brooder/grower stage ────────────────────────────────────────────
    const existing = await this.prisma.brooderGeneralFeedLog.findMany({ where: { batchId, entryDate: logDate } });
    const systemTotal = existing.reduce((s, e) => s + e.quantityDispensedKg, 0);

    if (existing.length === 0 && row.feedKg! <= 0) {
      row.resolution.feedKg = 'MATCHED';
      onMatch();
      return;
    }
    if (!matchedFeedItem) {
      // Can't check a day-specific issued balance without knowing which
      // StoreItem this is — never silently write feed we can't attribute.
      if (Math.abs(systemTotal - row.feedKg!) < 0.01) { row.resolution.feedKg = 'MATCHED'; onMatch(); return; }
      row.resolution.feedKg = 'DISCREPANCY';
      this.pushUnmatchedFeedDiscrepancy(row, discrepancies);
      return;
    }

    // §feed-is-day-specific (see PRODUCTION branch above for the rationale)
    // — only feed actually issued for THIS date can be auto-recorded.
    const dayBalance = await this.computeHeldBalanceForDate(matchedFeedItem.id, batchId, logDate);
    const outcome = resolveAdditiveCorrection(systemTotal, row.feedKg!, dayBalance, 'kg');

    if (outcome.resolution === 'MATCHED') {
      row.resolution.feedKg = 'MATCHED';
      onMatch();
      return;
    }
    if (outcome.resolution === 'AUTOFILLED') {
      const created = await this.prisma.brooderGeneralFeedLog.create({
        data: {
          batchId, entryDate: logDate,
          feedType: mapFeedType(matchedFeedItem.name, row.feedType),
          storeItemId: matchedFeedItem.id, unit: matchedFeedItem.unit,
          quantityDispensedKg: outcome.deltaToApply,
          notes: [existing.length === 0 ? `Auto-filled ${noteSuffix}` : `Correction: ${outcome.note} ${noteSuffix}`, row.feedType ? `sheet feed type: "${row.feedType}"` : null].filter(Boolean).join(' — '),
          loggedById: uploaderId,
        },
      });
      this.logChange(appliedChanges, batchId, row.date, 'BrooderGeneralFeedLog', created.id, 'CREATE', null, created);
      row.resolution.feedKg = 'AUTOFILLED';
      onAutofill();
      return;
    }
    row.resolution.feedKg = 'DISCREPANCY';
    discrepancies.push({
      rowDate: row.date, field: 'feedKg', discrepancyType: ProductionReportDiscrepancyType.FEED,
      locationRef: row.locationRef, systemValue: `${systemTotal} kg`, reportValue: `${row.feedKg} kg`, notes: outcome.note,
    });
  }

  /** Reconciles a two-way split feed cell — e.g. "chickcrumbs/growers
   *  75:25%" on a 387kg row means 75% (290.25kg) is Chick Crumbs and 25%
   *  (96.75kg) is Growers Mash. Each portion is matched to its own StoreItem
   *  and run through the exact same additive-correction / day-balance policy
   *  as a normal single-item feed row (§feed-is-day-specific) — so a portion
   *  is only ever auto-recorded up to what stores actually issued to
   *  production (PM/Attendant) for THAT item on THAT day; a portion that
   *  exceeds its own item's held balance is held back as its own
   *  discrepancy rather than silently borrowing from the other portion's
   *  balance.
   *
   *  BROODING/GROWER (and OTHER, same brooder-style sheet): each portion
   *  becomes its own BrooderGeneralFeedLog row — the table already supports
   *  multiple same-day entries with different feedType/storeItemId, so a
   *  split maps onto it cleanly. PRODUCTION (egg-laying): EggCollectionSession
   *  has only ONE combined feedKg/feedTypeName per session, with no per-item
   *  breakdown — there's nowhere to safely record two different items'
   *  worth against one field, so a split here is always flagged for the
   *  Director/Store to reconcile manually rather than guessed at. */
  private async reconcileFeedSplit(
    row: ParsedReportRow, batchId: string, logDate: Date, uploaderId: string, noteSuffix: string,
    stageBucket: 'BROODING' | 'PRODUCTION' | 'OTHER',
    batch: { batchCode: string; houseId: string },
    feedItems: StoreItem[], discrepancies: ReconcileOutcome['discrepancies'], appliedChanges: AppliedChangeInput[], onAutofill: () => void, onMatch: () => void,
  ) {
    const portions = row.feedSplit!;
    const splitSummary = portions.map(p => `${p.label} ${p.percent}% (${p.kg}kg)`).join(' / ');

    if (stageBucket === 'PRODUCTION') {
      row.resolution.feedKg = 'DISCREPANCY';
      discrepancies.push({
        rowDate: row.date, field: 'feedKg', discrepancyType: ProductionReportDiscrepancyType.FEED,
        locationRef: row.locationRef, systemValue: null,
        reportValue: `${row.feedKg} kg total — ${splitSummary}`,
        notes: 'Report shows a split feed type, but a production-stage session only tracks one combined feed figure with no per-item breakdown — record each portion manually (or via Store Inventory) rather than guessing which item to deduct from.',
      });
      return;
    }

    // ── Brooder/grower stage — each portion is its own item + own day balance ──
    const existing = await this.prisma.brooderGeneralFeedLog.findMany({ where: { batchId, entryDate: logDate } });

    if (existing.length === 0 && (row.feedKg ?? 0) <= 0) {
      row.resolution.feedKg = 'MATCHED';
      onMatch();
      return;
    }

    let anyDiscrepancy = false;
    let anyAutofilled = false;
    let anyMatched = false;

    for (const portion of portions) {
      const matchedItem = matchInventoryItem(portion.label, feedItems);
      if (!matchedItem) {
        anyDiscrepancy = true;
        discrepancies.push({
          rowDate: row.date, field: `feedKg:${portion.label}`, discrepancyType: ProductionReportDiscrepancyType.FEED,
          locationRef: row.locationRef, systemValue: null, reportValue: `${portion.kg} kg (${portion.percent}% of ${row.feedKg} kg)`,
          notes: `Could not match split portion "${portion.label}" to any store item — add/rename the store item or fix the sheet.`,
        });
        continue;
      }

      const systemQtyForItem = existing
        .filter(e => e.storeItemId === matchedItem.id)
        .reduce((s, e) => s + e.quantityDispensedKg, 0);
      const dayBalance = await this.computeHeldBalanceForDate(matchedItem.id, batchId, logDate);
      const outcome = resolveAdditiveCorrection(systemQtyForItem, portion.kg, dayBalance, 'kg');

      if (outcome.resolution === 'MATCHED') {
        anyMatched = true;
        continue;
      }
      if (outcome.resolution === 'AUTOFILLED') {
        const created = await this.prisma.brooderGeneralFeedLog.create({
          data: {
            batchId, entryDate: logDate,
            feedType: mapFeedType(matchedItem.name, portion.label),
            storeItemId: matchedItem.id, unit: matchedItem.unit,
            quantityDispensedKg: outcome.deltaToApply,
            notes: [
              systemQtyForItem === 0 ? `Auto-filled ${noteSuffix}` : `Correction: ${outcome.note} ${noteSuffix}`,
              `split portion: "${portion.label}" — ${portion.percent}% of sheet total "${row.feedType}"`,
            ].filter(Boolean).join(' — '),
            loggedById: uploaderId,
          },
        });
        this.logChange(appliedChanges, batchId, row.date, 'BrooderGeneralFeedLog', created.id, 'CREATE', null, created);
        anyAutofilled = true;
        continue;
      }
      anyDiscrepancy = true;
      discrepancies.push({
        rowDate: row.date, field: `feedKg:${portion.label}`, discrepancyType: ProductionReportDiscrepancyType.FEED,
        locationRef: row.locationRef, systemValue: `${systemQtyForItem} kg`, reportValue: `${portion.kg} kg`, notes: outcome.note,
      });
    }

    row.resolution.feedKg = anyDiscrepancy ? 'DISCREPANCY' : anyAutofilled ? 'AUTOFILLED' : anyMatched ? 'MATCHED' : 'DISCREPANCY';
    if (anyDiscrepancy) return; // onAutofill/onMatch below only for clean outcomes, mirrors other reconcile* methods
    if (anyAutofilled) onAutofill();
    else onMatch();
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
    discrepancies: ReconcileOutcome['discrepancies'], appliedChanges: AppliedChangeInput[], onAutofill: () => void, onMatch: () => void,
  ) {
    const existing = await this.prisma.brooderStockCount.findUnique({ where: { batchId_logDate: { batchId, logDate } } });
    if (!existing) {
      const created = await this.prisma.brooderStockCount.create({
        data: {
          batchId, logDate,
          openingStock: row.openingStock!, closingStock: row.closingStock!,
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
   *  Unlike feed/mortality, a sensor reading isn't additive — two different
   *  numbers for the same session can't both be "the temperature at that
   *  time" — so this mirrors reconcileStockCount's policy, not the delta-
   *  correction one: nothing recorded yet -> record it; already recorded
   *  and it matches -> no-op; already recorded and it DIFFERS -> flag for a
   *  human, never silently overwritten. */
  private async reconcileEnvironmental(
    row: ParsedReportRow, batchId: string, logDate: Date, uploaderId: string, noteSuffix: string,
    discrepancies: ReconcileOutcome['discrepancies'], appliedChanges: AppliedChangeInput[], onAutofill: () => void, onMatch: () => void,
  ) {
    const bySession = this.buildSessionReadings(row);
    if (bySession.length === 0) return;

    let anyAutofill = false, anyMatch = false, anyDiscrepancy = false;

    for (const { session, temperature, humidity, lux } of bySession) {
      if (temperature === undefined && humidity === undefined && lux === undefined) continue;

      const existing = await this.prisma.brooderLog.findFirst({ where: { batchId, logDate, logSession: session } });
      const toWrite: Record<string, number> = {};

      for (const [metric, dbField, rawValue] of [
        ['temperature', 'temperature', temperature],
        ['humidity', 'humidityPercent', humidity],
        ['lux', 'lightIntensityLux', lux],
      ] as const) {
        if (rawValue === undefined) continue;
        const num = parseFloat(rawValue);
        if (!Number.isFinite(num)) continue;
        const existingVal = existing ? (existing as any)[dbField] as number | null : null;
        if (existingVal == null) {
          toWrite[dbField] = dbField === 'lightIntensityLux' ? Math.round(num) : num;
          anyAutofill = true;
        } else if (Math.abs(existingVal - num) < 0.5) {
          anyMatch = true;
        } else {
          anyDiscrepancy = true;
          discrepancies.push({
            rowDate: row.date, field: `${metric}:${session}`, discrepancyType: ProductionReportDiscrepancyType.ENVIRONMENTAL,
            locationRef: row.locationRef, systemValue: String(existingVal), reportValue: rawValue,
            notes: `System already has ${metric} for ${session.toLowerCase()} recorded as ${existingVal}, but the report shows ${rawValue} — needs manual correction, not auto-overwritten.`,
          });
        }
      }

      if (Object.keys(toWrite).length === 0) continue;

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

    row.resolution.environmental = anyDiscrepancy ? 'DISCREPANCY' : anyAutofill ? 'AUTOFILLED' : anyMatch ? 'MATCHED' : undefined;
    if (anyAutofill) onAutofill();
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
    vaccineItems: StoreItem[], supplementItems: StoreItem[], treatmentItems: StoreItem[],
    discrepancies: ReconcileOutcome['discrepancies'], appliedChanges: AppliedChangeInput[], onAutofill: () => void, onMatch: () => void,
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

      const alreadyLoggedEvent = await this.hasHealthLogEntryToday(stageBucket, batchId, logDate, batch.houseId, c.kind, matched.id);

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

  /** Shared wrapper around resolveAdditiveCorrection() for a single matched
   *  StoreItem's health-usage quantity, using the cumulative (bulk) held
   *  balance — vaccines/supplements/treatments are issued to production in
   *  bulk, per spec, unlike feed. Handles the §4 unit-conversion step first,
   *  same as the old recordUsageAgainstHeldBalance did. */
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
    const heldBalance = await this.computeHeldBalance(item.id, batchId);
    // The delta itself must fit within what's held on top of whatever's
    // already logged — the balance already nets out everything logged so
    // far (see computeHeldBalance), so it's compared directly against delta.
    const outcome = resolveAdditiveCorrection(alreadyRecorded, neededQty, heldBalance, item.unit);
    if (outcome.resolution === 'DISCREPANCY') {
      discrepancies.push({
        rowDate: row.date, field: `item:${item.name}`, discrepancyType: ProductionReportDiscrepancyType.ITEM_ISSUANCE,
        locationRef: row.locationRef,
        systemValue: `${alreadyRecorded} ${item.unit}`, reportValue: `${reportQty} ${reportUnit ?? item.unit}`,
        notes: outcome.note,
      });
    }
    return outcome;
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
      const line = `${item.name}${usage.quantity ? ` (${usage.quantity}${usage.unit ?? item.unit})` : ''} — ${suffix}`;
      const before = existing.vaccineGiven;
      const after = existing.vaccineGiven ? `${existing.vaccineGiven}; ${line}` : line;
      await this.prisma.eggCollectionSession.update({ where: { id: existing.id }, data: { vaccineGiven: after } });
      return { entityType: 'EggCollectionSession.vaccineGiven', entityId: existing.id, action: 'UPDATE', beforeState: { vaccineGiven: before }, afterState: { vaccineGiven: after } };
    }

    if (kind === 'treatment') {
      const created = await this.prisma.brooderTreatmentLog.create({
        data: {
          batchId, treatmentDate: logDate, drugName: item.name, storeItemId: item.id,
          dose: usage.quantity ? `${usage.quantity}${usage.unit ?? item.unit}` : usage.rawText,
          doseUnit: usage.unit ?? item.unit, quantityUsed: usage.quantity, quantityUsedUnit: item.unit,
          notes: suffix, loggedById: uploaderId,
        },
      });
      return { entityType: 'BrooderTreatmentLog', entityId: created.id, action: 'CREATE', beforeState: null, afterState: created };
    }

    // vaccine / supplement — append to the once-daily BrooderLog row
    // (logSession: null), creating it if this is the first daily entry.
    const entry = {
      name: item.name, dose: usage.quantity ? `${usage.quantity}${usage.unit ?? item.unit}` : usage.rawText,
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
    const heldBalance = await this.computeHeldBalance(item.id, batchId);
    const outcome = resolveAdditiveCorrection(alreadyLoggedToday, neededQty, heldBalance, item.unit);
    setResolution(outcome.resolution);
    if (outcome.resolution === 'DISCREPANCY') {
      discrepancies.push({
        rowDate: row.date, field: `item:${item.name}`, discrepancyType: ProductionReportDiscrepancyType.ITEM_ISSUANCE,
        locationRef: row.locationRef, systemValue: `${alreadyLoggedToday} ${item.unit}`, reportValue: `${reportQty} ${reportUnit ?? item.unit}`,
        notes: outcome.note,
      });
    }
    // NOTE — scope limitation (unchanged from before this fix): generic
    // items (charcoal, cleaning supplies, ...) have no dedicated per-batch
    // usage-log table to write an AUTOFILLED delta into (see class doc
    // comment on the old version of this method) — the resolved outcome is
    // still captured in the report's own rawRows either way.
  }

  // (The old recordUsageAgainstHeldBalance held-balance/unit-conversion
  // decision now lives in resolveItemCorrection() above, generalised to
  // support additive delta-only correction via resolveAdditiveCorrection().)

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

  /** Day-scoped counterpart to computeHeldBalance(), used ONLY for feed.
   *  Per spec: charcoal/vaccines/supplements are issued to production in
   *  bulk to manage over several days, so it's correct to draw against
   *  everything ever issued (computeHeldBalance). Feed is different — Store
   *  issues the specific amount needed for that specific day, so a report
   *  claiming feed was used on a day nothing was issued must never be
   *  auto-recorded just because some earlier delivery is still sitting in
   *  the cumulative balance. Scoped to StoreStockOut rows issued ON this
   *  exact date, minus whatever's already been logged as dispensed on this
   *  exact date. */
  private async computeHeldBalanceForDate(storeItemId: string, batchId: string, logDate: Date): Promise<number> {
    const issuedAgg = await this.prisma.storeStockOut.aggregate({
      where: { storeItemId, issuedToBatchId: batchId, issuedDate: logDate },
      _sum: { quantityOut: true },
    });
    const issued = Number(issuedAgg._sum.quantityOut ?? 0);

    const feedAgg = await this.prisma.brooderGeneralFeedLog.aggregate({
      where: { batchId, storeItemId, entryDate: logDate },
      _sum: { quantityDispensedKg: true },
    });
    const feedUsed = Number(feedAgg._sum.quantityDispensedKg ?? 0);

    return Math.max(0, issued - feedUsed);
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

    return { applied: false, note: 'Unrecognised discrepancy type — needs manual review.' };
  }
}
