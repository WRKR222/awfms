import { Injectable, Logger } from '@nestjs/common';
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
  private async callClaude(prompt: string, maxTokens = 800): Promise<string | null> {
    if (!this.anthropic) return null;
    try {
      const msg = await this.anthropic.messages.create({
        model: this.config.get<string>('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      });
      const block = msg.content[0];
      return block.type === 'text' ? block.text : null;
    } catch (err: any) {
      this.logger.error(`Claude API error: ${err.message}`);
      return null;
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // AI-01 — Weekly Performance Report  (Monday 06:00)
  // ────────────────────────────────────────────────────────────────────────────
  @Cron('0 6 * * 1')
  async generateWeeklyReport() {
    this.logger.log('AI-01: Generating weekly performance report…');
    const weekEnd   = dayjs().subtract(1, 'day').endOf('day');
    const weekStart = weekEnd.subtract(6, 'day').startOf('day');

    // ── Gather data ───────────────────────────────────────────────────────────
    const [eggSessions, flockEntries, feedLogs, payments, expenses, healthEvents] =
      await Promise.all([
        this.prisma.eggCollectionSession.findMany({
          where: { sessionDate: { gte: weekStart.toDate(), lte: weekEnd.toDate() }, status: EntryStatus.APPROVED },
          select: { totalGoodEggs: true, totalFullTrays: true, henDayPercent: true, totalBrokenEggs: true },
        }),
        (this.prisma as any).flockDailyEntry.findMany({
          where: { entryDate: { gte: weekStart.toDate(), lte: weekEnd.toDate() }, status: EntryStatus.APPROVED },
          select: { mortalityCount: true, mortalityCause: true },
        }),
        this.prisma.feedIntakeLog.findMany({
          where: { entryDate: { gte: weekStart.toDate(), lte: weekEnd.toDate() }, status: EntryStatus.APPROVED },
          select: { quantityDispensedKg: true, feedType: true },
        }),
        this.prisma.invoicePayment.findMany({
          where: { paymentDate: { gte: weekStart.toDate(), lte: weekEnd.toDate() } },
          select: { amount: true },
        }),
        this.prisma.expenseLog.findMany({
          where: { expenseDate: { gte: weekStart.toDate(), lte: weekEnd.toDate() } },
          select: { amount: true, description: true },
        }),
        this.prisma.healthEvent.findMany({
          where: { eventDate: { gte: weekStart.toDate(), lte: weekEnd.toDate() } },
          select: { eventType: true, affectedCount: true, symptoms: true },
        }),
      ]);

    // ── Compute KPIs ──────────────────────────────────────────────────────────
    const totalEggs     = eggSessions.reduce((s: number, e: any) => s + e.totalGoodEggs, 0);
    const totalTrays    = eggSessions.reduce((s: number, e: any) => s + e.totalFullTrays, 0);
    const totalBroken   = eggSessions.reduce((s: number, e: any) => s + (e.totalBrokenEggs ?? 0), 0);
    const hdpValues     = eggSessions.map((e: any) => Number(e.henDayPercent)).filter((v: number) => v > 0);
    const avgHdp        = hdpValues.length ? hdpValues.reduce((a: number, b: number) => a + b, 0) / hdpValues.length : 0;
    const totalMort     = flockEntries.reduce((s: number, e: any) => s + e.mortalityCount, 0);
    const totalFeedKg   = feedLogs.reduce((s: number, f: any) => s + Number(f.quantityDispensedKg), 0);
    const totalRevenue  = payments.reduce((s: number, p: any) => s + Number(p.amount), 0);
    const totalExpenses = expenses.reduce((s: number, e: any) => s + Number(e.amount), 0);
    const netIncome     = totalRevenue - totalExpenses;

    const activeBatches = await this.prisma.batch.findMany({
      where: { isActive: true, deletedAt: null },
      select: { currentBirdCount: true },
    });
    const totalBirds = activeBatches.reduce((s, b) => s + b.currentBirdCount, 0);
    const fcr = totalEggs > 0 ? (totalFeedKg / totalEggs).toFixed(3) : 'N/A';

    const rawData = {
      week: `${weekStart.format('D MMM')} – ${weekEnd.format('D MMM YYYY')}`,
      totalEggs, totalTrays, avgHdp: avgHdp.toFixed(1), totalMort,
      totalFeedKg: totalFeedKg.toFixed(1), fcr, totalRevenue, totalExpenses,
      netIncome, totalBirds, healthEvents: healthEvents.length,
      brokenEggPct: totalEggs > 0 ? ((totalBroken / (totalEggs + totalBroken)) * 100).toFixed(1) : '0',
    };

    // ── Build prompt ──────────────────────────────────────────────────────────
    const prompt = `You are an expert poultry farm advisor. Write a concise weekly performance report for Anza Whole Foods farm in Kenya. Use plain English — no jargon. Address the Director directly. Be specific with numbers. End with 2-3 actionable recommendations.

WEEK: ${rawData.week}
PRODUCTION: ${totalEggs.toLocaleString()} eggs · ${totalTrays} trays · Avg HDP ${avgHdp.toFixed(1)}% · Broken egg rate ${rawData.brokenEggPct}%
FLOCK: ${totalBirds.toLocaleString()} birds · ${totalMort} mortalities this week
FEED: ${totalFeedKg.toFixed(1)} kg consumed · FCR ${fcr} kg feed per egg
FINANCE: KES ${totalRevenue.toLocaleString()} revenue · KES ${totalExpenses.toLocaleString()} expenses · KES ${netIncome.toLocaleString()} net
HEALTH: ${healthEvents.length} health event(s) logged

Format: Start with a one-sentence overall summary, then 3 short paragraphs (production, feed & flock health, finance), then "Recommended actions:" as a short bulleted list.`;

    const content = await this.callClaude(prompt, 600);
    if (!content) return;

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
          select: { sessionDate: true, totalGoodEggs: true, henDayPercent: true },
          orderBy: { sessionDate: 'desc' },
          take: 30,
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

      const sessions = batch.eggCollectionSessions;
      if (sessions.length < 14) continue; // not enough data

      const recentHdp = sessions.slice(0, 14).map(s => Number(s.henDayPercent)).filter(v => v > 0);
      const avgHdp = recentHdp.length ? recentHdp.reduce((a,b)=>a+b,0)/recentHdp.length : 0;
      const totalFeedKg = batch.feedIntakeLogs.reduce((s, f) => s + Number(f.quantityDispensedKg), 0);
      const totalEggs = sessions.reduce((s, e) => s + e.totalGoodEggs, 0);
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
AVG HDP (last 14 days): ${avgHdp.toFixed(1)}%
FCR: ${fcr} kg feed per egg
PLACEMENT DATE: ${dayjs(batch.dateReceived).format('D MMM YYYY')}

Based on this data, provide: (1) whether this batch should be closed now, in 4-8 weeks, or continue beyond 8 weeks, with reasoning, (2) the key metric that will signal when to close (HDP threshold or age milestone), (3) one operational note for the manager. Keep response to 3 short paragraphs. Be direct and specific.`;

      const content = await this.callClaude(prompt, 400);
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

    const [batches, feedLogs, sessions, healthChecklists] = await Promise.all([
      this.prisma.batch.findMany({
        where: { isActive: true, deletedAt: null },
        include: {
          eggCollectionSessions: {
            where: { sessionDate: { gte: since30 }, status: EntryStatus.APPROVED },
            select: { henDayPercent: true, sessionDate: true },
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
    ]);

    // Build per-batch HDP summary
    const batchSummaries = batches.map(b => {
      const hdpVals = b.eggCollectionSessions.map(s => Number(s.henDayPercent)).filter(v => v > 0);
      const avgHdp = hdpVals.length ? (hdpVals.reduce((a, c) => a + c, 0) / hdpVals.length).toFixed(1) : 'N/A';
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
- Batch HDP rates: ${batchSummaries}
- Broken egg rate: ${brokenPct}%
- Overall FCR: ${overallFcr} kg feed per egg
- Health checklist failures: ${checklistFailures} across ${healthChecklists.length} checklists
- Feed consumed: ${totalFeedKg.toFixed(0)} kg total
- Eggs collected: ${totalEggs.toLocaleString()}

Provide 3-5 improvement suggestions. Each should be: (a) specific to the data above, not generic advice, (b) actionable in the next 2 weeks, (c) one sentence of context + one sentence of recommended action. Format as a numbered list. Do not include suggestions where the data shows no issue.`;

    const content = await this.callClaude(prompt, 500);
    if (!content) return;

    const report = await this.prisma.aiReport.create({
      data: {
        reportType: 'IMPROVEMENT_SUGGESTIONS',
        content,
        rawData: { batchSummaries, brokenPct, overallFcr, checklistFailures },
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
    await this.generateWeeklyReport();
    return { triggered: true };
  }
}
