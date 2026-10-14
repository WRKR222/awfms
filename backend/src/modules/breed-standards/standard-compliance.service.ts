// src/modules/breed-standards/standard-compliance.service.ts
//
// Scores each batch against its breed guide, week by week, from the records
// AWFMS already holds (egg sessions, brooder logs, feed/water, weighings,
// mortalities). Results are upserted into BatchStandardMetric — the batch's
// benchmark history — and a deviation is notified ONCE, on the first week of
// a run (a parameter that stays off-standard for 5 weeks is one message).
//
// Also: declared farm practices, next-batch lessons, batch comparison and
// the plain-text context handed to AI reports.
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationType, UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { BATCH_TRANSFERRED_EVENT } from '../../common/events/app-event-bus';
import { farmTodayUtcMidnight } from '../../common/feed/feed-standard.util';
import { metricDef } from './breed-metrics.catalog';
import { COMPARED_NUTRIENTS } from './feed-nutrients.catalog';
import {
  BatchStandardContext, BreedStandardService, ResolvedBand, applyTolerance, bandStatus,
} from './breed-standard.service';

const DAY_MS = 86_400_000;
const DEVIATION = new Set(['BELOW', 'ABOVE', 'MISMATCH']);
/** Deviations older than this when first computed are history, not news. */
const NOTIFY_WITHIN_DAYS = 14;
/** Minimum days with data before a weekly average counts. */
const MIN_DAYS_PER_WEEK = 4;
/** Cumulative figures need this share of days recorded, else they'd mislead. */
const MIN_COVERAGE = 0.9;

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);
const utcMidnight = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const round = (v: number, dp = 2) => Math.round(v * 10 ** dp) / 10 ** dp;

interface DayData {
  eggs: number;            // all eggs laid (good + starter + broken + damaged + soft + deformed)
  weighedEggs: number;     // eggs covered by the weight entered = all laid except damaged
  weightKg: number;        // weight entered at collection
  hasEggs: boolean;
  blockPop: Map<string, number>; // opening population per block (first shift of the day)
  feedKg: number | null;
  altFeedKg: number | null;      // FeedIntakeLog — used only when sessions have none
  waterL: number | null;
  deaths: number;
  altDeaths: number;             // FlockDailyEntry — used only when nothing else recorded deaths
  temps: number[];
  lux: number[];
  feedTypes: Set<string>;
  /** Feed eaten that day, line by line — matched to Store's lab tests. */
  feedLines: FeedLine[];
  altFeedLines: FeedLine[];      // FeedIntakeLog — used only when nothing else recorded feed
  houseTemps: number[];          // production-house temperature (egg sessions)
}

interface FeedLine { kg: number; storeItemId: string | null; family: string | null }

type LabTest = { storeItemId: string; feedFamily: string | null; effectiveFrom: Date; values: Record<string, number> };

/** Latest lab test for this feed in force on `date`: the exact store item
 *  first, otherwise a test of the same feed family. */
export function labTestFor(tests: LabTest[], line: FeedLine, date: Date): LabTest | null {
  const inForce = tests.filter(t => t.effectiveFrom <= date);
  return (line.storeItemId && inForce.find(t => t.storeItemId === line.storeItemId))
    || (line.family && inForce.find(t => t.feedFamily === line.family))
    || null;
}

/** Feed-weighted nutrient concentration of a day's diet; null when any feed
 *  eaten that day has no lab test. A nutrient missing from one of the tests
 *  is left out for that day. */
export function dayDiet(lines: FeedLine[], tests: LabTest[], date: Date): { kg: number; conc: Record<string, number> } | null {
  const fed = lines.filter(l => l.kg > 0);
  if (!fed.length) return null;
  const matched = fed.map(l => ({ l, t: labTestFor(tests, l, date) }));
  if (matched.some(m => !m.t)) return null;
  const kg = fed.reduce((a, l) => a + l.kg, 0);
  const keys = Object.keys(matched[0].t!.values).filter(k => matched.every(m => m.t!.values[k] != null));
  const conc: Record<string, number> = {};
  for (const k of keys) conc[k] = matched.reduce((a, m) => a + m.l.kg * Number(m.t!.values[k]), 0) / kg;
  return { kg, conc };
}

interface Candidate {
  metric: string;
  ageUnit: 'WEEK' | 'DAY' | 'MILESTONE';
  ageIndex: number;
  periodStart: Date;
  periodEnd: Date;
  actual: number | null;
  actualText?: string | null;
  band: ResolvedBand | null;
  status: string;
  guideStatus?: string | null;
  sampleSize?: number | null;
}

/** Maps any feed name the farm uses to the guide's feed families. */
export function canonicalFeedType(name: string | null | undefined): string | null {
  const n = String(name ?? '').toUpperCase();
  if (!n || n.includes('KIENYEJI')) return null;
  if (n.includes('PRE') && n.includes('LAY')) return 'PRELAYER_MASH';
  if (n.includes('LAYER') || n.includes('LAYING')) return 'LAYER_MASH';
  if (n.includes('DEVELOP')) return 'DEVELOPER_MASH';
  if (n.includes('GROW')) return 'GROWER_MASH';
  if (n.includes('CRUMB')) return 'CHICK_CRUMBS';
  if (n.includes('CHICK') || n.includes('STARTER')) return 'CHICK_MASH';
  return null;
}

/** % of individual weights within ±10% of their mean (the guide's uniformity). */
export function uniformityPct(weights: number[]): number | null {
  if (weights.length < 10) return null;
  const mean = weights.reduce((a, b) => a + b, 0) / weights.length;
  const within = weights.filter(w => Math.abs(w - mean) <= mean * 0.1).length;
  return round((within / weights.length) * 100, 1);
}

