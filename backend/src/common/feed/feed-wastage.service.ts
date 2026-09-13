// src/common/feed/feed-wastage.service.ts
//
// Director-facing feed over-issuance detection + cost, for
// BrooderGeneralFeedLog rows. Originally lived as a private method on
// BrooderService (recordFeedWastageIfOverIssued), only reachable from the
// manual "General population sheet" feed-entry endpoint
// (BrooderService.createGeneralFeedLog). Production reports auto-fill feed
// straight into BrooderGeneralFeedLog too (see
// ProductionReportReconciliationService.reconcileFeed /
// reconcileFeedSplit), writing via Prisma directly rather than going through
// BrooderService — so a batch that was over-fed entirely via an
// auto-reconciled report never got a BrooderFeedWastageLog entry, and never
// showed up in the Director's feed-wastage summary. Moving this here as a
// standalone, @Global-provided service (same pattern as PrismaService /
// NotificationsService) lets both call sites share the exact same
// calculation and notification, with no risk of the two drifting apart —
// see BrooderService and ProductionReportReconciliationService for the two
// call sites.
import { Injectable, Logger } from '@nestjs/common';
import dayjs from 'dayjs';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface RecordFeedWastageParams {
  batch: { id: string; batchCode: string };
  entryDate: Date;
  dailyRationKg: number;
  generalFeedLogId: string;
  feedType: string;
  storeItemId: string | null;
  thisEntryKg: number;
  loggedById: string;
}

export interface RecordProductionFeedWastageParams {
  batch: { id: string; batchCode: string };
  entryDate: Date;
  /** The report row's "O.stock" (opening stock) figure — the population of
   *  record for PRODUCTION-stage feed wastage, see reconciliation service
   *  for why this is opening stock specifically, never closing stock or
   *  Batch.currentBirdCount. */
  populationOpeningStock: number;
  /** Required feed (kg) for populationOpeningStock over this single day,
   *  already computed by the caller (feed-standard.util's requiredFeedKg). */
  requiredKg: number;
  /** The day's actual reported feed (kg) — EggCollectionSession.feedKg is a
   *  single whole-day figure, not an incremental entry like the brooder's
   *  BrooderGeneralFeedLog, so this is compared directly (no "increment
   *  since last entry" math needed here). */
  actualKg: number;
  /** EggCollectionSession.id — reused as the informational pointer the
   *  brooder path stores in generalFeedLogId (that column has no FK
   *  constraint; it's a plain string reference either way). */
  sourceEntityId: string;
  feedType: string;
  storeItemId: string | null;
  loggedById: string;
}

