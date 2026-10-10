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
import { convertToUnit } from '../units/unit-conversion.util';
import {
  batchAgeWeeks, brooderRequiredFeedKg, farmNow, farmTodayUtcMidnight, hylineGramsPerBirdPerDay, requiredFeedKg,
} from './feed-standard.util';

export interface RecordFeedWastageParams {
  batch: { id: string; batchCode: string };
  entryDate: Date;
  dailyRationKg: number;
  generalFeedLogId: string;
  feedType: string;
  storeItemId: string | null;
  thisEntryKg: number;
  loggedById: string;
  /** Default true. False records the excess without paging the Director —
   *  used when a re-uploaded report re-applies a day whose figures didn't
   *  change, so the same excess isn't announced twice. */
  notify?: boolean;
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
  /** Default true — see RecordFeedWastageParams.notify. */
  notify?: boolean;
}

@Injectable()
export class FeedWastageService {
  private readonly logger = new Logger(FeedWastageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Feed wastage: ONE row per (batch, day), always rebuilt from current data ──
  //
  // A day's wastage used to be written once, at the moment a feed entry was
  // saved, as the INCREMENTAL excess of that entry. Anything that changed
  // the day afterwards — a re-uploaded production report, a rollback, a
  // returned-and-resubmitted egg session, a deleted/corrected feed log —
  // left those rows stale (e.g. "0.11 kg over" for a day that is no longer
  // over at all). recomputeDay() instead looks at everything recorded for
  // the batch on that day *now*, and keeps exactly one wastage row that
  // matches it (updated in place, created, or removed). Every write path
  // calls it, and FeedWastageRecomputeCron re-runs it for recent days as a
  // safety net, so the Director's figures follow the data automatically.
  //
  // Excess only counts when it is a real over-issue, not weighing / rounding
  // noise: more than max(0.5 kg, 1% of the day's ration). Cost is always
  // priced per kg — from the linked store item, else the latest feed issued
  // to the batch, else the matching feed item in Store, else Store's average
  // feed price — and is never shown as KES 0 for a non-zero excess.
  static readonly EXCESS_MIN_KG = 0.5;
  static readonly EXCESS_MIN_FRACTION = 0.01;

  static excessThreshold(requiredKg: number) {
    return Math.max(FeedWastageService.EXCESS_MIN_KG, requiredKg * FeedWastageService.EXCESS_MIN_FRACTION);
  }

  private static dayStart(date: Date | string) {
    const dayStr = typeof date === 'string' ? date.slice(0, 10) : dayjs(date).format('YYYY-MM-DD');
    return new Date(`${dayStr}T00:00:00.000Z`);
  }

  /** Store price of feed, per kg. Null only when Store has no priced feed at all. */
  async resolveFeedCostPerKg(args: { storeItemId?: string | null; feedType?: string | null; batchId: string; day: Date }) {
    const perKg = (item: { unit: string | null; unitCostKes: any; name?: string } | null) => {
      if (!item) return null;
      const cost = Number(item.unitCostKes);
      if (!(cost > 0)) return null;
      if (!item.unit) return cost;
      const unitsPerKg = convertToUnit(1, 'KG', item.unit);
      if (unitsPerKg != null && unitsPerKg > 0) return Math.round(cost * unitsPerKg * 10000) / 10000;
      // Bags / sacks: use the pack size in the name ("Layers Mash 70kg").
      const pack = `${item.name ?? ''} ${item.unit}`.match(/(\d+(?:\.\d+)?)\s*kgs?\b/i);
      return pack && Number(pack[1]) > 0 ? Math.round((cost / Number(pack[1])) * 10000) / 10000 : null;
    };

    if (args.storeItemId) {
      const item = await this.prisma.storeItem.findUnique({
        where: { id: args.storeItemId }, select: { name: true, unit: true, unitCostKes: true },
      });
      const c = perKg(item);
      if (c != null) return { costPerKg: c, source: item!.name };
    }

    const issued = await this.prisma.storeStockOut.findMany({
      where: {
        issuedToBatchId: args.batchId,
        issuedDate: { lte: new Date(args.day.getTime() + 86_399_999) },
        storeItem: { category: { in: ['FEED', 'FEED_SUPPLEMENT'] } },
      },
      orderBy: { issuedDate: 'desc' },
      take: 5,
      select: { unitCostKes: true, storeItem: { select: { name: true, unit: true } } },
    });
    for (const so of issued) {
      const c = perKg({ unit: so.storeItem.unit, unitCostKes: so.unitCostKes, name: so.storeItem.name });
      if (c != null) return { costPerKg: c, source: so.storeItem.name };
    }

    const feedItems = await this.prisma.storeItem.findMany({
      where: { category: 'FEED', isActive: true },
      select: { name: true, unit: true, unitCostKes: true },
    });
    const key = String(args.feedType ?? '').toLowerCase().split('_')[0]; // layer / grower / chick / developer / prelayer / kienyeji
    if (key) {
      const match = feedItems.find(i => i.name.toLowerCase().replace(/[^a-z]/g, '').includes(key) && perKg(i) != null);
      if (match) return { costPerKg: perKg(match)!, source: match.name };
    }
    const priced = feedItems.map(perKg).filter((c): c is number => c != null);
    if (priced.length) {
      return {
        costPerKg: Math.round((priced.reduce((a, b) => a + b, 0) / priced.length) * 10000) / 10000,
        source: 'Average Store feed price',
      };
    }
    return null;
  }

  /**
   * Rebuilds the single wastage row for one batch-day from what is recorded
   * now. `requiredKg` / `dispensedKg` overrides are used by callers that
   * already know the day's ration of record (e.g. a production report's
   * opening stock); otherwise the ration comes from the day's own snapshot
   * (existing row, feed-log snapshot, or the egg sessions' opening count).
   * Returns the row (or null when the day is not over-issued).
   */
  async recomputeDay(batchId: string, date: Date | string, opts: {
    requiredKg?: number;
    dispensedKg?: number;
    feedType?: string;
    storeItemId?: string | null;
    sourceEntityId?: string;
    loggedById?: string;
    notify?: boolean;
    populationNote?: string;
  } = {}) {
    const day = FeedWastageService.dayStart(date);
    const dayEnd = new Date(day.getTime() + 86_399_999);
    const batch = await this.prisma.batch.findUnique({
      where: { id: batchId },
      select: { id: true, batchCode: true, dateReceived: true, currentBirdCount: true },
    });
    if (!batch) return null;

    const [existing, generalLogs, sessions] = await Promise.all([
      this.prisma.brooderFeedWastageLog.findMany({ where: { batchId, entryDate: day }, orderBy: { createdAt: 'desc' } }),
      this.prisma.brooderGeneralFeedLog.findMany({
        where: { batchId, entryDate: { gte: day, lte: dayEnd } },
        select: { id: true, feedType: true, storeItemId: true, quantityDispensedKg: true, requiredKgForDay: true, loggedById: true },
      }),
      this.prisma.eggCollectionSession.findMany({
        where: { batchId, sessionDate: day, deletedAt: null },
        select: { id: true, shift: true, block: true, openingPop: true, feedKg: true, feedTypeName: true, feedStoreItemId: true, collectedById: true },
      }),
    ]);
    const previousExcess = existing.reduce((sum, r) => sum + r.excessKg, 0);

    // ── What was fed that day, and against what ration ──
    let dispensedKg = 0;
    let requiredKg: number | null = null;
    let feedType = opts.feedType ?? 'LAYER_MASH';
    let storeItemId: string | null = opts.storeItemId ?? null;
    let sourceId = opts.sourceEntityId ?? existing[0]?.generalFeedLogId ?? '';
    let loggedById = opts.loggedById ?? existing[0]?.loggedById ?? '';

    if (generalLogs.length) {
      dispensedKg = generalLogs.reduce((sum, r) => sum + (r.quantityDispensedKg ?? 0), 0);
      const dominant = [...generalLogs].sort((a, b) => (b.quantityDispensedKg ?? 0) - (a.quantityDispensedKg ?? 0))[0];
      feedType = opts.feedType ?? dominant.feedType;
      storeItemId = opts.storeItemId !== undefined ? opts.storeItemId : dominant.storeItemId;
      sourceId = opts.sourceEntityId ?? dominant.id;
      loggedById = opts.loggedById ?? dominant.loggedById;
      const snapshot = Math.max(0, ...generalLogs.map(r => r.requiredKgForDay ?? 0));
      requiredKg = existing[0]?.requiredKgForDay ?? (snapshot > 0 ? snapshot : null);
      // Today / yesterday with no snapshot: the live headcount is the population of record.
      if (requiredKg == null && dayjs(farmNow()).diff(dayjs(day), 'day') <= 1) {
        requiredKg = brooderRequiredFeedKg(batch.currentBirdCount, batchAgeWeeks(batch.dateReceived, day), 1);
      }
    } else if (sessions.length) {
      dispensedKg = sessions.reduce((sum, r) => sum + Number(r.feedKg ?? 0), 0);
      const first = sessions.find(x => x.shift === 'AM' && Number(x.feedKg ?? 0) > 0) ?? sessions[0];
      feedType = opts.feedType ?? first.feedTypeName ?? 'LAYER_MASH';
      storeItemId = opts.storeItemId !== undefined ? opts.storeItemId : first.feedStoreItemId;
      sourceId = opts.sourceEntityId ?? first.id;
      loggedById = opts.loggedById ?? first.collectedById;
      // Population of record = each block's opening count for its first shift of the day.
      const byBlock = new Map<string, number>();
      for (const sess of [...sessions].sort((a, b) => (a.shift === 'AM' ? -1 : 1) - (b.shift === 'AM' ? -1 : 1))) {
        if (!byBlock.has(sess.block)) byBlock.set(sess.block, sess.openingPop);
      }
      const population = [...byBlock.values()].reduce((a, b) => a + b, 0);
      requiredKg = population > 0
        ? requiredFeedKg(population, 'LAYER_MASH', batchAgeWeeks(batch.dateReceived, day), 1, (_t, aw) => hylineGramsPerBirdPerDay(aw))
        : existing[0]?.requiredKgForDay ?? null;
    }
    if (opts.requiredKg != null && opts.requiredKg > 0) requiredKg = opts.requiredKg;
    if (opts.dispensedKg != null) dispensedKg = opts.dispensedKg;
    dispensedKg = Math.round(dispensedKg * 100) / 100;

    // No ration of record → leave the day exactly as it is.
    if (requiredKg == null || requiredKg <= 0) return existing[0] ?? null;

    const excessKg = Math.round((dispensedKg - requiredKg) * 100) / 100;
    const isOver = excessKg > FeedWastageService.excessThreshold(requiredKg);

    if (!isOver) {
      if (existing.length) await this.prisma.brooderFeedWastageLog.deleteMany({ where: { id: { in: existing.map(r => r.id) } } });
      return null;
    }

    const price = await this.resolveFeedCostPerKg({ storeItemId, feedType, batchId, day });
    const unitCostKes = price?.costPerKg ?? null;
    const excessCostKes = unitCostKes != null ? Math.round(excessKg * unitCostKes * 100) / 100 : null;
    const data = {
      batchCode: batch.batchCode,
      generalFeedLogId: sourceId,
      feedType,
      storeItemId,
      storeItemName: price?.source ?? null,
      requiredKgForDay: Math.round(requiredKg * 100) / 100,
      dispensedKgTotal: dispensedKg,
      excessKg,
      unitCostKes,
      excessCostKes,
    };

    let row;
    if (existing.length) {
      row = await this.prisma.brooderFeedWastageLog.update({ where: { id: existing[0].id }, data });
      if (existing.length > 1) {
        await this.prisma.brooderFeedWastageLog.deleteMany({ where: { id: { in: existing.slice(1).map(r => r.id) } } });
      }
    } else {
      row = await this.prisma.brooderFeedWastageLog.create({
        data: { ...data, batchId, entryDate: day, loggedById: loggedById || 'system' },
      });
    }

    // Page the Director only when the day became (more) over-issued.
    if (opts.notify && excessKg > previousExcess + FeedWastageService.excessThreshold(requiredKg)) {
      const dayStr = dayjs(day).format('YYYY-MM-DD');
      const costLine = excessCostKes != null
        ? ` Cost of the excess: KES ${excessCostKes.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ` +
          `(${price!.source} @ KES ${unitCostKes!.toFixed(2)}/kg).`
        : ' No priced feed in Store, so the cost could not be calculated.';
      await this.notifications.notifyRole(
        UserRole.OWNER,
        'BROODER_FEED_WASTAGE' as any,
        `Feed Over-Issued — ${batch.batchCode}`,
        `Batch ${batch.batchCode} was given ${dispensedKg.toFixed(2)}kg of feed on ${dayStr} against a required ` +
        `${requiredKg.toFixed(2)}kg${opts.populationNote ?? ''} — ${excessKg.toFixed(2)}kg more than estimated.` + costLine,
        { entityId: batch.id, entityType: 'Brooder' },
      ).catch(() => {});
    }
    return row;
  }

  /** Re-runs recomputeDay for several days of one batch (no Director paging). */
  async recomputeDays(batchId: string, dates: Iterable<Date | string>) {
    const seen = new Set<string>();
    for (const d of dates) {
      const key = FeedWastageService.dayStart(d).toISOString();
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        await this.recomputeDay(batchId, d);
      } catch (err) {
        this.logger.warn(`Feed-wastage recompute failed for ${batchId} on ${key.slice(0, 10)}: ${(err as Error).message}`);
      }
    }
  }

