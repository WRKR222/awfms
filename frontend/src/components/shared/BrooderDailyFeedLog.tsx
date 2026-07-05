// src/components/shared/BrooderDailyFeedLog.tsx
//
// PM-facing widget: how much feed was dispensed farm-wide on EACH day of
// the current calendar week, so the PM can see at a glance whether any day
// was skipped entirely — instead of only seeing a single weekly total that
// could hide a bad day.
//
// Deliberately does NOT show any "residual" / feed-remaining figure — that
// belongs to Store, who track actual stock so they don't over-issue. This
// widget is purely "how much went out each day", for pattern analysis.

import { AlertTriangle, CalendarDays, Wheat } from 'lucide-react';
import { useDailyFeedBreakdown } from '../../hooks/useBrooderCageMap';

export function BrooderDailyFeedLog() {
  const { data, isLoading } = useDailyFeedBreakdown();

  if (isLoading) {
    return (
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-gray-100 dark:bg-dark-bg animate-pulse" />
        ))}
      </div>
    );
  }

  const days = data?.days ?? [];
  if (days.length === 0) {
    return (
      <div className="text-xs text-gray-400 text-center py-4 italic">
        No feed data for this week yet.
      </div>
    );
  }

  const maxKg = Math.max(1, ...days.map(d => d.dispensedKg));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1">
          <CalendarDays className="w-3 h-3 text-amber-500" />
          This week, by day
        </p>
        <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">
          Total: {data!.totalKg}kg
        </p>
      </div>

      {data!.skippedDays.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-2.5 text-xs text-red-700 dark:text-red-400 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            No feed logged at all on: <strong>{data!.skippedDays.join(', ')}</strong>
          </span>
        </div>
      )}

      <div className="grid grid-cols-7 gap-1.5">
        {days.map(d => (
          <div
            key={d.date}
            className={`rounded-xl p-2 text-center border ${
              d.skipped
                ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                : 'bg-gray-50 dark:bg-dark-bg border-gray-100 dark:border-dark-border'
            }`}
          >
            <p className="text-[9px] text-gray-400 uppercase truncate">{d.dayLabel.slice(0, 3)}</p>
            <div className="h-8 flex items-end justify-center my-1">
              <div
                className={`w-3 rounded-t ${d.skipped ? 'bg-red-300 dark:bg-red-700' : 'bg-amber-400'}`}
                style={{ height: `${Math.max(4, (d.dispensedKg / maxKg) * 100)}%` }}
              />
            </div>
            <p className={`text-[10px] font-bold ${
              d.skipped ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-200'
            }`}>
              {d.dispensedKg}kg
            </p>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-gray-400 italic flex items-center gap-1">
        <Wheat className="w-3 h-3" />
        Farm-wide feed dispensed per calendar day — flags a day with zero logged feed.
      </p>
    </div>
  );
}
