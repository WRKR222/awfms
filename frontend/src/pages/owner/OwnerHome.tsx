import { TrendingUp, AlertTriangle, Users, Zap, ChevronRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/auth.store';
import { useNotificationsStore } from '../../stores/notifications.store';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';

function useOwnerDashboard() {
  return useQuery({
    queryKey: ['owner-dashboard'],
    queryFn: async () => {
      const res = await api.get('/dashboard/owner');
      return res.data as {
        totalBirds: number;
        activeBatches: number;
        pendingVerifications: number;
        weeklyEggs: number;
        avgHenDayPct: number;
        totalOutstandingKes: number;
        overdueInvoices: number;
        feedAlertsCount: number;
        latestAiSummary?: { summary: string; generatedAt: string };
      };
    },
    staleTime: 60_000,
    retry: 1,
  });
}

function KpiCard({
  label, value, sub, alert = false, onClick
}: {
  label: string; value: string | number; sub?: string; alert?: boolean; onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-2xl p-4 shadow-sm border text-left w-full transition-all hover:shadow-md active:scale-98
        ${alert ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100'}`}
    >
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${alert ? 'text-red-600' : 'text-brand-green'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </button>
  );
}

export function OwnerHome() {
  const { user } = useAuthStore();
  const { data, isLoading } = useOwnerDashboard();
  const { notifications } = useNotificationsStore();
  const navigate = useNavigate();

  const firstName = user?.fullName?.split(' ')[0] ?? 'Director';

  const criticalAlerts = notifications.filter(
    n => !n.isRead && (n.type === 'FEED_LOW_STOCK' || n.type === 'MORTALITY_ANOMALY' || n.type === 'INVOICE_OVERDUE')
  );

  return (
    <div className="p-4 space-y-5">
      {/* Greeting */}
      <div className="bg-brand-green text-white rounded-2xl p-4">
        <p className="text-sm opacity-75">{dayjs().format('dddd, D MMMM YYYY')}</p>
        <p className="text-xl font-bold mt-1">Good morning, {firstName}</p>
        <p className="text-sm opacity-75 mt-0.5">Anza Whole Foods Farm Overview</p>
      </div>

      {/* Critical alerts banner */}
      {criticalAlerts.length > 0 && (
        <button
          onClick={() => navigate('/owner/notifications')}
          className="w-full bg-red-50 border-2 border-red-300 rounded-2xl p-4 flex items-center gap-3 text-left"
        >
          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-bold text-red-700">{criticalAlerts.length} Active Alert{criticalAlerts.length > 1 ? 's' : ''} — Action Required</p>
            <p className="text-sm text-red-600 mt-0.5">{criticalAlerts[0].title}</p>
          </div>
          <ChevronRight className="w-5 h-5 text-red-400" />
        </button>
      )}

      {/* AI Summary Card */}
      {data?.latestAiSummary && (
        <button
          onClick={() => navigate('/owner/ai')}
          className="w-full bg-gradient-to-br from-brand-green to-brand-teal text-white rounded-2xl p-4 text-left"
        >
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4" />
            <p className="text-sm font-bold">AI Weekly Summary</p>
            <p className="text-xs opacity-70 ml-auto">
              {dayjs(data.latestAiSummary.generatedAt).format('D MMM')}
            </p>
          </div>
          <p className="text-sm opacity-90 leading-relaxed line-clamp-3">
            {data.latestAiSummary.summary}
          </p>
          <p className="text-xs opacity-70 mt-2 underline">View full report →</p>
        </button>
      )}

      {/* KPI grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-gray-100 rounded-2xl p-4 h-20 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <KpiCard
            label="Total Birds"
            value={data?.totalBirds?.toLocaleString() ?? '—'}
            sub={`${data?.activeBatches ?? 0} active batches`}
          />
          <KpiCard
            label="Weekly Eggs"
            value={data?.weeklyEggs?.toLocaleString() ?? '—'}
            sub={`${data?.avgHenDayPct?.toFixed(1) ?? '—'}% hen-day avg`}
          />
          <KpiCard
            label="Feed Alerts"
            value={data?.feedAlertsCount ?? 0}
            alert={(data?.feedAlertsCount ?? 0) > 0}
            sub={(data?.feedAlertsCount ?? 0) > 0 ? 'Below 3-day threshold' : 'All stocks healthy'}
            onClick={() => navigate('/manager')}
          />
          <KpiCard
            label="AR Outstanding"
            value={data?.totalOutstandingKes ? `KES ${(data.totalOutstandingKes / 1000).toFixed(1)}K` : '—'}
            alert={(data?.overdueInvoices ?? 0) > 0}
            sub={data?.overdueInvoices ? `${data.overdueInvoices} overdue` : undefined}
            onClick={() => navigate('/owner/finance')}
          />
        </div>
      )}

      {/* Pending verifications */}
      {(data?.pendingVerifications ?? 0) > 0 && (
        <button
          onClick={() => navigate('/supervisor')}
          className="w-full bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3 text-left"
        >
          <Users className="w-5 h-5 text-amber-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-amber-700">
              {data?.pendingVerifications} entries awaiting supervisor verification
            </p>
            <p className="text-xs text-amber-500 mt-0.5">Tap to view verification queue</p>
          </div>
          <ChevronRight className="w-4 h-4 text-amber-400" />
        </button>
      )}

      {/* Performance trend */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-brand-green" />
          <p className="text-sm font-semibold text-gray-700">This Week</p>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Hen-Day Production</span>
            <span className="font-bold text-gray-800">
              {data?.avgHenDayPct ? `${data.avgHenDayPct.toFixed(1)}%` : '—'}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Active Batches</span>
            <span className="font-bold text-gray-800">{data?.activeBatches ?? '—'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Total Birds on Farm</span>
            <span className="font-bold text-gray-800">{data?.totalBirds?.toLocaleString() ?? '—'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
