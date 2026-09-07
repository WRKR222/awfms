import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { NotificationType, UserRole, EntryStatus, BatchStage } from '@prisma/client';
import dayjs from 'dayjs';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private anthropic: Anthropic | null = null;

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private config: ConfigService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
      this.logger.log('Anthropic client initialised');
    } else {
      this.logger.warn('ANTHROPIC_API_KEY not set — AI features disabled');
    }
  }

  // ── Helper: call Claude with a structured prompt ────────────────────────────
  // FIX: reports were getting cut off mid-sentence with no warning anywhere.
  // The Anthropic API truncates a response once it hits max_tokens and signals
  // this via stop_reason === 'max_tokens' — but that was never checked, so a
  // half-finished report was saved and shown to the Director exactly as if it
  // were complete. This now detects that case, logs it loudly, and retries
  // ONCE with an explicit instruction to answer more concisely so the saved
  // report is always a complete (if shorter) piece of writing rather than a
  // sentence that stops halfway through.
  // `model` lets a specific call (e.g. the Director's on-demand batch report)
  // override ANTHROPIC_MODEL and point at a more capable model without
  // affecting the cheaper, higher-frequency cron reports that also call this
  // helper.
  private async callClaude(prompt: string, maxTokens = 800, model?: string): Promise<string | null> {
    if (!this.anthropic) return null;
    const resolvedModel = model ?? this.config.get<string>('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6';
    try {
      const msg = await this.anthropic.messages.create({
        model: resolvedModel,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      });
      const block = msg.content[0];
      let text = block.type === 'text' ? block.text : null;

      if (msg.stop_reason === 'max_tokens') {
        this.logger.warn(`Claude response truncated at max_tokens=${maxTokens} (model: ${resolvedModel}) — retrying once with a tighter length cap`);
        const wordCap = Math.max(120, Math.floor(maxTokens * 0.55));
        const retryMsg = await this.anthropic.messages.create({
          model: resolvedModel,
          max_tokens: maxTokens,
          messages: [{
            role: 'user',
            content: `${prompt}\n\nIMPORTANT: Your previous attempt at this ran out of room and got cut off mid-sentence. This time, keep your ENTIRE response under ${wordCap} words so it finishes completely — be noticeably more concise while still briefly touching every section asked for above. A short, complete report is much better than a long, unfinished one.`,
          }],
        });
        const retryBlock = retryMsg.content[0];
        const retryText = retryBlock.type === 'text' ? retryBlock.text : null;
        if (retryText) {
          if (retryMsg.stop_reason === 'max_tokens') {
            this.logger.error('Claude response still truncated after the concise retry — saving it anyway, but consider raising maxTokens for this report type');
          }
          text = retryText;
        }
      }

      return text;
    } catch (err: any) {
      this.logger.error(`Claude API error: ${err.message} (status: ${err.status ?? 'unknown'}, model: ${resolvedModel})`);
      if (err.status === 401) this.logger.error('Claude API: invalid API key — check ANTHROPIC_API_KEY in Railway env vars');
      if (err.status === 404) this.logger.error(`Claude API: model not found — check ANTHROPIC_MODEL / ANTHROPIC_MODEL_BATCH_REPORT env vars (current: ${resolvedModel})`);
      return null;
    }
  }

  // ── Helper: guess which store item a report's free-text cell means ─────────
  // Used by the Production Report upload flow when the plain fuzzy-name
  // matcher couldn't place a report cell (e.g. "ND drops") against any
  // active store item. This NEVER auto-applies anything on its own — it only
  // returns a suggestion so Store can confirm (or reject) it in one click
  // instead of typing/scrolling through the full item list. Best-effort by
  // design: returns null (never throws) whenever the API key isn't
  // configured, the call fails, or Claude isn't confident there's a real
  // match — a missing suggestion just means Store picks manually, same as
  // before this existed.
  async suggestStoreItemMatch(
    rawText: string, kind: 'vaccine' | 'supplement' | 'treatment', candidates: { id: string; name: string }[],
  ): Promise<{ storeItemId: string; storeItemName: string; confidence: 'high' | 'medium' | 'low' } | null> {
    if (!this.anthropic || !rawText.trim() || candidates.length === 0) return null;
    const list = candidates.map((c, i) => `${i + 1}. ${c.name}`).join('\n');
    const prompt =
      `A poultry farm's daily report has a "${kind}" cell reading exactly: "${rawText.trim()}"\n\n` +
      `Here is the farm's list of active store items this could plausibly refer to (misspellings, ` +
      `abbreviations, brand names, or partial names are common on paper sheets):\n${list}\n\n` +
      `If — and only if — you are reasonably confident the cell refers to ONE specific item on this list, ` +
      `respond with ONLY a JSON object: {"index": <1-based number from the list>, "confidence": "high"|"medium"|"low"}. ` +
      `If nothing on the list plausibly matches, respond with ONLY {"index": null}. No other text.`;
    const text = await this.callClaude(prompt, 150);
    if (!text) return null;
    try {
      const cleaned = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned) as { index: number | null; confidence?: 'high' | 'medium' | 'low' };
      if (!parsed.index || parsed.index < 1 || parsed.index > candidates.length) return null;
      const match = candidates[parsed.index - 1];
      return { storeItemId: match.id, storeItemName: match.name, confidence: parsed.confidence ?? 'medium' };
    } catch {
      this.logger.warn(`suggestStoreItemMatch: could not parse Claude's response as JSON: ${text.slice(0, 200)}`);
      return null;
    }
  }

  // ── Helper: combine AM + PM sessions into TRUE daily HDP figures ────────────
  // EggCollectionSession.henDayPercent is stored per SHIFT (good eggs in that
  // one AM-or-PM session ÷ that shift's own closing stock). Every report below
  // used to average those shift-level numbers directly across whatever rows it
  // pulled — which silently mixes AM rows and PM rows together and treats each
  // half-day figure as if it were a full day. Since AM+PM together make up one
  // day, averaging them this way understates real daily HDP by roughly half
  // whenever both shifts are recorded (e.g. a true ~70% day reads as ~35%).
  //
  // This groups sessions by (batch, calendar day) first, sums the good-egg
  // count across whichever shifts were recorded that day, and divides by the
  // day's closing stock (PM's, since it's the more complete end-of-day figure;
  // falls back to AM's if PM hasn't been recorded yet) — same convention
  // already used correctly in CageMapService.getBlockWithMap. Callers should
  // average the returned per-day `hdp` values, never the raw per-session ones.
  private aggregateDailyHdp(
    sessions: Array<{
      sessionDate: Date;
      shift: string;
      totalGoodEggs: number;
      totalStarterEggs: number;
      closingStock: number;
      batchId?: string;
    }>,
  ): Array<{ date: string; batchId: string; goodEggs: number; closingStock: number; hdp: number }> {
    const byKey = new Map<string, typeof sessions>();
    for (const s of sessions) {
      const key = `${s.batchId ?? '_'}|${dayjs(s.sessionDate).format('YYYY-MM-DD')}`;
      const bucket = byKey.get(key) ?? [];
      bucket.push(s);
      byKey.set(key, bucket);
    }

    const days: Array<{ date: string; batchId: string; goodEggs: number; closingStock: number; hdp: number }> = [];
    for (const [key, daySessions] of byKey) {
      const [batchId, date] = key.split('|');
      // A session that is entirely Kienyeji "starter" eggs stores 0 in
      // totalGoodEggs by design — fall back to totalStarterEggs in that case,
      // mirroring the logic ProductionService uses when it first computes the
      // per-shift henDayPercent.
      const goodEggs = daySessions.reduce(
        (sum, s) => sum + (s.totalGoodEggs > 0 ? s.totalGoodEggs : s.totalStarterEggs),
        0,
      );
      const pm = daySessions.find(s => s.shift === 'PM');
      const am = daySessions.find(s => s.shift === 'AM');
      const closingStock = pm?.closingStock ?? am?.closingStock ?? 0;
      if (closingStock > 0) {
        days.push({
          date,
          batchId,
          goodEggs,
          closingStock,
          hdp: Math.round((goodEggs / closingStock) * 10000) / 100,
        });
      }
    }
    return days.sort((a, b) => a.date.localeCompare(b.date));
  }

  private avgOf(values: number[]): number {
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  }

  // ── Helper: sales, invoicing & receivables for a period ─────────────────────
  // Previously every report's "revenue" figure meant ONLY cash actually
  // collected (InvoicePayment rows) — sales orders placed, invoices issued
  // but unpaid, and the outstanding receivables book were all invisible.
  private async getSalesFinanceSummary(start: Date, end: Date) {
    const [orders, invoices, payments, openAr] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where: { orderDate: { gte: start, lte: end }, deletedAt: null },
        select: { subtotal: true, status: true },
      }),
      this.prisma.invoice.findMany({
        where: { invoiceDate: { gte: start, lte: end } },
        select: { totalAmount: true },
      }),
      this.prisma.invoicePayment.findMany({
        where: { paymentDate: { gte: start, lte: end } },
        select: { amount: true },
      }),
      // Outstanding AR is a balance-sheet figure, not a flow — read as a live
      // snapshot ("as of now") rather than filtered to the report period.
      this.prisma.arEntry.findMany({
        where: { currentBalance: { gt: 0 } },
        select: { currentBalance: true, dueDate: true },
      }),
    ]);

    const now = new Date();
    return {
      ordersCount: orders.length,
      ordersValue: orders.reduce((s, o) => s + Number(o.subtotal), 0),
      cancelledOrders: orders.filter(o => o.status === 'CANCELLED').length,
      invoicedValue: invoices.reduce((s, i) => s + Number(i.totalAmount), 0),
      cashCollected: payments.reduce((s, p) => s + Number(p.amount), 0),
      outstandingAR: openAr.reduce((s, a) => s + Number(a.currentBalance), 0),
      overdueAR: openAr.filter(a => a.dueDate < now).reduce((s, a) => s + Number(a.currentBalance), 0),
    };
  }

  // ── Helper: post-collection breakage adjustments for a period ───────────────
  // EggCollectionSession captures raw breakage at collection time (totalBrokenEggs,
  // totalDamaged); the sellable/unsellable split (totalBrokenSellable /
  // totalBrokenUnsellable) is entered later by the Production Manager at tally sign-off.
  // EggBreakageAdjustment is a SEPARATE record Sales raises later (storage/handling
  // breakage, recounts), and it was never queried by any report.
  private async getBreakageSummary(start: Date, end: Date) {
    const adjustments = await this.prisma.eggBreakageAdjustment.findMany({
      where: { adjustmentDate: { gte: start, lte: end } },
      select: { adjustmentType: true, quantityDiff: true },
    });
    return {
      count: adjustments.length,
      netDiff: adjustments.reduce((s, a) => s + a.quantityDiff, 0),
      consumable: adjustments.filter(a => a.adjustmentType === 'CONSUMABLE').length,
      nonConsumable: adjustments.filter(a => a.adjustmentType === 'NON_CONSUMABLE').length,
    };
  }

  // ── Helper: feed PURCHASED for a period (separate from feed CONSUMED) ───────
  // FeedDelivery (stock purchased) and FeedIntakeLog (stock consumed per
  // batch) are different tables. Reports only ever looked at consumption —
  // purchases, supplier, and cost were never surfaced, so there was no way to
  // cross-check what came in against what went out.
  private async getFeedDeliverySummary(start: Date, end: Date) {
    const deliveries = await this.prisma.feedDelivery.findMany({
      where: { deliveryDate: { gte: start, lte: end } },
      select: { quantityKg: true, totalCost: true },
    });
    return {
      count: deliveries.length,
      totalKg: deliveries.reduce((s, d) => s + Number(d.quantityKg), 0),
      totalCost: deliveries.reduce((s, d) => s + Number(d.totalCost), 0),
    };
  }

  // ── Helper: how completely each role logged its data this period ───────────
  // Nothing in the AI reports ever surfaced who's behind on data entry. This
  // pulls PENDING/RETURNED counts across the role-owned entry tables, plus the
  // Manager+Sales+Store three-way tally sign-off completion rate.
  private async getRoleDataCompleteness(start: Date, end: Date) {
    const countOf = (rows: Array<{ status: string; _count: { _all: number } }>, status: string) =>
      rows.find(r => r.status === status)?._count._all ?? 0;

    const [eggStatus, flockStatus, feedStatus, tallies] = await Promise.all([
      this.prisma.eggCollectionSession.groupBy({
        by: ['status'],
        where: { sessionDate: { gte: start, lte: end }, deletedAt: null },
        _count: { _all: true },
      }),
      (this.prisma as any).flockDailyEntry.groupBy({
        by: ['status'],
        where: { entryDate: { gte: start, lte: end } },
        _count: { _all: true },
      }),
      this.prisma.feedIntakeLog.groupBy({
        by: ['status'],
        where: { entryDate: { gte: start, lte: end } },
        _count: { _all: true },
      }),
      this.prisma.eggTallyVerification.findMany({
        where: { verificationDate: { gte: start, lte: end } },
        select: { pmSignedById: true, salesSignedById: true, storeSignedById: true, isLocked: true },
      }),
    ]);

    return {
      eggCollection: { pending: countOf(eggStatus as any, 'PENDING'), returned: countOf(eggStatus as any, 'RETURNED') },
      flockEntries: { pending: countOf(flockStatus as any, 'PENDING'), returned: countOf(flockStatus as any, 'RETURNED') },
      feedLogs: { pending: countOf(feedStatus as any, 'PENDING'), returned: countOf(feedStatus as any, 'RETURNED') },
      tallySignOff: {
        total: tallies.length,
        fullySigned: tallies.filter(t => t.pmSignedById && t.salesSignedById && t.storeSignedById).length,
        locked: tallies.filter(t => t.isLocked).length,
      },
    };
  }

  // ── Helper: derive reliable production metrics from the uploaded Store
  // production report, instead of the operational entry tables ────────────
  // StoreProductionReport is the report Store uploads and the Director signs
  // off on (see ProductionReportReconciliationService) — it is treated as
  // the authoritative record of what actually happened on the farm. The
  // operational tables it reconciles against (FeedIntakeLog, FlockDailyEntry,
  // BrooderLevelMortalityLog, etc.) are attendant-entered day-to-day and can
  // undercount or lag: aggregates elsewhere in this file only ever summed
  // APPROVED rows, silently excluding anything still PENDING/RETURNED, and
  // production-stage mortality in particular was never queried by the batch
  // report at all. Once a report has been uploaded for a batch, its numbers
  // should be what the AI reasons over — not a reconstruction from whichever
  // system tables happen to be populated and approved.
  //
  // `range`, when given, restricts the rows summed to that window (calendar,
  // by row.date) — used by the weekly report to fold a batch's report data
  // into a specific week. Omitted entirely, every row on the report counts
  // — used by the on-demand per-batch report, which covers the batch's
  // whole lifecycle.
  //
  // Returns null when there is no report for the batch, the report was
  // REJECTED by the Director (nothing on it should be trusted), or (with a
  // range given) the report simply has no rows in that window — all of
  // which mean "fall back to system data" to the caller.
  private async getProductionReportMetrics(
    batchId: string,
    range?: { start: Date; end: Date },
  ): Promise<{
    fileName: string;
    uploadedAt: Date;
    status: string;
    rowCount: number;
    dateRange: { from: string; to: string } | null;
    totalFeedKg: number;
    totalMortality: number;
    totalCulling: number;
    avgWaterLts: number | null;
    avgTemperature: number | null;
    avgHumidity: number | null;
    latestAvgWeightG: number | null;
    latestWeightDate: string | null;
    openDiscrepancies: number;
    totalDiscrepancies: number;
  } | null> {
    const report = await this.prisma.storeProductionReport.findUnique({
      where: { batchId },
      select: {
        fileName: true, uploadedAt: true, status: true, rawRows: true, discrepancyCount: true,
        discrepancies: { select: { resolved: true } },
      },
    });
    // REJECTED = Director threw the whole upload out; nothing on it was
    // ever applied, so it must not be treated as a source of truth either.
    if (!report || report.status === 'REJECTED') return null;

    let rows = ((report.rawRows as any[]) ?? []).filter(r => r && typeof r.date === 'string');
    if (range) {
      const startStr = dayjs(range.start).format('YYYY-MM-DD');
      const endStr = dayjs(range.end).format('YYYY-MM-DD');
      rows = rows.filter(r => r.date >= startStr && r.date <= endStr);
    }

    const openDiscrepancies = report.discrepancies.filter(d => !d.resolved).length;
    const base = {
      fileName: report.fileName,
      uploadedAt: report.uploadedAt,
      status: report.status as string,
      openDiscrepancies,
      totalDiscrepancies: report.discrepancyCount,
    };

    if (rows.length === 0) {
      return {
        ...base, rowCount: 0, dateRange: null,
        totalFeedKg: 0, totalMortality: 0, totalCulling: 0,
        avgWaterLts: null, avgTemperature: null, avgHumidity: null,
        latestAvgWeightG: null, latestWeightDate: null,
      };
    }

    // Report cells can carry numbers as text (e.g. "612", "612 g") — parse
    // defensively rather than assuming a clean numeric type out of jsonb.
    const num = (v: unknown): number | null => {
      if (v == null || v === '') return null;
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
      return Number.isFinite(n) ? n : null;
    };
    const sum = (vals: Array<number | null>): number => vals.reduce<number>((s, v) => s + (v ?? 0), 0);
    const avgOfNonNull = (vals: Array<number | null>) => {
      const present = vals.filter((v): v is number => v != null);
      return present.length ? this.avgOf(present) : null;
    };

    const sorted = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const withWeight = sorted.filter(r => num(r.avgWeight) != null);
    const latestWeightRow = withWeight[withWeight.length - 1];

    return {
      ...base,
      rowCount: rows.length,
      dateRange: { from: sorted[0].date, to: sorted[sorted.length - 1].date },
      totalFeedKg: sum(rows.map(r => num(r.feedKg))),
      totalMortality: sum(rows.map(r => num(r.mortality))),
      totalCulling: sum(rows.map(r => num(r.culling))),
      avgWaterLts: avgOfNonNull(rows.map(r => num(r.waterLts))),
      avgTemperature: avgOfNonNull(rows.map(r => num(r.temperature))),
      avgHumidity: avgOfNonNull(rows.map(r => num(r.humidity))),
      latestAvgWeightG: latestWeightRow ? num(latestWeightRow.avgWeight) : null,
      latestWeightDate: latestWeightRow ? latestWeightRow.date : null,
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // AI-01 — Weekly Performance Report  (Monday 06:00)
  // ────────────────────────────────────────────────────────────────────────────
  @Cron('0 6 * * 1')
  async generateWeeklyReport() {
    this.logger.log('AI-01: Generating weekly performance report…');
    const weekEnd   = dayjs().subtract(1, 'day').endOf('day');
    const weekStart = weekEnd.subtract(6, 'day').startOf('day');
    const startDate = weekStart.toDate();
    const endDate = weekEnd.toDate();

    // ── Production reports first ─────────────────────────────────────────────
    // For every active batch, check whether Store has an uploaded production
    // report with rows falling in this week — if so, that batch's feed &
    // mortality figures for the week come from the report (Store-verified,
    // Director-reviewed) rather than from FeedIntakeLog/FlockDailyEntry,
    // which only ever counted APPROVED rows and could quietly under-report a
    // week where entries were still pending. Batches without report coverage
    // for this week still fall back to the system tables below.
    const activeBatches = await this.prisma.batch.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, currentBirdCount: true },
    });
    const prMetricsByBatch = await Promise.all(
      activeBatches.map(async b => ({
        batchId: b.id,
        metrics: await this.getProductionReportMetrics(b.id, { start: startDate, end: endDate }),
      })),
    );
    const reportCovered = prMetricsByBatch.filter(m => m.metrics && m.metrics.rowCount > 0);
    const reportCoveredBatchIds = reportCovered.map(m => m.batchId);
    const feedKgFromReports = reportCovered.reduce((s, m) => s + m.metrics!.totalFeedKg, 0);
    const mortFromReports   = reportCovered.reduce((s, m) => s + m.metrics!.totalMortality, 0);
    const openDiscrepanciesThisWeek = reportCovered.reduce((s, m) => s + m.metrics!.openDiscrepancies, 0);

    // ── Gather data ───────────────────────────────────────────────────────────
    // Feed/mortality here are scoped to batches NOT already covered by a
    // production report this week, so the two sources are additive rather
    // than double-counted.
    const [eggSessions, flockEntries, feedLogs, expenses, healthEvents, sales, breakages, feedDeliveries, completeness] =
      await Promise.all([
        this.prisma.eggCollectionSession.findMany({
          where: { sessionDate: { gte: startDate, lte: endDate }, status: EntryStatus.APPROVED, deletedAt: null },
          select: {
            sessionDate: true, shift: true, batchId: true, closingStock: true,
            totalGoodEggs: true, totalStarterEggs: true, totalFullTrays: true, totalBrokenEggs: true,
          },
        }),
        (this.prisma as any).flockDailyEntry.findMany({
          where: {
            entryDate: { gte: startDate, lte: endDate }, status: EntryStatus.APPROVED,
            ...(reportCoveredBatchIds.length ? { batchId: { notIn: reportCoveredBatchIds } } : {}),
          },
          select: { mortalityCount: true, mortalityCause: true },
        }),
        this.prisma.feedIntakeLog.findMany({
          where: {
            entryDate: { gte: startDate, lte: endDate }, status: EntryStatus.APPROVED,
            ...(reportCoveredBatchIds.length ? { batchId: { notIn: reportCoveredBatchIds } } : {}),
          },
          select: { quantityDispensedKg: true, feedType: true },
        }),
        this.prisma.expenseLog.findMany({
          where: { expenseDate: { gte: startDate, lte: endDate } },
          select: { amount: true, description: true },
        }),
        this.prisma.healthEvent.findMany({
          where: { eventDate: { gte: startDate, lte: endDate } },
          select: { eventType: true, affectedCount: true, symptoms: true },
        }),
        this.getSalesFinanceSummary(startDate, endDate),
        this.getBreakageSummary(startDate, endDate),
        this.getFeedDeliverySummary(startDate, endDate),
        this.getRoleDataCompleteness(startDate, endDate),
      ]);

    // ── Compute KPIs ──────────────────────────────────────────────────────────
    const totalEggs   = eggSessions.reduce((s, e) => s + e.totalGoodEggs, 0);
    const totalTrays  = eggSessions.reduce((s, e) => s + e.totalFullTrays, 0);
    const totalBroken = eggSessions.reduce((s, e) => s + (e.totalBrokenEggs ?? 0), 0);

    // FIX: was averaging raw per-session henDayPercent (mixes AM+PM rows as if
    // each were a full day). Now combines AM+PM per calendar day first.
    const dailyHdp = this.aggregateDailyHdp(eggSessions);
    const avgHdp = this.avgOf(dailyHdp.map(d => d.hdp));

    // Blend: production-report figures (reliable, for covered batches) +
    // system figures (fallback, for batches with no report covering this
    // week). Neither source is queried for both, so this is a plain sum.
    const mortFromSystem   = flockEntries.reduce((s: number, e: any) => s + e.mortalityCount, 0);
    const feedKgFromSystem = feedLogs.reduce((s, f) => s + Number(f.quantityDispensedKg), 0);
    const totalMort   = mortFromReports + mortFromSystem;
    const totalFeedKg = feedKgFromReports + feedKgFromSystem;
    const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
    // "Revenue" kept as cash actually collected (matches the existing frontend
    // chip), but the prompt below now also shows sales placed and invoiced.
    const totalRevenue = sales.cashCollected;
    const netIncome    = totalRevenue - totalExpenses;

    const totalBirds = activeBatches.reduce((s, b) => s + b.currentBirdCount, 0);
    const fcr = totalEggs > 0 ? (totalFeedKg / totalEggs).toFixed(3) : 'N/A';

    const rawData = {
      week: `${weekStart.format('D MMM')} – ${weekEnd.format('D MMM YYYY')}`,
      totalEggs, totalTrays,
      avgHdp: avgHdp.toFixed(1),
      dailyHdpDaysCounted: dailyHdp.length,
      totalMort,
      totalFeedKg: totalFeedKg.toFixed(1), fcr, totalRevenue, totalExpenses,
      netIncome, totalBirds, healthEvents: healthEvents.length,
      brokenEggPct: totalEggs > 0 ? ((totalBroken / (totalEggs + totalBroken)) * 100).toFixed(1) : '0',
      sales, breakages, feedDeliveries, completeness,
      // Data provenance for feed & mortality — see getProductionReportMetrics.
      productionReportCoverage: {
        batchesCovered: reportCoveredBatchIds.length,
        totalActiveBatches: activeBatches.length,
        feedKgFromReports: feedKgFromReports.toFixed(1),
        feedKgFromSystem: feedKgFromSystem.toFixed(1),
        mortFromReports,
        mortFromSystem,
        openDiscrepancies: openDiscrepanciesThisWeek,
      },
    };

    // ── Build prompt ──────────────────────────────────────────────────────────
    const prSourceNote = reportCoveredBatchIds.length
      ? `Feed and mortality figures below are drawn from the uploaded, Store-verified production report for ${reportCoveredBatchIds.length} of ${activeBatches.length} active batch(es) this week (the more reliable source), and from system entry logs for the remaining batch(es) that had no report covering this week.${openDiscrepanciesThisWeek > 0 ? ` Note: ${openDiscrepanciesThisWeek} open discrepancy(ies) on those production reports are still awaiting your review.` : ''}`
      : `No active batch had an uploaded production report covering this week, so feed and mortality figures below come from system entry logs.`;

    const prompt = `You are an expert poultry farm advisor. Write a concise weekly performance report for Anza Whole Foods farm in Kenya. Use plain English — no jargon. Address the Director directly. Be specific with numbers. End with 2-3 actionable recommendations.

WEEK: ${rawData.week}
DATA SOURCE NOTE: ${prSourceNote}
PRODUCTION: ${totalEggs.toLocaleString()} eggs · ${totalTrays} trays · Avg daily HDP ${avgHdp.toFixed(1)}% (AM+PM combined, based on ${dailyHdp.length} fully-recorded day(s)) · Broken egg rate ${rawData.brokenEggPct}%
FLOCK: ${totalBirds.toLocaleString()} birds · ${totalMort} mortalities this week
FEED CONSUMED: ${totalFeedKg.toFixed(1)} kg · FCR ${fcr} kg feed per egg
FEED PURCHASED: ${feedDeliveries.totalKg.toFixed(1)} kg across ${feedDeliveries.count} delivery(ies) · KES ${feedDeliveries.totalCost.toLocaleString()}
SALES: ${sales.ordersCount} order(s) placed worth KES ${sales.ordersValue.toLocaleString()} (${sales.cancelledOrders} cancelled) · KES ${sales.invoicedValue.toLocaleString()} invoiced · KES ${sales.cashCollected.toLocaleString()} cash collected this week
RECEIVABLES (as of today): KES ${sales.outstandingAR.toLocaleString()} outstanding, of which KES ${sales.overdueAR.toLocaleString()} is overdue
EXPENSES: KES ${totalExpenses.toLocaleString()} · Net cash position this week: KES ${netIncome.toLocaleString()}
BREAKAGE ADJUSTMENTS (post-collection, raised by Sales): ${breakages.count} adjustment(s), net change ${breakages.netDiff} eggs
HEALTH: ${healthEvents.length} health event(s) logged
DATA COMPLETENESS THIS WEEK — Egg collection: ${completeness.eggCollection.pending} pending approval, ${completeness.eggCollection.returned} returned for correction. Flock entries: ${completeness.flockEntries.pending} pending, ${completeness.flockEntries.returned} returned. Feed logs: ${completeness.feedLogs.pending} pending, ${completeness.feedLogs.returned} returned. Three-way tally sign-off (Manager+Sales+Store): ${completeness.tallySignOff.fullySigned}/${completeness.tallySignOff.total} fully signed.

Format: one-sentence overall summary, then short paragraphs covering production, feed & flock health, finance (sales, receivables, expenses), and — only if something stands out — a brief note on data-entry discipline across roles. End with "Recommended actions:" as a short bulleted list. Keep the ENTIRE response under 400 words — be concise enough to finish completely rather than running long and getting cut off.`;

    const content = await this.callClaude(prompt, 1100);
    if (!content) return null;

    // ── Save and notify ───────────────────────────────────────────────────────
    const report = await this.prisma.aiReport.create({
      data: {
        reportType: 'WEEKLY_PERFORMANCE',
        weekEnding: weekEnd.toDate(),
        content,
        rawData,
      },
    });

    await this.notifications.notifyRole(
      UserRole.OWNER,
      NotificationType.AI_REPORT_READY,
      'Weekly Farm Report Ready',
      `Your AI performance report for ${rawData.week} is ready to view.`,
      { entityId: report.id, entityType: 'AiReport' },
    );
    this.logger.log('AI-01: Weekly report generated and Owner notified');
    return report;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // AI-02 — Feed Purchase Alert  (runs nightly at 01:30, after overdue cron)
  // ── AI-02 Note ──────────────────────────────────────────────────────────────
  // Feed Purchase Alert is handled by FeedService.checkFeedStock() cron (06:00 daily).
  // That cron creates FeedStockSnapshot records with alertFired flag and notifies
  // Manager and Owner. No duplicate implementation needed here.

  // ────────────────────────────────────────────────────────────────────────────
  // AI-03 — Mortality Anomaly Alert  (triggered on entry verification, not cron)
  // Called from FlockService.verifyEntry after approval
  // ────────────────────────────────────────────────────────────────────────────
  async checkMortalityAnomaly(batchId: string, todayMortality: number) {
    const pctThreshold = this.config.get<number>('MORTALITY_ALERT_PCT_ABOVE_AVG') ?? 15;

    // 14-day rolling average for this batch
    const cutoff = dayjs().subtract(14, 'day').toDate();
    const recent = await (this.prisma as any).flockDailyEntry.findMany({
      where: {
        batchId,
        status: EntryStatus.APPROVED,
        entryDate: { gte: cutoff },
      },
      select: { mortalityCount: true },
      orderBy: { entryDate: 'desc' },
    });

    if (recent.length < 3) return; // not enough data

    const avg = recent.reduce((s: number, e: any) => s + e.mortalityCount, 0) / recent.length;
    if (avg === 0) return;

    const pctAbove = ((todayMortality - avg) / avg) * 100;
    if (pctAbove < pctThreshold) return;

    const batch = await this.prisma.batch.findUnique({
      where: { id: batchId },
      select: { batchCode: true, house: { select: { name: true } } },
    });

    const message = `Mortality spike detected in ${batch?.batchCode} (${batch?.house?.name}): ${todayMortality} deaths today vs 14-day average of ${avg.toFixed(1)}. This is ${pctAbove.toFixed(0)}% above normal — immediate investigation recommended.`;

    await this.notifications.notifyRole(UserRole.MANAGER, NotificationType.MORTALITY_ANOMALY, 'Mortality Spike Alert', message);
    await this.notifications.notifyRole(UserRole.OWNER,   NotificationType.MORTALITY_ANOMALY, 'Mortality Spike Alert', message);
    this.logger.warn(`AI-03: Mortality spike in batch ${batch?.batchCode}: ${pctAbove.toFixed(0)}% above avg`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // AI-04 — Disease Pattern Analysis  (Weekly, Wednesday 07:00)
  // ────────────────────────────────────────────────────────────────────────────
  @Cron('0 7 * * 3')
  async analyseDisasePatterns() {
    this.logger.log('AI-04: Running disease pattern analysis…');
    if (!this.anthropic) return;

    const since = dayjs().subtract(90, 'day').toDate();

    const [healthEvents, flockEntries, vaccinations] = await Promise.all([
      this.prisma.healthEvent.findMany({
        where: { eventDate: { gte: since } },
        include: { batch: { select: { batchCode: true, house: { select: { name: true } } } } },
        orderBy: { eventDate: 'asc' },
      }),
      (this.prisma as any).flockDailyEntry.findMany({
        where: { entryDate: { gte: since }, status: EntryStatus.APPROVED, mortalityCount: { gt: 5 } },
        select: { entryDate: true, mortalityCount: true, mortalityCause: true, batchId: true },
        orderBy: { entryDate: 'asc' },
      }),
      this.prisma.vaccinationRecord.findMany({
        where: { administeredDate: { gte: since } },
        select: { vaccineName: true, administeredDate: true, batchId: true },
      }),
    ]);

    if (healthEvents.length === 0 && flockEntries.length === 0) {
      this.logger.log('AI-04: No health data to analyse');
      return;
    }

    const eventSummary = healthEvents
      .map((e: any) => `${dayjs(e.eventDate).format('D MMM')}: ${e.eventType} in ${e.batch?.batchCode} — ${e.symptoms ?? 'no symptoms noted'}`)
      .join('\n');

    const mortalitySummary = flockEntries
      .map((e: any) => `${dayjs(e.entryDate).format('D MMM')}: ${e.mortalityCount} deaths (cause: ${e.mortalityCause ?? 'unknown'})`)
      .join('\n');

    const prompt = `You are a poultry health expert. Analyse the last 90 days of health data from Anza Whole Foods farm in Kenya and identify any concerning patterns. Be specific and practical.

HEALTH EVENTS (${healthEvents.length} total):
${eventSummary || 'None recorded'}

HIGH MORTALITY DAYS (>5 birds):
${mortalitySummary || 'None recorded'}

VACCINATIONS: ${vaccinations.length} vaccination records in period

Identify: (1) any recurring disease patterns, (2) correlation between health events and mortality spikes, (3) any vaccination gaps. 
Write 2-3 short paragraphs. If no concerning patterns exist, say so clearly. End with 1-2 specific preventive recommendations. Be concise.`;

    const content = await this.callClaude(prompt, 500);
    if (!content) return;

    const hasPattern = !content.toLowerCase().includes('no concerning') &&
                       !content.toLowerCase().includes('no significant');

    if (hasPattern) {
      const report = await this.prisma.aiReport.create({
        data: {
          reportType: 'DISEASE_PATTERN',
          content,
          rawData: { healthEventCount: healthEvents.length, highMortalityDays: flockEntries.length },
        },
      });
      await this.notifications.notifyRole(
        UserRole.OWNER,
        NotificationType.AI_REPORT_READY,
        'Disease Pattern Analysis',
        'AI has identified health patterns that may require attention. View the full analysis in your reports.',
        { entityId: report.id, entityType: 'AiReport' },
      );
    }
    this.logger.log('AI-04: Disease pattern analysis complete');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // AI-05 — Batch Closure Forecast  (Daily 08:00, only when batch is mature)
  // ────────────────────────────────────────────────────────────────────────────
  @Cron('0 8 * * *')
  async generateBatchForecasts() {
    this.logger.log('AI-05: Running batch closure forecasts…');
    if (!this.anthropic) return;

    // Only run on batches that are in PRODUCTION stage for > 50 weeks (Kienyeji) or > 60 weeks (layers)
    const matureBatches = await this.prisma.batch.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        stage: BatchStage.PRODUCTION,
      },
      include: {
        eggCollectionSessions: {
          where: { status: EntryStatus.APPROVED },
          // FIX: was take 14 → only ~7 days of AM+PM rows. Bumped so there's
          // enough raw rows to reliably reconstruct 14 full combined days.
          select: { sessionDate: true, shift: true, totalGoodEggs: true, totalStarterEggs: true, closingStock: true },
          orderBy: { sessionDate: 'desc' },
          take: 40,
        },
        feedIntakeLogs: {
          where: { status: EntryStatus.APPROVED },
          select: { quantityDispensedKg: true },
          orderBy: { entryDate: 'desc' },
          take: 30,
        },
        house: { select: { name: true } },
      },
    });

    for (const batch of matureBatches) {
      const ageWeeks = dayjs().diff(dayjs(batch.dateReceived), 'week');
      if (ageWeeks < 50) continue; // too young for closure forecast

      // FIX: was averaging raw per-session henDayPercent across the most
      // recent 14 ROWS (a mix of AM and PM), which understates real HDP by
      // roughly half. Now combine AM+PM into real days first, then require
      // at least 7 fully-recorded days before forecasting.
      const dailyHdp = this.aggregateDailyHdp(batch.eggCollectionSessions);
      if (dailyHdp.length < 7) continue; // not enough complete daily data

      const last14Days = dailyHdp.slice(-14);
      const avgHdp = this.avgOf(last14Days.map(d => d.hdp));
      const totalFeedKg = batch.feedIntakeLogs.reduce((s, f) => s + Number(f.quantityDispensedKg), 0);
      const totalEggs = batch.eggCollectionSessions.reduce((s, e) => s + e.totalGoodEggs, 0);
      const fcr = totalEggs > 0 ? (totalFeedKg / totalEggs).toFixed(3) : 'N/A';

      // Check if we already generated a forecast this week
      const existingForecast = await this.prisma.aiReport.findFirst({
        where: {
          reportType: 'BATCH_CLOSURE_FORECAST',
          rawData: { path: ['batchId'], equals: batch.id },
          generatedAt: { gte: dayjs().subtract(7, 'day').toDate() },
        },
      });
      if (existingForecast) continue;

      const prompt = `You are a commercial poultry expert. Advise on batch closure timing for Anza Whole Foods farm in Kenya.

BATCH: ${batch.batchCode} (${batch.birdType}) in ${batch.house.name}
AGE: ${ageWeeks} weeks
CURRENT BIRDS: ${batch.currentBirdCount.toLocaleString()}
AVG HDP (last ${last14Days.length} fully-recorded day(s), AM+PM combined): ${avgHdp.toFixed(1)}%
FCR: ${fcr} kg feed per egg
PLACEMENT DATE: ${dayjs(batch.dateReceived).format('D MMM YYYY')}

Based on this data, provide: (1) whether this batch should be closed now, in 4-8 weeks, or continue beyond 8 weeks, with reasoning, (2) the key metric that will signal when to close (HDP threshold or age milestone), (3) one operational note for the manager. Keep response to 3 short paragraphs. Be direct and specific.`;

      const content = await this.callClaude(prompt, 450);
      if (!content) continue;

      const report = await this.prisma.aiReport.create({
        data: {
          reportType: 'BATCH_CLOSURE_FORECAST',
          content,
          rawData: { batchId: batch.id, batchCode: batch.batchCode, ageWeeks, avgHdp: avgHdp.toFixed(1), fcr },
        },
      });

      await this.notifications.notifyRole(
        UserRole.OWNER,
        NotificationType.AI_REPORT_READY,
        `Batch Forecast: ${batch.batchCode}`,
        `AI closure forecast for ${batch.batchCode} (${ageWeeks} weeks, HDP ${avgHdp.toFixed(1)}%) is ready.`,
        { entityId: report.id, entityType: 'AiReport' },
      );
    }
    this.logger.log('AI-05: Batch forecasts complete');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // AI-06 — AI Improvement Suggestions  (Friday 07:00)
  // ────────────────────────────────────────────────────────────────────────────
  @Cron('0 7 * * 5')
  async generateImprovementSuggestions() {
    this.logger.log('AI-06: Generating improvement suggestions…');
    if (!this.anthropic) return;

    const since30 = dayjs().subtract(30, 'day').toDate();
    const now = new Date();

    const [batches, feedLogs, sessions, healthChecklists, breakages, completeness] = await Promise.all([
      this.prisma.batch.findMany({
        where: { isActive: true, deletedAt: null },
        include: {
          eggCollectionSessions: {
            where: { sessionDate: { gte: since30 }, status: EntryStatus.APPROVED },
            select: { sessionDate: true, shift: true, totalGoodEggs: true, totalStarterEggs: true, closingStock: true },
            orderBy: { sessionDate: 'desc' },
          },
          house: { select: { name: true } },
        },
      }),
      this.prisma.feedIntakeLog.findMany({
        where: { entryDate: { gte: since30 }, status: EntryStatus.APPROVED },
        select: { quantityDispensedKg: true, feedType: true, batchId: true },
      }),
      this.prisma.eggCollectionSession.findMany({
        where: { sessionDate: { gte: since30 }, status: EntryStatus.APPROVED },
        select: { totalBrokenEggs: true, totalGoodEggs: true, sessionDate: true },
        orderBy: { sessionDate: 'desc' },
        take: 60,
      }),
      this.prisma.healthChecklist.findMany({
        where: { checkDate: { gte: since30 } },
        select: { checks: true },
        take: 60,
      }),
      this.getBreakageSummary(since30, now),
      this.getRoleDataCompleteness(since30, now),
    ]);

    // Build per-batch HDP summary
    // FIX: was averaging raw per-session henDayPercent per batch (mixing AM
    // and PM rows). Now combines AM+PM per day first, then averages those.
    const batchSummaries = batches.map(b => {
      const dailyHdp = this.aggregateDailyHdp(b.eggCollectionSessions);
      const avgHdp = dailyHdp.length ? this.avgOf(dailyHdp.map(d => d.hdp)).toFixed(1) : 'N/A';
      return `${b.batchCode} (${b.house.name}): HDP ${avgHdp}%`;
    }).join(', ');

    const brokenPct = sessions.length
      ? ((sessions.reduce((s,e)=>s+(e.totalBrokenEggs??0),0) /
          Math.max(1, sessions.reduce((s,e)=>s+e.totalGoodEggs+(e.totalBrokenEggs??0),0))) * 100).toFixed(1)
      : '0';

    // Count checklist failures
    let checklistFailures = 0;
    for (const cl of healthChecklists) {
      const checks = cl.checks as Record<string, string>;
      checklistFailures += Object.values(checks).filter(v => v === 'FAIL').length;
    }

    const totalFeedKg = feedLogs.reduce((s: number, f: any) => s + Number(f.quantityDispensedKg), 0);
    const totalEggs   = sessions.reduce((s, e) => s + e.totalGoodEggs, 0);
    const overallFcr  = totalEggs > 0 ? (totalFeedKg / totalEggs).toFixed(3) : 'N/A';

    const prompt = `You are a poultry farm improvement advisor for Anza Whole Foods, a commercial egg farm in Kenya. Review the last 30 days of operational data and provide 3-5 specific, actionable improvement suggestions.

PRODUCTION SUMMARY (last 30 days):
- Batch HDP rates (AM+PM combined daily): ${batchSummaries}
- Broken egg rate at collection: ${brokenPct}%
- Post-collection breakage adjustments raised by Sales: ${breakages.count} adjustment(s), net change ${breakages.netDiff} eggs
- Overall FCR: ${overallFcr} kg feed per egg
- Health checklist failures: ${checklistFailures} across ${healthChecklists.length} checklists
- Feed consumed: ${totalFeedKg.toFixed(0)} kg total
- Eggs collected: ${totalEggs.toLocaleString()}
- Data completeness: egg collection ${completeness.eggCollection.pending} pending / ${completeness.eggCollection.returned} returned; flock entries ${completeness.flockEntries.pending} pending / ${completeness.flockEntries.returned} returned; feed logs ${completeness.feedLogs.pending} pending / ${completeness.feedLogs.returned} returned; tally sign-off ${completeness.tallySignOff.fullySigned}/${completeness.tallySignOff.total} fully completed by Manager, Sales and Store

Provide 3-5 improvement suggestions. Each should be: (a) specific to the data above, not generic advice, (b) actionable in the next 2 weeks, (c) one sentence of context + one sentence of recommended action. Where the data shows a role consistently lagging on approvals or sign-offs, include that as one of the suggestions. Format as a numbered list. Do not include suggestions where the data shows no issue. Keep the ENTIRE response under 350 words — be concise enough to finish completely rather than running long and getting cut off.`;

    const content = await this.callClaude(prompt, 750);
    if (!content) return;

    const report = await this.prisma.aiReport.create({
      data: {
        reportType: 'IMPROVEMENT_SUGGESTIONS',
        content,
        rawData: { batchSummaries, brokenPct, overallFcr, checklistFailures, breakages, completeness },
      },
    });

    await this.notifications.notifyRole(
      UserRole.OWNER,
      NotificationType.AI_REPORT_READY,
      'Weekly Improvement Suggestions',
      'AI has reviewed the last 30 days and generated improvement recommendations.',
      { entityId: report.id, entityType: 'AiReport' },
    );
    this.logger.log('AI-06: Improvement suggestions generated');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // API: Get all AI reports for Director  (paginated, newest first)
  // ────────────────────────────────────────────────────────────────────────────
  async getReports(page = 1, limit = 20, type?: string) {
    const skip = (page - 1) * limit;
    const where = type ? { reportType: type } : {};

    const [reports, total] = await Promise.all([
      this.prisma.aiReport.findMany({
        where,
        orderBy: { generatedAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          reportType: true,
          weekEnding: true,
          content: true,
          rawData: true,
          generatedAt: true,
        },
      }),
      this.prisma.aiReport.count({ where }),
    ]);

    return { reports, total, page, limit };
  }

  async getLatestSummary(): Promise<{ content: string; generatedAt: string } | null> {
    const latest = await this.prisma.aiReport.findFirst({
      where: { reportType: 'WEEKLY_PERFORMANCE' },
      orderBy: { generatedAt: 'desc' },
      select: { content: true, generatedAt: true },
    });
    if (!latest) return null;
    // Return first 300 chars as summary
    return {
      content: latest.content.slice(0, 300),
      generatedAt: latest.generatedAt.toISOString(),
    };
  }

  // Manually trigger weekly report (for testing / Director on-demand)
  async triggerWeeklyReport() {
    if (!this.anthropic) {
      throw new BadRequestException('AI reporting is not configured on this server (ANTHROPIC_API_KEY is not set). Contact your administrator.');
    }
    const report = await this.generateWeeklyReport();
    if (!report) {
      throw new BadRequestException('The AI service did not return a report. Please try again in a moment.');
    }
    return { triggered: true, reportId: report.id };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Helper: pull EVERY brooder-stage data point recorded for a batch and
  // compute the comparisons a director actually needs to spot a problem.
  //
  // Before this existed, generateBatchReport only ever looked at
  // EggCollectionSession + FeedIntakeLog + Batch.currentBirdCount — none of
  // which are even populated while a batch is in the brooder. Meanwhile 11
  // separate tables (BrooderLog, BrooderTreatmentLog, BrooderHeatLog,
  // BrooderLevelFeedLog, BrooderGeneralFeedLog, BrooderLevelMortalityLog,
  // BrooderGeneralMortalityLog, BirdWeightSample, VaccinationRecord,
  // VaccinationSchedule, HealthEvent) sat completely unused by any report.
  // That's exactly why the Director's brooder-batch reports read as shallow —
  // the model was never given the data to analyse in the first place, no
  // matter how capable it is.
  //
  // This pulls all of it for one batch and pre-computes the comparisons that
  // actually reveal gaps/issues (mortality vs the HyLine control-standard
  // ceiling, weight vs the expected band for that age, vaccines due vs
  // vaccines actually given, environmental log completeness), so the prompt
  // can ask the model to reason over real numbers instead of guessing.
  // ────────────────────────────────────────────────────────────────────────────
  private async getBrooderDeepDive(batch: {
    id: string;
    birdType: string;
    quantityReceived: number;
    dateReceived: Date;
  }) {
    const batchId = batch.id;
    const ageWeeks = dayjs().diff(dayjs(batch.dateReceived), 'week');
    const ageDays = dayjs().diff(dayjs(batch.dateReceived), 'day');

    const [
      brooderLogs,
      levelAssignments,
      generalFeedLogs,
      levelMortalityLogs,
      generalMortalityLogs,
      treatmentLogs,
      weightSamples,
      vaccinationRecords,
      vaccinationSchedule,
      healthEvents,
      controlStandards,
    ] = await Promise.all([
      this.prisma.brooderLog.findMany({
        where: { batchId },
        select: { logDate: true, temperature: true, humidityPercent: true, waterConsumptionL: true, lightIntensityLux: true, lightingOk: true },
        orderBy: { logDate: 'asc' },
      }),
      this.prisma.brooderLevelAssignment.findMany({
        where: { batchId },
        select: {
          levelId: true, birdCount: true, placedDate: true,
          level: { select: { label: true, row: { select: { label: true } } } },
        },
      }),
      this.prisma.brooderGeneralFeedLog.findMany({
        where: { batchId },
        select: { entryDate: true, quantityDispensedKg: true, requiredKgForDay: true },
      }),
      this.prisma.brooderLevelMortalityLog.findMany({
        where: { batchId },
        select: { logDate: true, mortalityCount: true, cullingCount: true, cause: true },
      }),
      this.prisma.brooderGeneralMortalityLog.findMany({
        where: { batchId },
        select: { logDate: true, mortalityCount: true, cullingCount: true, cause: true },
      }),
      this.prisma.brooderTreatmentLog.findMany({
        where: { batchId },
        select: { treatmentDate: true, drugName: true, dose: true, doseUnit: true, route: true, durationDays: true },
        orderBy: { treatmentDate: 'desc' },
      }),
      this.prisma.birdWeightSample.findMany({
        where: { batchId },
        select: { sampleDate: true, averageWeightG: true, ageWeeks: true, sampleCount: true },
        orderBy: { sampleDate: 'desc' },
        take: 12,
      }),
      this.prisma.vaccinationRecord.findMany({
        where: { batchId },
        select: { vaccineName: true, administeredDate: true, route: true },
        orderBy: { administeredDate: 'asc' },
      }),
      this.prisma.vaccinationSchedule.findMany({
        where: { birdType: batch.birdType as any, isActive: true },
        select: { vaccineName: true, ageWeeks: true, route: true },
        orderBy: { ageWeeks: 'asc' },
      }),
      this.prisma.healthEvent.findMany({
        where: { batchId },
        select: { eventType: true, eventDate: true, affectedCount: true, symptoms: true, diagnosis: true, treatment: true, outcome: true, isResolved: true },
        orderBy: { eventDate: 'desc' },
      }),
      this.prisma.brooderControlStandard.findMany({
        select: { week: true, expectedWeightMinG: true, expectedWeightMaxG: true, cumulativeMortalityPct: true, feedingGramsPerBird: true },
        orderBy: { week: 'asc' },
      }),
    ]);

    // Per-level feed logs need the level IDs from the assignments above.
    const levelIds = levelAssignments.map(a => a.levelId);
    const levelFeedLogs = levelIds.length
      ? await this.prisma.brooderLevelFeedLog.findMany({
          where: { levelId: { in: levelIds } },
          select: { entryDate: true, quantityDispensedKg: true, requiredKgForWeek: true },
        })
      : [];

    // ── Environmental completeness & readings ─────────────────────────────
    const tempReadings = brooderLogs.map(l => l.temperature).filter((t): t is number => t != null);
    const humidityReadings = brooderLogs.map(l => l.humidityPercent).filter((h): h is number => h != null);
    const lightingIssues = brooderLogs.filter(l => l.lightingOk === false).length;
    // Brooder logs are expected up to 3x/day (AM/midday/PM); use that as the
    // ceiling for a rough completeness ratio rather than a hard requirement.
    const expectedEnvLogs = Math.max(1, ageDays * 3);
    const envCompletenessPct = Math.min(100, Math.round((brooderLogs.length / expectedEnvLogs) * 100));

    // ── Feed vs required ration (level + general, kept separate — the two
    // are mutually exclusive per batch+date by design, so summing both
    // dispensed totals is safe and won't double count) ────────────────────
    const totalFeedDispensedKg =
      levelFeedLogs.reduce((s, f) => s + f.quantityDispensedKg, 0) +
      generalFeedLogs.reduce((s, f) => s + f.quantityDispensedKg, 0);
    const feedEntryCount = levelFeedLogs.length + generalFeedLogs.length;

    // ── Mortality & culling vs the HyLine control-standard ceiling ─────────
    const totalMortality =
      levelMortalityLogs.reduce((s, m) => s + m.mortalityCount, 0) +
      generalMortalityLogs.reduce((s, m) => s + m.mortalityCount, 0);
    const totalCulling =
      levelMortalityLogs.reduce((s, m) => s + m.cullingCount, 0) +
      generalMortalityLogs.reduce((s, m) => s + m.cullingCount, 0);
    const cumulativeMortalityPct = batch.quantityReceived > 0
      ? (totalMortality / batch.quantityReceived) * 100
      : 0;
    const causeCounts = new Map<string, number>();
    for (const m of [...levelMortalityLogs, ...generalMortalityLogs]) {
      if (!m.cause) continue;
      causeCounts.set(m.cause, (causeCounts.get(m.cause) ?? 0) + m.mortalityCount);
    }
    const currentStandard = controlStandards.find(s => s.week === Math.min(19, Math.max(1, ageWeeks)));
    const mortalityCeilingPct = currentStandard ? Number(currentStandard.cumulativeMortalityPct) : null;
    const mortalityOverCeiling = mortalityCeilingPct != null && cumulativeMortalityPct > mortalityCeilingPct;

    // ── Bird weight vs expected band for the batch's current age ───────────
    const latestWeight = weightSamples[0] ?? null;
    const weightStandard = latestWeight
      ? controlStandards.find(s => s.week === Math.min(19, Math.max(1, latestWeight.ageWeeks)))
      : null;
    const weightBandStatus = latestWeight && weightStandard
      ? (Number(latestWeight.averageWeightG) < Number(weightStandard.expectedWeightMinG) ? 'BELOW_BAND'
        : Number(latestWeight.averageWeightG) > Number(weightStandard.expectedWeightMaxG) ? 'ABOVE_BAND'
        : 'WITHIN_BAND')
      : 'NO_DATA';

    // ── Vaccination coverage gaps ───────────────────────────────────────────
    const givenNames = new Set(vaccinationRecords.map(v => v.vaccineName.toLowerCase().trim()));
    const dueVaccines = vaccinationSchedule.filter(s => s.ageWeeks <= ageWeeks);
    const missedVaccines = dueVaccines.filter(s => !givenNames.has(s.vaccineName.toLowerCase().trim()));

    // ── Health events & treatments ──────────────────────────────────────────
    const unresolvedHealthEvents = healthEvents.filter(e => !e.isResolved);

    return {
      ageWeeks, ageDays,
      environment: {
        logCount: brooderLogs.length,
        expectedLogCount: expectedEnvLogs,
        completenessPct: envCompletenessPct,
        avgTemp: this.avgOf(tempReadings),
        minTemp: tempReadings.length ? Math.min(...tempReadings) : null,
        maxTemp: tempReadings.length ? Math.max(...tempReadings) : null,
        avgHumidity: this.avgOf(humidityReadings),
        lightingIssues,
      },
      feed: {
        totalDispensedKg: totalFeedDispensedKg,
        entryCount: feedEntryCount,
      },
      mortality: {
        total: totalMortality,
        culling: totalCulling,
        cumulativePct: cumulativeMortalityPct,
        ceilingPct: mortalityCeilingPct,
        overCeiling: mortalityOverCeiling,
        byCause: Array.from(causeCounts.entries()).map(([cause, count]) => ({ cause, count })),
      },
      weight: latestWeight ? {
        sampleDate: latestWeight.sampleDate,
        averageWeightG: Number(latestWeight.averageWeightG),
        ageWeeks: latestWeight.ageWeeks,
        sampleCount: latestWeight.sampleCount,
        expectedMinG: weightStandard ? Number(weightStandard.expectedWeightMinG) : null,
        expectedMaxG: weightStandard ? Number(weightStandard.expectedWeightMaxG) : null,
        status: weightBandStatus,
      } : null,
      vaccination: {
        given: vaccinationRecords.map(v => ({ name: v.vaccineName, date: v.administeredDate, route: v.route })),
        missed: missedVaccines.map(s => ({ name: s.vaccineName, dueAtWeek: s.ageWeeks, route: s.route })),
      },
      health: {
        totalEvents: healthEvents.length,
        unresolved: unresolvedHealthEvents.map(e => ({
          type: e.eventType, date: e.eventDate, affected: e.affectedCount, symptoms: e.symptoms,
        })),
      },
      treatments: treatmentLogs.map(t => ({
        date: t.treatmentDate, drug: t.drugName, dose: `${t.dose}${t.doseUnit}`, route: t.route, durationDays: t.durationDays,
      })),
      levelsOccupied: levelAssignments.map(a => `${a.level.row.label}/${a.level.label} (${a.birdCount} birds)`),
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // On-demand: generate a report for ONE specific batch (active or recently
  // closed/sold/discarded). Unlike the AI-05 cron (generateBatchForecasts),
  // this has NO age/stage/data-volume gating — it works for any existing
  // batch, using whatever production/feed data is actually available, and
  // says so plainly in the report when a metric has no data yet.
  // ────────────────────────────────────────────────────────────────────────────
  async generateBatchReport(batchId: string) {
    if (!this.anthropic) {
      throw new BadRequestException('AI reporting is not configured on this server (ANTHROPIC_API_KEY is not set). Contact your administrator.');
    }

    const batch = await this.prisma.batch.findUnique({
      where: { id: batchId },
      include: { house: { select: { name: true } } },
    });
    if (!batch) throw new NotFoundException('Batch not found');

    // ── Gather data ───────────────────────────────────────────────────────────
    // Split into (a) status breakdown — ALL sessions/logs regardless of
    // approval state, used for the data-completeness note, and (b) the
    // approved-only detail rows used for the actual production/feed figures.
    const [
      eggStatusCounts, approvedSessions,
      feedStatusCounts, approvedFeed,
      flockStatusCounts,
      allSessionIds,
    ] = await Promise.all([
      this.prisma.eggCollectionSession.groupBy({
        by: ['status'],
        where: { batchId, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.eggCollectionSession.findMany({
        where: { batchId, status: EntryStatus.APPROVED, deletedAt: null },
        select: { sessionDate: true, shift: true, totalGoodEggs: true, totalStarterEggs: true, closingStock: true },
        orderBy: { sessionDate: 'desc' },
        take: 60,
      }),
      this.prisma.feedIntakeLog.groupBy({
        by: ['status'],
        where: { batchId },
        _count: { _all: true },
      }),
      this.prisma.feedIntakeLog.findMany({
        where: { batchId, status: EntryStatus.APPROVED },
        select: { quantityDispensedKg: true },
        orderBy: { entryDate: 'desc' },
        take: 60,
      }),
      (this.prisma as any).flockDailyEntry.groupBy({
        by: ['status'],
        where: { batchId },
        _count: { _all: true },
      }),
      this.prisma.eggCollectionSession.findMany({
        where: { batchId, deletedAt: null },
        select: { id: true },
      }),
    ]);

    const storeDiscrepancies = allSessionIds.length
      ? await this.prisma.storeEggIntake.count({
          where: { sessionId: { in: allSessionIds.map(s => s.id) }, hasDiscrepancy: true },
        })
      : 0;

    const countOf = (rows: Array<{ status: string; _count: { _all: number } }>, status: string) =>
      rows.find(r => r.status === status)?._count._all ?? 0;

    const ageWeeks = dayjs().diff(dayjs(batch.dateReceived), 'week');

    // FIX: was averaging raw per-session henDayPercent across the 30 most
    // recent ROWS (a mix of AM and PM) — this is exactly what produced the
    // understated HDP (e.g. 36.6% instead of a true ~70%) seen in reports.
    // Now combines AM+PM into real days first.
    const dailyHdp = this.aggregateDailyHdp(approvedSessions);
    const avgHdp = dailyHdp.length ? this.avgOf(dailyHdp.map(d => d.hdp)) : null;

    // ── Prefer the uploaded, Store-verified production report over system
    // tables wherever it covers the same ground — see getProductionReportMetrics
    // for why. Covers the batch's ENTIRE lifecycle (no date range given), since
    // this on-demand report is a full-batch review, not a period snapshot.
    const prMetrics = await this.getProductionReportMetrics(batch.id);
    const hasProductionReport = !!prMetrics && prMetrics.rowCount > 0;

    // FEED: the production report's total covers brooder + production-house
    // feed together and every day Store recorded, not just APPROVED
    // FeedIntakeLog rows — use it as the single feed figure when available.
    const systemProductionHouseFeedKg = approvedFeed.reduce((s, f) => s + Number(f.quantityDispensedKg), 0);
    const totalFeedKg = hasProductionReport ? prMetrics!.totalFeedKg : systemProductionHouseFeedKg;
    const feedDataSource: 'production_report' | 'system' = hasProductionReport ? 'production_report' : 'system';

    const totalEggs = approvedSessions.reduce((s, e) => s + e.totalGoodEggs, 0);
    const fcr = totalEggs > 0 ? (totalFeedKg / totalEggs).toFixed(3) : null;
    const survivalRate = batch.quantityReceived > 0
      ? ((batch.currentBirdCount / batch.quantityReceived) * 100).toFixed(1)
      : null;

    const eggPending = countOf(eggStatusCounts as any, 'PENDING');
    const eggReturned = countOf(eggStatusCounts as any, 'RETURNED');
    const feedPending = countOf(feedStatusCounts as any, 'PENDING');
    const feedReturned = countOf(feedStatusCounts as any, 'RETURNED');
    const flockPending = countOf(flockStatusCounts as any, 'PENDING');
    const flockReturned = countOf(flockStatusCounts as any, 'RETURNED');
    const completenessFlags =
      eggPending + eggReturned + feedPending + feedReturned + flockPending + flockReturned + storeDiscrepancies > 0;

    const statusNote = !batch.isActive
      ? `This batch is CLOSED (stage: ${batch.stage}).` +
        (batch.soldAt ? ` Sold ${dayjs(batch.soldAt).format('D MMM YYYY')}.` : '') +
        (batch.discardedAt ? ` Discarded ${dayjs(batch.discardedAt).format('D MMM YYYY')}.` : '') +
        (batch.closedAt ? ` Closed ${dayjs(batch.closedAt).format('D MMM YYYY')}.` : '')
      : `This batch is currently ACTIVE, in the ${batch.stage} stage.`;

    // ── Brooder deep-dive: every environment, feed, mortality, weight,
    // vaccination, health and treatment data point recorded for this batch.
    // Populated regardless of current stage — a GROWER/PRODUCTION batch still
    // has a brooding history worth reporting gaps in, and it's simply empty
    // arrays for a batch that never had brooder data logged.
    const bd = await this.getBrooderDeepDive(batch);

    // MORTALITY/CULLING: the production report's totals cover the batch's
    // FULL lifecycle (brooder AND production stage) — bd.mortality only ever
    // covers the brooder-stage tables and has no source at all for
    // production-stage mortality, so once a report exists it is materially
    // more complete, not merely a duplicate of the same numbers.
    const totalMortality = hasProductionReport ? prMetrics!.totalMortality : bd.mortality.total;
    const totalCulling = hasProductionReport ? prMetrics!.totalCulling : bd.mortality.culling;
    const cumulativeMortalityPct = batch.quantityReceived > 0 ? (totalMortality / batch.quantityReceived) * 100 : 0;
    // The ceiling itself is a fixed HyLine control-standard constant for the
    // batch's current age, independent of which data source fed totalMortality.
    const mortalityCeilingPct = bd.mortality.ceilingPct;
    const mortalityOverCeiling = mortalityCeilingPct != null && cumulativeMortalityPct > mortalityCeilingPct;
    const mortalityDataSource: 'production_report' | 'system' = hasProductionReport ? 'production_report' : 'system';

    // BIRD WEIGHT: prefer the report's most recent reading (Store-verified,
    // logged more consistently) over the system's BirdWeightSample. The
    // report doesn't record an age at time of sampling, so an expected-band
    // comparison is only shown when the reading actually came from a system
    // sample that carries one — the report's raw figure is still reported,
    // just without inventing a band comparison it can't support.
    const weightSource: 'production_report' | 'system' | 'none' =
      hasProductionReport && prMetrics!.latestAvgWeightG != null ? 'production_report'
      : bd.weight ? 'system' : 'none';
    const weightValueG = weightSource === 'production_report' ? prMetrics!.latestAvgWeightG : bd.weight?.averageWeightG ?? null;
    const weightDateLabel = weightSource === 'production_report'
      ? dayjs(prMetrics!.latestWeightDate).format('D MMM YYYY')
      : bd.weight ? dayjs(bd.weight.sampleDate).format('D MMM YYYY') : null;

    const brooderSection = `
BROODER ENVIRONMENT: ${bd.environment.logCount} log(s) recorded out of a rough expected ${bd.environment.expectedLogCount} (up to 3x/day) — ${bd.environment.completenessPct}% logging completeness.${bd.environment.logCount > 0
      ? ` Avg temperature ${bd.environment.avgTemp.toFixed(1)}°C (range ${bd.environment.minTemp}–${bd.environment.maxTemp}°C), avg humidity ${bd.environment.avgHumidity.toFixed(1)}%, ${bd.environment.lightingIssues} log(s) flagged a lighting problem.`
      : ' No environmental readings recorded at all — this is a significant gap for a brooding batch.'}${hasProductionReport && (prMetrics!.avgTemperature != null || prMetrics!.avgHumidity != null)
      ? ` Cross-check from the uploaded production report: avg temperature ${prMetrics!.avgTemperature != null ? `${prMetrics!.avgTemperature.toFixed(1)}°C` : 'not recorded'}, avg humidity ${prMetrics!.avgHumidity != null ? `${prMetrics!.avgHumidity.toFixed(1)}%` : 'not recorded'} across ${prMetrics!.rowCount} report day(s) — note any material difference from the system logs above.`
      : ''}
FEED (source: ${feedDataSource === 'production_report' ? 'uploaded production report, whole-batch lifecycle' : 'system FeedIntakeLog, production-house only'}): ${totalFeedKg > 0 ? `${totalFeedKg.toFixed(1)} kg total dispensed${feedDataSource === 'production_report' ? ` across ${prMetrics!.rowCount} report day(s)` : ''}.` : 'no feed data recorded for this batch.'}${feedDataSource === 'system' && bd.feed.entryCount > 0 ? ` (Brooder-stage feed alone, from system logs: ${bd.feed.totalDispensedKg.toFixed(1)} kg across ${bd.feed.entryCount} logged feeding(s), already excluded from the production-house figure above.)` : ''}${hasProductionReport && prMetrics!.avgWaterLts != null ? ` Water: avg ${prMetrics!.avgWaterLts.toFixed(1)} L/day from the production report.` : ''}
MORTALITY/CULLING (source: ${mortalityDataSource === 'production_report' ? 'uploaded production report, whole-batch lifecycle' : 'system brooder logs only — no production-stage mortality source exists for this batch'}): ${totalMortality} death(s), ${totalCulling} culled. Cumulative mortality ${cumulativeMortalityPct.toFixed(2)}%${mortalityCeilingPct != null ? ` vs the HyLine control-standard ceiling of ${mortalityCeilingPct.toFixed(2)}% for week ${ageWeeks} — ${mortalityOverCeiling ? 'THIS BATCH IS OVER THE CEILING, flag it clearly' : 'within the expected ceiling'}.` : ' (no matching control-standard week found to compare against).'}${bd.mortality.byCause.length ? ` Causes recorded in system logs (brooder-stage only, may be incomplete relative to the total above): ${bd.mortality.byCause.map(c => `${c.cause} (${c.count})`).join(', ')}.` : ''}
BIRD WEIGHT (source: ${weightSource === 'production_report' ? 'uploaded production report' : weightSource === 'system' ? 'system weight sample' : 'none'}): ${weightValueG != null ? `latest reading ${weightDateLabel}: average ${weightValueG}g${weightSource === 'system' && bd.weight ? ` from ${bd.weight.sampleCount} bird(s) sampled` : ''}.${weightSource === 'system' && bd.weight?.expectedMinG != null ? ` Expected band for that age: ${bd.weight.expectedMinG}–${bd.weight.expectedMaxG}g — this batch is ${bd.weight!.status.replace('_', ' ')}.` : weightSource === 'production_report' ? ' (No age-matched HyLine band comparison shown — this reading came from the production report rather than a dated system weight sample.)' : ''}` : 'no weight samples recorded for this batch.'}
VACCINATION: ${bd.vaccination.given.length} record(s) administered${bd.vaccination.given.length ? ` (${bd.vaccination.given.map(v => v.name).join(', ')})` : ''}.${bd.vaccination.missed.length ? ` GAP: ${bd.vaccination.missed.length} vaccine(s) due by this age were not found in the records — ${bd.vaccination.missed.map(m => `${m.name} (due wk ${m.dueAtWeek})`).join(', ')}. Flag this clearly.` : ' No overdue vaccines found against the active schedule.'}
HEALTH EVENTS: ${bd.health.totalEvents} total logged, ${bd.health.unresolved.length} UNRESOLVED.${bd.health.unresolved.length ? ` Unresolved: ${bd.health.unresolved.map(e => `${e.type} on ${dayjs(e.date).format('D MMM')} affecting ${e.affected} bird(s)${e.symptoms ? ` (symptoms: ${e.symptoms})` : ''}`).join('; ')}.` : ''}
TREATMENTS ADMINISTERED: ${bd.treatments.length ? bd.treatments.map(t => `${t.drug} ${t.dose} via ${t.route} on ${dayjs(t.date).format('D MMM')}${t.durationDays ? ` for ${t.durationDays}d` : ''}`).join('; ') : 'none recorded.'}
BROODER LOCATION: ${bd.levelsOccupied.length ? bd.levelsOccupied.join(', ') : 'no brooder row/level assignment on record.'}`;

    const prMetricsNote = hasProductionReport
      ? `An uploaded production report ("${prMetrics!.fileName}", ${prMetrics!.status.toLowerCase()}, ${prMetrics!.rowCount} day(s) covering ${dayjs(prMetrics!.dateRange!.from).format('D MMM YYYY')}–${dayjs(prMetrics!.dateRange!.to).format('D MMM YYYY')}) exists for this batch. Wherever a figure below is marked "source: uploaded production report", treat it as the reliable, Store-verified number — it is more trustworthy than a reconstruction from day-to-day system entries.${prMetrics!.openDiscrepancies > 0 ? ` ${prMetrics!.openDiscrepancies} discrepancy(ies) between the report and system entries are still open and awaiting your review — mention this as a data gap.` : ''}`
      : 'No production report has been uploaded for this batch — every figure below comes from system entry logs, which only count APPROVED entries and can therefore understate the true picture.';

    const prompt = `You are a commercial poultry expert producing a FULL-SCALE, detailed report for the Director of Anza Whole Foods farm in Kenya, reviewing every data point collected for one specific batch. Plain English, specific numbers, no jargon — but do not shorten this into a summary. Go through EVERY section below individually. If a figure has no data, say so plainly and treat that itself as a gap worth flagging, rather than skipping it.

BATCH: ${batch.batchCode} (${batch.birdType}, ${batch.strain}) in ${batch.house.name}
${statusNote}
DATA SOURCE NOTE: ${prMetricsNote}
AGE: ${ageWeeks} week(s) since arrival (hatched ${dayjs(batch.dateOfHatch).format('D MMM YYYY')}, received ${dayjs(batch.dateReceived).format('D MMM YYYY')})
BIRDS: started with ${batch.quantityReceived.toLocaleString()}, currently ${batch.currentBirdCount.toLocaleString()}${survivalRate ? ` (${survivalRate}% survival)` : ''}
EGG PRODUCTION (source: system — production reports do not carry egg-count data): ${totalEggs > 0 ? `${totalEggs.toLocaleString()} eggs across ${dailyHdp.length} fully-recorded day(s)` : 'no egg collection data recorded for this batch'}${avgHdp != null ? `, average daily HDP (AM+PM combined) ${avgHdp.toFixed(1)}%` : ''}${fcr ? `. FCR ${fcr} kg feed per egg (using the feed figure below).` : ''}
${brooderSection}
DATA COMPLETENESS (egg/feed/flock approval workflow): ${completenessFlags
      ? `${eggPending} egg session(s) pending approval, ${eggReturned} returned for correction; ${feedPending} feed log(s) pending, ${feedReturned} returned; ${flockPending} flock entry pending, ${flockReturned} returned; ${storeDiscrepancies} store-intake discrepancy flag(s) raised.`
      : 'all egg, feed and flock entries for this batch are fully approved with no outstanding store discrepancies.'}${hasProductionReport && prMetrics!.openDiscrepancies > 0 ? ` Additionally, the uploaded production report has ${prMetrics!.openDiscrepancies} open discrepancy(ies) awaiting Director review.` : ''}

Write a full-scale report with these named sections, covering every data point above — do not skip the brooder data even if the batch has moved past brooding stage, since gaps there are still relevant history:
1. **Overall Assessment** — how this batch has performed given its age/stage
2. **Flock Health & Survival** — mortality, culling, causes, vs the control-standard ceiling
3. **Growth & Nutrition** — feed adherence and bird weight vs the expected band
4. **Environmental Conditions** — brooder temperature/humidity/lighting and logging completeness
5. **Vaccination & Health Events** — coverage gaps, unresolved health events, treatments given
6. **Data Gaps & Issues** — an explicit list of every gap, anomaly, or missing data point found across all sections above (this section is mandatory even if the answer is "no significant gaps found")
7. **Recommendations** — ${batch.isActive ? '3-5 specific, actionable next steps' : 'a closing assessment of how this batch performed overall plus lessons for future batches'}

This is meant to be read carefully by the Director, not skimmed — be thorough rather than brief. There is no strict word limit, but keep every sentence carrying real information (no filler).`;

    // Use the higher-capability model configured for this specific report (if
    // set) rather than the cheaper model used for the automated cron reports —
    // see ANTHROPIC_MODEL_BATCH_REPORT in app.config.ts / .env.example.
    const batchReportModel = this.config.get<string>('ANTHROPIC_MODEL_BATCH_REPORT')
      || this.config.get<string>('ANTHROPIC_MODEL')
      || 'claude-sonnet-4-6';

    const content = await this.callClaude(prompt, 4000, batchReportModel);
    if (!content) {
      throw new BadRequestException('The AI service did not return a report. Please try again in a moment.');
    }

    const report = await this.prisma.aiReport.create({
      data: {
        reportType: 'BATCH_CLOSURE_FORECAST',
        content,
        rawData: {
          batchId: batch.id,
          batchCode: batch.batchCode,
          ageWeeks,
          avgHdp: avgHdp != null ? avgHdp.toFixed(1) : undefined,
          fcr: fcr ?? undefined,
          isActive: batch.isActive,
          manuallyRequested: true,
          modelUsed: batchReportModel,
          completeness: {
            eggPending, eggReturned, feedPending, feedReturned, flockPending, flockReturned, storeDiscrepancies,
          },
          brooder: bd,
          // Data provenance — drives the "derived from production report"
          // indicator on the Director's AI Reports page.
          dataSources: { feed: feedDataSource, mortality: mortalityDataSource, weight: weightSource },
          productionReport: hasProductionReport ? {
            fileName: prMetrics!.fileName,
            status: prMetrics!.status,
            uploadedAt: prMetrics!.uploadedAt,
            rowCount: prMetrics!.rowCount,
            dateRange: prMetrics!.dateRange,
            openDiscrepancies: prMetrics!.openDiscrepancies,
          } : null,
        },
      },
    });

    await this.notifications.notifyRole(
      UserRole.OWNER,
      NotificationType.AI_REPORT_READY,
      `Batch Report: ${batch.batchCode}`,
      `AI report for ${batch.batchCode} (${ageWeeks} week(s), ${batch.isActive ? 'active' : 'closed'}) is ready.`,
      { entityId: report.id, entityType: 'AiReport' },
    ).catch(() => { /* best-effort */ });

    return report;
  }
}