@Injectable()
export class FeedWastageService {
  private readonly logger = new Logger(FeedWastageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Feed wastage: over-issuance detection + cost (whole-brooder path) ────
  //
  // Called right after a BrooderGeneralFeedLog row is saved — whether that
  // row came from a manual General Record entry OR from a production report
  // being auto-reconciled. Recomputes the batch's TOTAL feed for that
  // calendar date (every general-log entry for the day, including the one
  // that just triggered this call) and compares it against the HyLine daily
  // ration.
  //
  // excessKg is deliberately the INCREMENTAL amount this specific entry
  // added past the ration, not the day's running total:
  //   - if the day was already under ration before this entry, and this
  //     entry alone pushes it over, excessKg = (new total − ration).
  //   - if the day was ALREADY over ration before this entry (e.g. an
  //     evening top-up, or a report correction applied on top of an
  //     already-full day), the entire new entry counts as excess.
  // That keeps a per-event notification meaningful ("this entry added Xkg
  // over") while still letting excessKg sum correctly to the day's true
  // total when rolled up for the daily/weekly/monthly Director summary.
  //
  // Cost is priced off the CURRENT StoreItem.unitCostKes for whichever
  // store item this triggering entry was logged against — the log rows
  // don't carry a per-entry price snapshot, so this is the best available
  // figure at write time. If the entry wasn't linked to a store item, only
  // the excess kg is recorded — no cost figure is fabricated.
  //
  // Best-effort by design — callers should wrap this in try/catch and log a
  // warning on failure rather than let it fail the feed log write itself
  // (see both call sites).
  async recordIfOverIssued(params: RecordFeedWastageParams) {
    const {
      batch, entryDate, dailyRationKg, generalFeedLogId,
      feedType, storeItemId, thisEntryKg, loggedById,
    } = params;

    // No valid ration to compare against (e.g. batch has 0 live birds) —
    // nothing meaningful to flag.
    if (!dailyRationKg || dailyRationKg <= 0) return null;

    const dayStr        = dayjs(entryDate).format('YYYY-MM-DD');
    const entryDateStart = new Date(`${dayStr}T00:00:00.000Z`);
    const entryDateEnd   = new Date(`${dayStr}T23:59:59.999Z`);

    const dayTotal = await this.prisma.brooderGeneralFeedLog.aggregate({
      where: { batchId: batch.id, entryDate: { gte: entryDateStart, lte: entryDateEnd } },
      _sum:  { quantityDispensedKg: true },
    });
    const dispensedKgTotal = Math.round((dayTotal._sum.quantityDispensedKg ?? 0) * 100) / 100;

    const effectiveRationKg = dailyRationKg;

    const dispensedBeforeThisEntry = Math.max(0, dispensedKgTotal - thisEntryKg);
    const excessBefore = Math.max(0, dispensedBeforeThisEntry - effectiveRationKg);
    const excessAfter  = Math.max(0, dispensedKgTotal - effectiveRationKg);
    const excessKg     = Math.round((excessAfter - excessBefore) * 100) / 100;

    // Rounding-noise tolerance — mirrors the 0.05kg tolerance the
    // under-issuance (missed-feed) check uses, applied here symmetrically.
    if (excessKg <= 0.05) return null;

    let unitCostKes: number | null = null;
    let storeItemName: string | null = null;
    if (storeItemId) {
      const item = await this.prisma.storeItem.findUnique({
        where:  { id: storeItemId },
        select: { name: true, unitCostKes: true },
      });
      if (item) {
        storeItemName = item.name;
        unitCostKes   = Number(item.unitCostKes);
      }
    }
    const excessCostKes = unitCostKes != null
      ? Math.round(excessKg * unitCostKes * 100) / 100
      : null;

    const created = await this.prisma.brooderFeedWastageLog.create({
      data: {
        batchId:          batch.id,
        batchCode:        batch.batchCode,
        generalFeedLogId,
        feedType,
        storeItemId,
        storeItemName,
        entryDate:        entryDateStart,
        requiredKgForDay: effectiveRationKg,
        dispensedKgTotal,
        excessKg,
        unitCostKes,
        excessCostKes,
        loggedById,
      },
    });

    const costLine = excessCostKes != null
      ? ` Cost of the excess: KES ${excessCostKes.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ` +
        `(${storeItemName} @ KES ${unitCostKes!.toFixed(2)}/kg).`
      : ' This feed entry was not linked to a store item, so no cost could be calculated.';

    // Director-only — unlike the other Brooder alerts (mortality, weight
    // anomaly, stock mismatch) this one deliberately does NOT go through
    // alertRoles(), which also notifies MANAGER. Feed cost/wastage tracking
    // is Director-facing only.
    await this.notifications.notifyRole(
      UserRole.OWNER,
      'BROODER_FEED_WASTAGE' as any,
      `Feed Over-Issued — ${batch.batchCode}`,
      `Batch ${batch.batchCode} has been given ${dispensedKgTotal.toFixed(2)}kg of feed so far today ` +
      `against a required ${effectiveRationKg.toFixed(2)}kg — ${excessKg.toFixed(2)}kg more than estimated.` +
      costLine,
      { entityId: batch.id, entityType: 'Brooder' },
    );

    // Returned so report-driven callers (ProductionReportReconciliationService)
    // can record this write in the ProductionReportAppliedChange ledger —
    // without it, ProductionReportRollbackService has no way to remove a
    // wastage entry that a since-rolled-back report created, and it's left
    // behind showing a stale/wrong excess figure forever. See
    // ProductionReportRollbackService's 'BrooderFeedWastageLog' case.
    return created;
  }

  // ── Feed wastage: PRODUCTION stage, population = report's opening stock ──
  //
  // Companion to recordIfOverIssued() above, for laying batches. The two
  // differ in one important way: EggCollectionSession.feedKg is a single
  // whole-day figure that gets overwritten wholesale on correction (see
  // reconcileFeed's PRODUCTION branch), not an append-only log of
  // individual entries — so there's no "incremental amount THIS entry
  // added" to compute here, unlike the brooder path. excessKg is simply
  // actualKg − requiredKg for the day.
  //
  // requiredKg is computed by the caller from the report row's OPENING
  // STOCK (never closing stock, never Batch.currentBirdCount) — a laying
  // batch's population of record for a given day is whatever the farm's
  // own daily sheet says was present that morning, not today's live
  // headcount.
  async recordProductionOverIssuance(params: RecordProductionFeedWastageParams) {
    const {
      batch, entryDate, populationOpeningStock, requiredKg, actualKg,
      sourceEntityId, feedType, storeItemId, loggedById,
    } = params;

    if (!requiredKg || requiredKg <= 0) return null;

    const effectiveRequiredKg = requiredKg;
    const excessKg = Math.round((actualKg - effectiveRequiredKg) * 100) / 100;
    // Same rounding-noise tolerance as the brooder check.
    if (excessKg <= 0.05) return null;

    const dayStr         = dayjs(entryDate).format('YYYY-MM-DD');
    const entryDateStart = new Date(`${dayStr}T00:00:00.000Z`);

    let unitCostKes: number | null = null;
    let storeItemName: string | null = null;
    if (storeItemId) {
      const item = await this.prisma.storeItem.findUnique({
        where:  { id: storeItemId },
        select: { name: true, unitCostKes: true },
      });
      if (item) {
        storeItemName = item.name;
        unitCostKes   = Number(item.unitCostKes);
      }
    }
    const excessCostKes = unitCostKes != null
      ? Math.round(excessKg * unitCostKes * 100) / 100
      : null;

    const created = await this.prisma.brooderFeedWastageLog.create({
      data: {
        batchId:          batch.id,
        batchCode:        batch.batchCode,
        generalFeedLogId: sourceEntityId,
        feedType,
        storeItemId,
        storeItemName,
        entryDate:        entryDateStart,
        requiredKgForDay: effectiveRequiredKg,
        dispensedKgTotal: actualKg,
        excessKg,
        unitCostKes,
        excessCostKes,
        loggedById,
      },
    });

    const costLine = excessCostKes != null
      ? ` Cost of the excess: KES ${excessCostKes.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ` +
        `(${storeItemName} @ KES ${unitCostKes!.toFixed(2)}/kg).`
      : ' This feed entry was not linked to a store item, so no cost could be calculated.';

    // Director-only, same as the brooder alert.
    await this.notifications.notifyRole(
      UserRole.OWNER,
      'BROODER_FEED_WASTAGE' as any,
      `Feed Over-Issued — ${batch.batchCode}`,
      `Batch ${batch.batchCode} was recorded with ${actualKg.toFixed(2)}kg of feed on ${dayStr} ` +
      `against a required ${effectiveRequiredKg.toFixed(2)}kg for its reported opening stock of ` +
      `${populationOpeningStock.toLocaleString()} birds — ${excessKg.toFixed(2)}kg more than estimated.` +
      costLine,
      { entityId: batch.id, entityType: 'Brooder' },
    );

    return created; // see recordIfOverIssued's matching comment above
  }

  // ── One-time catch-up for feed logged BEFORE this check existed ─────────
  //
  // recordIfOverIssued() (above) is designed to run once per NEW entry, as
  // it's written, and works out the INCREMENTAL excess that single entry
  // added. That math depends on being called in real time — it can't be
  // safely replayed after the fact for entries that all already exist,
  // because "the total before this entry" no longer means anything once
  // every entry for the day is already sitting in the table.
  //
  // For catching up a day's feed that was logged before this service was
  // wired into the caller (e.g. a production report that was reconciled
  // prior to this fix), this instead treats the WHOLE day as one check:
  // sum every BrooderGeneralFeedLog entry for (batch, entryDate), compare
  // the total against the day's ration, and if it's over, write ONE
  // BrooderFeedWastageLog entry for the full excess. Cost is priced off
  // whichever store item contributed the most kg that day (a day can mix
  // feed types/items; there's no meaningful way to split cost precisely
  // after the fact without a per-entry price snapshot, which these older
  // entries don't have).
  //
  // Idempotent per (batch, entryDate): if a BrooderFeedWastageLog entry
  // already exists for that day, this is a no-op — safe to re-run across
  // an entire batch's history repeatedly (e.g. after reconciling another
  // report for the same batch) without creating duplicates.
  //
  // `notify` defaults to false — these are (usually) historical
  // over-issuances, not something happening right now, so a live Director
  // alert for a date that's already passed would be misleading. Pass
  // `notify: true` only if the caller genuinely wants the Director paged
  // for it anyway.
  async backfillDayIfOverIssued(params: {
    batch: { id: string; batchCode: string };
    entryDate: Date;
    dailyRationKg: number;
    loggedById: string;
    notify?: boolean;
  }) {
    const { batch, entryDate, dailyRationKg, loggedById, notify = false } = params;
    if (!dailyRationKg || dailyRationKg <= 0) return null;

    const dayStr         = dayjs(entryDate).format('YYYY-MM-DD');
    const entryDateStart = new Date(`${dayStr}T00:00:00.000Z`);
    const entryDateEnd   = new Date(`${dayStr}T23:59:59.999Z`);

    // Already checked (live or by a previous backfill run) — skip.
    const already = await this.prisma.brooderFeedWastageLog.findFirst({
      where: { batchId: batch.id, entryDate: entryDateStart },
      select: { id: true },
    });
    if (already) return null;

    const rows = await this.prisma.brooderGeneralFeedLog.findMany({
      where: { batchId: batch.id, entryDate: { gte: entryDateStart, lte: entryDateEnd } },
      select: { id: true, feedType: true, storeItemId: true, quantityDispensedKg: true },
    });
    if (rows.length === 0) return null;

    const dispensedKgTotal = Math.round(
      rows.reduce((sum, r) => sum + (r.quantityDispensedKg ?? 0), 0) * 100,
    ) / 100;
    const effectiveRationKg = dailyRationKg;
    const excessKg = Math.round((dispensedKgTotal - effectiveRationKg) * 100) / 100;
    if (excessKg <= 0.05) return null;

    // The row that contributed the most kg that day — used to attribute
    // feedType/storeItemId/generalFeedLogId for this one summary entry.
    const dominant = [...rows].sort((a, b) => (b.quantityDispensedKg ?? 0) - (a.quantityDispensedKg ?? 0))[0];

    let unitCostKes: number | null = null;
    let storeItemName: string | null = null;
    if (dominant.storeItemId) {
      const item = await this.prisma.storeItem.findUnique({
        where:  { id: dominant.storeItemId },
        select: { name: true, unitCostKes: true },
      });
      if (item) {
        storeItemName = item.name;
        unitCostKes   = Number(item.unitCostKes);
      }
    }
    const excessCostKes = unitCostKes != null
      ? Math.round(excessKg * unitCostKes * 100) / 100
      : null;

    const created = await this.prisma.brooderFeedWastageLog.create({
      data: {
        batchId:          batch.id,
        batchCode:        batch.batchCode,
        generalFeedLogId: dominant.id,
        feedType:         dominant.feedType,
        storeItemId:      dominant.storeItemId,
        storeItemName,
        entryDate:        entryDateStart,
        requiredKgForDay: effectiveRationKg,
        dispensedKgTotal,
        excessKg,
        unitCostKes,
        excessCostKes,
        loggedById,
      },
    });

    if (notify) {
      const costLine = excessCostKes != null
        ? ` Cost of the excess: KES ${excessCostKes.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ` +
          `(${storeItemName} @ KES ${unitCostKes!.toFixed(2)}/kg).`
        : ' This feed entry was not linked to a store item, so no cost could be calculated.';
      await this.notifications.notifyRole(
        UserRole.OWNER,
        'BROODER_FEED_WASTAGE' as any,
        `Feed Over-Issued — ${batch.batchCode} (${dayStr})`,
        `Batch ${batch.batchCode} was given ${dispensedKgTotal.toFixed(2)}kg of feed on ${dayStr} ` +
        `against a required ${effectiveRationKg.toFixed(2)}kg — ${excessKg.toFixed(2)}kg more than estimated.` +
        costLine,
        { entityId: batch.id, entityType: 'Brooder' },
      );
    }

    return created;
  }

  // ── Issued vs Recorded: Store's daily issuance vs what attendants logged ──
  //
  // Egg Collection and Brooder feed logging no longer require picking a
  // specific Store-issued item (see LAYER_FEED_TYPES on the frontend / the
  // feedType-based DTOs) — the attendant just records a feed-stage name +
  // kg, with no per-submission gate against Store's stock. This is the
  // monitoring that replaces that gate: for each batch-day, how much did
  // Store actually issue to that batch (StoreStockOut, category FEED or
  // FEED_SUPPLEMENT) versus how much the attendant recorded that day
  // (FeedIntakeLog for production-stage batches, BrooderGeneralFeedLog for
  // brooding-stage ones). A day where the two disagree by more than the
  // tolerance is a mismatch worth a human looking at — either Store hasn't
  // logged an issuance yet, feed was drawn from carry-over stock, or the
  // attendant's figure needs a second look.
  //
  // Deliberately NOT the same 0.05kg tolerance as the ration-based checks
  // above: issuance is naturally lumpier day-to-day (a bulk drop can cover
  // several days), so a much looser bar avoids flagging normal timing noise
  // as a mismatch.
  private static readonly ISSUED_VS_RECORDED_TOLERANCE_KG = 0.5;

  async getIssuedVsRecordedSummary(params: {
    period?: 'daily' | 'weekly' | 'monthly';
    from?: string;
    to?: string;
    batchId?: string;
  } = {}) {
    const period = params.period ?? 'daily';
    const to     = params.to ? dayjs(params.to) : dayjs();
    const defaultSpan = period === 'daily' ? 30 : period === 'weekly' ? 84 : 365;
    const from   = params.from ? dayjs(params.from) : to.subtract(defaultSpan, 'day');
    const fromDate = from.startOf('day').toDate();
    const toDate   = to.endOf('day').toDate();
    const batchFilter = params.batchId ? { batchId: params.batchId } : {};

    const [productionRows, brooderRows, issuedRows] = await Promise.all([
      this.prisma.feedIntakeLog.findMany({
        where: { entryDate: { gte: fromDate, lte: toDate }, ...batchFilter },
        select: { batchId: true, entryDate: true, quantityDispensedKg: true },
      }),
      this.prisma.brooderGeneralFeedLog.findMany({
        where: { entryDate: { gte: fromDate, lte: toDate }, ...batchFilter },
        select: { batchId: true, entryDate: true, quantityDispensedKg: true },
      }),
      this.prisma.storeStockOut.findMany({
        where: {
          issuedDate: { gte: fromDate, lte: toDate },
          issuedToBatchId: params.batchId ?? { not: null },
        },
        select: {
          issuedToBatchId: true, issuedDate: true, quantityOut: true,
          storeItem: { select: { category: true } },
        },
      }),
    ]);
    const feedIssuedRows = issuedRows.filter(
      r => r.storeItem.category === 'FEED' || r.storeItem.category === 'FEED_SUPPLEMENT',
    );

    const dayStr = (d: Date) => dayjs(d).format('YYYY-MM-DD');
    const bucketKey = (dayStrVal: string): string => {
      if (period === 'monthly') return dayStrVal.slice(0, 7);
      if (period === 'weekly')  return dayjs(dayStrVal).startOf('isoWeek').format('YYYY-MM-DD');
      return dayStrVal;
    };

    type DayTotals = { recordedKg: number; issuedKg: number };
    const perBatchDay = new Map<string, DayTotals>();
    const keyFor = (batchId: string, d: Date) => `${batchId}|${dayStr(d)}`;

    for (const r of [...productionRows, ...brooderRows]) {
      const k = keyFor(r.batchId, r.entryDate);
      const t = perBatchDay.get(k) ?? { recordedKg: 0, issuedKg: 0 };
      t.recordedKg += Number(r.quantityDispensedKg ?? 0);
      perBatchDay.set(k, t);
    }
    for (const r of feedIssuedRows) {
      if (!r.issuedToBatchId) continue;
      const k = keyFor(r.issuedToBatchId, r.issuedDate);
      const t = perBatchDay.get(k) ?? { recordedKg: 0, issuedKg: 0 };
      t.issuedKg += Number(r.quantityOut ?? 0);
      perBatchDay.set(k, t);
    }

    const buckets = new Map<string, {
      periodStart: string; issuedKg: number; recordedKg: number; diffKg: number; mismatchDays: number;
    }>();
    let totalIssuedKg = 0, totalRecordedKg = 0, totalMismatchDays = 0;

    for (const [key, totals] of perBatchDay) {
      const [, dStr] = key.split('|');
      const bKey = bucketKey(dStr);
      const bucket = buckets.get(bKey) ?? { periodStart: bKey, issuedKg: 0, recordedKg: 0, diffKg: 0, mismatchDays: 0 };
      bucket.issuedKg   = Math.round((bucket.issuedKg + totals.issuedKg) * 100) / 100;
      bucket.recordedKg = Math.round((bucket.recordedKg + totals.recordedKg) * 100) / 100;
      bucket.diffKg     = Math.round((bucket.recordedKg - bucket.issuedKg) * 100) / 100;
      if (Math.abs(totals.recordedKg - totals.issuedKg) > FeedWastageService.ISSUED_VS_RECORDED_TOLERANCE_KG) {
        bucket.mismatchDays += 1;
        totalMismatchDays   += 1;
      }
      buckets.set(bKey, bucket);

      totalIssuedKg   += totals.issuedKg;
      totalRecordedKg += totals.recordedKg;
    }

    return {
      period,
      from: from.format('YYYY-MM-DD'),
      to:   to.format('YYYY-MM-DD'),
      totals: {
        issuedKg:     Math.round(totalIssuedKg * 100) / 100,
        recordedKg:   Math.round(totalRecordedKg * 100) / 100,
        diffKg:       Math.round((totalRecordedKg - totalIssuedKg) * 100) / 100,
        mismatchDays: totalMismatchDays,
      },
      buckets: Array.from(buckets.values()).sort((a, b) => a.periodStart.localeCompare(b.periodStart)),
    };
  }

  // ── Daily cron support: check yesterday's issued-vs-recorded mismatch for
  // one batch and notify the Director if it's outside tolerance. Separate
  // from the summary above (which is read-only for the panel) — this is the
  // write/notify side, called once per batch per day by
  // FeedIssuedVsRecordedCron.
  async notifyIfIssuedVsRecordedMismatch(batch: { id: string; batchCode: string }, date: Date) {
    const dayStart = dayjs(date).startOf('day').toDate();
    const dayEnd   = dayjs(date).endOf('day').toDate();

    const [productionAgg, brooderAgg, issuedRows] = await Promise.all([
      this.prisma.feedIntakeLog.aggregate({
        where: { batchId: batch.id, entryDate: { gte: dayStart, lte: dayEnd } },
        _sum: { quantityDispensedKg: true },
      }),
      this.prisma.brooderGeneralFeedLog.aggregate({
        where: { batchId: batch.id, entryDate: { gte: dayStart, lte: dayEnd } },
        _sum: { quantityDispensedKg: true },
      }),
      this.prisma.storeStockOut.findMany({
        where: { issuedToBatchId: batch.id, issuedDate: { gte: dayStart, lte: dayEnd } },
        select: { quantityOut: true, storeItem: { select: { category: true } } },
      }),
    ]);

    const recordedKg = Number(productionAgg._sum.quantityDispensedKg ?? 0)
      + Number(brooderAgg._sum.quantityDispensedKg ?? 0);
    const issuedKg = issuedRows
      .filter(r => r.storeItem.category === 'FEED' || r.storeItem.category === 'FEED_SUPPLEMENT')
      .reduce((s, r) => s + Number(r.quantityOut ?? 0), 0);

    // Nothing recorded and nothing issued — not a mismatch, just a quiet day.
    if (recordedKg === 0 && issuedKg === 0) return null;

    const diffKg = Math.round((recordedKg - issuedKg) * 100) / 100;
    if (Math.abs(diffKg) <= FeedWastageService.ISSUED_VS_RECORDED_TOLERANCE_KG) return null;

    const dayStrLabel = dayjs(date).format('D MMM YYYY');
    const direction = diffKg > 0
      ? `${diffKg.toFixed(2)}kg more was recorded fed than Store issued`
      : `${Math.abs(diffKg).toFixed(2)}kg less was recorded fed than Store issued`;

    await this.notifications.notifyRole(
      UserRole.OWNER,
      'BROODER_FEED_WASTAGE' as any,
      `Feed Issued vs Recorded Mismatch — ${batch.batchCode}`,
      `${batch.batchCode} on ${dayStrLabel}: Store issued ${issuedKg.toFixed(2)}kg of feed, ` +
      `attendants recorded ${recordedKg.toFixed(2)}kg fed — ${direction}.`,
      { entityId: batch.id, entityType: 'Batch' },
    );

    return { batchId: batch.id, issuedKg, recordedKg, diffKg };
  }
}