  /** Safety net: every batch with feed recorded in the last `days` days. */
  async recomputeRecent(days = 14) {
    const from = new Date(farmTodayUtcMidnight().getTime() - days * 86_400_000);
    const [general, sessions, rows] = await Promise.all([
      this.prisma.brooderGeneralFeedLog.findMany({ where: { entryDate: { gte: from } }, select: { batchId: true, entryDate: true } }),
      this.prisma.eggCollectionSession.findMany({ where: { sessionDate: { gte: from }, deletedAt: null }, select: { batchId: true, sessionDate: true } }),
      this.prisma.brooderFeedWastageLog.findMany({ where: { entryDate: { gte: from } }, select: { batchId: true, entryDate: true } }),
    ]);
    const byBatch = new Map<string, Date[]>();
    const add = (batchId: string, d: Date) => byBatch.set(batchId, [...(byBatch.get(batchId) ?? []), d]);
    general.forEach(g => add(g.batchId, g.entryDate));
    sessions.forEach(x => add(x.batchId, x.sessionDate));
    rows.forEach(r => add(r.batchId, r.entryDate));
    for (const [batchId, dates] of byBatch) await this.recomputeDays(batchId, dates);
    return { batches: byBatch.size };
  }

  // ── Call-site API (kept for existing callers) — all routed through recomputeDay ──