@Injectable()
export class StandardComplianceService {
  private readonly logger = new Logger(StandardComplianceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly standards: BreedStandardService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Data collection ─────────────────────────────────────────────────────

  private async collectDaily(batchId: string, from: Date, to: Date) {
    const range = { gte: from, lte: to };
    const [sessions, feedLogs, brooderFeed, brooderDeaths, flockEntries, brooderLogs, samples, track] = await Promise.all([
      this.prisma.eggCollectionSession.findMany({
        where: { batchId, deletedAt: null, status: { not: 'RETURNED' }, sessionDate: range },
        select: {
          sessionDate: true, shift: true, block: true, openingPop: true, mortalities: true,
          totalGoodEggs: true, totalStarterEggs: true, totalBrokenEggs: true, totalDamaged: true,
          totalSoftShell: true, totalDeformed: true, totalWeightKg: true, feedKg: true,
          feedTypeName: true, feedBreakdownJson: true, feedStoreItemId: true, waterLiters: true, houseTempC: true,
        },
      }),
      this.prisma.feedIntakeLog.findMany({
        where: { batchId, status: { not: 'RETURNED' }, entryDate: range },
        select: { entryDate: true, quantityDispensedKg: true, feedType: true, storeItemId: true },
      }),
      this.prisma.brooderGeneralFeedLog.findMany({
        where: { batchId, entryDate: range },
        select: { entryDate: true, quantityDispensedKg: true, feedType: true, storeItemId: true },
      }),
      this.prisma.brooderGeneralMortalityLog.findMany({
        where: { batchId, logDate: range },
        select: { logDate: true, mortalityCount: true, cullingCount: true },
      }),
      this.prisma.flockDailyEntry.findMany({
        where: { batchId, status: { not: 'RETURNED' }, entryDate: range },
        select: { entryDate: true, mortalityCount: true, cullingCount: true, waterConsumptionL: true, temperatureCelsius: true },
      }),
      this.prisma.brooderLog.findMany({
        where: { batchId, logDate: range },
        select: {
          logDate: true, waterConsumptionL: true, temperature: true, lightIntensityLux: true,
          reading3amTemperature: true, reading6amTemperature: true,
          reading3amLightIntensityLux: true, reading6amLightIntensityLux: true,
        },
      }),
      this.prisma.birdWeightSample.findMany({
        where: { batchId, sampleDate: range },
        select: { sampleDate: true, sampleCount: true, averageWeightG: true, individualWeightsG: true },
      }),
      this.prisma.batchWeightTrackPoint.findMany({
        where: { batchId, sampleDate: range },
        select: { sampleDate: true, avgActualG: true },
      }),
    ]);

    const days = new Map<string, DayData>();
    const day = (d: Date) => {
      const k = dayKey(d);
      let v = days.get(k);
      if (!v) {
        v = {
          eggs: 0, weighedEggs: 0, weightKg: 0, hasEggs: false, blockPop: new Map(), feedKg: null, altFeedKg: null,
          waterL: null, deaths: 0, altDeaths: 0, temps: [], lux: [], feedTypes: new Set(),
          feedLines: [], altFeedLines: [], houseTemps: [],
        };
        days.set(k, v);
      }
      return v;
    };
    const addTo = (cur: number | null, v: number) => (cur ?? 0) + v;

    // AM before PM so the first shift's opening population is the day's.
    sessions.sort((a, b) => a.sessionDate.getTime() - b.sessionDate.getTime() || a.shift.localeCompare(b.shift));
    for (const s of sessions) {
      const d = day(s.sessionDate);
      // The weight recorded at collection covers every egg except damaged ones.
      const weighed = s.totalGoodEggs + s.totalStarterEggs + s.totalBrokenEggs + s.totalSoftShell + s.totalDeformed;
      d.eggs += weighed + s.totalDamaged;
      d.hasEggs = true;
      const w = Number(s.totalWeightKg ?? 0);
      if (w > 0 && weighed > 0) { d.weightKg += w; d.weighedEggs += weighed; }
      if (!d.blockPop.has(s.block)) d.blockPop.set(s.block, s.openingPop);
      if (s.feedKg != null && Number(s.feedKg) > 0) d.feedKg = addTo(d.feedKg, Number(s.feedKg));
      if (s.waterLiters != null) d.waterL = addTo(d.waterL, Number(s.waterLiters));
      d.deaths += s.mortalities;
      if (s.houseTempC != null) d.houseTemps.push(Number(s.houseTempC));
      const lines = Array.isArray(s.feedBreakdownJson) ? (s.feedBreakdownJson as any[]) : [];
      for (const l of lines) {
        const t = canonicalFeedType(l?.feedType ?? l?.itemName); if (t) d.feedTypes.add(t);
        // Current shape { feedType, kg }; older { storeItemId, itemName, issuedKg, dispensedKg }.
        const kg = Number(l?.kg ?? l?.dispensedKg ?? l?.issuedKg ?? 0);
        if (kg > 0) d.feedLines.push({ kg, family: t, storeItemId: l?.storeItemId ?? (lines.length === 1 ? s.feedStoreItemId : null) });
      }
      const t = canonicalFeedType(s.feedTypeName); if (t) d.feedTypes.add(t);
      if (!lines.length && Number(s.feedKg ?? 0) > 0) d.feedLines.push({ kg: Number(s.feedKg), family: t, storeItemId: s.feedStoreItemId });
    }
    for (const f of feedLogs) {
      const d = day(f.entryDate);
      d.altFeedKg = addTo(d.altFeedKg, Number(f.quantityDispensedKg));
      const t = canonicalFeedType(f.feedType); if (t) d.feedTypes.add(t);
      d.altFeedLines.push({ kg: Number(f.quantityDispensedKg), family: t, storeItemId: f.storeItemId });
    }
    for (const f of brooderFeed) {
      const d = day(f.entryDate);
      d.feedKg = addTo(d.feedKg, Number(f.quantityDispensedKg));
      const t = canonicalFeedType(f.feedType); if (t) d.feedTypes.add(t);
      d.feedLines.push({ kg: Number(f.quantityDispensedKg), family: t, storeItemId: f.storeItemId });
    }
    for (const m of brooderDeaths) day(m.logDate).deaths += m.mortalityCount + m.cullingCount;
    for (const e of flockEntries) {
      const d = day(e.entryDate);
      d.altDeaths += e.mortalityCount + e.cullingCount;
      if (e.waterConsumptionL != null && d.waterL == null) d.waterL = Number(e.waterConsumptionL);
      if (e.temperatureCelsius != null) d.temps.push(Number(e.temperatureCelsius));
    }
    for (const l of brooderLogs) {
      const d = day(l.logDate);
      if (l.waterConsumptionL != null) d.waterL = addTo(d.waterL, l.waterConsumptionL);
      for (const t of [l.temperature, l.reading3amTemperature, l.reading6amTemperature]) if (t != null) d.temps.push(t);
      for (const x of [l.lightIntensityLux, l.reading3amLightIntensityLux, l.reading6amLightIntensityLux]) if (x != null) d.lux.push(x);
    }
    for (const d of days.values()) {
      if (d.feedKg == null && d.altFeedKg != null) d.feedKg = d.altFeedKg;
      if (!d.feedLines.length && d.altFeedLines.length) d.feedLines = d.altFeedLines;
      if (d.deaths === 0 && d.altDeaths > 0) d.deaths = d.altDeaths;
    }
    return { days, samples, track };
  }

  // ── Evaluation ──────────────────────────────────────────────────────────

  async evaluateActiveBatches() {
    const batches = await this.prisma.batch.findMany({
      where: { isActive: true, deletedAt: null, breedId: { not: null } },
      select: { id: true },
    });
    let deviations = 0;
    for (const b of batches) {
      try { deviations += (await this.evaluateBatch(b.id)).newDeviations; }
      catch (err: any) { this.logger.error(`Standards evaluation failed for batch ${b.id}: ${err?.message}`); }
    }
    return { batches: batches.length, newDeviations: deviations };
  }

  async evaluateBatch(batchId: string) {
    const ctx = await this.standards.batchContext(batchId);
    if (!ctx) throw new NotFoundException('Batch not found');
    if (!ctx.guide) return { evaluated: 0, newDeviations: 0, skipped: 'No breed guide for this batch' };
    const batch = await this.prisma.batch.findUniqueOrThrow({ where: { id: batchId } });

    const hatch = utcMidnight(ctx.dateOfHatch);
    const received = utcMidnight(ctx.dateReceived);
    const start = received > hatch ? received : hatch;
    const yesterday = addDays(farmTodayUtcMidnight(), -1);
    const closed = [batch.closedAt, batch.soldAt, batch.discardedAt].filter(Boolean).map(d => utcMidnight(d!));
    const end = closed.length ? new Date(Math.min(yesterday.getTime(), ...closed.map(d => d.getTime()))) : yesterday;
    if (end < start) return { evaluated: 0, newDeviations: 0 };

    const { days, samples, track } = await this.collectDaily(batchId, start, end);
    const tracked = (m: string) => !ctx.untracked.has(m);

    // Population per day: the egg session's opening count when there is one,
    // otherwise birds placed minus deaths recorded before that day.
    const effectiveReceived = Math.max(0, batch.quantityReceived - batch.mortalityOnArrival);
    const popByDay = new Map<string, number>();
    const cumDeathsByDay = new Map<string, number>();
    let deathsSoFar = 0;
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const k = dayKey(d);
      const data = days.get(k);
      const sessionPop = data && data.blockPop.size ? [...data.blockPop.values()].reduce((a, b) => a + b, 0) : null;
      popByDay.set(k, sessionPop ?? Math.max(0, effectiveReceived - deathsSoFar));
      deathsSoFar += data?.deaths ?? 0;
      cumDeathsByDay.set(k, deathsSoFar);
    }
    const pop = (k: string) => popByDay.get(k) ?? 0;
    const daysIn = (from: Date, to: Date) => {
      const out: string[] = [];
      for (let d = from < start ? start : from; d <= to && d <= end; d = addDays(d, 1)) out.push(dayKey(d));
      return out;
    };

    const weekStart = (w: number) => addDays(hatch, (w - 1) * 7);
    const weekEnd = (w: number) => addDays(hatch, w * 7 - 1);
    const firstWeek = Math.max(1, Math.floor((start.getTime() - hatch.getTime()) / DAY_MS / 7) + 1);
    const lastWeek = Math.floor((end.getTime() - hatch.getTime()) / DAY_MS / 7); // last COMPLETE week
    const receivedInWeek1 = start.getTime() - hatch.getTime() < 7 * DAY_MS;

    const out: Candidate[] = [];
    const push = async (
      metric: string, ageIndex: number, from: Date, to: Date, actual: number | null,
      extra: { ageUnit?: Candidate['ageUnit']; variant?: string | null; bandAge?: number; bandUnit?: 'WEEK' | 'DAY'; sampleSize?: number | null; actualText?: string | null } = {},
    ) => {
      if (actual == null || !Number.isFinite(actual) || !tracked(metric)) return;
      const band = await this.standards.resolveBand(ctx, metric, extra.bandAge ?? ageIndex, {
        ageUnit: extra.bandUnit ?? 'WEEK',
        ...(extra.variant !== undefined ? { variant: extra.variant } : {}),
      });
      if (!band) return;
      out.push({
        metric, ageUnit: extra.ageUnit ?? 'WEEK', ageIndex, periodStart: from, periodEnd: to,
        actual: round(actual, 3), actualText: extra.actualText ?? null, band,
        status: bandStatus(actual, band), guideStatus: bandStatus(actual, band.guide), sampleSize: extra.sampleSize ?? null,
      });
    };

    // Lay-period anchors.
    const w18 = weekStart(18);
    const layStart = w18 < start ? start : w18;
    const housedBase = pop(dayKey(layStart)) || effectiveReceived;
    const eggDays = [...days.entries()].filter(([, d]) => d.hasEggs && d.eggs > 0).map(([k]) => k).sort();
    const firstEggDay = eggDays[0] ?? null;
    const weeklyHdp = new Map<number, number>();
    const dailyAvgEggWt = (d: DayData) => (d.weighedEggs > 0 ? (d.weightKg * 1000) / d.weighedEggs : null);
    const validEggWt = (v: number | null) => v != null && v >= 30 && v <= 90;

    const feedPhases = (await this.standards.metricSeries(ctx.guide.id, 'FEED_PHASE')).filter(p => p.ageUnit === 'WEEK');
    // Store's feed lab tests (only needed when feed nutrients are recorded).
    const labTests: LabTest[] = tracked('FEED_NUTRIENTS') ? await this.labTests() : [];
    const prelayEarliest = (await this.standards.resolveBand(ctx, 'PRELAY_EARLIEST_WEEK', 15))?.min ?? null;

    for (let w = firstWeek; w <= lastWeek; w++) {
      const ws = weekStart(w), we = weekEnd(w);
      const keys = daysIn(ws, we);
      if (keys.length === 0) continue;
      const data = keys.map(k => ({ k, d: days.get(k) })).filter(x => x.d) as { k: string; d: DayData }[];

      // Body weight & uniformity
      const wkSamples = samples.filter(s => s.sampleDate >= ws && s.sampleDate <= we);
      if (wkSamples.length) {
        const n = wkSamples.reduce((a, s) => a + Math.max(1, s.sampleCount), 0);
        const avg = wkSamples.reduce((a, s) => a + Number(s.averageWeightG) * Math.max(1, s.sampleCount), 0) / n;
        await push('BODY_WEIGHT', w, ws, we, avg, { sampleSize: n });
        const indiv = wkSamples.flatMap(s => s.individualWeightsG ?? []).filter(x => x > 0);
        const u = uniformityPct(indiv);
        if (u != null) await push('UNIFORMITY', w, ws, we, u, { sampleSize: indiv.length });
      } else {
        const tp = track.filter(t => t.sampleDate >= ws && t.sampleDate <= we && t.avgActualG != null);
        if (tp.length) await push('BODY_WEIGHT', w, ws, we, tp.reduce((a, t) => a + Number(t.avgActualG), 0) / tp.length, { sampleSize: null, actualText: 'from production report weight track' });
      }

      // Feed & water per bird
      const feedDays = data.filter(x => x.d.feedKg != null && pop(x.k) > 0);
      if (feedDays.length >= MIN_DAYS_PER_WEEK) {
        await push('FEED_INTAKE', w, ws, we, feedDays.reduce((a, x) => a + (x.d.feedKg! * 1000) / pop(x.k), 0) / feedDays.length, { sampleSize: feedDays.length });
      }
      const waterDays = data.filter(x => x.d.waterL != null && x.d.waterL > 0 && pop(x.k) > 0);
      if (waterDays.length >= MIN_DAYS_PER_WEEK) {
        await push('WATER_INTAKE', w, ws, we, waterDays.reduce((a, x) => a + (x.d.waterL! * 1000) / pop(x.k), 0) / waterDays.length, { sampleSize: waterDays.length });
      }

      // Laying rate & egg weight
      const layDays = data.filter(x => x.d.hasEggs && pop(x.k) > 0);
      if (layDays.length >= MIN_DAYS_PER_WEEK) {
        const hdp = layDays.reduce((a, x) => a + (x.d.eggs / pop(x.k)) * 100, 0) / layDays.length;
        weeklyHdp.set(w, hdp);
        await push('HEN_DAY_PCT', w, ws, we, hdp, { sampleSize: layDays.length });
      }
      const wtDays = data.filter(x => validEggWt(dailyAvgEggWt(x.d)));
      if (wtDays.length) {
        const g = wtDays.reduce((a, x) => a + x.d.weightKg, 0) * 1000 / wtDays.reduce((a, x) => a + x.d.weighedEggs, 0);
        await push('EGG_WEIGHT', w, ws, we, g, { sampleSize: wtDays.length });
      }

      // Livability
      const deathsThrough = cumDeathsByDay.get(dayKey(we < end ? we : end)) ?? 0;
      if (w <= 17 && receivedInWeek1 && effectiveReceived > 0) {
        await push('MORTALITY_CUM_REARING', w, ws, we, (deathsThrough / effectiveReceived) * 100);
      }
      if (w >= 18 && housedBase > 0) {
        const before = cumDeathsByDay.get(dayKey(addDays(layStart, -1))) ?? 0;
        await push('MORTALITY_CUM_LAY', w, ws, we, ((deathsThrough - before) / housedBase) * 100);
      }

      // Cumulative rearing feed
      if (w <= 17 && receivedInWeek1) {
        const all = daysIn(hatch, we);
        const fed = all.filter(k => days.get(k)?.feedKg != null && pop(k) > 0);
        if (all.length && fed.length / all.length >= MIN_COVERAGE) {
          await push('FEED_CUM_REARING', w, ws, we, fed.reduce((a, k) => a + (days.get(k)!.feedKg! * 1000) / pop(k), 0), { sampleSize: fed.length });
        }
      }

      // Cumulative eggs & egg mass (from first egg)
      if (w >= 18 && firstEggDay && firstEggDay <= dayKey(we)) {
        const span = daysIn(new Date(firstEggDay), we);
        const recorded = span.filter(k => days.get(k)?.hasEggs);
        if (span.length && recorded.length / span.length >= MIN_COVERAGE) {
          await push('HD_EGGS_CUM', w, ws, we, recorded.reduce((a, k) => a + (pop(k) > 0 ? days.get(k)!.eggs / pop(k) : 0), 0));
          if (housedBase > 0) await push('HH_EGGS_CUM', w, ws, we, recorded.reduce((a, k) => a + days.get(k)!.eggs, 0) / housedBase);
          const weighed = recorded.filter(k => validEggWt(dailyAvgEggWt(days.get(k)!)));
          if (housedBase > 0 && weighed.length / recorded.length >= MIN_COVERAGE) {
            const massKg = weighed.reduce((a, k) => { const d = days.get(k)!; return a + (d.eggs * dailyAvgEggWt(d)!) / 1000; }, 0);
            await push('EGG_MASS_CUM', w, ws, we, massKg / housedBase);
          }
        }
      }

      // FCR milestones (guide gives 20–60, 20–72, 20–90 weeks)
      if (w === 60 || w === 72 || w === 90) {
        const span = daysIn(weekStart(20), we);
        const both = span.filter(k => { const d = days.get(k); return d && d.feedKg != null && d.hasEggs && validEggWt(dailyAvgEggWt(d)); });
        if (span.length && both.length / span.length >= MIN_COVERAGE) {
          const feed = both.reduce((a, k) => a + days.get(k)!.feedKg!, 0);
          const mass = both.reduce((a, k) => { const d = days.get(k)!; return a + (d.eggs * dailyAvgEggWt(d)!) / 1000; }, 0);
          if (mass > 0) await push('FCR_CUM', w, weekStart(20), we, feed / mass, { sampleSize: both.length });
        }
      }

      // Feed nutrients from lab tests: diet concentration in rearing, daily
      // intake per bird in lay (guide figures are total amino acids).
      if (labTests.length) {
        const diets = data.map(x => ({ ...x, diet: dayDiet(x.d.feedLines, labTests, new Date(x.k)) }));
        const fedKg = data.reduce((a, x) => a + x.d.feedLines.reduce((b, l) => b + l.kg, 0), 0);
        const covered = diets.filter(x => x.diet);
        const coveredKg = covered.reduce((a, x) => a + x.diet!.kg, 0);
        if (w <= 17 && fedKg > 0 && coveredKg / fedKg >= 0.8) {
          for (const n of COMPARED_NUTRIENTS) {
            const withN = covered.filter(x => x.diet!.conc[n.key] != null);
            const kg = withN.reduce((a, x) => a + x.diet!.kg, 0);
            if (!withN.length || kg / fedKg < 0.8) continue;
            await push(`DIET_${n.key}`, w, ws, we, withN.reduce((a, x) => a + x.diet!.kg * x.diet!.conc[n.key], 0) / kg, { sampleSize: withN.length });
          }
        }
        if (w >= 18) {
          const days = covered.filter(x => pop(x.k) > 0);
          if (days.length >= MIN_DAYS_PER_WEEK) {
            const peak = Math.max(...[...weeklyHdp.entries()].filter(([wk]) => wk <= w).map(([, v]) => v), 0) || null;
            const phases: Record<string, string | null> = {};
            for (const program of ['ECONOMICAL', 'OPTIMAL']) phases[program] = await this.layingPhase(ctx, program, weeklyHdp.get(w) ?? null, peak);
            const temps = data.flatMap(x => x.d.houseTemps);
            const avgTemp = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
            for (const n of COMPARED_NUTRIENTS) {
              const withN = days.filter(x => x.diet!.conc[n.key] != null);
              if (withN.length < MIN_DAYS_PER_WEEK || !tracked(`INTAKE_${n.key}`)) continue;
              const intake = withN.reduce((a, x) => a + n.intake((x.diet!.kg * 1000) / pop(x.k), x.diet!.conc[n.key]), 0) / withN.length;
              const band = await this.intakeBand(ctx, n.key, w, phases, n.key === 'ENERGY' ? avgTemp : null);
              if (!band) continue;
              out.push({
                metric: `INTAKE_${n.key}`, ageUnit: 'WEEK', ageIndex: w, periodStart: ws, periodEnd: we,
                actual: round(intake, 3), actualText: band.phase, band,
                status: bandStatus(intake, band), guideStatus: bandStatus(intake, band.guide), sampleSize: withN.length,
              });
            }
          }
        }
      }

      // Diet phase for age (with a one-phase transition allowance either side)
      if (tracked('FEED_PHASE') && feedPhases.length) {
        const types = new Set(data.flatMap(x => [...x.d.feedTypes]));
        const idx = feedPhases.findIndex(p => w >= p.ageFrom && w <= p.ageTo);
        const phase = idx >= 0 ? feedPhases[idx] : (w > Math.max(...feedPhases.map(p => p.ageTo)) ? feedPhases[feedPhases.length - 1] : null);
        if (types.size && phase) {
          const i = feedPhases.indexOf(phase);
          const allowed = new Set([feedPhases[i - 1], phase, feedPhases[i + 1]].filter(Boolean).flatMap(p => String(p!.text ?? '').split(',')));
          const problems: string[] = [];
          const offPhase = [...types].filter(t => !allowed.has(t));
          if (offPhase.length) problems.push(`${offPhase.join(', ')} fed; guide phase is ${phase.phase} (${phase.text})`);
          if (types.has('PRELAYER_MASH') && prelayEarliest != null && w < prelayEarliest) problems.push(`Pre-lay fed at week ${w}; guide says not before week ${prelayEarliest}`);
          if (types.has('PRELAYER_MASH') && (weeklyHdp.get(w) ?? 0) >= 5) problems.push('Pre-lay still fed after lay started — too little calcium for shell');
          const band = await this.standards.resolveBand(ctx, 'FEED_PHASE', w);
          if (band) {
            out.push({
              metric: 'FEED_PHASE', ageUnit: 'WEEK', ageIndex: w, periodStart: ws, periodEnd: we, actual: null,
              actualText: problems.length ? problems.join('; ') : [...types].join(', '),
              band, status: problems.length ? 'MISMATCH' : 'IN_BAND', guideStatus: problems.length ? 'MISMATCH' : 'IN_BAND',
            });
          }
        }
      }
    }

    // Light hours — declared practice vs the programme for the housing type.
    // Existing weeks are never rewritten, so changing the declaration later
    // keeps the history of what was declared at the time.
    if (tracked('LIGHT_HOURS') && batch.declaredLightHours != null) {
      const declaredFrom = utcMidnight(batch.recordingPlanSetAt ?? batch.createdAt);
      for (let w = firstWeek; w <= lastWeek; w++) {
        if (weekEnd(w) < declaredFrom) continue;
        await push('LIGHT_HOURS', w, weekStart(w), weekEnd(w), Number(batch.declaredLightHours), { variant: ctx.housingType });
      }
    }

    // Brooding temperature & light intensity by the guide's day ranges.
    for (const metric of ['BROODING_TEMP', 'LIGHT_INTENSITY'] as const) {
      if (!tracked(metric)) continue;
      const ranges = (await this.standards.metricSeries(ctx.guide.id, metric, metric === 'BROODING_TEMP' ? 'CAGE' : null)).filter(p => p.ageUnit === 'DAY');
      for (const r of ranges) {
        const from = addDays(hatch, r.ageFrom), to = addDays(hatch, r.ageTo);
        if (to > end) continue;
        const vals = daysIn(from, to).flatMap(k => (metric === 'BROODING_TEMP' ? days.get(k)?.temps : days.get(k)?.lux) ?? []);
        if (!vals.length) continue;
        await push(metric, r.ageFrom, from, to, vals.reduce((a, b) => a + b, 0) / vals.length, {
          ageUnit: 'DAY', bandUnit: 'DAY', bandAge: r.ageFrom, variant: metric === 'BROODING_TEMP' ? 'CAGE' : null, sampleSize: vals.length,
        });
      }
    }

    // Milestones: age at 50% production, peak production.
    if (tracked('DAYS_TO_50_PCT') && eggDays.length) {
      const fifty = eggDays.find(k => pop(k) > 0 && (days.get(k)!.eggs / pop(k)) * 100 >= 50);
      const band = await this.standards.resolveBand(ctx, 'DAYS_TO_50_PCT', 18);
      if (band) {
        const ageNow = Math.floor((end.getTime() - hatch.getTime()) / DAY_MS);
        if (fifty) {
          const ageDays = Math.floor((new Date(fifty).getTime() - hatch.getTime()) / DAY_MS);
          out.push({ metric: 'DAYS_TO_50_PCT', ageUnit: 'MILESTONE', ageIndex: 0, periodStart: new Date(fifty), periodEnd: new Date(fifty),
            actual: ageDays, band, status: bandStatus(ageDays, band), guideStatus: bandStatus(ageDays, band.guide) });
        } else if (band.max != null && ageNow > band.max + 7) {
          out.push({ metric: 'DAYS_TO_50_PCT', ageUnit: 'MILESTONE', ageIndex: 0, periodStart: new Date(eggDays[0]), periodEnd: end,
            actual: null, actualText: `Not reached by day ${ageNow}`, band, status: 'ABOVE', guideStatus: 'ABOVE' });
        }
      }
    }
    if (tracked('PEAK_HDP') && lastWeek >= 35 && weeklyHdp.size) {
      const lay = [...weeklyHdp.entries()].filter(([w]) => w >= 18 && w <= 35);
      if (lay.length) {
        const [peakWeek, peak] = lay.reduce((a, b) => (b[1] > a[1] ? b : a));
        await push('PEAK_HDP', 0, weekStart(peakWeek), weekEnd(peakWeek), peak, { ageUnit: 'MILESTONE', bandAge: 35, actualText: `Peak in week ${peakWeek}` });
      }
    }

    const result = await this.persist(ctx, out);
    await this.autoPracticeNotes(ctx, batch, out);
    return { evaluated: out.length, ...result };
  }

