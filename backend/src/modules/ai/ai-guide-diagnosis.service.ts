// src/modules/ai/ai-guide-diagnosis.service.ts
//
// Gives AI reports what they need to say *why* a batch might be off its breed
// guide, not just *that* it is:
//
//   1. GUIDE vs ACTUAL — the weekly BatchStandardMetric rows (actual value,
//      guide/farm band, status) for the key areas: production, livability,
//      growth, feed & water, egg quality.
//   2. RECORDS THAT MAY EXPLAIN IT — for the same weeks, what the farm
//      recorded around those numbers: water and feed per bird, house
//      temperature, mortalities and their causes (and which levels they came
//      from), shell problems, feed changes, health events, vaccinations.
//
// A batch with no breed guide still gets its own weekly records, labelled so
// the AI compares against the batch's earlier weeks and says the comparison
// is weaker. Text only — no AI call happens here.

import { Injectable, Logger } from '@nestjs/common';
import { EntryStatus } from '@prisma/client';
import dayjs from 'dayjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { metricDef } from '../breed-standards/breed-metrics.catalog';

/** Areas the diagnosis looks at, in report order. */
const AREA_METRICS: { area: string; metrics: string[] }[] = [
  // Weekly measures only — cumulative egg totals count from the start of lay,
  // so any gap in early records would make them look wrongly "below".
  { area: 'Production', metrics: ['HEN_DAY_PCT', 'EGG_WEIGHT'] },
  { area: 'Mortality / livability', metrics: ['MORTALITY_CUM_LAY', 'MORTALITY_CUM_REARING'] },
  { area: 'Growth', metrics: ['BODY_WEIGHT', 'UNIFORMITY', 'BODY_CONDITION_SCORE'] },
  { area: 'Feed & water', metrics: ['FEED_INTAKE', 'FEED_CUM_REARING', 'WATER_INTAKE'] },
  { area: 'Egg quality', metrics: ['BREAKING_STRENGTH', 'HAUGH_UNITS', 'SHELL_COLOR'] },
  { area: 'Environment & management', metrics: ['LIGHT_HOURS', 'BROODING_TEMP', 'LIGHT_INTENSITY'] },
];
const ALL_METRICS = AREA_METRICS.flatMap(a => a.metrics);

const num = (v: any) => (v == null ? null : Number(v));
const fmt = (v: number | null, dp = 1) => (v == null || !Number.isFinite(v) ? '—' : String(Math.round(v * 10 ** dp) / 10 ** dp));
const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);

interface WeekWindow { ageIndex: number; from: Date; to: Date }

