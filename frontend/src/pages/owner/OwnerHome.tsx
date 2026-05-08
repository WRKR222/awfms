// src/pages/owner/OwnerHome.tsx  (REPLACE existing file)
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

type Range = 'daily' | 'weekly' | 'monthly' | 'quarterly';

interface DashData {
  range: Range;
  periodLabel: string;
  periodFrom: string;
  totalBirds: number;
  activeBatchCount: number;
  pendingVerifications: number;
  periodEggs: number;
  periodTrays: number;
  avgHdp: number;
  cumulativeEggs: number;
  revenueKes: number;
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
    amountKes: number;
    status: string;
    date: string;
  }>;
  latestAiSummary?: { summary: string; generatedAt: string } | null;
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

export function OwnerHome() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>('weekly');
  const { data, isLoading } = useOwnerDash(range);

  // PW-02: real-time updates (WS on desktop, polling on mobile)
  useOwnerRealtime();

  // Dedicated AI summary from the AI module (separate from dashboard endpoint)
  const { data: aiSummary } = useQuery({
    queryKey: ['ai-summary'],
    queryFn: () => api.get('/ai/reports/summary').then(r => r.data),
    staleTime: 10 * 60_000,
    retry: false, // don't spam if AI key not configured yet
  });

  const hour = dayjs().hour();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.fullName?.split(' ')[0] ?? 'Director';

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

      {/* Feed alerts banner */}
      {(data?.feedAlertsCount ?? 0) > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-300 dark:border-red-700 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Flame className="w-5 h-5 text-red-600 dark:text-red-400" />
            <p className="font-bold text-red-700 dark:text-red-400 text-sm">
              {data!.feedAlertsCount} Feed Type{data!.feedAlertsCount > 1 ? 's' : ''} Running Low
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {data!.feedAlerts.map(a => (
              <span key={a.feedType} className="bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-xs px-3 py-1 rounded-full font-medium">
                {a.feedType.replace(/_/g, ' ')} — {Number(a.daysRemaining).toFixed(1)}d left
              </span>
            ))}
          </div>
        </div>
      )}

      {/* KPI grid — top row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={<Bird className="w-5 h-5" />} label="Total Birds" value={data?.totalBirds?.toLocaleString() ?? '—'} sub={`${data?.activeBatchCount ?? 0} active batches`} loading={isLoading} />
        <KpiCard icon={<Egg className="w-5 h-5" />} label={`${data?.periodLabel ?? ''} Eggs`} value={data?.periodEggs?.toLocaleString() ?? '—'} sub={`${data?.periodTrays ?? 0} trays · ${data?.avgHdp ?? 0}% HDP`} loading={isLoading} />
        <KpiCard icon={<DollarSign className="w-5 h-5" />} label="Revenue" value={data ? `KES ${(data.revenueKes / 1000).toFixed(1)}K` : '—'} sub={data?.periodLabel} loading={isLoading} accent />
        <KpiCard icon={<Activity className="w-5 h-5" />} label="Outstanding AR" value={data ? `KES ${(data.totalOutstandingKes / 1000).toFixed(1)}K` : '—'} sub={data ? `${data.overdueInvoices} overdue` : '—'} alert={(data?.overdueInvoices ?? 0) > 0} loading={isLoading} onClick={() => navigate('/owner/finance')} />
      </div>

      {/* Cumulative egg counter — big display */}
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

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={<TrendingUp className="w-5 h-5" />} label="Mortality" value={data?.periodMortality?.toLocaleString() ?? '—'} sub={`${data?.periodCulling ?? 0} culled`} alert={(data?.periodMortality ?? 0) > 20} loading={isLoading} />
        <KpiCard icon={<Lock className="w-5 h-5" />} label="Pending Verifications" value={data?.pendingVerifications?.toLocaleString() ?? '—'} sub="flock entries" alert={(data?.pendingVerifications ?? 0) > 5} loading={isLoading} />
        <div className="col-span-2 bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border">
          <p className="text-xs text-gray-500 mb-2 font-semibold">Feed Status</p>
          {(data?.feedAlertsCount ?? 0) === 0 ? (
            <p className="text-sm text-green-600 dark:text-green-400 font-medium">✓ All feed stocks adequate</p>
          ) : (
            <p className="text-sm text-red-600 dark:text-red-400 font-medium">{data!.feedAlertsCount} type(s) need urgent reorder</p>
          )}
        </div>
      </div>

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
              <div key={order.id} className="bg-white dark:bg-dark-card rounded-2xl p-3 border border-gray-100 dark:border-dark-border flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">{order.customerName}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${STATUS_COLORS[order.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {order.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">{order.orderNumber} · {order.trays} trays · {dayjs(order.date).format('D MMM')}</p>
                </div>
                <p className="text-sm font-bold text-brand-green flex-shrink-0">KES {order.amountKes.toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Block 1 Cage Map — collapsible production section */}
      <CageMapPanel />

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

// ── Cage Map Collapsible Panel (Director view) ────────────────────────────────

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
