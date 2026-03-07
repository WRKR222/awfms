import { usePendingEntries, useBatches } from '../../hooks/useFlock';
import { useFeedStock } from '../../hooks/useFeed';
import { AlertTriangle, CheckCircle, Package, Zap } from 'lucide-react';
import dayjs from 'dayjs';

export function ManagerHome() {
  const { data: pending = [] } = usePendingEntries();
  const { data: batches = [] } = useBatches({ isActive: true });
  const { data: feedStock } = useFeedStock();

  const lowFeedAlerts = feedStock
    ? Object.values(feedStock).filter((s: any) => s.isLow)
    : [];

  return (
    <div className="p-4 space-y-5">
      <div className="bg-brand-green text-white rounded-2xl p-4">
        <p className="text-sm opacity-75">{dayjs().format('dddd, D MMMM YYYY')}</p>
        <p className="text-xl font-bold mt-1">Farm Overview</p>
      </div>

      {/* Feed alerts */}
      {lowFeedAlerts.length > 0 && (
        <div className="bg-red-50 border-2 border-red-300 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            <p className="font-bold text-red-700">Low Feed Stock Alert</p>
          </div>
          {lowFeedAlerts.map((s: any) => (
            <div key={s.feedType} className="bg-white rounded-xl p-3 mt-2 border border-red-100">
              <p className="font-semibold text-gray-800">{s.feedType.replace(/_/g, ' ')}</p>
              <p className="text-sm text-red-600">
                {s.currentStockKg.toFixed(0)}kg remaining · {s.daysRemaining} days at current usage
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Recommended order: {(s.avgDailyUsageKg * 10).toFixed(0)}kg (10-day cycle)
              </p>
            </div>
          ))}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <p className="text-xs text-gray-500 mb-1">Active Batches</p>
          <p className="text-3xl font-bold text-brand-green">{batches.length}</p>
        </div>
        <div className={`rounded-2xl p-4 shadow-sm border ${pending.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-100'}`}>
          <p className="text-xs text-gray-500 mb-1">Pending Verification</p>
          <p className={`text-3xl font-bold ${pending.length > 0 ? 'text-amber-600' : 'text-gray-800'}`}>
            {pending.length}
          </p>
        </div>
      </div>

      {/* Feed stock overview */}
      {feedStock && (
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <p className="text-sm font-semibold text-gray-700 mb-3">Feed Stock Status</p>
          <div className="space-y-2">
            {Object.values(feedStock).filter((s: any) => s.avgDailyUsageKg > 0).map((s: any) => (
              <div key={s.feedType} className="flex items-center justify-between">
                <span className="text-sm text-gray-600">{s.feedType.replace(/_/g, ' ')}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{s.currentStockKg.toFixed(0)}kg</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.isLow ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                    {s.daysRemaining}d
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active batches list */}
      {batches.length > 0 && (
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <p className="text-sm font-semibold text-gray-700 mb-3">Active Batches</p>
          <div className="space-y-2">
            {batches.map((b: any) => (
              <div key={b.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <div>
                  <p className="text-sm font-semibold text-gray-800">{b.batchCode}</p>
                  <p className="text-xs text-gray-500">{b.house?.name} · {b.birdType.replace(/_/g, ' ')}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-brand-green">{b.currentBirdCount.toLocaleString()}</p>
                  <p className="text-xs text-gray-400">birds</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
