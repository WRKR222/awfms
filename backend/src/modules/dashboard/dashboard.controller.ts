import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UserRole, BatchStage, EntryStatus } from '@prisma/client';
import dayjs from 'dayjs';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private prisma: PrismaService) {}

  /** Owner executive dashboard — KPIs and AI summary */
  @Get('owner')
  @RequirePermission(Permission.AI_REPORTS_VIEW)
  async ownerDashboard() {
    const weekAgo = dayjs().subtract(7, 'day').toDate();

    const [
      activeBatches,
      pendingEntries,
      feedAlerts,
      arSummary,
      weeklyProduction,
      latestAiReport,
    ] = await Promise.all([
      // Active batches summary
      this.prisma.batch.findMany({
        where: { isActive: true, deletedAt: null },
        select: { currentBirdCount: true, stage: true },
      }),

      // Pending verification count
      this.prisma.flockDailyEntry.count({
        where: { status: EntryStatus.PENDING, deletedAt: null },
      }),

      // Low feed stock count
      this.prisma.feedStockSnapshot.findMany({
        where: { isLow: true, snapshotDate: { gte: dayjs().startOf('day').toDate() } },
        distinct: ['feedType'],
      }),

      // AR outstanding
      this.prisma.arEntry.aggregate({
        where: { paidAt: null, deletedAt: null },
        _sum: { balanceKes: true },
        _count: { id: true },
      }),

      // Weekly egg production
      this.prisma.productionEntry.aggregate({
        where: {
          entryDate: { gte: weekAgo },
          status: EntryStatus.APPROVED,
          deletedAt: null,
        },
        _sum: { totalWhole: true },
        _avg: { henDayPct: true },
      }),

      // Latest AI report
      this.prisma.aiReport.findFirst({
        where: { deletedAt: null },
        orderBy: { generatedAt: 'desc' },
        select: { summary: true, generatedAt: true },
      }),
    ]);

    // Overdue invoices count
    const overdueCount = await this.prisma.invoice.count({
      where: {
        status: 'OVERDUE',
        deletedAt: null,
      },
    });

    const totalBirds = activeBatches.reduce((sum, b) => sum + b.currentBirdCount, 0);

    return {
      totalBirds,
      activeBatches: activeBatches.length,
      pendingVerifications: pendingEntries,
      weeklyEggs: weeklyProduction._sum.totalWhole ?? 0,
      avgHenDayPct: weeklyProduction._avg.henDayPct ?? 0,
      totalOutstandingKes: arSummary._sum.balanceKes ?? 0,
      overdueInvoices: overdueCount,
      feedAlertsCount: feedAlerts.length,
      latestAiSummary: latestAiReport
        ? { summary: latestAiReport.summary, generatedAt: latestAiReport.generatedAt }
        : null,
    };
  }

  /** Supervisor dashboard — pending queue count */
  @Get('supervisor')
  async supervisorDashboard() {
    const [pendingCount, approvedToday] = await Promise.all([
      this.prisma.flockDailyEntry.count({
        where: { status: EntryStatus.PENDING, deletedAt: null },
      }),
      this.prisma.flockDailyEntry.count({
        where: {
          status: EntryStatus.APPROVED,
          entryDate: { gte: dayjs().startOf('day').toDate() },
          deletedAt: null,
        },
      }),
    ]);

    return { pendingCount, approvedToday };
  }
}
