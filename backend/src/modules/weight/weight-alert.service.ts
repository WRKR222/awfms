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
   * cross-reference context, asks the AI for a short analysis, persists a
   * ProductionWeightAlert, and notifies the Director. Returns the created
   * alert (or null if within band / batch not found).
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

    const aiAnalysis = await this.getAiAnalysis({
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

    const alert = await this.prisma.productionWeightAlert.create({
      data: {
        batchId: params.batchId,
        source: params.source,
        sourceId: params.sourceId ?? null,
        sampleDate: params.sampleDate,
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
      },
    });

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
    return alert;
  }

  /** Recent feed intake vs. the HyLine daily ration for this age — lets the
   *  Director see at a glance whether a below-standard weight lines up
   *  with underfeeding (feed well under ration) or looks unrelated (feed
   *  on/over ration, so something else — disease, stress, genetics — is
   *  the likelier driver). Reads FeedIntakeLog, which is the batch-generic
   *  feed table used across stages (see AGENTS.md decimal-handling note —
   *  values are wrapped with Number() once per row here). */
  private async buildFeedContext(batchId: string, sampleDate: Date, ageWeeks: number): Promise<FeedContextSnapshot> {
    const windowStart = dayjs(sampleDate).subtract(CONTEXT_WINDOW_DAYS - 1, 'day').toDate();
    const logs = await this.prisma.feedIntakeLog.findMany({
      where: { batchId, entryDate: { gte: windowStart, lte: sampleDate } },
      select: { quantityDispensedKg: true },
    });
    const totalDispensedKg = Math.round(logs.reduce((s, l) => s + Number(l.quantityDispensedKg), 0) * 100) / 100;

    const batch = await this.prisma.batch.findUnique({ where: { id: batchId }, select: { currentBirdCount: true } });
    const gramsPerBirdPerDay = hylineGramsPerBirdPerDay(ageWeeks);
    const recommendedKg = batch
      ? Math.round(((batch.currentBirdCount * gramsPerBirdPerDay * CONTEXT_WINDOW_DAYS) / 1000) * 100) / 100
      : null;
    const pctOfRecommended = recommendedKg && recommendedKg > 0
      ? Math.round((totalDispensedKg / recommendedKg) * 10000) / 100
      : null;

    let note: string;
    if (logs.length === 0) {
      note = `No feed intake logged in the last ${CONTEXT_WINDOW_DAYS} days — feed records can't confirm or rule out underfeeding here; check with the attendant/PM directly.`;
    } else if (pctOfRecommended != null && pctOfRecommended < 85) {
      note = `Feed dispensed is only ${pctOfRecommended.toFixed(0)}% of the HyLine-recommended ration for this period — underfeeding is a plausible contributor.`;
    } else if (pctOfRecommended != null && pctOfRecommended > 115) {
      note = `Feed dispensed is ${pctOfRecommended.toFixed(0)}% of the HyLine-recommended ration — feed intake looks adequate or high, so the weight deviation is likely NOT feed-driven.`;
    } else {
      note = `Feed dispensed is within a normal range of the HyLine-recommended ration (${pctOfRecommended?.toFixed(0) ?? '—'}%) — feed intake alone doesn't explain the weight deviation.`;
    }

    return {
      windowDays: CONTEXT_WINDOW_DAYS,
      totalDispensedKg,
      recommendedKg,
      pctOfRecommended,
      entryCount: logs.length,
      note,
    };
  }

  /** Recent + cumulative mortality vs. the HyLine ceiling for this age —
   *  lets the Director see whether a below-standard weight coincides with
   *  elevated deaths (disease outbreak suspicion) or normal mortality
   *  (weight issue likely isolated, not part of a wider health event).
   *  Reads FlockDailyEntry, the batch-generic daily mortality/production
   *  table used across stages. */
  private async buildMortalityContext(
    batchId: string, sampleDate: Date, ageWeeks: number,
    batch: { quantityReceived: number; mortalityOnArrival: number; currentBirdCount: number },
  ): Promise<MortalityContextSnapshot> {
    const windowStart = dayjs(sampleDate).subtract(CONTEXT_WINDOW_DAYS - 1, 'day').toDate();
    const entries = await this.prisma.flockDailyEntry.findMany({
      where: { batchId, entryDate: { gte: windowStart, lte: sampleDate } },
      select: { mortalityCount: true },
    });
    const totalDeaths = entries.reduce((s, e) => s + e.mortalityCount, 0);

    const effectiveReceived = batch.quantityReceived - batch.mortalityOnArrival;
    const farmDeaths = Math.max(0, effectiveReceived - batch.currentBirdCount);
    const std = hylineStandard(ageWeeks);
    const cumulativePct = effectiveReceived > 0
      ? Math.round(((farmDeaths / effectiveReceived) * 100) * 100) / 100
      : null;
    const overCeiling = cumulativePct != null && cumulativePct > std.cumulativeMortalityPct;

    let note: string;
    if (totalDeaths > 0 && overCeiling) {
      note = `${totalDeaths} death(s) in the last ${CONTEXT_WINDOW_DAYS} days AND cumulative mortality (${cumulativePct}%) exceeds the HyLine week-${std.week} ceiling (${std.cumulativeMortalityPct}%) — an outbreak or other flock-wide health event is a real possibility and should be investigated alongside the weight flag.`;
    } else if (totalDeaths > 0) {
      note = `${totalDeaths} death(s) in the last ${CONTEXT_WINDOW_DAYS} days, but cumulative mortality (${cumulativePct ?? '—'}%) is still within the HyLine ceiling (${std.cumulativeMortalityPct}%) — mortality alone doesn't obviously explain the weight deviation, though it's worth a closer look.`;
    } else {
      note = `No deaths logged in the last ${CONTEXT_WINDOW_DAYS} days — the weight deviation does not appear to coincide with a mortality event.`;
    }

    return {
      windowDays: CONTEXT_WINDOW_DAYS,
      totalDeaths,
      cumulativePct,
      standardCeilingPct: std.cumulativeMortalityPct,
      overCeiling,
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

    const prompt = `You are analysing a poultry farm weight-monitoring flag for a Director. Be concise (3-5 sentences, plain prose, no headers/bullets).

Batch ${ctx.batchCode}${ctx.houseName ? ` (${ctx.houseName})` : ''}, Week ${ctx.ageWeeks}.
Recorded average weight: ${ctx.averageWeightG.toFixed(0)}g. HyLine standard band for this week: ${ctx.standardMinG}-${ctx.standardMaxG}g.
This is ${ctx.direction === 'BELOW_MIN' ? 'BELOW the minimum' : 'ABOVE the maximum'} by ${Math.abs(ctx.deviationG).toFixed(0)}g (${Math.abs(ctx.deviationPct).toFixed(1)}%).

Feed context (last ${ctx.feedContext?.windowDays ?? 7} days): ${ctx.feedContext?.note ?? 'no feed data available'}. Total dispensed: ${ctx.feedContext?.totalDispensedKg ?? '—'}kg vs. recommended ${ctx.feedContext?.recommendedKg ?? '—'}kg.

Mortality context (last ${ctx.mortalityContext?.windowDays ?? 7} days): ${ctx.mortalityContext?.note ?? 'no mortality data available'}. Cumulative mortality: ${ctx.mortalityContext?.cumulativePct ?? '—'}% vs. HyLine ceiling ${ctx.mortalityContext?.standardCeilingPct ?? '—'}%.

Give the Director your best read on the likeliest explanation(s) for this weight deviation — e.g. underfeeding, overfeeding, a possible disease outbreak, sampling error, genetics/strain variance, environmental stress — grounded in the feed and mortality context above. If the context doesn't clearly point anywhere, say so plainly and suggest what to check next (e.g. a vet visit, re-weighing a larger sample, reviewing recent brooder/production logs). Do not invent data you weren't given.`;

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
