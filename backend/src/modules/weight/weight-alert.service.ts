// src/modules/weight/weight-alert.service.ts
//
// Single place that decides "is this recorded average weight outside the
// HyLine standard band for this batch's age, and if so, what should the
// Director see about it". Called from two places:
//
//   1. ProductionReportReconciliationService — for the `avgWeight` column
//      on an uploaded/reconciled store production report row.
//   2. HealthService.logHealthEvent — for a Farm Events "Bird Weighing"
//      entry (which itself may have come from the PM autofilling from a
//      BirdWeightReportUpload).
//
// Both call sites just hand this service (batchId, sampleDate,
// averageWeightG, sampleCount) and it does the rest: look up the standard
// band, and if violated, build the cross-reference context the Director
// needs to judge WHY — recent feed intake vs. the HyLine ration (underfed?
// overfed?) and recent/cumulative mortality vs. the HyLine ceiling
// (possible outbreak?) — ask Claude for a short read on the likeliest
// explanation, persist a ProductionWeightAlert, and notify the Director.
//
// Deliberately best-effort throughout: a failure gathering feed/mortality
// context or calling the AI never blocks the weight sample itself from
// being saved — this service only ever adds an alert on top.
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { NotificationType, UserRole, WeightAlertDirection, WeightAlertSource } from '@prisma/client';
import { batchAgeWeeks, checkWeightViolation, hylineGramsPerBirdPerDay, hylineStandard } from '../../common/feed/feed-standard.util';
import dayjs from 'dayjs';
import type { FeedContextSnapshot, MortalityContextSnapshot } from './weight.dto';
import type { ParsedReportRow } from '../store/production-report.dto';

const CONTEXT_WINDOW_DAYS = 7;