@Injectable()
export class AiGuideDiagnosisService {
  private readonly logger = new Logger(AiGuideDiagnosisService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Full block for one batch (per-batch report). `weeks` = how many of the
   * latest recorded weeks to show.
   */
  async batchBlock(batchId: string, weeks = 8): Promise<string> {
    try {
      return await this.build(batchId, weeks, false);
    } catch (e) {
      this.logger.warn(`Guide diagnosis skipped for ${batchId}: ${(e as Error).message}`);
      return '';
    }
  }

  /** Compact block for farm-wide reports: only areas off the guide, last 4 weeks. */
  async batchesBlock(batchIds: string[], weeks = 4): Promise<string> {
    const parts: string[] = [];
    for (const id of batchIds) {
      try {
        const b = await this.build(id, weeks, true);
        if (b) parts.push(b);
      } catch (e) {
        this.logger.warn(`Guide diagnosis skipped for ${id}: ${(e as Error).message}`);
      }
    }
    return parts.length
      ? `GUIDE vs ACTUAL WITH SUPPORTING RECORDS (per batch — use the records to suggest what might be causing each gap):\n${parts.join('\n\n')}`
      : '';
  }

  private async build(batchId: string, weeks: number, compact: boolean): Promise<string> {
    const batch = await this.prisma.batch.findFirst({
      where: { id: batchId, deletedAt: null },
      select: { id: true, batchCode: true, dateOfHatch: true, quantityReceived: true, currentBirdCount: true, breedId: true },
    });
    if (!batch) return '';

    const rows = await this.prisma.batchStandardMetric.findMany({
      where: { batchId, ageUnit: 'WEEK', metric: { in: ALL_METRICS } },
      orderBy: { ageIndex: 'asc' },
    });
    const hasGuide = rows.length > 0;

    // Weeks to look at: the latest recorded guide weeks, else the batch's
    // own latest weeks of age.
    const windows: WeekWindow[] = [];
    if (hasGuide) {
      const byWeek = new Map<number, WeekWindow>();
      for (const r of rows) {
        if (!byWeek.has(r.ageIndex)) byWeek.set(r.ageIndex, { ageIndex: r.ageIndex, from: r.periodStart, to: r.periodEnd });
      }
      windows.push(...[...byWeek.values()].sort((a, b) => a.ageIndex - b.ageIndex).slice(-weeks));
    } else {
      const hatch = dayjs(batch.dateOfHatch).startOf('day');
      const nowWeek = Math.max(1, Math.floor(dayjs().diff(hatch, 'day') / 7) + 1);
      for (let w = Math.max(1, nowWeek - weeks + 1); w <= nowWeek; w++) {
        windows.push({ ageIndex: w, from: hatch.add((w - 1) * 7, 'day').toDate(), to: hatch.add(w * 7 - 1, 'day').toDate() });
      }
    }
    if (!windows.length) return '';
    const shown = new Set(windows.map(w => w.ageIndex));

    // ── 1. Guide vs actual ────────────────────────────────────────────────
    const lines: string[] = [];
    const offAreas: string[] = [];
    if (hasGuide) {
      for (const { area, metrics } of AREA_METRICS) {
        const areaLines: string[] = [];
        let areaOff = false;
        for (const metric of metrics) {
          const mine = rows.filter(r => r.metric === metric && shown.has(r.ageIndex) && r.actualValue != null);
          if (!mine.length) continue;
          const off = mine.filter(r => r.status !== 'IN_BAND');
          if (off.length) areaOff = true;
          if (compact && !off.length) continue;
          const def = metricDef(metric);
          const cells = mine.map(r => {
            const actual = num(r.actualValue)!;
            const target = num(r.targetValue);
            const lo = num(r.minValue), hi = num(r.maxValue);
            const range = lo != null && hi != null ? `${fmt(lo)}–${fmt(hi)}` : lo != null ? `≥${fmt(lo)}` : hi != null ? `≤${fmt(hi)}` : '';
            const band = [range, target != null ? `target ${fmt(target)}` : ''].filter(Boolean).join(', ') || 'no band';
            const gap = target != null ? ` (${actual - target >= 0 ? '+' : ''}${fmt(actual - target)})` : '';
            const basis = r.basis === 'FARM' ? 'farm std' : 'guide';
            return `wk ${r.ageIndex}: ${fmt(actual)} vs ${basis} ${band} → ${r.status}${gap}`;
          });
          areaLines.push(`  ${def?.label ?? metric}${def?.unit ? ` (${def.unit})` : ''}: ${cells.join('; ')}`);
        }
        if (areaLines.length) {
          lines.push(`- ${area}${areaOff ? ' — OFF THE GUIDE' : ' — on the guide'}:`, ...areaLines);
          if (areaOff) offAreas.push(area);
        }
      }
      if (compact && !offAreas.length) return '';
    }

    // ── 2. Records for the same weeks ─────────────────────────────────────
    const from = windows[0].from;
    const to = dayjs(windows[windows.length - 1].to).endOf('day').toDate();
    const [sessions, mortLogs, health, vaccines] = await Promise.all([
      this.prisma.eggCollectionSession.findMany({
        where: { batchId, deletedAt: null, status: { not: EntryStatus.RETURNED }, sessionDate: { gte: from, lte: to } },
        select: {
          sessionDate: true, shift: true, closingStock: true, mortalities: true, feedKg: true, feedTypeName: true,
          waterLiters: true, houseTempC: true, totalGoodEggs: true, totalStarterEggs: true, totalBrokenEggs: true,
          totalDamaged: true, totalSoftShell: true, totalDeformed: true, mortalityCagesJson: true,
        },
      }),
      this.prisma.productionCageMortalityLog.findMany({
        where: { batchId, logDate: { gte: from, lte: to } },
        select: { logDate: true, count: true, cause: true, cage: { select: { label: true } } },
      }),
      this.prisma.healthEvent.findMany({
        where: { batchId, eventDate: { gte: from, lte: to } },
        select: { eventDate: true, eventType: true, affectedCount: true, symptoms: true, diagnosis: true, treatment: true },
        orderBy: { eventDate: 'asc' },
      }),
      this.prisma.vaccinationRecord.findMany({
        where: { batchId, administeredDate: { gte: from, lte: to } },
        select: { administeredDate: true, vaccineName: true },
        orderBy: { administeredDate: 'asc' },
      }),
    ]);

    const inWeek = (d: Date, w: WeekWindow) => d >= w.from && d <= dayjs(w.to).endOf('day').toDate();
    const evidence: string[] = [];
    let prevFeedTypes = '';
    for (const w of windows) {
      const ws = sessions.filter(s => inWeek(s.sessionDate, w));
      if (!ws.length) { evidence.push(`  wk ${w.ageIndex}: no egg-collection sessions recorded`); continue; }
      const days = new Set(ws.map(s => dayjs(s.sessionDate).format('YYYY-MM-DD'))).size;
      const birds = Math.max(...ws.map(s => s.closingStock), 0);
      const feedKg = ws.reduce((s, x) => s + (num(x.feedKg) ?? 0), 0);
      const waterL = ws.reduce((s, x) => s + (num(x.waterLiters) ?? 0), 0);
      const temps = ws.map(x => num(x.houseTempC)).filter((t): t is number => t != null);
      const eggs = ws.reduce((s, x) => s + x.totalGoodEggs + x.totalStarterEggs + x.totalBrokenEggs + x.totalDamaged + x.totalSoftShell + x.totalDeformed, 0);
      const broken = ws.reduce((s, x) => s + x.totalBrokenEggs, 0);
      const soft = ws.reduce((s, x) => s + x.totalSoftShell, 0);
      const deformed = ws.reduce((s, x) => s + x.totalDeformed, 0);
      const dead = ws.reduce((s, x) => s + x.mortalities, 0);
      const feedTypes = [...new Set(ws.map(x => x.feedTypeName).filter(Boolean))].join('/');
      const perBirdDay = (total: number, mult: number) => (birds > 0 && days > 0 ? (total * mult) / birds / days : null);
      const bits = [
        `${days} day(s) recorded`,
        `${dead} dead`,
        `feed ${fmt(perBirdDay(feedKg, 1000), 0)} g/bird/day`,
        `water ${fmt(perBirdDay(waterL, 1000), 0)} ml/bird/day`,
        `house temp ${!temps.length ? 'not recorded'
          : Math.min(...temps) === Math.max(...temps) ? `${fmt(temps[0])}°C` : `${fmt(Math.min(...temps))}–${fmt(Math.max(...temps))}°C`}`,
        `broken ${fmt(pct(broken, eggs))}%, soft-shell ${fmt(pct(soft, eggs))}%, deformed ${fmt(pct(deformed, eggs))}%`,
      ];
      if (feedTypes) bits.push(`feed ${feedTypes}${prevFeedTypes && feedTypes !== prevFeedTypes ? ' (CHANGED from previous week)' : ''}`);
      if (feedTypes) prevFeedTypes = feedTypes;
      evidence.push(`  wk ${w.ageIndex}: ${bits.join(' · ')}`);
    }

    // Mortality causes and where they happened (per level).
    const causes = new Map<string, number>();
    const levels = new Map<string, number>();
    for (const m of mortLogs) {
      causes.set(m.cause?.trim() || 'cause not given', (causes.get(m.cause?.trim() || 'cause not given') ?? 0) + m.count);
      levels.set(m.cage.label, (levels.get(m.cage.label) ?? 0) + m.count);
    }
    if (!mortLogs.length) {
      // Sessions not yet approved still carry their per-level entries.
      for (const s of sessions) {
        for (const e of (Array.isArray(s.mortalityCagesJson) ? s.mortalityCagesJson : []) as any[]) {
          const c = String(e?.cause ?? '').trim() || 'cause not given';
          causes.set(c, (causes.get(c) ?? 0) + (Number(e?.count) || 0));
          if (e?.cageLabel) levels.set(e.cageLabel, (levels.get(e.cageLabel) ?? 0) + (Number(e?.count) || 0));
        }
      }
    }
    const top = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} (${v})`).join(', ');
    if (causes.size) evidence.push(`  mortality causes recorded: ${top(causes, 6)}`);
    if (levels.size) evidence.push(`  where the deaths were (row · level): ${top(levels, 5)}`);
    if (health.length) {
      evidence.push(`  health events: ${health.slice(0, 8).map(h =>
        `${dayjs(h.eventDate).format('D MMM')} ${h.eventType.toLowerCase().replace(/_/g, ' ')}${h.affectedCount ? ` (${h.affectedCount} birds)` : ''}` +
        `${h.symptoms ? `, symptoms: ${h.symptoms}` : ''}${h.diagnosis ? `, diagnosis: ${h.diagnosis}` : ''}${h.treatment ? `, treated: ${h.treatment}` : ''}`).join('; ')}`);
    } else {
      evidence.push('  health events: none logged in these weeks');
    }
    evidence.push(`  vaccinations in these weeks: ${vaccines.length ? vaccines.map(v => `${v.vaccineName} ${dayjs(v.administeredDate).format('D MMM')}`).join(', ') : 'none recorded'}`);

    const head = hasGuide
      ? `${batch.batchCode} — weeks ${windows[0].ageIndex}–${windows[windows.length - 1].ageIndex} of age${offAreas.length ? `; off the guide in: ${offAreas.join(', ')}` : '; on the guide in every area recorded'}`
      : `${batch.batchCode} — NO BREED GUIDE linked, weeks ${windows[0].ageIndex}–${windows[windows.length - 1].ageIndex} of age. Compare against this batch's own earlier weeks and say the comparison is weaker without a guide.`;
    return [
      head,
      ...(hasGuide ? ['GUIDE vs ACTUAL:', ...lines] : []),
      'RECORDS FOR THE SAME WEEKS (possible explanations):',
      ...evidence,
    ].join('\n');
  }
}
