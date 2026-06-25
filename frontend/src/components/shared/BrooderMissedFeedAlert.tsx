// src/components/shared/BrooderMissedFeedAlert.tsx
// Flags any row/level whose required ration for YESTERDAY was not fully
// dispensed. Surfaced on Lead Attendant and PM home pages so a missed
// feeding is caught the morning after it happens.
import { AlertTriangle } from 'lucide-react';
import { useMissedFeedAlerts } from '../../hooks/useBrooderCageMap';
import dayjs from '../../lib/dayjs';

export function BrooderMissedFeedAlert() {
  const { data, isLoading } = useMissedFeedAlerts();

  if (isLoading) return null;

  const alerts = data?.alerts ?? [];
  if (alerts.length === 0) return null;

  return (
    <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-300 dark:border-red-700 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
        <p className="font-bold text-red-700 dark:text-red-400 text-sm">
          {alerts.length} {alerts.length === 1 ? 'Level' : 'Levels'} Missed Required Feed —{' '}
          {dayjs(data!.date).format('ddd D MMM')}
        </p>
      </div>
      <p className="text-xs text-red-500 dark:text-red-500 mb-3">
        These rows/levels did not receive the full daily ration yesterday. Catch up as soon as possible.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {alerts.map(a => (
          <div key={a.levelId} className="bg-white dark:bg-dark-card rounded-xl p-3 border border-red-100 dark:border-red-800 text-xs">
            <p className="font-semibold text-gray-800 dark:text-gray-200">
              {a.rowLabel} · {a.levelLabel} · <span className="font-mono">{a.batchCode}</span>
            </p>
            <p className="text-red-600 dark:text-red-400 mt-1 font-medium">
              Given {a.dispensedKg}kg of {a.requiredKg}kg required — short by {a.shortfallKg}kg
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