  /** After a whole-brooder feed entry is saved (manual or report auto-fill). */
  async recordIfOverIssued(params: RecordFeedWastageParams) {
    return this.recomputeDay(params.batch.id, params.entryDate, {
      requiredKg: params.dailyRationKg,
      loggedById: params.loggedById,
      notify: params.notify !== false,
    });
  }

  /** After a production report sets a laying day's feed; ration from the report's opening stock. */
  async recordProductionOverIssuance(params: RecordProductionFeedWastageParams) {
    return this.recomputeDay(params.batch.id, params.entryDate, {
      requiredKg: params.requiredKg,
      dispensedKg: params.actualKg,
      feedType: params.feedType,
      storeItemId: params.storeItemId,
      sourceEntityId: params.sourceEntityId,
      loggedById: params.loggedById,
      notify: params.notify !== false,
      populationNote: ` for its reported opening stock of ${params.populationOpeningStock.toLocaleString()} birds`,
    });
  }

  /** Report re-applied a day whose feed already matched — just re-check it. */
  async backfillDayIfOverIssued(params: {
    batch: { id: string; batchCode: string };
    entryDate: Date;
    dailyRationKg: number;
    loggedById: string;
    notify?: boolean;
  }) {
    return this.recomputeDay(params.batch.id, params.entryDate, {
      requiredKg: params.dailyRationKg,
      loggedById: params.loggedById,
      notify: params.notify === true,
    });
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
