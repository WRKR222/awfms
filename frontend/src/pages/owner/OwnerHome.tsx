// src/pages/owner/OwnerHome.tsx
// IMPLEMENTATION PLAN CHANGES:
//   • Removed Feed Status KPI card from secondary KPIs grid.
//   • Secondary KPI grid changed from grid-cols-4 to grid-cols-3 with gap-4.
//   • Feed alerts banner at top RETAINED.
//   • "Pending Verifications" KPI relabelled "Morning Tally Sign-Off" with
//     sub "sessions awaiting 3-party cosign".
//   • Revenue & Sales Summary expanded to 4-column grid with new
//     "Differential Revenue" card (surplus/shortfall vs expected).
//   • Revenue and Outstanding AR KPI cards use toLocaleString() — no "K" abbreviation.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import { useAuthStore } from '../../stores/auth.store';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp, AlertTriangle, Bird, Egg, DollarSign, Flame,
  Activity, Users, ChevronRight, Lock, Brain, ArrowRight, Map,
} from 'lucide-react';
import dayjs from 'dayjs';
import { CageMap } from '../../components/shared/CageMap';
import { BrooderCageMap } from '../../components/shared/BrooderCageMap';

type Range = 'daily' | 'weekly' | 'monthly' | 'quarterly';

interface DashData {
  range: Range;
  periodLabel: string;
  periodFrom: string;
  totalBirds: number;
  activeBatchCount: number;
  pendingVerifications: number;
  pendingApprovals: number;
  periodEggs: number;
  periodTrays: number;
  avgHdp: number;
  cumulativeEggs: number;
  revenueKes: number;
  expectedRevenueKes?: number;
  totalOutstandingKes: number;
  overdueInvoices: number;
  feedAlertsCount: number;
  feedAlerts: Array<{ feedType: string; daysRemaining: number }>;
  periodMortality: number;
  periodCulling: number;
  salesFeed: Array<{
    id: string;
    orderNumber: string;
    customerName: string;
    trays: number;
    standardEggs: number;
    starterEggs: number;
    brokenEggs: number;
    totalEggs: number;
    amountKes: number;
    status: string;
    date: string;
  }>;
  confirmedOrdersTotal: number;
  confirmedOrdersCount: number;
  totalStandardEggsSold: number;
  totalStarterEggsSold: number;
  totalBrokenEggsSold: number;
  totalEggsSold: number;
  latestAiSummary?: { summary: string; generatedAt: string } | null;
  todayPricing?: {
    priceDate: string;
    pricePerEgg: number;
    pricePerEggStarter: number | null;
    pricePerEggBroken: number | null;
    expectedRevenue: number | null;
    notes: string | null;
  } | null;
}

function useOwnerDash(range: Range) {
  return useQuery({
    queryKey: ['owner-dashboard', range],
    queryFn: async () => {
      const res = await api.get(`/dashboard/owner?range=${range}`);
      return res.data as DashData;
    },
    staleTime: 60_000,
    retry: 1,
  });
}

const RANGE_TABS: { id: Range; label: string }[] = [
  { id: 'daily',     label: 'Today' },
  { id: 'weekly',    label: 'Week' },
  { id: 'monthly',   label: 'Month' },
  { id: 'quarterly', label: 'Quarter' },
];

const STATUS_COLORS: Record<string, string> = {
  PENDING:   'bg-amber-100 text-amber-700',
  CONFIRMED: 'bg-blue-100 text-blue-700',
  DELIVERED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
};

import { useOwnerRealtime } from '../../hooks/useRealtime';