  private async labTests(): Promise<LabTest[]> {
    const rows = await this.prisma.feedLabTest.findMany({
      where: { deletedAt: null },
      select: { storeItemId: true, feedFamily: true, effectiveFrom: true, values: true },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(r => ({ ...r, values: (r.values ?? {}) as Record<string, number> }));
  }

  /**
   * Guide daily intake for a laying week. The guide sets intake per laying
   * phase (Peaking … Layer 5, chosen from the flock's HD% and peak) and per
   * programme; calcium and phosphorus go by age. With both programmes the
   * band starts at the lower (economical) figure and the target is the
   * optimal one. Energy is adjusted ~2 kcal per 0.5 °C away from 22 °C.
   */
  private async intakeBand(
    ctx: BatchStandardContext, key: string, week: number,
    phases: Record<string, string | null>, houseTemp: number | null,
  ): Promise<ResolvedBand | null> {
    const metric = `INTAKE_${key}`;
    const def = metricDef(metric);
    const series = (await this.standards.metricSeries(ctx.guide!.id, metric)).filter(p => p.ageUnit === 'WEEK');
    if (!series.length) return null;
    const programs = ctx.nutritionProgram === 'BOTH' ? ['ECONOMICAL', 'OPTIMAL'] : [ctx.nutritionProgram];
    const byAge = series.filter(p => !p.variant);
    const lastAge = byAge.length ? byAge.reduce((a, b) => (b.ageTo > a.ageTo ? b : a)) : null;
    const points = programs.map(program =>
      series.find(p => p.variant === program && p.phase === phases[program])
      ?? byAge.find(p => week >= p.ageFrom && week <= p.ageTo)
      ?? (lastAge && week > lastAge.ageTo ? lastAge : null),
    ).filter(Boolean) as typeof series;
    if (!points.length) return null;
    const bands = points.map(p => applyTolerance(p, def));
    const pick = (vals: (number | null)[], f: (...n: number[]) => number) => {
      const v = vals.filter((x): x is number => x != null);
      return v.length ? f(...v) : null;
    };
    let min = pick(bands.map(b => b.min), Math.min);
    let max = pick(bands.map(b => b.max), Math.max);
    const target = pick(bands.map(b => b.target), Math.max);
    let text = [...new Set(points.map(p => p.phase).filter(Boolean))].join(' / ') || null;
    if (houseTemp != null && key === 'ENERGY') {
      const adj = Math.round(-4 * (houseTemp - 22) * 10) / 10;
      if (min != null) min += adj;
      if (max != null) max += adj;
      text = `${text ?? ''} (adjusted ${adj >= 0 ? '+' : ''}${adj} kcal for ${round(houseTemp, 1)} °C)`.trim();
    }
    const guide = { min, target, max };
    return {
      metric, ...guide, unit: points[0].unit, label: null, phase: text, text,
      basis: 'GUIDE', guideId: ctx.guide!.id, farmStandardId: null, guide,
    };
  }

  /** Feeds a batch ate in the last `days` days that have no lab test in force. */
  async feedsWithoutLabTest(batchId: string, days = 28) {
    const ctx = await this.standards.batchContext(batchId);
    if (!ctx || ctx.untracked.has('FEED_NUTRIENTS')) return [];
    const to = addDays(farmTodayUtcMidnight(), -1);
    const from = addDays(to, -(days - 1));
    const [{ days: daily }, tests] = await Promise.all([this.collectDaily(batchId, from, to), this.labTests()]);
    const missing = new Map<string, { storeItemId: string | null; family: string | null; kg: number; lastUsed: string }>();
    for (const [k, d] of daily) {
      for (const l of d.feedLines) {
        if (l.kg <= 0 || labTestFor(tests, l, new Date(k))) continue;
        const id = l.storeItemId ?? `family:${l.family ?? 'unknown'}`;
        const m = missing.get(id) ?? { storeItemId: l.storeItemId, family: l.family, kg: 0, lastUsed: k };
        m.kg += l.kg;
        if (k > m.lastUsed) m.lastUsed = k;
        missing.set(id, m);
      }
    }
    const ids = [...missing.values()].map(m => m.storeItemId).filter((x): x is string => !!x);
    const names = new Map((await this.prisma.storeItem.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map(i => [i.id, i.name]));
    return [...missing.values()].map(m => ({
      ...m, kg: round(m.kg, 1),
      name: (m.storeItemId && names.get(m.storeItemId)) || (m.family ? m.family.replace(/_/g, ' ').toLowerCase() : 'unnamed feed'),
    }));
  }

  /** Upserts only rows whose figures changed; notifies the first week of a run. */
  private async persist(ctx: BatchStandardContext, rows: Candidate[]) {
    const existing = await this.prisma.batchStandardMetric.findMany({ where: { batchId: ctx.batchId } });
    const byKey = new Map(existing.map(e => [`${e.metric}|${e.ageUnit}|${e.ageIndex}`, e]));
    const n = (v: any) => (v == null ? null : Number(v));
    let changed = 0;

    for (const r of rows) {
      const key = `${r.metric}|${r.ageUnit}|${r.ageIndex}`;
      const prev = byKey.get(key);
      if (prev && r.metric === 'LIGHT_HOURS') continue; // declared history is kept as it was
      const data = {
        periodStart: r.periodStart, periodEnd: r.periodEnd,
        actualValue: r.actual, actualText: r.actualText ?? null,
        minValue: r.band?.min ?? null, targetValue: r.band?.target ?? null, maxValue: r.band?.max ?? null,
        basis: r.band?.basis ?? 'GUIDE', guideId: r.band?.guideId ?? null, farmStandardId: r.band?.farmStandardId ?? null,
        status: r.status, guideStatus: r.guideStatus ?? null, sampleSize: r.sampleSize ?? null,
      };
      if (prev && n(prev.actualValue) === data.actualValue && prev.status === data.status && prev.actualText === data.actualText
          && n(prev.minValue) === data.minValue && n(prev.maxValue) === data.maxValue && prev.basis === data.basis) continue;
      const saved = await this.prisma.batchStandardMetric.upsert({
        where: { batchId_metric_ageUnit_ageIndex: { batchId: ctx.batchId, metric: r.metric, ageUnit: r.ageUnit, ageIndex: r.ageIndex } },
        create: { batchId: ctx.batchId, metric: r.metric, ageUnit: r.ageUnit, ageIndex: r.ageIndex, ...data, computedAt: new Date() },
        // A row that leaves and re-enters deviation keeps its notifiedAt:
        // the same data point is never announced twice.
        update: { ...data, computedAt: new Date() },
      });
      byKey.set(key, saved);
      changed++;
    }

    // Notify once per deviation run (consecutive periods with the same
    // status). A run is announced when it is still current (its latest
    // period ended within NOTIFY_WITHIN_DAYS); runs that ended long ago are
    // history and are only marked as seen. The dedupe key is the run's first
    // period, so the same run is never announced twice.
    const cutoff = addDays(farmTodayUtcMidnight(), -NOTIFY_WITHIN_DAYS);
    let newDeviations = 0;
    const all = [...byKey.values()].sort((a, b) => a.ageIndex - b.ageIndex);
    for (const metricKey of new Set(all.map(r => `${r.metric}|${r.ageUnit}`))) {
      const series = all.filter(r => `${r.metric}|${r.ageUnit}` === metricKey);
      for (let i = 0; i < series.length; i++) {
        if (!DEVIATION.has(series[i].status)) continue;
        let j = i;
        while (j + 1 < series.length && series[j + 1].status === series[i].status) j++;
        const run = series.slice(i, j + 1);
        const pending = run.filter(r => !r.notifiedAt);
        if (pending.length) {
          const alreadyAnnounced = pending.length < run.length;
          const last = run[run.length - 1];
          if (!alreadyAnnounced && last.periodEnd >= cutoff) {
            await this.notifyDeviation(ctx, run[0], run.length, last);
            newDeviations++;
          }
          await this.prisma.batchStandardMetric.updateMany({ where: { id: { in: pending.map(r => r.id) } }, data: { notifiedAt: new Date() } });
        }
        i = j;
      }
    }
    return { changed, newDeviations };
  }

  private async notifyDeviation(ctx: BatchStandardContext, first: any, runLength = 1, latest: any = first) {
    const row = latest;
    const def = metricDef(row.metric);
    const label = def?.label ?? row.metric;
    const at = (r: any) => (r.ageUnit === 'WEEK' ? `week ${r.ageIndex}` : r.ageUnit === 'DAY' ? `days ${r.ageIndex}+` : 'milestone');
    const when = runLength > 1 ? `${at(row)} (off standard since ${at(first)})` : at(row);
    const basis = row.basis === 'FARM' ? 'farm standard'
      : row.basis === 'GUIDE_EXTENDED' ? `${ctx.breedName} guide (last week's values — batch is past the guide)`
      : `${ctx.breedName} guide (${ctx.guide?.versionLabel})`;
    const actual = row.actualValue != null ? `${fmt(Number(row.actualValue))} ${def?.unit ?? ''}`.trim() : row.actualText;
    const implication = row.status === 'BELOW' ? def?.ifBelow : row.status === 'ABOVE' ? def?.ifAbove : def?.ifAbove ?? '';
    const message = row.status === 'MISMATCH'
      ? `${ctx.batchCode} ${when}: ${row.actualText}. ${implication ?? ''}`.trim()
      : `${ctx.batchCode} ${when}: ${label} ${actual} is ${row.status === 'BELOW' ? 'below' : 'above'} the ${basis} (${bandText(row, def?.unit)}). ${implication ?? ''}`.trim();
    for (const role of [UserRole.OWNER, UserRole.MANAGER]) {
      await this.notifications.notifyRole(role, NotificationType.STANDARD_DEVIATION, `${label} off standard — ${ctx.batchCode}`, message, {
        entityId: ctx.batchId, entityType: 'Batch',
        dedupeKey: `std:${ctx.batchId}:${first.metric}:${first.status}:${first.ageUnit}:${first.ageIndex}`,
      }).catch(() => {});
    }
  }

  /** Practices the system can see were outside the guide get noted on the batch. */
  private async autoPracticeNotes(ctx: BatchStandardContext, batch: { declaredLightHours: any }, rows: Candidate[]) {
    const notes: { metric: string; practice: string; guide: string; from: Date }[] = [];
    for (const r of rows.filter(x => x.metric === 'FEED_PHASE' && x.status === 'MISMATCH')) {
      if (/Pre-lay/i.test(r.actualText ?? '')) notes.push({ metric: 'FEED_PHASE', practice: r.actualText!, guide: 'Pre-Lay only from week 15 until first egg', from: r.periodStart });
    }
    // Light stimulation before the flock is ready (guide: 1.35 kg and 85% uniformity).
    const lightRows = rows.filter(x => x.metric === 'LIGHT_HOURS' && x.status === 'ABOVE' && x.ageIndex >= 14 && x.ageIndex <= 24);
    if (lightRows.length) {
      const minBw = (await this.standards.resolveBand(ctx, 'LIGHT_STIM_BODY_WEIGHT', 16))?.min;
      const minU = (await this.standards.resolveBand(ctx, 'LIGHT_STIM_UNIFORMITY', 16))?.min;
      const lastBw = rows.filter(x => x.metric === 'BODY_WEIGHT' && x.ageIndex <= lightRows[0].ageIndex).pop()?.actual;
      const lastU = rows.filter(x => x.metric === 'UNIFORMITY' && x.ageIndex <= lightRows[0].ageIndex).pop()?.actual;
      if ((minBw != null && lastBw != null && lastBw < minBw) || (minU != null && lastU != null && lastU < minU)) {
        notes.push({
          metric: 'LIGHT_HOURS',
          practice: `Light increased to ${batch.declaredLightHours} h at week ${lightRows[0].ageIndex} with body weight ${lastBw ?? '—'} g and uniformity ${lastU ?? '—'}%`,
          guide: `Stimulate only at ${minBw} g and ${minU}% uniformity`, from: lightRows[0].periodStart,
        });
      }
    }
    for (const n of notes) {
      const exists = await this.prisma.batchPracticeNote.findFirst({ where: { batchId: ctx.batchId, metric: n.metric, practice: n.practice, deletedAt: null } });
      if (!exists) {
        await this.prisma.batchPracticeNote.create({
          data: { batchId: ctx.batchId, metric: n.metric, practice: n.practice, guideRecommendation: n.guide, source: 'AUTO', effectiveFrom: n.from },
        });
      }
    }
  }

  @OnEvent(BATCH_TRANSFERRED_EVENT)
  async onTransfer(payload: { batchId: string; transferDate: Date }) {
    try {
      const ctx = await this.standards.batchContext(payload.batchId);
      if (!ctx?.guide || ctx.untracked.has('TRANSFER_AGE')) return;
      const date = utcMidnight(new Date(payload.transferDate));
      const ageWeeks = Math.round(((date.getTime() - utcMidnight(ctx.dateOfHatch).getTime()) / DAY_MS / 7) * 10) / 10;
      const band = await this.standards.resolveBand(ctx, 'TRANSFER_AGE', 15);
      if (!band) return;
      // Guide band is whole weeks 15–16: anything inside week 15 or 16 of age is on time.
      const status = ageWeeks < (band.min ?? 0) - 1 ? 'BELOW' : ageWeeks >= (band.max ?? 99) ? 'ABOVE' : 'IN_BAND';
      await this.persist(ctx, [{
        metric: 'TRANSFER_AGE', ageUnit: 'MILESTONE', ageIndex: 0, periodStart: date, periodEnd: date,
        actual: ageWeeks, actualText: `Transferred at ${ageWeeks} weeks`, band, status, guideStatus: status,
      }]);
      if (status !== 'IN_BAND') {
        await this.prisma.batchPracticeNote.create({
          data: {
            batchId: ctx.batchId, metric: 'TRANSFER_AGE', practice: `Transferred to the laying house at ${ageWeeks} weeks`,
            guideRecommendation: band.text ?? `Transfer at ${band.min}–${band.max} weeks`, source: 'AUTO', effectiveFrom: date,
          },
        });
      }
    } catch (err: any) {
      this.logger.warn(`Transfer-age check failed for ${payload.batchId}: ${err?.message}`);
    }
  }

  // ── Read models ─────────────────────────────────────────────────────────

  async getBatchStandards(batchId: string) {
    const ctx = await this.standards.batchContext(batchId);
    if (!ctx) throw new NotFoundException('Batch not found');
    const batch = await this.prisma.batch.findUniqueOrThrow({
      where: { id: batchId },
      select: { housingType: true, housingDescription: true, declaredLightHours: true, nutritionProgram: true, recordingPlanSetAt: true, stage: true },
    });
    const [rows, notes, plan] = await Promise.all([
      this.prisma.batchStandardMetric.findMany({ where: { batchId }, orderBy: [{ metric: 'asc' }, { ageUnit: 'asc' }, { ageIndex: 'asc' }] }),
      this.prisma.batchPracticeNote.findMany({ where: { batchId, deletedAt: null }, orderBy: { effectiveFrom: 'desc' } }),
      this.standards.recordingPlan(ctx),
    ]);
    const ageWeeks = Math.max(1, Math.floor((farmTodayUtcMidnight().getTime() - utcMidnight(ctx.dateOfHatch).getTime()) / DAY_MS / 7) + 1);
    const recentCutoff = addDays(farmTodayUtcMidnight(), -NOTIFY_WITHIN_DAYS);
    const isCurrent = (d: Date) => new Date(d) >= recentCutoff;

    const metrics = [...new Set(rows.map(r => r.metric))].map(key => {
      const def = metricDef(key);
      const history = rows.filter(r => r.metric === key).map(r => ({
        ageUnit: r.ageUnit, ageIndex: r.ageIndex, periodStart: r.periodStart, periodEnd: r.periodEnd,
        actual: r.actualValue != null ? Number(r.actualValue) : null, actualText: r.actualText,
        min: r.minValue != null ? Number(r.minValue) : null, target: r.targetValue != null ? Number(r.targetValue) : null,
        max: r.maxValue != null ? Number(r.maxValue) : null, basis: r.basis, status: r.status, guideStatus: r.guideStatus,
      }));
      const latest = history[history.length - 1];
      let run = 0;
      for (let i = history.length - 1; i >= 0 && DEVIATION.has(history[i].status) && history[i].status === latest.status; i--) run++;
      return {
        key, label: def?.label ?? key, unit: def?.unit ?? '', group: def?.group ?? 'OTHER', direction: def?.direction ?? 'IN_BAND',
        latest, runLength: run,
        implication: latest.status === 'BELOW' ? def?.ifBelow : DEVIATION.has(latest.status) ? def?.ifAbove : null,
        inBandRate: history.length ? round((history.filter(h => h.status === 'IN_BAND').length / history.length) * 100, 0) : null,
        history,
      };
    });

    return {
      batchId, batchCode: ctx.batchCode, ageWeeks,
      breed: ctx.breedId ? { id: ctx.breedId, name: ctx.breedName, variety: ctx.variety } : null,
      guide: ctx.guide,
      setup: { ...batch, declaredLightHours: batch.declaredLightHours != null ? Number(batch.declaredLightHours) : null },
      plan,
      metrics,
      // Current = the parameter's latest period ended recently. Older runs
      // (e.g. brooding temperature once the flock is laying) are history.
      openDeviations: metrics.filter(m => DEVIATION.has(m.latest.status) && isCurrent(m.latest.periodEnd)).map(m => ({
        key: m.key, label: m.label, status: m.latest.status, ageUnit: m.latest.ageUnit, ageIndex: m.latest.ageIndex,
        actual: m.latest.actual, actualText: m.latest.actualText, min: m.latest.min, max: m.latest.max, target: m.latest.target,
        basis: m.latest.basis, runLength: m.runLength, implication: m.implication,
      })),
      pastDeviations: metrics.flatMap(m => runsOf(m.history).filter(r => !isCurrent(r.to.periodEnd)).map(r => ({
        key: m.key, label: m.label, status: r.status, ageUnit: r.from.ageUnit, from: r.from.ageIndex, to: r.to.ageIndex, periods: r.length,
        implication: r.status === 'BELOW' ? metricDef(m.key)?.ifBelow ?? null : metricDef(m.key)?.ifAbove ?? null,
      }))),
      practiceNotes: await Promise.all(notes.map(async n => ({ ...n, implication: await this.practiceImplication(ctx, n) }))),
      reference: ctx.guide ? await this.currentReference(ctx, ageWeeks, rows) : null,
      lessons: ctx.breedId ? await this.lessons(ctx.breedId, batchId) : null,
      feedsWithoutLabTest: ctx.guide ? await this.feedsWithoutLabTest(batchId).catch(() => []) : [],
    };
  }

  /** What the guide says for this week — nutrition phase, diet, light, Ca/P, space. */
  private async currentReference(ctx: BatchStandardContext, ageWeeks: number, rows: any[]) {
    const r = (metric: string, variant?: string | null) => this.standards.resolveBand(ctx, metric, ageWeeks, variant !== undefined ? { variant } : {});
    const lightVariant = ctx.housingType;
    const hdpRows = rows.filter(x => x.metric === 'HEN_DAY_PCT' && x.actualValue != null);
    const latestHdp = hdpRows.length ? Number(hdpRows[hdpRows.length - 1].actualValue) : null;
    const peakSoFar = hdpRows.length ? Math.max(...hdpRows.map(x => Number(x.actualValue))) : null;
    const programs = ctx.nutritionProgram === 'BOTH' ? ['ECONOMICAL', 'OPTIMAL'] : [ctx.nutritionProgram];
    const phases: Record<string, string | null> = {};
    const nutrients: Record<string, { label: string | null; unit: string | null; text: string | null }[]> = {};
    if (ageWeeks >= 18) {
      for (const program of programs) {
        const phase = await this.layingPhase(ctx, program, latestHdp, peakSoFar);
        phases[program] = phase;
        nutrients[program] = (await this.standards.metricSeries(ctx.guide!.id, 'NUTRIENT_DAILY', program))
          .filter(p => p.phase === phase).map(p => ({ label: p.label, unit: p.unit, text: p.text }));
      }
    }
    const rearing = ageWeeks <= 17
      ? (await this.standards.metricSeries(ctx.guide!.id, 'NUTRIENT_REARING'))
          .filter(p => ageWeeks >= p.ageFrom && ageWeeks <= p.ageTo).map(p => ({ label: p.label, unit: p.unit, text: p.text, phase: p.phase }))
      : [];
    const caP = (await this.standards.metricSeries(ctx.guide!.id, 'CALCIUM_PHOSPHORUS'))
      .filter(p => ageWeeks >= p.ageFrom && ageWeeks <= p.ageTo).map(p => ({ label: p.label, unit: p.unit, target: p.target, text: p.text }));
    const space = (await this.standards.metricSeries(ctx.guide!.id, 'SPACE'))
      .filter(p => ageWeeks >= p.ageFrom && ageWeeks <= p.ageTo).map(p => ({ label: p.label, variant: p.variant }));
    const notes = (await this.standards.metricSeries(ctx.guide!.id, 'GUIDE_NOTE'))
      .filter(p => ageWeeks >= p.ageFrom && ageWeeks <= p.ageTo).map(p => ({ label: p.label, text: p.text }));
    return {
      ageWeeks,
      feedPhase: await r('FEED_PHASE'),
      lightHours: await r('LIGHT_HOURS', lightVariant),
      bodyWeight: await r('BODY_WEIGHT'),
      feedIntake: await r('FEED_INTAKE'),
      waterIntake: await r('WATER_INTAKE'),
      henDay: ageWeeks >= 18 ? await r('HEN_DAY_PCT') : null,
      eggWeight: ageWeeks >= 18 ? await r('EGG_WEIGHT') : null,
      layingPhase: phases,
      layingNutrients: nutrients,
      rearingNutrients: rearing,
      calciumPhosphorus: caP,
      space,
      notes,
    };
  }

  /** Guide laying-diet phase from the latest weekly HD% and the peak so far. */
  private async layingPhase(ctx: BatchStandardContext, program: string, hdp: number | null, peak: number | null) {
    // Highest threshold first: Peaking (no threshold) → Layer 2 (≥92) … Layer 5 (<83).
    const key = (p: { min: number | null; max: number | null }) => (p.min == null && p.max == null ? Infinity : p.min ?? p.max! - 0.5);
    const phases = (await this.standards.metricSeries(ctx.guide!.id, 'NUTRITION_PHASE', program)).sort((a, b) => key(b) - key(a));
    if (!phases.length) return null;
    if (hdp == null || peak == null || hdp > peak - 2) return phases[0].phase; // Peaking until 2% below peak
    const byHd = phases.slice(1).find(p => (p.min == null || hdp >= p.min) && (p.max == null || hdp <= p.max + 0.999));
    return byHd?.phase ?? phases[phases.length - 1].phase;
  }

  // ── Practices outside the guide ─────────────────────────────────────────

  async addPracticeNote(batchId: string, input: any, userId: string) {
    const ctx = await this.standards.batchContext(batchId);
    if (!ctx) throw new NotFoundException('Batch not found');
    const metric = String(input.metric ?? '').trim();
    const practice = String(input.practice ?? '').trim();
    if (!metric || !practice) throw new BadRequestException('Choose the parameter and describe what the farm is doing');
    const from = input.effectiveFrom ? utcMidnight(new Date(input.effectiveFrom)) : farmTodayUtcMidnight();
    let guideRecommendation = input.guideRecommendation ? String(input.guideRecommendation) : null;
    if (!guideRecommendation && ctx.guide) {
      const ageWeeks = Math.max(1, Math.floor((from.getTime() - utcMidnight(ctx.dateOfHatch).getTime()) / DAY_MS / 7) + 1);
      const band = await this.standards.resolveBand(ctx, metric, ageWeeks, metric === 'LIGHT_HOURS' ? { variant: ctx.housingType } : {});
      if (band) guideRecommendation = band.text ?? `${bandText(band, metricDef(metric)?.unit)} (week ${ageWeeks})`;
    }
    const note = await this.prisma.batchPracticeNote.create({
      data: {
        batchId, metric, practice, guideRecommendation, reason: input.reason ? String(input.reason) : null,
        source: 'MANUAL', effectiveFrom: from, effectiveTo: input.effectiveTo ? utcMidnight(new Date(input.effectiveTo)) : null,
        recordedById: userId,
      },
    });
    // Declaring light hours as a number updates the batch's declared value.
    if (metric === 'LIGHT_HOURS') {
      const h = Number(/([\d.]+)\s*h/i.exec(practice)?.[1] ?? input.value);
      if (Number.isFinite(h) && h >= 0 && h <= 24) {
        await this.prisma.batch.update({ where: { id: batchId }, data: { declaredLightHours: h, recordingPlanSetAt: new Date() } });
      }
    }
    return { ...note, implication: await this.practiceImplication(ctx, note) };
  }

  /** When the practice states a number (e.g. "14 h light"), compare it with
   *  the guide band at the week it started; otherwise read the wording. */
  private async practiceImplication(ctx: BatchStandardContext, note: { metric: string; practice: string; effectiveFrom: Date }) {
    const def = metricDef(note.metric);
    if (!def) return null;
    const n = Number(/(-?\d+(?:\.\d+)?)/.exec(note.practice)?.[1]);
    if (ctx.guide && Number.isFinite(n) && !/week/i.test(note.practice.split(String(n))[0].slice(-6))) {
      const ageWeeks = Math.max(1, Math.floor((utcMidnight(note.effectiveFrom).getTime() - utcMidnight(ctx.dateOfHatch).getTime()) / DAY_MS / 7) + 1);
      const band = await this.standards.resolveBand(ctx, note.metric, ageWeeks, note.metric === 'LIGHT_HOURS' ? { variant: ctx.housingType } : {});
      if (band) {
        const st = bandStatus(n, band);
        if (st === 'BELOW') return def.ifBelow ?? def.ifNotRecorded;
        if (st === 'ABOVE') return def.ifAbove ?? def.ifNotRecorded;
        return 'Within the guide range at the time it started.';
      }
    }
    return implicationFor(note.metric, note.practice);
  }

  async endPracticeNote(noteId: string, remove = false) {
    const note = await this.prisma.batchPracticeNote.findFirst({ where: { id: noteId, deletedAt: null } });
    if (!note) throw new NotFoundException('Note not found');
    return this.prisma.batchPracticeNote.update({
      where: { id: noteId },
      data: remove ? { deletedAt: new Date() } : { effectiveTo: farmTodayUtcMidnight() },
    });
  }

  // ── Cross-batch learning ────────────────────────────────────────────────

  /** Same-breed batches side by side for one parameter, with the guide band. */
  async compareBatches(breedId: string, metric: string) {
    const breed = await this.prisma.breed.findUnique({ where: { id: breedId } });
    if (!breed) throw new NotFoundException('Breed not found');
    const guide = await this.standards.activeGuide(breedId);
    const rows = await this.prisma.batchStandardMetric.findMany({
      where: { metric, batch: { breedId, deletedAt: null } },
      include: { batch: { select: { id: true, batchCode: true, dateOfHatch: true, isActive: true } } },
      orderBy: [{ ageIndex: 'asc' }],
    });
    const batches = new Map<string, any>();
    for (const r of rows) {
      const b = batches.get(r.batchId) ?? { batchId: r.batchId, batchCode: r.batch.batchCode, hatch: r.batch.dateOfHatch, isActive: r.batch.isActive, points: [] as any[] };
      b.points.push({ ageUnit: r.ageUnit, ageIndex: r.ageIndex, actual: r.actualValue != null ? Number(r.actualValue) : null, status: r.status });
      batches.set(r.batchId, b);
    }
    const def = metricDef(metric);
    const ages = [...new Set(rows.filter(r => r.ageUnit === 'WEEK' && r.actualValue != null).map(r => r.ageIndex))];
    const farm = ages.map(age => {
      const vals = rows.filter(r => r.ageIndex === age && r.ageUnit === 'WEEK' && r.actualValue != null).map(r => Number(r.actualValue)).sort((a, b) => a - b);
      const best = def?.direction === 'LOWER_BETTER' ? vals[0] : vals[vals.length - 1];
      return { ageIndex: age, batches: vals.length, median: round(vals[Math.floor(vals.length / 2)], 2), best: round(best, 2) };
    });
    return {
      metric, label: def?.label ?? metric, unit: def?.unit ?? '', direction: def?.direction ?? 'IN_BAND',
      guide: guide ? { id: guide.id, versionLabel: guide.versionLabel, points: (await this.standards.metricSeries(guide.id, metric)).filter(p => p.ageUnit === 'WEEK' && (metric !== 'LIGHT_HOURS' || p.variant === 'LIGHT_CONTROLLED')) } : null,
      batches: [...batches.values()],
      farm,
    };
  }

  /** What earlier batches of the breed teach the next one: repeated
   *  problems (avoid), best performers and the practices behind them (copy). */
  async lessons(breedId: string, excludeBatchId?: string) {
    const rows = await this.prisma.batchStandardMetric.findMany({
      where: { batch: { breedId, deletedAt: null, ...(excludeBatchId ? { id: { not: excludeBatchId } } : {}) } },
      select: { batchId: true, metric: true, ageUnit: true, ageIndex: true, status: true, batch: { select: { batchCode: true } } },
      orderBy: { ageIndex: 'asc' },
    });
    if (!rows.length) return { batchesCompared: 0, repeatIssues: [], strengths: [], practices: [] };
    const batchIds = [...new Set(rows.map(r => r.batchId))];
    const codeOf = new Map(rows.map(r => [r.batchId, r.batch.batchCode]));

    const repeatIssues: any[] = [];
    const strengths: any[] = [];
    for (const metric of [...new Set(rows.map(r => r.metric))]) {
      const def = metricDef(metric);
      const per = batchIds.map(id => {
        const mine = rows.filter(r => r.batchId === id && r.metric === metric);
        const off = mine.filter(r => DEVIATION.has(r.status));
        return { id, total: mine.length, off, inBand: mine.length ? mine.filter(r => r.status === 'IN_BAND').length / mine.length : null };
      }).filter(p => p.total > 0);
      const affected = per.filter(p => p.off.length >= 2 || (p.off.length >= 1 && p.total <= 2));
      if (affected.length >= Math.min(2, per.length) && affected.length > 0) {
        const weeks = affected.flatMap(p => p.off.filter(r => r.ageUnit === 'WEEK').map(r => r.ageIndex));
        const dir = affected.flatMap(p => p.off.map(r => r.status));
        const mainDir = dir.filter(d => d === 'BELOW').length >= dir.length / 2 ? 'BELOW' : dir.includes('MISMATCH') ? 'MISMATCH' : 'ABOVE';
        repeatIssues.push({
          metric, label: def?.label ?? metric, direction: mainDir,
          batches: affected.map(p => codeOf.get(p.id)),
          weeks: weeks.length ? `${Math.min(...weeks)}–${Math.max(...weeks)}` : null,
          implication: mainDir === 'BELOW' ? def?.ifBelow : def?.ifAbove,
        });
      }
      const best = per.filter(p => p.total >= 4).sort((a, b) => (b.inBand ?? 0) - (a.inBand ?? 0))[0];
      if (best && (best.inBand ?? 0) >= 0.8) {
        strengths.push({ metric, label: def?.label ?? metric, batchId: best.id, batchCode: codeOf.get(best.id), inBandPct: round((best.inBand ?? 0) * 100, 0) });
      }
    }
    const notes = await this.prisma.batchPracticeNote.findMany({
      where: { batchId: { in: batchIds }, deletedAt: null },
      select: { batchId: true, metric: true, practice: true, guideRecommendation: true, source: true },
    });
    const practices = notes.map(n => {
      const mine = rows.filter(r => r.batchId === n.batchId && r.metric === n.metric);
      const inBand = mine.length ? round((mine.filter(r => r.status === 'IN_BAND').length / mine.length) * 100, 0) : null;
      return { ...n, batchCode: codeOf.get(n.batchId), label: metricDef(n.metric)?.label ?? n.metric, outcomeInBandPct: inBand };
    });
    return { batchesCompared: batchIds.length, repeatIssues, strengths, practices };
  }

  // ── AI context ──────────────────────────────────────────────────────────

  /** Plain-text block for AI prompts. Sections appear only when they have
   *  something to say (no "not recorded" section if nothing was given up). */
  async buildAiContext(batchId: string): Promise<string | null> {
    const ctx = await this.standards.batchContext(batchId);
    if (!ctx?.guide) return null;
    const s = await this.getBatchStandards(batchId);
    const lines: string[] = [];
    const housing = s.setup.housingType === 'OPEN_SIDED' ? 'open-sided' : 'light-controlled';
    lines.push(`BREED STANDARD: ${ctx.breedName}${ctx.variety ? ` (${ctx.variety})` : ''} benchmarked against "${ctx.guide.title}", ${ctx.guide.versionLabel} edition. Housing: ${housing}${s.setup.housingDescription ? ` — ${s.setup.housingDescription}` : ''}. Nutrition programme(s): ${s.setup.nutritionProgram === 'BOTH' ? 'economical and optimal' : s.setup.nutritionProgram.toLowerCase()}. Batch age: week ${s.ageWeeks}.`);
    const farmChoice = s.plan.notRecorded.filter((p: any) => p.reason !== 'NO_INPUT');
    const noInput = s.plan.notRecorded.filter((p: any) => p.reason === 'NO_INPUT');
    if (farmChoice.length || noInput.length) {
      lines.push('PARAMETERS NOT RECORDED FOR THIS BATCH (mention an implication only where it matters for this report):');
      for (const p of [...farmChoice, ...noInput]) lines.push(`- ${p.label}${p.reason === 'NO_INPUT' ? ' (not measured at the farm)' : ''}: ${p.implication}`);
    }
    if (s.practiceNotes.length) {
      lines.push('FARM PRACTICES THAT DIFFER FROM THE GUIDE (explain the likely effect where the data shows one):');
      for (const n of s.practiceNotes.slice(0, 10)) {
        lines.push(`- ${metricDef(n.metric)?.label ?? n.metric}: ${n.practice}${n.guideRecommendation ? ` (guide: ${n.guideRecommendation})` : ''}${n.reason ? ` — reason: ${n.reason}` : ''}. ${n.implication ?? ''}`.trim());
      }
    }
    if (s.openDeviations.length) {
      lines.push('CURRENT DEVIATIONS FROM THE STANDARD:');
      for (const d of s.openDeviations) {
        const when = d.ageUnit === 'WEEK' ? `week ${d.ageIndex}` : d.ageUnit === 'DAY' ? `days ${d.ageIndex}+` : 'milestone';
        const val = d.actual != null ? `${fmt(d.actual)} ${metricDef(d.key)?.unit ?? ''}`.trim() : d.actualText;
        lines.push(`- ${d.label} ${when}: ${val} vs ${d.basis === 'FARM' ? 'farm standard' : 'guide'} ${bandText(d, metricDef(d.key)?.unit)} — ${d.status.toLowerCase()} for ${d.runLength} period(s). ${d.implication ?? ''}`.trim());
      }
    }
    if (s.pastDeviations.length) {
      lines.push(`EARLIER IN THIS BATCH (resolved or no longer measured): ${s.pastDeviations.slice(0, 12).map((d: any) => `${d.label} ${d.status.toLowerCase()} ${d.ageUnit === 'DAY' ? 'days' : 'weeks'} ${d.from}–${d.to}`).join('; ')}.`);
    }
    if (s.feedsWithoutLabTest?.length) {
      lines.push(`FEEDS WITHOUT A LAB TEST (last 4 weeks — nutrient intake for days on these feeds cannot be checked): ${s.feedsWithoutLabTest.map((f: any) => `${f.name} (${f.kg} kg)`).join(', ')}.`);
    }
    const inBand = s.metrics.filter((m: any) => m.latest.status === 'IN_BAND').map((m: any) => m.label);
    if (inBand.length) lines.push(`ON STANDARD (latest period): ${inBand.join(', ')}.`);
    const l = s.lessons;
    if (l && l.batchesCompared) {
      if (l.repeatIssues.length) lines.push(`PREVIOUS ${ctx.breedName} BATCHES — repeated problems: ${l.repeatIssues.map((i: any) => `${i.label} ${i.direction.toLowerCase()} (${i.batches.join(', ')}${i.weeks ? `, weeks ${i.weeks}` : ''})`).join('; ')}.`);
      if (l.strengths.length) lines.push(`PREVIOUS ${ctx.breedName} BATCHES — best results: ${l.strengths.map((x: any) => `${x.label} ${x.inBandPct}% on standard in ${x.batchCode}`).join('; ')}.`);
    }
    return lines.join('\n');
  }

  /** Short combined block for farm-wide reports (weekly / improvement). */
  async buildAiContextForBatches(batchIds: string[]): Promise<string> {
    const parts: string[] = [];
    for (const id of batchIds) {
      const ctx = await this.standards.batchContext(id);
      if (!ctx?.guide) continue;
      const s = await this.getBatchStandards(id);
      const dev = s.openDeviations.map((d: any) => `${d.label} ${d.status.toLowerCase()}${d.runLength > 1 ? ` ×${d.runLength}` : ''}`);
      const notRec = s.plan.notRecorded.filter((p: any) => p.reason !== 'NO_INPUT').map((p: any) => p.label);
      const prac = s.practiceNotes.slice(0, 3).map((n: any) => n.practice);
      if (!dev.length && !notRec.length && !prac.length) continue;
      parts.push(`- ${ctx.batchCode} (${ctx.breedName}, wk ${s.ageWeeks}, guide ${ctx.guide.versionLabel}): ${dev.length ? `off standard: ${dev.join(', ')}` : 'on standard'}${notRec.length ? `; not recorded by choice: ${notRec.join(', ')}` : ''}${prac.length ? `; practices outside guide: ${prac.join('; ')}` : ''}.`);
    }
    return parts.length ? `BREED-GUIDE BENCHMARK (first week of each deviation is what matters; mention not-recorded parameters only if they limit a conclusion):\n${parts.join('\n')}` : '';
  }

  // ── Farm standards (farm results better than the guide) ─────────────────

  async listFarmStandards(breedId: string) {
    return this.prisma.farmStandard.findMany({ where: { breedId }, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }] });
  }

  /** A manager's farm standard goes to the Director as a proposal; one the
   *  Director sets applies straight away (no proposal to themselves). */
  async createFarmStandard(input: any, userId: string, role?: string) {
    const breed = await this.prisma.breed.findUnique({ where: { id: String(input.breedId ?? '') } });
    if (!breed) throw new NotFoundException('Breed not found');
    const metric = String(input.metric ?? '');
    if (!metricDef(metric)) throw new BadRequestException('Unknown parameter');
    const points = Array.isArray(input.points) ? input.points : [];
    if (!points.length || points.some((p: any) => !Number.isFinite(Number(p.ageFrom)))) throw new BadRequestException('Give at least one age with a value');
    if (!String(input.reason ?? '').trim()) throw new BadRequestException('Say why the farm standard differs from the guide');
    const created = await this.prisma.farmStandard.create({
      data: {
        breedId: breed.id, metric, variant: input.variant ?? null, ageUnit: input.ageUnit === 'DAY' ? 'DAY' : 'WEEK',
        points: points.map((p: any) => ({
          ageFrom: Number(p.ageFrom), ageTo: Number(p.ageTo ?? p.ageFrom),
          min: p.min ?? null, target: p.target ?? null, max: p.max ?? null,
        })),
        reason: String(input.reason).trim(), status: 'PROPOSED', proposedById: userId,
      },
    });
    if (role === UserRole.OWNER) return this.decideFarmStandard(created.id, true, userId);
    if (role === UserRole.MANAGER) {
      await this.notifications.notifyRole(UserRole.OWNER, NotificationType.FARM_STANDARD_PROPOSED,
        `Farm standard proposed — ${metricDef(metric)?.label ?? metric}`,
        `${breed.name}: the Production Manager proposes a farm standard. Reason: ${String(input.reason).trim()} Review it under Breed Standards → Decisions.`,
        { entityId: created.id, entityType: 'FarmStandard', dedupeKey: `farmstd-manual:${created.id}` },
      ).catch(() => {});
    }
    return created;
  }

  /** Plain-English effect of approving a farm standard, week by week vs the
   *  guide: whether it holds batches to a stricter figure (more flags) or
   *  relaxes the guide (fewer flags). */
  private async farmStandardImplication(fs: { breedId: string; metric: string; points: any; variant: string | null }) {
    const guide = await this.standards.activeGuide(fs.breedId);
    const def = metricDef(fs.metric);
    if (!guide || !def) return { summary: null, weeks: [] as any[] };
    const series = await this.standards.metricSeries(guide.id, fs.metric, fs.variant ?? undefined);
    let stricter = 0, looser = 0, weekCount = 0;
    const weeks = (fs.points as any[]).map(p => {
      const ageFrom = Number(p.ageFrom), ageTo = Number(p.ageTo ?? p.ageFrom);
      weekCount += ageTo - ageFrom + 1;
      const g = series.find(x => ageFrom >= x.ageFrom && ageFrom <= x.ageTo);
      const gb = g ? applyTolerance(g, def) : null;
      const fmin = p.min != null ? Number(p.min) : null, fmax = p.max != null ? Number(p.max) : null;
      let effect: 'STRICTER' | 'LOOSER' | 'SAME' | null = null;
      if (gb) {
        const up = fmin != null && gb.min != null ? Math.sign(fmin - gb.min) : 0;      // higher floor = stricter
        const down = fmax != null && gb.max != null ? Math.sign(gb.max - fmax) : 0;    // lower ceiling = stricter
        const score = up + down;
        effect = score > 0 ? 'STRICTER' : score < 0 ? 'LOOSER' : 'SAME';
        if (effect === 'STRICTER') stricter++;
        if (effect === 'LOOSER') looser++;
      }
      return { ageFrom, ageTo, guide: gb ? bandText(gb, def.unit) : '—', farm: bandText({ min: fmin, max: fmax, target: p.target }, def.unit), effect };
    });
    const ex = weeks.find(w => w.effect === (stricter >= looser ? 'STRICTER' : 'LOOSER')) ?? weeks[0];
    const e = ex ? ` — e.g. week ${ex.ageFrom}: guide ${ex.guide} → farm ${ex.farm}` : '';
    const name = def.label.toLowerCase();
    let summary: string;
    if (stricter && !looser) {
      summary = `Approving holds batches to a stricter ${name} figure than the guide over ${weekCount} week(s)${e}. Batches will be flagged against the farm figure, even while they are still within the guide.`;
    } else if (looser && !stricter) {
      summary = `Approving relaxes the guide for ${name} over ${weekCount} week(s)${e}. Batches that miss the guide but meet this figure will no longer be flagged in those weeks (the guide figure is still shown).`;
    } else if (stricter && looser) {
      summary = `Approving is stricter than the guide in some weeks and looser in others for ${name}${e}. Flags will follow the farm figure in all ${weekCount} week(s).`;
    } else {
      summary = `Approving makes little difference — the farm figure for ${name} matches the guide${e}.`;
    }
    return { summary, weeks };
  }

  /** Director's view: every benchmarked batch's current problems and their
   *  meaning, plus the decisions waiting for the Director. */
  async overview() {
    const batches = await this.prisma.batch.findMany({
      where: { isActive: true, deletedAt: null, breedId: { not: null } },
      select: { id: true },
      orderBy: { dateOfHatch: 'asc' },
    });
    const rows: any[] = [];
    for (const b of batches) {
      const s = await this.getBatchStandards(b.id).catch(() => null);
      if (!s?.guide) continue;
      rows.push({
        batchId: s.batchId, batchCode: s.batchCode, ageWeeks: s.ageWeeks, breed: s.breed, guide: s.guide,
        openDeviations: s.openDeviations,
        practiceNotes: s.practiceNotes.filter((n: any) => !n.effectiveTo).slice(0, 5)
          .map((n: any) => ({ metric: n.metric, label: metricDef(n.metric)?.label ?? n.metric, practice: n.practice, guideRecommendation: n.guideRecommendation, reason: n.reason, implication: n.implication, source: n.source })),
        notRecordedByChoice: s.plan.notRecorded.filter((p: any) => p.reason !== 'NO_INPUT').map((p: any) => ({ label: p.label, implication: p.implication })),
        feedsWithoutLabTest: s.feedsWithoutLabTest,
        onStandard: s.metrics.filter((m: any) => m.latest.status === 'IN_BAND' && new Date(m.latest.periodEnd) >= addDays(farmTodayUtcMidnight(), -NOTIFY_WITHIN_DAYS)).length,
      });
    }
    const drafts = await this.prisma.breedGuide.findMany({
      where: { status: 'DRAFT' },
      include: { breed: { select: { name: true } }, _count: { select: { points: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const draftGuides = [];
    for (const g of drafts) {
      const current = await this.standards.activeGuide(g.breedId, g.variety);
      const affected = await this.prisma.batch.count({ where: { breedId: g.breedId, isActive: true, deletedAt: null } });
      draftGuides.push({
        id: g.id, breed: g.breed.name, title: g.title, versionLabel: g.versionLabel, variety: g.variety,
        sourceKind: g.sourceKind, aiInterpretation: g.aiInterpretation, points: g._count.points, createdAt: g.createdAt,
        implication: `Using this edition ${current ? `replaces the ${current.versionLabel} edition` : 'starts benchmarking'} for ${affected} active ${g.breed.name}${g.variety ? ` ${g.variety}` : ''} batch(es) from the next check.`
          + (g.sourceKind === 'AI' ? ' It was read from a PDF/photo by AI — ask the Production Manager to confirm the figures first.' : ''),
      });
    }
    const standards = await this.prisma.farmStandard.findMany({
      where: { status: { in: ['PROPOSED', 'APPROVED'] } },
      include: { breed: { select: { name: true } } },
      orderBy: [{ status: 'desc' }, { createdAt: 'desc' }],
    });
    const farmStandards = [];
    for (const fs of standards) {
      farmStandards.push({
        id: fs.id, breed: fs.breed.name, metric: fs.metric, label: metricDef(fs.metric)?.label ?? fs.metric, status: fs.status,
        reason: fs.reason, proposedBy: fs.proposedById ? 'Production Manager' : 'System (farm results)', approvedAt: fs.approvedAt,
        ...(await this.farmStandardImplication(fs)),
      });
    }
    return { batches: rows, decisions: { draftGuides, farmStandards } };
  }

  async decideFarmStandard(id: string, approve: boolean, userId: string) {
    const fs = await this.prisma.farmStandard.findUnique({ where: { id } });
    if (!fs) throw new NotFoundException('Farm standard not found');
    if (fs.status !== 'PROPOSED') throw new BadRequestException(`This farm standard is already ${fs.status.toLowerCase()}`);
    if (!approve) return this.prisma.farmStandard.update({ where: { id }, data: { status: 'REJECTED', approvedById: userId, approvedAt: new Date() } });
    return this.prisma.$transaction(async tx => {
      await tx.farmStandard.updateMany({
        where: { breedId: fs.breedId, metric: fs.metric, variant: fs.variant, status: 'APPROVED' },
        data: { status: 'RETIRED' },
      });
      return tx.farmStandard.update({ where: { id }, data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date() } });
    });
  }

  async retireFarmStandard(id: string) {
    const fs = await this.prisma.farmStandard.findUnique({ where: { id } });
    if (!fs) throw new NotFoundException('Farm standard not found');
    return this.prisma.farmStandard.update({ where: { id }, data: { status: 'RETIRED' } });
  }

  /**
   * Where at least FARM_STANDARD_MIN_BATCHES (default 3) batches of the
   * breed have results for a week and the farm's best-quartile result beats
   * the guide, propose a farm standard (Director approves). Only parameters
   * with a clear "better" direction are considered.
   */
  async proposeFarmStandards(breedId: string, userId?: string) {
    const breed = await this.prisma.breed.findUnique({ where: { id: breedId } });
    if (!breed) throw new NotFoundException('Breed not found');
    const guide = await this.standards.activeGuide(breedId);
    if (!guide) throw new BadRequestException('This breed has no active guide');
    const minBatches = Math.max(2, Number(process.env.FARM_STANDARD_MIN_BATCHES ?? 3));
    const better: Record<string, 'HIGHER' | 'LOWER'> = {
      HEN_DAY_PCT: 'HIGHER', HH_EGGS_CUM: 'HIGHER', HD_EGGS_CUM: 'HIGHER', UNIFORMITY: 'HIGHER', EGG_MASS_CUM: 'HIGHER',
      MORTALITY_CUM_REARING: 'LOWER', MORTALITY_CUM_LAY: 'LOWER', FCR_CUM: 'LOWER',
    };
    const created: any[] = [];
    for (const [metric, dir] of Object.entries(better)) {
      const rows = await this.prisma.batchStandardMetric.findMany({
        where: { metric, ageUnit: 'WEEK', actualValue: { not: null }, batch: { breedId, deletedAt: null } },
        select: { batchId: true, ageIndex: true, actualValue: true },
      });
      const guidePts = await this.standards.metricSeries(guide.id, metric);
      const points: any[] = [];
      const evidence: any[] = [];
      for (const age of [...new Set(rows.map(r => r.ageIndex))].sort((a, b) => a - b)) {
        const vals = rows.filter(r => r.ageIndex === age).map(r => Number(r.actualValue)).sort((a, b) => a - b);
        if (new Set(rows.filter(r => r.ageIndex === age).map(r => r.batchId)).size < minBatches) continue;
        const q = dir === 'HIGHER' ? vals[Math.floor((vals.length - 1) * 0.75)] : vals[Math.floor((vals.length - 1) * 0.25)];
        const g = guidePts.find(p => age >= p.ageFrom && age <= p.ageTo);
        if (!g) continue;
        const guideRef = dir === 'HIGHER' ? (g.max ?? g.target ?? g.min) : (g.max ?? g.target);
        if (guideRef == null) continue;
        if ((dir === 'HIGHER' && q > guideRef) || (dir === 'LOWER' && q < guideRef)) {
          points.push(dir === 'HIGHER' ? { ageFrom: age, ageTo: age, min: round(q, 2), target: round(q, 2) } : { ageFrom: age, ageTo: age, max: round(q, 2), target: round(q, 2) });
          evidence.push({ ageIndex: age, batches: vals.length, farmBestQuartile: round(q, 2), guide: guideRef });
        }
      }
      if (points.length < 3) continue;
      await this.prisma.farmStandard.updateMany({ where: { breedId, metric, status: 'PROPOSED', proposedById: null }, data: { status: 'RETIRED' } });
      const fs = await this.prisma.farmStandard.create({
        data: {
          breedId, metric, ageUnit: 'WEEK', points, evidence, status: 'PROPOSED', proposedById: userId ?? null,
          reason: `Best-quartile results of ${minBatches}+ ${breed.name} batches beat the ${guide.versionLabel} guide in ${points.length} week(s).`,
        },
      });
      created.push(fs);
      await this.notifications.notifyRole(UserRole.OWNER, NotificationType.FARM_STANDARD_PROPOSED,
        `Farm results beat the guide — ${metricDef(metric)?.label ?? metric}`,
        `${breed.name}: the farm's best batches did better than the guide in ${points.length} week(s). Review the proposed farm standard on the Breed Standards page.`,
        { entityId: fs.id, entityType: 'FarmStandard', dedupeKey: `farmstd:${breedId}:${metric}:${JSON.stringify(points)}` },
      ).catch(() => {});
    }
    return { proposed: created.length, standards: created };
  }
}

// ── formatting helpers ────────────────────────────────────────────────────

/** Consecutive periods with the same off-standard status. */
function runsOf<T extends { status: string }>(history: T[]) {
  const runs: { status: string; from: T; to: T; length: number }[] = [];
  for (let i = 0; i < history.length; i++) {
    if (!DEVIATION.has(history[i].status)) continue;
    let j = i;
    while (j + 1 < history.length && history[j + 1].status === history[i].status) j++;
    runs.push({ status: history[i].status, from: history[i], to: history[j], length: j - i + 1 });
    i = j;
  }
  return runs;
}

function fmt(v: number) {
  return Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-KE') : String(round(v, 2));
}

export function bandText(b: { min?: number | null; max?: number | null; target?: number | null; minValue?: any; maxValue?: any; targetValue?: any }, unit?: string) {
  const min = b.min ?? (b.minValue != null ? Number(b.minValue) : null);
  const max = b.max ?? (b.maxValue != null ? Number(b.maxValue) : null);
  const target = b.target ?? (b.targetValue != null ? Number(b.targetValue) : null);
  const u = unit ? ` ${unit}` : '';
  if (min != null && max != null) return `${fmt(min)}–${fmt(max)}${u}`;
  if (min != null) return `at least ${fmt(min)}${u}`;
  if (max != null) return `at most ${fmt(max)}${u}`;
  if (target != null) return `${fmt(target)}${u}`;
  return 'guide value';
}

/** Implication of a declared practice: the catalogue's below/above text when
 *  the practice reads as more/less than the guide, else the general note. */
function implicationFor(metric: string, practice: string): string | null {
  const def = metricDef(metric);
  if (!def) return null;
  const p = practice.toLowerCase();
  if (/(less|lower|reduc|fewer|below|under|short)/.test(p)) return def.ifBelow ?? def.ifNotRecorded;
  if (/(more|higher|increas|above|over|extra|longer|early|late)/.test(p)) return def.ifAbove ?? def.ifNotRecorded;
  return def.ifAbove ?? def.ifBelow ?? null;
}

