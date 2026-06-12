// src/modules/dashboard/dashboard.controller.ts
// FIX: Added PermissionsGuard to @UseGuards. Previously the @RequirePermission decorators
//      on ownerDashboard, analyticsData, and salesProjection set metadata that nobody read,
//      making those endpoints accessible to any authenticated user regardless of role.
import { Controller, Get, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
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
@UseGuards(JwtAuthGuard, PermissionsGuard)
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

    // ── Pending tally sign-offs (Morning Tally Sign-Off card) ────────────
    // Count unlocked tallies — these are the sessions awaiting 3-party cosign.
    const pendingEntries = await this.prisma.eggTallyVerification.count({
      where: { isLocked: false },
    });

    // ── Pending LPO approvals (Director Activity Diagram: "Review Pending Approvals")
    const pendingLpoCount = await this.prisma.localPurchaseOrder.count({
      where: { status: 'SUBMITTED' },  // FIX: LPOStatus has no PENDING; SUBMITTED = awaiting approval
    }).catch(() => 0);  // graceful fallback if LPO model not yet migrated

    // ── Egg production for period — use DailyEggAggregate (AM+PM combined) ──
    // DailyEggAggregate is written when BOTH AM and PM tallies lock, giving the
    // true combined total. Falling back to raw session sum only when no aggregate
    // exists yet (e.g. first day before any tally is fully signed).
    const aggregates = await this.prisma.dailyEggAggregate.findMany({
      where: { aggregateDate: { gte: from } },
      select: { totalStdEggs: true, totalStarterEggs: true, totalBrokenSellable: true, aggregateDate: true },
    });

    let periodEggs  = 0;
    let periodTrays = 0;
    let avgHdp      = 0;

    if (aggregates.length > 0) {
      // Sum standard eggs from locked aggregates
      periodEggs  = aggregates.reduce((s, a) => s + (a.totalStdEggs ?? 0), 0);
      periodTrays = Math.floor(periodEggs / 30);
      // True daily HDP = (AM good eggs + PM good eggs) / closing bird count × 100.
      // Averaging per-session henDayPercent values is wrong — it treats AM and PM as
      // equal-weight denominators when they share the same bird population.
      const hdpSessions = await this.prisma.eggCollectionSession.findMany({
        where: { sessionDate: { gte: from }, status: EntryStatus.APPROVED },
        select: { totalGoodEggs: true, totalStarterEggs: true, closingStock: true, sessionDate: true, shift: true },
      });
      // Group by date: sum eggs (using starterEggs when all-starter), use PM closing stock
      const hdpByDate: Record<string, { eggs: number; closingStock: number }> = {};
      for (const s of hdpSessions) {
        const d = s.sessionDate.toISOString().slice(0, 10);
        if (!hdpByDate[d]) hdpByDate[d] = { eggs: 0, closingStock: 0 };
        const effectiveEggs = (s.totalGoodEggs === 0 && (s.totalStarterEggs ?? 0) > 0)
          ? (s.totalStarterEggs ?? 0) : s.totalGoodEggs;
        hdpByDate[d].eggs += effectiveEggs;
        // PM closing stock is more accurate; always overwrite with latest available
        if (s.closingStock > 0) hdpByDate[d].closingStock = s.closingStock;
      }
      const dailyHdps = Object.values(hdpByDate)
        .filter(d => d.closingStock > 0)
        .map(d => (d.eggs / d.closingStock) * 100);
      avgHdp = dailyHdps.length > 0 ? dailyHdps.reduce((a,b)=>a+b,0)/dailyHdps.length : 0;
    } else {
      // Fallback: raw session totals (pre-tally-lock state) — same correct HDP method
      const eggSessions = await this.prisma.eggCollectionSession.findMany({
        where: { sessionDate: { gte: from }, status: EntryStatus.APPROVED },
        select: { totalGoodEggs: true, totalFullTrays: true, totalStarterEggs: true, closingStock: true, sessionDate: true, shift: true },
      });
      periodEggs  = eggSessions.reduce((s, e) => s + e.totalGoodEggs, 0);
      periodTrays = eggSessions.reduce((s, e) => s + e.totalFullTrays, 0);
      const fbHdpByDate: Record<string, { eggs: number; closingStock: number }> = {};
      for (const s of eggSessions) {
        const d = s.sessionDate.toISOString().slice(0, 10);
        if (!fbHdpByDate[d]) fbHdpByDate[d] = { eggs: 0, closingStock: 0 };
        const effectiveEggs = (s.totalGoodEggs === 0 && (s.totalStarterEggs ?? 0) > 0)
          ? (s.totalStarterEggs ?? 0) : s.totalGoodEggs;
        fbHdpByDate[d].eggs += effectiveEggs;
        if (s.closingStock > 0) fbHdpByDate[d].closingStock = s.closingStock;
      }
      const fbDailyHdps = Object.values(fbHdpByDate)
        .filter(d => d.closingStock > 0)
        .map(d => (d.eggs / d.closingStock) * 100);
      avgHdp = fbDailyHdps.length > 0 ? fbDailyHdps.reduce((a,b)=>a+b,0)/fbDailyHdps.length : 0;
    }

    // ── Cumulative egg counter (all-time approved + historical offset) ───
    // Counts every egg recorded in each session row:
    // good (std) + starter + broken-sellable + broken-unsellable + soft-shell + deformed.
    // This matches the "total eggs collected" definition shown on the card.
    //
    // Primary source: DailyEggAggregate (written when both AM+PM tallies lock).
    // Fallback: raw EggCollectionSession rows for dates with no aggregate yet.
    const aggCumulativeResult = await this.prisma.dailyEggAggregate.aggregate({
      _sum: {
        totalStdEggs:          true,
        totalStarterEggs:      true,
        totalBrokenSellable:   true,
        totalBrokenUnsellable: true,
        totalSoftShell:        true,
        totalDeformed:         true,
      },
    });
    // For sessions not yet aggregated, add raw session totals.
    const aggregatedDates = await this.prisma.dailyEggAggregate.findMany({
      select: { aggregateDate: true },
    });
    const aggregatedDateSet = new Set(
      aggregatedDates.map(a => new Date(a.aggregateDate).toISOString().slice(0, 10)),
    );
    const unaggregatedSessions = await this.prisma.eggCollectionSession.findMany({
      where: { status: EntryStatus.APPROVED },
      select: {
        sessionDate:           true,
        totalGoodEggs:         true,
        totalStarterEggs:      true,
        totalBrokenSellable:   true,
        totalBrokenUnsellable: true,
        totalSoftShell:        true,
        totalDeformed:         true,
      },
    });
    let unaggregatedTotal = 0;
    for (const s of unaggregatedSessions) {
      const d = s.sessionDate.toISOString().slice(0, 10);
      if (!aggregatedDateSet.has(d)) {
        // Use starterEggs when the day is all-starter (good eggs = 0)
        const goodOrStarter = (s.totalGoodEggs === 0 && (s.totalStarterEggs ?? 0) > 0)
          ? (s.totalStarterEggs ?? 0)
          : s.totalGoodEggs;
        unaggregatedTotal += goodOrStarter
          + ((s as any).totalBrokenSellable   ?? 0)
          + ((s as any).totalBrokenUnsellable ?? 0)
          + ((s as any).totalSoftShell        ?? 0)
          + ((s as any).totalDeformed         ?? 0);
      }
    }
    const offsetRecord = await this.prisma.systemConfig.findUnique({
      where: { key: 'egg_counter_offset' },
    });
    const historicalOffset = parseInt(offsetRecord?.value ?? '0', 10);
    const cumulativeEggs = (
      Number(aggCumulativeResult._sum.totalStdEggs          ?? 0) +
      Number(aggCumulativeResult._sum.totalStarterEggs      ?? 0) +
      Number(aggCumulativeResult._sum.totalBrokenSellable   ?? 0) +
      Number(aggCumulativeResult._sum.totalBrokenUnsellable ?? 0) +
      Number(aggCumulativeResult._sum.totalSoftShell        ?? 0) +
      Number(aggCumulativeResult._sum.totalDeformed         ?? 0) +
      unaggregatedTotal
    ) + historicalOffset;


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

    // ── Today's egg pricing (set by accountant) ──────────────────────────
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    const todayPricing = await this.prisma.dailyEggPrice.findUnique({
      where: { priceDate: todayDate },
      select: {
        priceDate:          true,
        pricePerEgg:        true,
        pricePerEggBulk:    true,
        pricePerEggStarter: true,
        pricePerEggBroken:  true,
        expectedRevenue:    true,
        notes:              true,
      },
    });

    // Feed alerts removed from Director dashboard per product requirement.
    const feedAlerts: any[] = [];

    // ── Live sales feed (last 10 orders) — include full item breakdown ──
    const recentOrders = await this.prisma.salesOrder.findMany({
      where: { orderDate: { gte: from }, deletedAt: null },
      include: {
        customer: { select: { name: true } },
        items: {
          select: {
            itemType: true,
            quantityEggs: true,
            quantityTrays: true,
            subtotal: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const salesFeed = recentOrders.map(o => {
      let standardEggs = 0, starterEggs = 0, brokenEggs = 0;
      for (const item of o.items) {
        const qty = item.quantityEggs ?? (item.quantityTrays ?? 0) * 30;
        if (item.itemType === 'STANDARD_EGGS')          standardEggs += qty;
        else if (item.itemType === 'STARTER_EGGS')      starterEggs  += qty;
        else if (item.itemType === 'CONSUMABLE_BROKEN_EGGS') brokenEggs += qty;
      }
      return {
        id: o.id,
        orderNumber: o.orderNumber,
        customerName: o.customer.name,
        trays: o.items.reduce((s, i) => s + (i.quantityTrays ?? 0), 0),
        standardEggs,
        starterEggs,
        brokenEggs,
        totalEggs: standardEggs + starterEggs + brokenEggs,
        amountKes: Number(o.subtotal),
        status: o.status,
        date: o.orderDate,
      };
    });

    // ── Confirmed orders total (sum of confirmed/delivered subtotals) ───
    const confirmedOrdersAgg = await this.prisma.salesOrder.aggregate({
      where: {
        orderDate: { gte: from },
        status: { in: ['CONFIRMED', 'DELIVERING', 'DELIVERED'] as any },
        deletedAt: null,
      },
      _sum: { subtotal: true },
      _count: true,
    });
    const confirmedOrdersTotal = Number(confirmedOrdersAgg._sum.subtotal ?? 0);
    const confirmedOrdersCount = confirmedOrdersAgg._count;

    // ── Eggs sold totals (from paid invoices via AR payments) ───────────
    const allPeriodOrders = await this.prisma.salesOrder.findMany({
      where: {
        orderDate: { gte: from },
        status: { not: 'CANCELLED' as any },
        deletedAt: null,
      },
      include: { items: { select: { itemType: true, quantityEggs: true, quantityTrays: true } } },
    });
    let totalStandardEggsSold = 0, totalStarterEggsSold = 0, totalBrokenEggsSold = 0;
    for (const o of allPeriodOrders) {
      for (const item of o.items) {
        const qty = item.quantityEggs ?? (item.quantityTrays ?? 0) * 30;
        if (item.itemType === 'STANDARD_EGGS')               totalStandardEggsSold += qty;
        else if (item.itemType === 'STARTER_EGGS')           totalStarterEggsSold  += qty;
        else if (item.itemType === 'CONSUMABLE_BROKEN_EGGS') totalBrokenEggsSold   += qty;
      }
    }

    // ── Expected revenue ─────────────────────────────────────────────────────
    // FIX: Previously used hardcoded `todayDate` for aggregate/tally lookups,
    // so revenue was zero when eggs were collected yesterday and priced today.
    // Now: find the most recent aggregate (or tally), use that date as refDate,
    // and apply today's pricing to it when no pricing exists for refDate itself.
    let expectedRevenueKes = 0;
    try {
      const mostRecentAgg = await this.prisma.dailyEggAggregate.findFirst({
        orderBy: { aggregateDate: 'desc' },
        select: { aggregateDate: true, expectedRevenueKes: true, totalStdEggs: true, totalStarterEggs: true, totalBrokenSellable: true },
      });

      // Determine refDate from most recent aggregate or locked tally
      let revRefDate: Date = todayDate;
      if (mostRecentAgg) {
        revRefDate = new Date(mostRecentAgg.aggregateDate);
        revRefDate.setHours(0, 0, 0, 0);
      }

      // Try pricing for refDate; fall back to todayPricing
      const revRefPricing = (revRefDate.getTime() !== todayDate.getTime())
        ? await this.prisma.dailyEggPrice.findUnique({ where: { priceDate: revRefDate } })
        : null;
      const effectivePricing = revRefPricing ?? todayPricing;

      if (mostRecentAgg && effectivePricing) {
        const refAggregates = await this.prisma.dailyEggAggregate.findMany({
          where: { aggregateDate: mostRecentAgg.aggregateDate },
          select: { expectedRevenueKes: true, totalStdEggs: true, totalStarterEggs: true, totalBrokenSellable: true },
        });
        const storedTotal = refAggregates.reduce(
          (sum, a) => sum + Number(a.expectedRevenueKes ?? 0), 0,
        );
        if (storedTotal > 0) {
          expectedRevenueKes = storedTotal;
        } else {
          expectedRevenueKes = refAggregates.reduce((sum, a) => {
            return sum
              + (a.totalStdEggs         ?? 0) * Number(effectivePricing.pricePerEgg)
              + (a.totalStarterEggs     ?? 0) * Number(effectivePricing.pricePerEggStarter ?? 0)
              + (a.totalBrokenSellable  ?? 0) * Number(effectivePricing.pricePerEggBroken  ?? 0);
          }, 0);
        }
      } else if (effectivePricing) {
        // No aggregate — fall back to locked tally sessions for refDate.
        const revRefTallies = await this.prisma.eggTallyVerification.findMany({
          where: {
            isLocked: true,
            session: { sessionDate: revRefDate, status: 'APPROVED' },
          },
          include: {
            session: {
              select: {
                totalGoodEggs:        true,
                totalStarterEggs:     true,
                totalBrokenSellable:  true,
              },
            },
          },
        });
        if (revRefTallies.length > 0) {
          expectedRevenueKes = revRefTallies.reduce((sum, t) => {
            const s = t.session as any;
            if (!s) return sum;
            return sum
              + (s.totalGoodEggs        ?? 0) * Number(effectivePricing.pricePerEgg)
              + (s.totalStarterEggs     ?? 0) * Number(effectivePricing.pricePerEggStarter ?? 0)
              + (s.totalBrokenSellable  ?? 0) * Number(effectivePricing.pricePerEggBroken  ?? 0);
          }, 0);
        }
      }
    } catch (_) { /* best-effort */ }


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
      pendingVerifications: pendingEntries,  // unlocked egg tally verifications
      pendingApprovals: pendingLpoCount,

      // Eggs
      periodEggs,
      periodTrays,
      avgHdp: Math.round(avgHdp * 100) / 100,
      cumulativeEggs,

      // Finance
      revenueKes,
      totalOutstandingKes,
      overdueInvoices: overdueCount,

      // Feed alerts removed from Director dashboard
      feedAlertsCount: 0,
      feedAlerts: [],

      // Mortality
      periodMortality,
      periodCulling,

      // Sales feed (with per-type egg breakdown)
      salesFeed,

      // Sales totals
      confirmedOrdersTotal,
      confirmedOrdersCount,
      totalStandardEggsSold,
      totalStarterEggsSold,
      totalBrokenEggsSold,
      totalEggsSold: totalStandardEggsSold + totalStarterEggsSold + totalBrokenEggsSold,

      // Expected revenue from tally × pricing
      expectedRevenueKes: Math.round(expectedRevenueKes),

      // Today's egg pricing
      todayPricing: todayPricing ? {
        priceDate:          todayPricing.priceDate,
        pricePerEgg:        Number(todayPricing.pricePerEgg),          // Standard < 330 eggs
        pricePerEggBulk:    (todayPricing as any).pricePerEggBulk != null ? Number((todayPricing as any).pricePerEggBulk) : null, // Standard >= 330 eggs
        pricePerEggStarter: todayPricing.pricePerEggStarter != null ? Number(todayPricing.pricePerEggStarter) : null,
        pricePerEggBroken:  todayPricing.pricePerEggBroken  != null ? Number(todayPricing.pricePerEggBroken)  : null,
        expectedRevenue:    todayPricing.expectedRevenue    != null ? Number(todayPricing.expectedRevenue)    : null,
        notes:              todayPricing.notes,
      } : null,

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

    const eggSessions = await this.prisma.eggCollectionSession.findMany({
      where: {
        sessionDate: { gte: fromDate },
        status: EntryStatus.APPROVED,
        ...batchFilter,
      },
      select: {
        sessionDate: true,
        totalGoodEggs: true,
        totalStarterEggs: true,
        totalFullTrays: true,
        closingStock: true,
        shift: true,
        totalBrokenEggs: true,
      },
      orderBy: { sessionDate: 'asc' },
    });

    // True daily HDP = (AM eggs + PM eggs) / closing bird count × 100.
    // Storing per-session henDayPercent values and averaging them is wrong —
    // AM and PM share the same bird population so the denominator must be used once.
    const eggByDate: Record<string, { date: string; eggs: number; trays: number; closingStock: number; broken: number }> = {};
    for (const s of eggSessions) {
      const d = dayjs(s.sessionDate).format('YYYY-MM-DD');
      if (!eggByDate[d]) eggByDate[d] = { date: d, eggs: 0, trays: 0, closingStock: 0, broken: 0 };
      // For all-starter sessions, use totalStarterEggs as the effective egg count for HDP
      const effectiveEggs = (s.totalGoodEggs === 0 && (s.totalStarterEggs ?? 0) > 0)
        ? (s.totalStarterEggs ?? 0) : s.totalGoodEggs;
      eggByDate[d].eggs  += effectiveEggs;
      eggByDate[d].trays += s.totalFullTrays;
      eggByDate[d].broken += s.totalBrokenEggs ?? 0;
      // PM closing stock overwrites AM — it is the authoritative end-of-day figure
      if (s.closingStock > 0) eggByDate[d].closingStock = s.closingStock;
    }
    const eggTrend = Object.values(eggByDate).map(d => ({
      date: d.date,
      eggs: d.eggs,
      trays: d.trays,
      broken: d.broken,
      hdp: d.closingStock > 0 ? Math.round((d.eggs / d.closingStock) * 10000) / 100 : 0,
    }));

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

    const causeMap: Record<string, number> = {};
    for (const e of flockEntries) {
      const cause = e.mortalityCause ?? 'UNKNOWN';
      causeMap[cause] = (causeMap[cause] ?? 0) + e.mortalityCount;
    }
    const mortalityCauses = Object.entries(causeMap).map(([cause, count]) => ({ cause, count }));

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

    const totalGood   = eggSessions.reduce((s, e) => s + e.totalGoodEggs, 0);
    const totalBroken = eggSessions.reduce((s, e) => s + (e.totalBrokenEggs ?? 0), 0);
    const eggCondition = [
      { name: 'Good', value: totalGood },
      { name: 'Broken', value: totalBroken },
    ].filter(e => e.value > 0);

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

  @Get('analytics/projection')
  @RequirePermission(Permission.PRODUCTION_VIEW)
  async salesProjection(@CurrentUser() user: any) {
    if (!REVENUE_ROLES.has(user?.role)) {
      throw new ForbiddenException('Sales projection is restricted to Director and Accountant');
    }
    const now = dayjs();
    const from30 = now.subtract(30, 'day').startOf('day').toDate();

    const payments = await this.prisma.invoicePayment.findMany({
      where: { paymentDate: { gte: from30 } },
      select: { paymentDate: true, amount: true },
      orderBy: { paymentDate: 'asc' },
    });

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

    const n = actuals.length;
    const xs = actuals.map((_, i) => i);
    const ys = actuals.map(a => a.actual);
    const sumX  = xs.reduce((s, x) => s + x, 0);
    const sumY  = ys.reduce((s, y) => s + y, 0);
    const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
    const sumX2 = xs.reduce((s, x) => s + x * x, 0);
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX || 1);
    const intercept = (sumY - slope * sumX) / n;

    const pipelineStart = now.add(1, 'day').startOf('day').toDate();
    const pipelineEnd   = now.add(14, 'day').endOf('day').toDate();
    const bookings = await this.prisma.advanceBooking.findMany({
      where: {
        requestedDate: { gte: pipelineStart, lte: pipelineEnd },
        status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
      },
      select: { requestedDate: true, estimatedTotal: true },
    });

    const bookingMap: Record<string, number> = {};
    for (const b of bookings) {
      const d = dayjs(b.requestedDate).format('YYYY-MM-DD');
      bookingMap[d] = (bookingMap[d] ?? 0) + Number(b.estimatedTotal);
    }

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
