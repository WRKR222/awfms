// src/components/shared/BrooderFeedSummary.tsx
// Shared widget showing the latest brooder log (feed type + amount) per batch.
// Used on PM (ManagerHome) and Director (OwnerHome) dashboards.
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import dayjs from 'dayjs';
import { Flame, AlertTriangle, Calendar, CheckCircle2 } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LastLog {
  logDate: string;
  feedType: string | null;
  feedConsumedKg: number | null;
  waterConsumptionL: number | null;
  temperature: number | null;
  lightingOk: boolean;
  mortalityCount: number;
  vaccineGiven: string | null;
  notes: string | null;
}

interface BrooderBatchSummary {
  batchId: string;
  batchCode: string;
  currentBirdCount: number;
  survivalRate: number | null;
  ageWeeks: number;
  supplierName: string | null;
  lastLog: LastLog | null;
  daysSinceLastLog: number | null;
  logOverdue: boolean;
}

interface BrooderSummaryResponse {
  batches: BrooderBatchSummary[];
}

const FEED_LABELS: Record<string, string> = {
  CHICK_MASH:  'Chick & Duckling Mash',
  GROWER_MASH: "Grower's Mash",
  LAYER_MASH:  "Layer's Mash",
};

function feedLabel(type: string | null) {
  if (!type) return null;
  return FEED_LABELS[type] ?? type;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function OverdueBadge({ days }: { days: number | null }) {
  if (days === null) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 font-semibold">
        <AlertTriangle className="w-2.5 h-2.5" /> No entries
      </span>
    );
  }
  if (days === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 font-semibold">
        <CheckCircle2 className="w-2.5 h-2.5" /> Today
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 font-semibold">
      <AlertTriangle className="w-2.5 h-2.5" /> {days}d overdue
    </span>
  );
}

function BatchRow({ b }: { b: BrooderBatchSummary }) {
  const log = b.lastLog;
  const hasFeed = log && (log.feedConsumedKg != null || log.feedType);

  return (
    <div className={`rounded-xl p-3 text-xs space-y-2 border ${
      b.logOverdue
        ? 'bg-orange-50 dark:bg-orange-900/10 border-orange-200 dark:border-orange-800/50'
        : 'bg-gray-50 dark:bg-dark-bg border-gray-100 dark:border-dark-border'
    }`}>
      {/* Batch header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="font-bold text-gray-800 dark:text-gray-100 font-mono">{b.batchCode}</span>
          <span className="text-gray-400">{b.ageWeeks}wk · {b.currentBirdCount.toLocaleString()} birds</span>
          {b.survivalRate != null && (
            <span className="text-gray-400">· {b.survivalRate}% survival</span>
          )}
        </div>
        <OverdueBadge days={b.daysSinceLastLog} />
      </div>

      {/* Last log details */}
      {log ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1 text-gray-400">
            <Calendar className="w-3 h-3" />
            <span>Last log: <strong className="text-gray-600 dark:text-gray-300">{dayjs(log.logDate).format('ddd D MMM YYYY')}</strong></span>
          </div>
          <div className="flex flex-wrap gap-3">
            {/* Feed — most important, highlighted */}
            {hasFeed ? (
              <span className="flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-lg">
                🌾{' '}
                {log.feedConsumedKg != null ? `${log.feedConsumedKg} kg` : ''}
                {log.feedType ? ` · ${feedLabel(log.feedType)}` : ' feed'}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-gray-400 italic">🌾 No feed recorded</span>
            )}
            {log.waterConsumptionL != null && (
              <span className="text-gray-500 dark:text-gray-400">💧 {log.waterConsumptionL}L water</span>
            )}
            {log.temperature != null && (
              <span className="text-gray-500 dark:text-gray-400">🌡 {log.temperature}°C</span>
            )}
            {!log.lightingOk && (
              <span className="text-red-500">⚠ Lighting issue</span>
            )}
            {log.mortalityCount > 0 && (
              <span className="text-red-500">💀 {log.mortalityCount} {log.mortalityCount === 1 ? 'mortality' : 'mortalities'}</span>
            )}
          </div>
          {log.vaccineGiven && (
            <p className="text-gray-400">💉 {log.vaccineGiven}</p>
          )}
          {log.notes && (
            <p className="text-gray-400 italic truncate" title={log.notes}>{log.notes}</p>
          )}
        </div>
      ) : (
        <p className="text-red-400 italic">No entries logged yet.</p>
      )}
    </div>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────

export function BrooderFeedSummary() {
  const { data, isLoading } = useQuery<BrooderSummaryResponse>({
    queryKey: ['brooder-summary'],
    queryFn: () => api.get('/dashboard/brooder-summary').then(r => r.data),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const batches = data?.batches ?? [];
  const overdueCount = batches.filter(b => b.logOverdue).length;

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2].map(i => (
          <div key={i} className="h-20 rounded-xl bg-gray-100 dark:bg-dark-bg animate-pulse" />
        ))}
      </div>
    );
  }

  if (batches.length === 0) {
    return (
      <div className="text-xs text-gray-400 text-center py-4 italic">
        No active brooder batches.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Summary bar */}
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
          {batches.length} batch{batches.length !== 1 ? 'es' : ''} · {batches.reduce((s, b) => s + b.currentBirdCount, 0).toLocaleString()} chicks
        </p>
        {overdueCount > 0 && (
          <span className="text-[10px] font-semibold text-orange-600 dark:text-orange-400 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            {overdueCount} batch{overdueCount > 1 ? 'es' : ''} need logging
          </span>
        )}
      </div>

      {/* Batch rows */}
      {batches.map(b => (
        <BatchRow key={b.batchId} b={b} />
      ))}
    </div>
  );
}