@Injectable()
export class WeightAlertService {
  private readonly logger = new Logger(WeightAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Checks one recorded average weight against the HyLine standard band for
   * the batch's age at `sampleDate`. No-ops (returns null) when the weight
   * is within band — nothing to flag. When it's outside band, gathers
   * cross-reference context, asks the AI for a short analysis, and
   * upserts a ProductionWeightAlert keyed on (batchId, sampleDate).
   *
   * IMPORTANT — this is called on every reconcile pass over a production
   * report, which means the SAME row (same batch, same day) can flow
   * through here many times: the report gets re-uploaded, or a later
   * report's date range simply happens to include a day that was already
   * flagged. Without de-duplication that reproduces the exact bug this
   * upsert exists to prevent: the Director sees the same week's flag
   * duplicated on every re-upload, even after they've already
   * acknowledged or resolved it (both in-app and in their notification
   * feed). So:
   *   - First occurrence for a (batch, day) → create + notify, as before.
   *   - Later occurrence for the same (batch, day) → update the
   *     measurement/context fields in place (in case the report brought a
   *     corrected figure) but NEVER touch status/acknowledgedById/
   *     acknowledgedAt, and NEVER send another notification. A flag the
   *     Director already dealt with stays dealt with.
   * Returns the created/updated alert (or null if within band / batch not
   * found).
   */
  async evaluateWeightSample(params: {
    batchId: string;
    sampleDate: Date;
    averageWeightG: number;
    sampleCount?: number;
    source: WeightAlertSource;
    sourceId?: string;
  }) {
    const batch = await this.prisma.batch.findUnique({
      where: { id: params.batchId },
      select: {
        batchCode: true, dateOfHatch: true, dateReceived: true,
        quantityReceived: true, mortalityOnArrival: true, currentBirdCount: true,
        house: { select: { name: true } },
      },
    });
    if (!batch) return null;

    const ageWeeks = batchAgeWeeks(batch.dateOfHatch, params.sampleDate);
    const check = checkWeightViolation(params.averageWeightG, ageWeeks);
    if (!check.violated) return null;

    const direction: WeightAlertDirection =
      params.averageWeightG < check.standard.weightMinG ? 'BELOW_MIN' : 'ABOVE_MAX';
    const boundaryG = direction === 'BELOW_MIN' ? check.standard.weightMinG : check.standard.weightMaxG;
    const deviationG = Math.round((params.averageWeightG - boundaryG) * 100) / 100;
    const deviationPct = boundaryG > 0 ? Math.round((deviationG / boundaryG) * 10000) / 100 : 0;

    // Already flagged this batch on this exact day? Don't re-flag it — see
    // the doc-comment above. We still refresh the measurement/context
    // fields below (a re-upload may carry a corrected figure), but we
    // never create a second row, never touch the Director's
    // acknowledgment, and never send a second notification.
    const existing = await this.prisma.productionWeightAlert.findUnique({
      where: { batchId_sampleDate: { batchId: params.batchId, sampleDate: params.sampleDate } },
    });

    const [feedContext, mortalityContext] = await Promise.all([
      this.buildFeedContext(params.batchId, params.sampleDate, ageWeeks).catch(err => {
        this.logger.warn(`Feed context lookup failed for weight alert (batch ${params.batchId}): ${err?.message}`);
        return null;
      }),
      this.buildMortalityContext(params.batchId, params.sampleDate, ageWeeks, batch).catch(err => {
        this.logger.warn(`Mortality context lookup failed for weight alert (batch ${params.batchId}): ${err?.message}`);
        return null;
      }),
    ]);

    // Same figure as what's already on file for this day? Nothing to do —
    // skip the AI call entirely (no point paying for/waiting on a fresh
    // read when nothing changed) and hand back the existing alert as-is.
    const unchanged = existing != null && Math.abs(Number(existing.averageWeightG) - params.averageWeightG) < 0.005;
    if (unchanged) return existing;

    const aiAnalysis = existing
      ? existing.aiAnalysis // keep the prior read rather than re-spending an API call on a duplicate pass
      : await this.getAiAnalysis({
          batchCode: batch.batchCode,
          houseName: batch.house?.name ?? null,
          ageWeeks,
          direction,
          averageWeightG: params.averageWeightG,
          standardMinG: check.standard.weightMinG,
          standardMaxG: check.standard.weightMaxG,
          deviationG,
          deviationPct,
          feedContext,
          mortalityContext,
        }).catch(err => {
          this.logger.warn(`AI weight-deviation analysis failed (batch ${params.batchId}): ${err?.message}`);
          return null;
        });

    const alertData = {
      source: params.source,
      sourceId: params.sourceId ?? null,
      sampleCount: params.sampleCount ?? null,
      averageWeightG: params.averageWeightG,
      standardMinG: check.standard.weightMinG,
      standardMaxG: check.standard.weightMaxG,
      ageWeeks,
      direction,
      deviationG,
      deviationPct,
      feedContext: feedContext as any,
      mortalityContext: mortalityContext as any,
      aiAnalysis,
    };

    // Upsert on (batchId, sampleDate) rather than a plain create — this is
    // the crux of the duplicate-flag fix. A second/third/Nth pass over the
    // same batch+day updates the existing row's measurement/context in
    // place instead of minting a sibling row, and — critically — leaves
    // status/acknowledgedById/acknowledgedAt untouched, so a flag the
    // Director already acknowledged or resolved does not pop back up.
    const alert = await this.prisma.productionWeightAlert.upsert({
      where: { batchId_sampleDate: { batchId: params.batchId, sampleDate: params.sampleDate } },
      create: { batchId: params.batchId, sampleDate: params.sampleDate, ...alertData },
      update: alertData,
    });

    // Only the very first time this (batch, day) is flagged does the
    // Director get notified — re-notifying on every re-upload of an
    // already-seen flag is exactly the duplication being fixed here.
    if (!existing) {
      const directionLabel = direction === 'BELOW_MIN' ? 'below' : 'above';
      const boundaryLabel = direction === 'BELOW_MIN' ? 'minimum' : 'maximum';
      const title = direction === 'BELOW_MIN' ? 'Bird Weight Below Standard' : 'Bird Weight Above Standard';
      const message = `${batch.batchCode} (Week ${ageWeeks}, ${check.standard.phase}): average weight ${params.averageWeightG.toFixed(0)}g is ${Math.abs(deviationG).toFixed(0)}g (${Math.abs(deviationPct).toFixed(1)}%) ${directionLabel} the HyLine ${boundaryLabel} of ${boundaryG}g, recorded ${dayjs(params.sampleDate).format('D MMM YYYY')}.`;

      await this.notifications.notifyRole(
        UserRole.OWNER,
        direction === 'BELOW_MIN' ? NotificationType.WEIGHT_BELOW_STANDARD : NotificationType.WEIGHT_ABOVE_STANDARD,
        title,
        message,
        { entityId: alert.id, entityType: 'ProductionWeightAlert' },
      ).catch(() => { /* best-effort */ });

      this.logger.warn(`Weight alert raised for batch ${batch.batchCode}: ${message}`);
    } else {
      this.logger.log(`Weight alert refreshed (no re-notify) for batch ${batch.batchCode}, ${dayjs(params.sampleDate).format('D MMM YYYY')}: alert ${alert.id}`);
    }

    return alert;
  }

  /** Pulls the batch's current Store production report rows, straight from
   *  StoreProductionReport.rawRows — the sheet Store/PM actually filled in
   *  by hand from what they counted/dispensed on the ground. This is the
   *  preferred source for feed-intake and mortality context on a weight
   *  alert (see buildFeedContext/buildMortalityContext below): system
   *  tables like FeedIntakeLog/FlockDailyEntry are only as good as what
   *  got logged through the app in real time, and in practice some areas
   *  don't log every dispense/death that way, so those tables can under-
   *  report — occasionally right down to a flat 0 — even when the report
   *  itself, filled in on paper first, shows otherwise. Returns null when
   *  the batch has no production report on file yet (e.g. a Farm Events
   *  weighing logged before Store's first upload); callers fall back to
   *  system tables in that case. */
  private async getReportRows(batchId: string): Promise<ParsedReportRow[] | null> {
    const report = await this.prisma.storeProductionReport.findUnique({
      where: { batchId },
      select: { rawRows: true },
    });
    if (!report) return null;
    const rows = report.rawRows as unknown as ParsedReportRow[];
    return Array.isArray(rows) ? rows : null;
  }

  /** Recent feed intake vs. the HyLine daily ration for this age — lets the
   *  Director see at a glance whether a below-standard weight lines up
   *  with underfeeding (feed well under ration) or looks unrelated (feed
   *  on/over ration, so something else — disease, stress, genetics — is
   *  the likelier driver).
   *
   *  Sourced from the batch's production report rows (row.feedKg summed
   *  across whatever rows — including per-cage rows — fall inside the
   *  window) whenever the report has any; that's the in-person figure
   *  Store/PM actually recorded, and is preferred over FeedIntakeLog for
   *  exactly the reason described on getReportRows(). Falls back to
   *  FeedIntakeLog only when there's no report on file, or none of its
   *  rows land inside this window. */
  private async buildFeedContext(batchId: string, sampleDate: Date, ageWeeks: number): Promise<FeedContextSnapshot> {
    const windowStartStr = dayjs(sampleDate).subtract(CONTEXT_WINDOW_DAYS - 1, 'day').format('YYYY-MM-DD');
    const sampleDateStr = dayjs(sampleDate).format('YYYY-MM-DD');

    const reportRows = await this.getReportRows(batchId);
    const windowFeedRows = reportRows?.filter(
      r => r.date >= windowStartStr && r.date <= sampleDateStr && r.feedKg != null,
    ) ?? [];

    let totalDispensedKg: number;
    let entryCount: number;
    let source: 'report' | 'system';

    if (windowFeedRows.length > 0) {
      totalDispensedKg = Math.round(windowFeedRows.reduce((s, r) => s + (r.feedKg ?? 0), 0) * 100) / 100;
      entryCount = windowFeedRows.length;
      source = 'report';
    } else {
      const windowStart = dayjs(sampleDate).subtract(CONTEXT_WINDOW_DAYS - 1, 'day').toDate();
      const logs = await this.prisma.feedIntakeLog.findMany({
        where: { batchId, entryDate: { gte: windowStart, lte: sampleDate } },
        select: { quantityDispensedKg: true },
      });
      totalDispensedKg = Math.round(logs.reduce((s, l) => s + Number(l.quantityDispensedKg), 0) * 100) / 100;
      entryCount = logs.length;
      source = 'system';
    }

    const batch = await this.prisma.batch.findUnique({ where: { id: batchId }, select: { currentBirdCount: true } });
    const gramsPerBirdPerDay = hylineGramsPerBirdPerDay(ageWeeks);
    const recommendedKg = batch
      ? Math.round(((batch.currentBirdCount * gramsPerBirdPerDay * CONTEXT_WINDOW_DAYS) / 1000) * 100) / 100
      : null;
    const pctOfRecommended = recommendedKg && recommendedKg > 0
      ? Math.round((totalDispensedKg / recommendedKg) * 10000) / 100
      : null;

    const sourceLabel = source === 'report' ? 'per the production report' : 'per system feed logs — no production report data for this window';

    let note: string;
    if (entryCount === 0) {
      note = `No feed intake recorded in the last ${CONTEXT_WINDOW_DAYS} days (checked both the production report and system logs) — feed records can't confirm or rule out underfeeding here; check with the attendant/PM directly.`;
    } else if (pctOfRecommended != null && pctOfRecommended < 85) {
      note = `Feed dispensed (${sourceLabel}) is only ${pctOfRecommended.toFixed(0)}% of the HyLine-recommended ration for this period — underfeeding is a plausible contributor.`;
    } else if (pctOfRecommended != null && pctOfRecommended > 115) {
      note = `Feed dispensed (${sourceLabel}) is ${pctOfRecommended.toFixed(0)}% of the HyLine-recommended ration — feed intake looks adequate or high, so the weight deviation is likely NOT feed-driven.`;
    } else {
      note = `Feed dispensed (${sourceLabel}) is within a normal range of the HyLine-recommended ration (${pctOfRecommended?.toFixed(0) ?? '—'}%) — feed intake alone doesn't explain the weight deviation.`;
    }

    return {
      windowDays: CONTEXT_WINDOW_DAYS,
      totalDispensedKg,
      recommendedKg,
      pctOfRecommended,
      entryCount,
      source,
      note,
    };
  }

  /** Recent + cumulative mortality vs. the HyLine ceiling for this age —
   *  lets the Director see whether a below-standard weight coincides with
   *  elevated deaths (disease outbreak suspicion) or normal mortality
   *  (weight issue likely isolated, not part of a wider health event).
   *
   *  Sourced from the production report's row.mortality figures whenever
   *  the report has any recorded — both the 7-day window total and the
   *  cumulative-since-report figure, so a batch where deaths are being
   *  written on the report but not consistently logged through the app
   *  (the exact gap that produces "0 deaths logged" here while the report
   *  clearly shows otherwise) still gets an accurate read. Falls back to
   *  FlockDailyEntry + the batch's tracked currentBirdCount only when the
   *  report has no mortality figures at all. */
  private async buildMortalityContext(
    batchId: string, sampleDate: Date, ageWeeks: number,
    batch: { quantityReceived: number; mortalityOnArrival: number; currentBirdCount: number },
  ): Promise<MortalityContextSnapshot> {
    const windowStartStr = dayjs(sampleDate).subtract(CONTEXT_WINDOW_DAYS - 1, 'day').format('YYYY-MM-DD');
    const sampleDateStr = dayjs(sampleDate).format('YYYY-MM-DD');

    const reportRows = await this.getReportRows(batchId);
    const reportMortalityRowsToDate = reportRows?.filter(r => r.date <= sampleDateStr && r.mortality != null) ?? [];

    const effectiveReceived = batch.quantityReceived - batch.mortalityOnArrival;
    const std = hylineStandard(ageWeeks);

    let totalDeaths: number;
    let farmDeaths: number;
    let source: 'report' | 'system';

    if (reportMortalityRowsToDate.length > 0) {
      totalDeaths = reportMortalityRowsToDate
        .filter(r => r.date >= windowStartStr)
        .reduce((s, r) => s + (r.mortality ?? 0), 0);
      // Cumulative since the report's own earliest row — the most
      // accurate figure available when Store's sheet covers the batch's
      // full history to date (the normal case for a re-uploaded/growing
      // report); see reconcileWeight's caller comment for why reports are
      // expected to be cumulative, not delta-only.
      farmDeaths = reportMortalityRowsToDate.reduce((s, r) => s + (r.mortality ?? 0), 0);
      source = 'report';
    } else {
      const windowStart = dayjs(sampleDate).subtract(CONTEXT_WINDOW_DAYS - 1, 'day').toDate();
      const entries = await this.prisma.flockDailyEntry.findMany({
        where: { batchId, entryDate: { gte: windowStart, lte: sampleDate } },
        select: { mortalityCount: true },
      });
      totalDeaths = entries.reduce((s, e) => s + e.mortalityCount, 0);
      farmDeaths = Math.max(0, effectiveReceived - batch.currentBirdCount);
      source = 'system';
    }

    const cumulativePct = effectiveReceived > 0
      ? Math.round(((farmDeaths / effectiveReceived) * 100) * 100) / 100
      : null;
    const overCeiling = cumulativePct != null && cumulativePct > std.cumulativeMortalityPct;
    const sourceLabel = source === 'report' ? 'per the production report' : 'per system logs — no production report mortality data on file';

    let note: string;
    if (totalDeaths > 0 && overCeiling) {
      note = `${totalDeaths} death(s) in the last ${CONTEXT_WINDOW_DAYS} days (${sourceLabel}) AND cumulative mortality (${cumulativePct}%) exceeds the HyLine week-${std.week} ceiling (${std.cumulativeMortalityPct}%) — an outbreak or other flock-wide health event is a real possibility and should be investigated alongside the weight flag.`;
    } else if (totalDeaths > 0) {
      note = `${totalDeaths} death(s) in the last ${CONTEXT_WINDOW_DAYS} days (${sourceLabel}), but cumulative mortality (${cumulativePct ?? '—'}%) is still within the HyLine ceiling (${std.cumulativeMortalityPct}%) — mortality alone doesn't obviously explain the weight deviation, though it's worth a closer look.`;
    } else {
      note = `No deaths recorded in the last ${CONTEXT_WINDOW_DAYS} days (${sourceLabel}) — the weight deviation does not appear to coincide with a mortality event.`;
    }

    return {
      windowDays: CONTEXT_WINDOW_DAYS,
      totalDeaths,
      cumulativePct,
      standardCeilingPct: std.cumulativeMortalityPct,
      overCeiling,
      source,
      note,
    };
  }

  /** Best-effort AI reasoning layered on top of the rule-based feed/
   *  mortality context above. Returns null (never throws to the caller —
   *  errors are caught by evaluateWeightSample) when ANTHROPIC_API_KEY
   *  isn't configured or the call fails; the persisted feed/mortality
   *  context still stands on its own in that case. Uses AiService's own
   *  Anthropic client indirectly is avoided here to keep this module
   *  independent — AiModule already exposes AiService for anything richer
   *  (see AiService.checkMortalityAnomaly for the equivalent pattern on
   *  the mortality side); this call is intentionally simple and scoped to
   *  "why might this one weight sample be off". */
  private async getAiAnalysis(ctx: {
    batchCode: string; houseName: string | null; ageWeeks: number;
    direction: WeightAlertDirection; averageWeightG: number;
    standardMinG: number; standardMaxG: number; deviationG: number; deviationPct: number;
    feedContext: FeedContextSnapshot | null; mortalityContext: MortalityContextSnapshot | null;
  }): Promise<string | null> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic({ apiKey });
    const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

    const feedSourceNote = ctx.feedContext?.source === 'report'
      ? '(sourced from the Store production report — the in-person recorded figure, treat as authoritative)'
      : ctx.feedContext?.source === 'system'
        ? '(no production report data for this window — this is a system-log fallback and may under/over-count; flag that uncertainty rather than treating it as solid ground)'
        : '';
    const mortalitySourceNote = ctx.mortalityContext?.source === 'report'
      ? '(sourced from the Store production report — the in-person recorded figure, treat as authoritative)'
      : ctx.mortalityContext?.source === 'system'
        ? '(no production report mortality data on file — this is a system-log fallback and may under-count; flag that uncertainty rather than treating it as solid ground)'
        : '';

    const prompt = `You are analysing a poultry farm weight-monitoring flag for a Director. Be concise (3-5 sentences, plain prose, no headers/bullets).

Batch ${ctx.batchCode}${ctx.houseName ? ` (${ctx.houseName})` : ''}, Week ${ctx.ageWeeks}.
Recorded average weight: ${ctx.averageWeightG.toFixed(0)}g. HyLine standard band for this week: ${ctx.standardMinG}-${ctx.standardMaxG}g.
This is ${ctx.direction === 'BELOW_MIN' ? 'BELOW the minimum' : 'ABOVE the maximum'} by ${Math.abs(ctx.deviationG).toFixed(0)}g (${Math.abs(ctx.deviationPct).toFixed(1)}%).

Feed context ${feedSourceNote} (last ${ctx.feedContext?.windowDays ?? 7} days): ${ctx.feedContext?.note ?? 'no feed data available'}. Total dispensed: ${ctx.feedContext?.totalDispensedKg ?? '—'}kg vs. recommended ${ctx.feedContext?.recommendedKg ?? '—'}kg.

Mortality context ${mortalitySourceNote} (last ${ctx.mortalityContext?.windowDays ?? 7} days): ${ctx.mortalityContext?.note ?? 'no mortality data available'}. Cumulative mortality: ${ctx.mortalityContext?.cumulativePct ?? '—'}% vs. HyLine ceiling ${ctx.mortalityContext?.standardCeilingPct ?? '—'}%.

The production report is Store/PM's in-person, hand-recorded account of what actually happened on the ground each day — prefer it over any system-log fallback noted above when weighing how confident to be. Give the Director your best read on the likeliest explanation(s) for this weight deviation — e.g. underfeeding, overfeeding, a possible disease outbreak, sampling error, genetics/strain variance, environmental stress — grounded in the feed and mortality context above. If a context value is a system-log fallback rather than report-sourced, note that it's less certain before leaning on it. If the context doesn't clearly point anywhere, say so plainly and suggest what to check next (e.g. a vet visit, re-weighing a larger sample, reviewing recent brooder/production logs). Do not invent data you weren't given.`;

    try {
      const msg = await anthropic.messages.create({ model, max_tokens: 400, messages: [{ role: 'user', content: prompt }] });
      const block = msg.content[0];
      return block.type === 'text' ? block.text.trim() : null;
    } catch (err: any) {
      this.logger.warn(`Claude call failed for weight-deviation analysis: ${err?.message}`);
      return null;
    }
  }

  // ── Director-facing reads ────────────────────────────────────────────────

  async listAlerts(params: { status?: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'; batchId?: string; limit?: number }) {
    return this.prisma.productionWeightAlert.findMany({
      where: {
        ...(params.status ? { status: params.status } : {}),
        ...(params.batchId ? { batchId: params.batchId } : {}),
      },
      include: { batch: { select: { batchCode: true, house: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: params.limit ?? 100,
    });
  }

  async getAlert(id: string) {
    return this.prisma.productionWeightAlert.findUnique({
      where: { id },
      include: { batch: { select: { batchCode: true, house: { select: { name: true } } } } },
    });
  }

  async updateAlertStatus(id: string, status: 'ACKNOWLEDGED' | 'RESOLVED', userId: string) {
    return this.prisma.productionWeightAlert.update({
      where: { id },
      data: {
        status,
        acknowledgedById: userId,
        acknowledgedAt: new Date(),
      },
    });
  }
}