export default function OwnerHome() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>('weekly');
  const { data, isLoading } = useOwnerDash(range);

  useOwnerRealtime();

  const { data: aiSummary } = useQuery({
    queryKey: ['ai-summary'],
    queryFn: () => api.get('/ai/reports/summary').then(r => r.data),
    staleTime: 10 * 60_000,
    retry: false,
  });

  const hour = dayjs().hour();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.fullName?.split(' ')[0] ?? 'Director';

  // Differential revenue = actual - expected
  const differentialRevenue = data
    ? data.revenueKes - (data.expectedRevenueKes ?? 0)
    : 0;

  const confirmedVsExpectedColor = data && data.confirmedOrdersTotal >= (data.expectedRevenueKes ?? 0)
    ? 'text-green-600 dark:text-green-400'
    : 'text-amber-500 dark:text-amber-400';

  const actualVsExpectedColor = data && data.revenueKes >= (data.expectedRevenueKes ?? 0)
    ? 'text-green-600 dark:text-green-400'
    : 'text-amber-500';

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-6xl mx-auto">

      {/* Header */}
      <div className="bg-brand-green text-white rounded-2xl p-4 md:p-6">
        <p className="text-sm opacity-75">{dayjs().format('dddd, D MMMM YYYY')}</p>
        <p className="text-xl md:text-2xl font-bold mt-1">{greeting}, {firstName}</p>
        <p className="text-sm opacity-75 mt-0.5">Anza Whole Foods — Director Overview</p>
      </div>

      {/* Period range tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-2xl p-1">
        {RANGE_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setRange(t.id)}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-colors ${
              range === t.id
                ? 'bg-white dark:bg-dark-card text-brand-green shadow-sm'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Feed alerts banner removed from Director dashboard */}

      {/* KPI grid — top row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={<Bird className="w-5 h-5" />} label="Total Birds" value={data?.totalBirds?.toLocaleString() ?? '—'} sub={`${data?.activeBatchCount ?? 0} active ${(data?.activeBatchCount ?? 0) === 1 ? 'batch' : 'batches'}`} loading={isLoading} />
        <KpiCard icon={<Egg className="w-5 h-5" />} label={`${data?.periodLabel ?? ''} Eggs`} value={data?.periodEggs?.toLocaleString() ?? '—'} sub={`${data?.periodTrays ?? 0} trays · ${data?.avgHdp ?? 0}% HDP`} loading={isLoading} />
        {/* Revenue — full number, no "K" abbreviation */}
        <KpiCard
          icon={<DollarSign className="w-5 h-5" />}
          label="Revenue"
          value={data ? `KES ${data.revenueKes.toLocaleString()}` : '—'}
          sub={data?.periodLabel}
          loading={isLoading}
          accent
        />
        {/* Outstanding AR — full number, no "K" abbreviation */}
        <KpiCard
          icon={<Activity className="w-5 h-5" />}
          label="Outstanding AR"
          value={data ? `KES ${data.totalOutstandingKes.toLocaleString()}` : '—'}
          sub={data ? `${data.overdueInvoices} overdue` : '—'}
          alert={(data?.overdueInvoices ?? 0) > 0}
          loading={isLoading}
          onClick={() => navigate('/owner/finance')}
        />
      </div>

      {/* Cumulative egg counter */}
      <div className="bg-gradient-to-r from-brand-green to-brand-teal text-white rounded-2xl p-5 flex items-center justify-between">
        <div>
          <p className="text-xs opacity-75 mb-1">Cumulative Eggs Produced</p>
          <p className="text-3xl md:text-4xl font-black tracking-tight">
            {data ? data.cumulativeEggs.toLocaleString() : '—'}
          </p>
          <p className="text-xs opacity-75 mt-1">All-time total incl. historical offset</p>
        </div>
        <Egg className="w-12 h-12 opacity-20" />
      </div>

      {/* Secondary KPIs — 3 cards (Feed Status card removed) */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <KpiCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="Mortality"
          value={data?.periodMortality?.toLocaleString() ?? '—'}
          sub={`${data?.periodCulling ?? 0} culled`}
          alert={(data?.periodMortality ?? 0) > 20}
          loading={isLoading}
        />
        {/* Pending Verifications relabelled to Morning Tally Sign-Off */}
        <KpiCard
          icon={<Lock className="w-5 h-5" />}
          label="Morning Tally Sign-Off"
          value={data?.pendingVerifications?.toLocaleString() ?? '—'}
          sub="sessions awaiting 3-party cosign"
          alert={(data?.pendingVerifications ?? 0) > 0}
          loading={isLoading}
          onClick={() => navigate('/owner/tally')}
        />
        <KpiCard
          icon={<Lock className="w-5 h-5" />}
          label="Pending Approvals"
          value={data?.pendingApprovals?.toLocaleString() ?? '—'}
          sub="LPOs to approve"
          alert={(data?.pendingApprovals ?? 0) > 0}
          loading={isLoading}
        />
      </div>

      {/* Today's Egg Pricing — visible only on "Today" tab */}
      {range === 'daily' && (
        <div className={`rounded-2xl border p-5 ${
          data?.todayPricing
            ? 'bg-white dark:bg-dark-card border-gray-100 dark:border-dark-border'
            : 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800'
        }`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-brand-green" />
              Today's Egg Prices
            </h3>
            {data?.todayPricing ? (
              <span className="text-[10px] font-semibold px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full">
                ✓ Set by accountant
              </span>
            ) : (
              <span className="text-[10px] font-semibold px-2 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-full">
                ⚠ Not set yet
              </span>
            )}
          </div>

          {!data?.todayPricing ? (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              The accountant has not set today's egg prices yet. Orders cannot be created until prices are set.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-green-600 dark:text-green-500 uppercase tracking-wider mb-1">Standard</p>
                  <p className="text-lg font-extrabold text-green-700 dark:text-green-400">
                    KES {Number(data.todayPricing.pricePerEgg).toFixed(2)}
                    <span className="text-xs font-normal text-green-600 dark:text-green-500">/egg</span>
                  </p>
                  <p className="text-[11px] text-green-600 dark:text-green-500 mt-0.5">
                    = KES {(Number(data.todayPricing.pricePerEgg) * 30).toFixed(2)}/tray
                  </p>
                </div>

                <div className={`rounded-xl p-3 ${data.todayPricing.pricePerEggStarter != null ? 'bg-blue-50 dark:bg-blue-900/20' : 'bg-gray-50 dark:bg-dark-bg opacity-50'}`}>
                  <p className="text-[10px] font-bold text-blue-600 dark:text-blue-500 uppercase tracking-wider mb-1">Starter</p>
                  {data.todayPricing.pricePerEggStarter != null ? (
                    <>
                      <p className="text-lg font-extrabold text-blue-700 dark:text-blue-400">
                        KES {Number(data.todayPricing.pricePerEggStarter).toFixed(2)}
                        <span className="text-xs font-normal text-blue-600 dark:text-blue-500">/egg</span>
                      </p>
                      <p className="text-[11px] text-blue-600 dark:text-blue-500 mt-0.5">
                        = KES {(Number(data.todayPricing.pricePerEggStarter) * 30).toFixed(2)}/tray
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-400 dark:text-dark-muted">Not set</p>
                  )}
                </div>

                <div className={`rounded-xl p-3 ${data.todayPricing.pricePerEggBroken != null ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-gray-50 dark:bg-dark-bg opacity-50'}`}>
                  <p className="text-[10px] font-bold text-amber-600 dark:text-amber-500 uppercase tracking-wider mb-1">Broken Sellable</p>
                  {data.todayPricing.pricePerEggBroken != null ? (
                    <>
                      <p className="text-lg font-extrabold text-amber-700 dark:text-amber-400">
                        KES {Number(data.todayPricing.pricePerEggBroken).toFixed(2)}
                        <span className="text-xs font-normal text-amber-600 dark:text-amber-500">/egg</span>
                      </p>
                      <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-0.5">
                        = KES {(Number(data.todayPricing.pricePerEggBroken) * 30).toFixed(2)}/tray
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-400 dark:text-dark-muted">Not set</p>
                  )}
                </div>
              </div>

              {data.todayPricing.notes && (
                <p className="mt-3 text-[11px] text-gray-400 dark:text-dark-muted italic border-t border-gray-100 dark:border-dark-border pt-2">
                  Note: {data.todayPricing.notes}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {data && (
        <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-5 space-y-4">
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300">Revenue & Sales Summary</h3>

          {/* Revenue row — 4 columns including new Differential Revenue card */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-gray-400 dark:text-dark-muted">Expected Revenue</p>
              <p className="text-xl font-bold text-blue-600 dark:text-blue-400">
                KES {(data.expectedRevenueKes ?? 0).toLocaleString()}
              </p>
              <p className="text-[10px] text-gray-400 dark:text-dark-muted">Tally stock × accountant pricing</p>
            </div>

            <div>
              <p className="text-xs text-gray-400 dark:text-dark-muted">Confirmed Orders</p>
              <p className={`text-xl font-bold ${confirmedVsExpectedColor}`}>
                KES {(data.confirmedOrdersTotal ?? 0).toLocaleString()}
              </p>
              <p className="text-[10px] text-gray-400 dark:text-dark-muted">{data.confirmedOrdersCount ?? 0} confirmed orders</p>
            </div>

            <div>
              <p className="text-xs text-gray-400 dark:text-dark-muted">Actual Revenue</p>
              <p className={`text-xl font-bold ${actualVsExpectedColor}`}>
                KES {data.revenueKes.toLocaleString()}
              </p>
              <p className="text-[10px] text-gray-400 dark:text-dark-muted">From completed invoice payments</p>
            </div>

            {/* NEW — Differential Revenue */}
            <div className={`rounded-xl p-3 ${
              differentialRevenue >= 0
                ? 'bg-green-50 dark:bg-green-900/20'
                : 'bg-red-50 dark:bg-red-900/20'
            }`}>
              <p className="text-xs text-gray-400 dark:text-dark-muted">Differential Revenue</p>
              <p className={`text-xl font-bold ${
                differentialRevenue >= 0
                  ? 'text-green-700 dark:text-green-400'
                  : 'text-red-600 dark:text-red-400'
              }`}>
                {differentialRevenue >= 0 ? '+' : ''}
                KES {Math.abs(differentialRevenue).toLocaleString()}
              </p>
              <p className="text-[10px] text-gray-400 dark:text-dark-muted">
                {differentialRevenue >= 0 ? 'Surplus' : 'Shortfall'} vs expected
              </p>
            </div>
          </div>

          {/* Eggs sold breakdown */}
          <div className="pt-3 border-t border-gray-100 dark:border-dark-border">
            <p className="text-xs font-semibold text-gray-500 dark:text-dark-muted mb-2">Eggs Sold — {data.periodLabel}</p>
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-gray-50 dark:bg-dark-bg rounded-xl p-3 text-center">
                <p className="text-lg font-extrabold text-gray-800 dark:text-dark-text">{(data.totalEggsSold ?? 0).toLocaleString()}</p>
                <p className="text-[10px] text-gray-400 dark:text-dark-muted font-medium mt-0.5">Total Sold</p>
              </div>
              <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-3 text-center">
                <p className="text-lg font-extrabold text-green-700 dark:text-green-400">{(data.totalStandardEggsSold ?? 0).toLocaleString()}</p>
                <p className="text-[10px] text-green-600 dark:text-green-500 font-medium mt-0.5">Standard</p>
              </div>
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 text-center">
                <p className="text-lg font-extrabold text-blue-700 dark:text-blue-400">{(data.totalStarterEggsSold ?? 0).toLocaleString()}</p>
                <p className="text-[10px] text-blue-600 dark:text-blue-500 font-medium mt-0.5">Starter</p>
              </div>
              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 text-center">
                <p className="text-lg font-extrabold text-amber-700 dark:text-amber-400">{(data.totalBrokenEggsSold ?? 0).toLocaleString()}</p>
                <p className="text-[10px] text-amber-600 dark:text-amber-500 font-medium mt-0.5">Broken Sellable</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Live Sales Feed */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-bold text-gray-700 dark:text-gray-300">
            Sales Feed — {data?.periodLabel}
          </p>
          <button onClick={() => navigate('/owner/sales-orders')} className="text-xs text-brand-green font-medium flex items-center gap-0.5">
            See all <ChevronRight className="w-3 h-3" />
          </button>
        </div>
        {isLoading ? (
          <p className="text-sm text-gray-400 py-4 text-center">Loading…</p>
        ) : !data?.salesFeed?.length ? (
          <p className="text-sm text-gray-400 py-4 text-center">No orders in this period</p>
        ) : (
          <div className="space-y-2">
            {data.salesFeed.map(order => (
              <div key={order.id} className="bg-white dark:bg-dark-card rounded-2xl p-3 border border-gray-100 dark:border-dark-border">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">{order.customerName}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                        order.status === 'CONFIRMED'  ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' :
                        order.status === 'DELIVERED'  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                        order.status === 'DELIVERING' ? 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300' :
                        order.status === 'CANCELLED'  ? 'bg-gray-100 dark:bg-gray-800 text-gray-500' :
                        'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                      }`}>
                        {order.status}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 dark:text-dark-muted">{order.orderNumber} · {dayjs(order.date).format('D MMM')}</p>
                  </div>
                  <p className="text-sm font-bold text-brand-green dark:text-brand-greenDark flex-shrink-0">KES {order.amountKes.toLocaleString()}</p>
                </div>
                {order.totalEggs > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-gray-50 dark:border-dark-border">
                    {order.standardEggs > 0 && (
                      <span className="text-[10px] bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full font-medium">
                        {order.standardEggs.toLocaleString()} standard
                      </span>
                    )}
                    {order.starterEggs > 0 && (
                      <span className="text-[10px] bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-full font-medium">
                        {order.starterEggs.toLocaleString()} starter
                      </span>
                    )}
                    {order.brokenEggs > 0 && (
                      <span className="text-[10px] bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full font-medium">
                        {order.brokenEggs.toLocaleString()} broken sellable
                      </span>
                    )}
                    <span className="text-[10px] text-gray-400 dark:text-dark-muted ml-auto">
                      {order.trays} trays total
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Block 1 Cage Map */}
      <CageMapPanel />
      <BrooderMapPanel />

      {/* AI Intelligence Summary */}
      {(aiSummary || data?.latestAiSummary) && (() => {
        const summary = aiSummary ?? data?.latestAiSummary;
        const content = summary?.content ?? summary?.summary ?? '';
        const ts = summary?.generatedAt;
        return (
          <div className="bg-gradient-to-br from-brand-green/5 to-brand-teal/5 border border-brand-green/20 dark:border-brand-green/30 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-brand-green" />
                <p className="text-xs font-semibold text-brand-green">
                  Farm Intelligence{ts ? ` — ${dayjs(ts).format('D MMM YYYY')}` : ''}
                </p>
              </div>
              <button
                onClick={() => navigate('/owner/reports')}
                className="flex items-center gap-1 text-xs text-brand-green hover:underline"
              >
                View all reports <ArrowRight className="w-3 h-3" />
              </button>
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              {content}{content.length >= 300 ? '…' : ''}
            </p>
          </div>
        );
      })()}
    </div>
  );
}

// ── Cage Map Collapsible Panel ────────────────────────────────────────────────

function CageMapPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-gray-100 dark:border-dark-border overflow-hidden shadow-sm">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-white dark:bg-dark-card hover:bg-gray-50 dark:hover:bg-dark-border transition-colors"
      >
        <div className="flex items-center gap-2">
          <Map className="w-4 h-4 text-brand-green" />
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">Block 1 — Live Cage Map</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-medium">
            Live
          </span>
        </div>
        <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div style={{ background: '#060c08', padding: '16px 20px' }}>
          <CageMap blockCode="BLK1" compact={false} />
        </div>
      )}
    </div>
  );
}

function BrooderMapPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-gray-100 dark:border-dark-border overflow-hidden shadow-sm">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-white dark:bg-dark-card hover:bg-gray-50 dark:hover:bg-dark-border transition-colors"
      >
        <div className="flex items-center gap-2">
          <Map className="w-4 h-4 text-blue-500" />
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">Brooder — Live Map</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium">
            Live
          </span>
        </div>
        <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div style={{ background: '#060c08', padding: '16px 20px' }}>
          <BrooderCageMap />
        </div>
      )}
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({
  icon, label, value, sub, alert = false, accent = false, loading = false, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  alert?: boolean;
  accent?: boolean;
  loading?: boolean;
  onClick?: () => void;
}) {
  const base = 'rounded-2xl p-4 shadow-sm border text-left transition-all';
  const color = alert   ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
              : accent  ? 'bg-brand-green/5 dark:bg-brand-green/10 border-brand-green/20'
              : 'bg-white dark:bg-dark-card border-gray-100 dark:border-dark-border';
  const El: any = onClick ? 'button' : 'div';
  return (
    <El onClick={onClick} className={`${base} ${color} ${onClick ? 'hover:shadow-md active:scale-[0.98] cursor-pointer w-full' : ''}`}>
      <div className={`mb-2 ${alert ? 'text-red-500' : accent ? 'text-brand-green' : 'text-gray-400'}`}>{icon}</div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">{label}</p>
      {loading ? (
        <div className="h-7 w-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
      ) : (
        <p className={`text-xl font-bold ${alert ? 'text-red-600 dark:text-red-400' : accent ? 'text-brand-green' : 'text-gray-800 dark:text-gray-100'}`}>{value}</p>
      )}
      {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
    </El>
  );
}
