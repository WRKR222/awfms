// src/modules/dashboard/dashboard.controller.ts  (REPLACE existing file)
import { Controller, Get, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EntryStatus, InvoiceStatus, BookingStatus } from '@prisma/client';
import dayjs from 'dayjs';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

// Phase 5: roles allowed to see revenue/financial fields in analytics
const REVENUE_ROLES = new Set(['OWNER', 'ACCOUNTANT']);

type DashRange = 'daily' | 'weekly' | 'monthly' | 'quarterly';

function getPeriodBounds(range: DashRange): { from: Date; label: string } {
  const now = dayjs();
  switch (range) {
    case 'daily':     return { from: now.startOf('day').toDate(),   label: 'Today' };
    case 'weekly':    return { from: now.startOf('week').toDate(),  label: 'This Week' };
    case 'monthly':   return { from: now.startOf('month').toDate(), label: 'This Month' };
    case 'quarterly': {
      const qMonth = Math.floor(now.month() / 3) * 3;
      return {
        from: now.month(qMonth).startOf('month').toDate(),
        label: `Q${Math.floor(now.month() / 3) + 1} ${now.year()}`,
      };
    }
  }
}

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private prisma: PrismaService) {}

  @Get('owner')
  @RequirePermission(Permission.AI_REPORTS_VIEW)
  async ownerDashboard(@Query('range') range: DashRange = 'weekly') {
    const { from, label } = getPeriodBounds(range);

    // ── Core bird / batch stats ──────────────────────────────────────────
    const activeBatches = await this.prisma.batch.findMany({
      where: { isActive: true, deletedAt: null },
      select: { currentBirdCount: true, stage: true, batchCode: true },
    });
    const totalBirds = activeBatches.reduce((s, b) => s + b.currentBirdCount, 0);

    // ── Pending verifications ────────────────────────────────────────────
    const pendingEntries = await (this.prisma as any).flockDailyEntry.count({
      where: { status: EntryStatus.PENDING },
    });

    // ── Pending LPO approvals (Director Activity Diagram: "Review Pending Approvals")
    const pendingLpoCount = await this.prisma.localPurchaseOrder.count({
      where: { status: 'SUBMITTED' },  // FIX: LPOStatus has no PENDING; SUBMITTED = awaiting approval
    }).catch(() => 0);  // graceful fallback if LPO model not yet migrated

    // ── Egg production for period ────────────────────────────────────────
    const eggSessions = await this.prisma.eggCollectionSession.findMany({
      where: {
        sessionDate: { gte: from },
        status: EntryStatus.APPROVED,
      },
      select: {
        totalGoodEggs: true,
        totalFullTrays: true,
        henDayPercent: true,
        totalBrokenEggs: true,
      },
    });
    const periodEggs  = eggSessions.reduce((s, e) => s + e.totalGoodEggs, 0);
    const periodTrays = eggSessions.reduce((s, e) => s + e.totalFullTrays, 0);
    const hdpValues   = eggSessions.map(e => Number(e.henDayPercent)).filter(v => v > 0);
    const avgHdp      = hdpValues.length > 0
      ? hdpValues.reduce((a, b) => a + b, 0) / hdpValues.length : 0;

    // ── Cumulative egg counter (all-time approved + historical offset) ───
    const cumulativeResult = await this.prisma.eggCollectionSession.aggregate({
      where: { status: EntryStatus.APPROVED },
      _sum: { totalGoodEggs: true },
    });
    const offsetRecord = await this.prisma.systemConfig.findUnique({
      where: { key: 'egg_counter_offset' },
    });
    const historicalOffset = parseInt(offsetRecord?.value ?? '0', 10);
    const cumulativeEggs = (Number(cumulativeResult._sum.totalGoodEggs ?? 0)) + historicalOffset;

    // ── Revenue & AR for period ─────────────────────────────────────────
    const paymentsInPeriod = await this.prisma.invoicePayment.aggregate({
      where: { paymentDate: { gte: from } },
      _sum: { amount: true },
    });
    const revenueKes = Number(paymentsInPeriod._sum.amount ?? 0);

    const arEntries = await this.prisma.arEntry.findMany({
      select: { currentBalance: true },
    });
    const totalOutstandingKes = arEntries.reduce((s, e) => s + Number(e.currentBalance), 0);

    const overdueCount = await this.prisma.invoice.count({
      where: { status: InvoiceStatus.OVERDUE },
    });

    // ── Feed alerts ──────────────────────────────────────────────────────
    const feedAlerts = await this.prisma.feedStockSnapshot.findMany({
      where: {
        snapshotDate: { gte: dayjs().startOf('day').toDate() },
        daysRemaining: { lte: 3 },
      },
      distinct: ['feedType'],
    });

    // ── Live sales feed (last 10 orders) ────────────────────────────────
    const recentOrders = await this.prisma.salesOrder.findMany({
      where: { orderDate: { gte: from } },
      include: {
        customer: { select: { name: true } },
        items: { select: { quantityTrays: true, subtotal: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    const salesFeed = recentOrders.map(o => ({
      id: o.id,
      orderNumber: o.orderNumber,
      customerName: o.customer.name,
      trays: o.items.reduce((s, i) => s + (i.quantityTrays ?? 0), 0),
      amountKes: Number(o.subtotal),
      status: o.status,
      date: o.orderDate,
    }));

    // ── Mortality for period ─────────────────────────────────────────────
    const mortalityAgg = await (this.prisma as any).flockDailyEntry.aggregate({
      where: {
        entryDate: { gte: from },
        status: EntryStatus.APPROVED,
      },
      _sum: { mortalityCount: true, cullingCount: true },
    });
    const periodMortality = Number(mortalityAgg._sum.mortalityCount ?? 0);
    const periodCulling   = Number(mortalityAgg._sum.cullingCount   ?? 0);

    // ── Latest AI report summary ─────────────────────────────────────────
    const latestAiReport = await this.prisma.aiReport.findFirst({
      orderBy: { generatedAt: 'desc' },
      select: { content: true, generatedAt: true },
    });

    return {
      range,
      periodLabel: label,
      periodFrom: from,

      // Birds
      totalBirds,
      activeBatchCount: activeBatches.length,
      pendingVerifications: pendingEntries,
      pendingApprovals: pendingLpoCount,  // LPOs awaiting Director sign-off

      // Eggs
      periodEggs,
      periodTrays,
      avgHdp: Math.round(avgHdp * 100) / 100,
      cumulativeEggs,

      // Finance
      revenueKes,
      totalOutstandingKes,
      overdueInvoices: overdueCount,

      // Feed
      feedAlertsCount: feedAlerts.length,
      feedAlerts: feedAlerts.map(f => ({ feedType: f.feedType, daysRemaining: f.daysRemaining })),

      // Mortality
      periodMortality,
      periodCulling,

      // Sales feed
      salesFeed,

      // AI
      latestAiSummary: latestAiReport
        ? { summary: latestAiReport.content.slice(0, 300), generatedAt: latestAiReport.generatedAt }
        : null,
    };
  }

  @Get('supervisor')
  async supervisorDashboard() {
    const [pendingCount, approvedToday] = await Promise.all([
      (this.prisma as any).flockDailyEntry.count({ where: { status: EntryStatus.PENDING } }),
      (this.prisma as any).flockDailyEntry.count({
        where: {
          status: EntryStatus.APPROVED,
          entryDate: { gte: dayjs().startOf('day').toDate() },
        },
      }),
    ]);
    return { pendingCount, approvedToday };
  }
  // ── Phase 5: Analytics time-series data ──────────────────────────────────
  @Get('analytics')
  @RequirePermission(Permission.PRODUCTION_VIEW)
  async analyticsData(
    @Query('range') range: string = '30d',
    @Query('batchId') batchId?: string,
    @Query('includeHistory') includeHistoryParam?: string,
    @CurrentUser() user?: any,
  ) {
    // Determine date range
    let fromDate: Date;
    const now = dayjs();
    switch (range) {
      case '7d':     fromDate = now.subtract(7,  'day').toDate(); break;
      case '30d':    fromDate = now.subtract(30, 'day').toDate(); break;
      case '90d':    fromDate = now.subtract(90, 'day').toDate(); break;
      case 'today':  fromDate = now.startOf('day').toDate(); break;
      default:       fromDate = now.subtract(30, 'day').toDate();
    }

    const batchFilter = batchId ? { batchId } : {};

    // ── Egg production trend (daily) ─────────────────────────────────────
    const eggSessions = await this.prisma.eggCollectionSession.findMany({
      where: {
        sessionDate: { gte: fromDate },
        status: EntryStatus.APPROVED,
        ...batchFilter,
      },
      select: {
        sessionDate: true,
        totalGoodEggs: true,
        totalFullTrays: true,
        henDayPercent: true,
        totalBrokenEggs: true,
      },
      orderBy: { sessionDate: 'asc' },
    });

    // Group by date — sum AM+PM per day
    const eggByDate: Record<string, { date: string; eggs: number; trays: number; hdp: number[]; broken: number }> = {};
    for (const s of eggSessions) {
      const d = dayjs(s.sessionDate).format('YYYY-MM-DD');
      if (!eggByDate[d]) eggByDate[d] = { date: d, eggs: 0, trays: 0, hdp: [], broken: 0 };
      eggByDate[d].eggs  += s.totalGoodEggs;
      eggByDate[d].trays += s.totalFullTrays;
      eggByDate[d].broken += s.totalBrokenEggs ?? 0;
      if (s.henDayPercent) eggByDate[d].hdp.push(Number(s.henDayPercent));
    }
    const eggTrend = Object.values(eggByDate).map(d => ({
      date: d.date,
      eggs: d.eggs,
      trays: d.trays,
      broken: d.broken,
      hdp: d.hdp.length > 0 ? Math.round((d.hdp.reduce((a,b)=>a+b,0)/d.hdp.length)*100)/100 : 0,
    }));

    // ── Mortality trend (daily) ──────────────────────────────────────────
    const flockEntries = await (this.prisma as any).flockDailyEntry.findMany({
      where: {
        entryDate: { gte: fromDate },
        status: EntryStatus.APPROVED,
        ...batchFilter,
      },
      select: { entryDate: true, mortalityCount: true, cullingCount: true, mortalityCause: true },
      orderBy: { entryDate: 'asc' },
    });

    const mortalityByDate: Record<string, { date: string; mortality: number; culling: number }> = {};
    for (const e of flockEntries) {
      const d = dayjs(e.entryDate).format('YYYY-MM-DD');
      if (!mortalityByDate[d]) mortalityByDate[d] = { date: d, mortality: 0, culling: 0 };
      mortalityByDate[d].mortality += e.mortalityCount;
      mortalityByDate[d].culling   += e.cullingCount;
    }
    const mortalityTrend = Object.values(mortalityByDate);

    // ── Mortality cause breakdown (pie) ──────────────────────────────────
    const causeMap: Record<string, number> = {};
    for (const e of flockEntries) {
      const cause = e.mortalityCause ?? 'UNKNOWN';
      causeMap[cause] = (causeMap[cause] ?? 0) + e.mortalityCount;
    }
    const mortalityCauses = Object.entries(causeMap).map(([cause, count]) => ({ cause, count }));

    // ── Feed consumption trend ───────────────────────────────────────────
    const feedLogs = await this.prisma.feedIntakeLog.findMany({
      where: {
        entryDate: { gte: fromDate },
        status: EntryStatus.APPROVED,
        ...batchFilter,
      },
      select: { entryDate: true, feedType: true, quantityDispensedKg: true },
      orderBy: { entryDate: 'asc' },
    });

    const feedByDate: Record<string, Record<string, number>> = {};
    for (const f of feedLogs) {
      const d = dayjs(f.entryDate).format('YYYY-MM-DD');
      if (!feedByDate[d]) feedByDate[d] = {};
      feedByDate[d][f.feedType] = (feedByDate[d][f.feedType] ?? 0) + Number(f.quantityDispensedKg);
    }
    const feedTrend = Object.entries(feedByDate).map(([date, types]) => ({ date, ...types }));

    // ── Batch comparison (bar) ─────────────────────────────────────────
    // When includeHistory=true, show ALL batches (active + historical/closed/sold/discarded).
    // This enables Manager and Director to compare performance across batch lifecycles.
    const includeHistory = includeHistoryParam === 'true';
    const batches = await this.prisma.batch.findMany({
      where: {
        deletedAt: null,
        ...(includeHistory ? {} : { isActive: true }),
      },
      select: {
        id: true, batchCode: true, currentBirdCount: true,
        eggCollectionSessions: {
          where: { sessionDate: { gte: fromDate }, status: EntryStatus.APPROVED },
          select: { totalGoodEggs: true, totalFullTrays: true },
        },
        feedIntakeLogs: {
          where: { entryDate: { gte: fromDate }, status: EntryStatus.APPROVED },
          select: { quantityDispensedKg: true },
        },
      },
    });
    const batchComparison = batches.map(b => ({
      batchCode: b.batchCode,
      birdCount: b.currentBirdCount,
      totalEggs: b.eggCollectionSessions.reduce((s, e) => s + e.totalGoodEggs, 0),
      totalTrays: b.eggCollectionSessions.reduce((s, e) => s + e.totalFullTrays, 0),
      totalFeedKg: b.feedIntakeLogs.reduce((s, f) => s + Number(f.quantityDispensedKg), 0),
    }));

    // ── Revenue by period (bar) ───────────────────────────────────────────
    const payments = await this.prisma.invoicePayment.findMany({
      where: { paymentDate: { gte: fromDate } },
      select: { paymentDate: true, amount: true },
      orderBy: { paymentDate: 'asc' },
    });
    const revenueByDate: Record<string, number> = {};
    for (const p of payments) {
      const d = dayjs(p.paymentDate).format('YYYY-MM-DD');
      revenueByDate[d] = (revenueByDate[d] ?? 0) + Number(p.amount);
    }
    const revenueTrend = Object.entries(revenueByDate).map(([date, amount]) => ({ date, amount }));

    // ── Revenue by customer (pie) ─────────────────────────────────────────
    const ordersByCustomer = await this.prisma.salesOrder.findMany({
      where: { orderDate: { gte: fromDate } },
      select: { subtotal: true, customer: { select: { name: true } } },
    });
    const revenueByCustomer: Record<string, number> = {};
    for (const o of ordersByCustomer) {
      const name = o.customer.name;
      revenueByCustomer[name] = (revenueByCustomer[name] ?? 0) + Number(o.subtotal);
    }
    const revenueByCustomerArr = Object.entries(revenueByCustomer)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    // ── Egg condition breakdown (pie) ────────────────────────────────────
    const totalGood   = eggSessions.reduce((s, e) => s + e.totalGoodEggs, 0);
    const totalBroken = eggSessions.reduce((s, e) => s + (e.totalBrokenEggs ?? 0), 0);
    const eggCondition = [
      { name: 'Good', value: totalGood },
      { name: 'Broken', value: totalBroken },
    ].filter(e => e.value > 0);

    // ── Summary KPIs ─────────────────────────────────────────────────────
    const totalEggs   = eggTrend.reduce((s, d) => s + d.eggs, 0);
    const totalTrays  = eggTrend.reduce((s, d) => s + d.trays, 0);
    const hdpVals     = eggTrend.map(d => d.hdp).filter(v => v > 0);
    const avgHdp      = hdpVals.length > 0 ? hdpVals.reduce((a,b)=>a+b,0)/hdpVals.length : 0;
    const totalMort   = mortalityTrend.reduce((s, d) => s + d.mortality, 0);
    const totalFeedKg = feedTrend.reduce((s, d) => s + Object.values(d).filter(v => typeof v === 'number').reduce((a: number, b) => a + (b as number), 0), 0);
    const totalRev    = revenueTrend.reduce((s, d) => s + d.amount, 0);

    const canSeeRevenue = REVENUE_ROLES.has(user?.role);
    return {
      range,
      fromDate,
      kpis: {
        totalEggs,
        totalTrays,
        avgHdp: Math.round(avgHdp * 100) / 100,
        totalMortality: totalMort,
        totalFeedKg: Math.round(totalFeedKg * 10) / 10,
        totalRevenue: canSeeRevenue ? totalRev : 0,
      },
      eggTrend,
      mortalityTrend,
      mortalityCauses,
      feedTrend,
      batchComparison,
      revenueTrend:      canSeeRevenue ? revenueTrend : [],
      revenueByCustomer: canSeeRevenue ? revenueByCustomerArr : [],
      eggCondition,
    };
  }

  // ── AN-07: Predictive Sales Projection ──────────────────────────────────────
  // Returns last 30 days of daily revenue (actuals) + 14-day forward projection
  // Projection uses linear regression on the last 30 days combined with the
  // confirmed booking pipeline as a demand signal.
  @Get('analytics/projection')
  @RequirePermission(Permission.PRODUCTION_VIEW)
  async salesProjection(@CurrentUser() user: any) {
    if (!REVENUE_ROLES.has(user?.role)) {
      throw new ForbiddenException('Sales projection is restricted to Director and Accountant');
    }
    const now = dayjs();
    const from30 = now.subtract(30, 'day').startOf('day').toDate();

    // ── Actuals: daily revenue (payments received) over last 30 days ──────
    const payments = await this.prisma.invoicePayment.findMany({
      where: { paymentDate: { gte: from30 } },
      select: { paymentDate: true, amount: true },
      orderBy: { paymentDate: 'asc' },
    });

    // Build a date-keyed map so every day in the window has a value (0 if no payment)
    const actualMap: Record<string, number> = {};
    for (let i = 0; i <= 30; i++) {
      const d = now.subtract(30 - i, 'day').format('YYYY-MM-DD');
      actualMap[d] = 0;
    }
    for (const p of payments) {
      const d = dayjs(p.paymentDate).format('YYYY-MM-DD');
      if (actualMap[d] !== undefined) {
        actualMap[d] += Number(p.amount);
      }
    }
    const actuals = Object.entries(actualMap).map(([date, amount]) => ({
      date,
      actual: amount,
      projected: null as number | null,
    }));

    // ── Linear regression on actuals (x = day index 0..30, y = revenue) ──
    const n = actuals.length;
    const xs = actuals.map((_, i) => i);
    const ys = actuals.map(a => a.actual);
    const sumX  = xs.reduce((s, x) => s + x, 0);
    const sumY  = ys.reduce((s, y) => s + y, 0);
    const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
    const sumX2 = xs.reduce((s, x) => s + x * x, 0);
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX || 1);
    const intercept = (sumY - slope * sumX) / n;

    // ── Booking pipeline: confirmed bookings for next 14 days ─────────────
    const pipelineStart = now.add(1, 'day').startOf('day').toDate();
    const pipelineEnd   = now.add(14, 'day').endOf('day').toDate();
    const bookings = await this.prisma.advanceBooking.findMany({
      where: {
        requestedDate: { gte: pipelineStart, lte: pipelineEnd },
        status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
      },
      select: { requestedDate: true, estimatedTotal: true },
    });

    // Group bookings by date
    const bookingMap: Record<string, number> = {};
    for (const b of bookings) {
      const d = dayjs(b.requestedDate).format('YYYY-MM-DD');
      bookingMap[d] = (bookingMap[d] ?? 0) + Number(b.estimatedTotal);
    }

    // ── Build projection points for next 14 days ─────────────────────────
    // Blend: 60% trend-based, 40% booking signal (when booking exists)
    const projected = Array.from({ length: 14 }, (_, i) => {
      const dayOffset = i + 1;
      const date = now.add(dayOffset, 'day').format('YYYY-MM-DD');
      const trendValue = Math.max(0, slope * (n + i) + intercept);
      const bookingValue = bookingMap[date] ?? 0;
      const blended = bookingValue > 0
        ? trendValue * 0.6 + bookingValue * 0.4
        : trendValue;
      return {
        date,
        actual: null as number | null,
        projected: Math.round(blended),
      };
    });

    // ── Summary stats ─────────────────────────────────────────────────────
    const avgDaily = sumY / n;
    const projectedTotal14 = projected.reduce((s, p) => s + (p.projected ?? 0), 0);
    const pendingBookingsValue = bookings.reduce((s, b) => s + Number(b.estimatedTotal), 0);

    return {
      series: [...actuals, ...projected],
      summary: {
        avgDailyRevenue: Math.round(avgDaily),
        projectedRevenue14d: projectedTotal14,
        pendingBookingsPipeline: Math.round(pendingBookingsValue),
        trendDirection: slope > 50 ? 'up' : slope < -50 ? 'down' : 'flat',
        trendSlope: Math.round(slope),
      },
    };
  }

}
