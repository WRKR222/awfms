// src/components/shared/BrooderMissedFeedAlert.tsx
//
// Flags any row/level that issued significantly less than the HyLine schedule
// for YESTERDAY.  Framed as an informational alert — not an enforcement action.
// The schedule is advisory; this alert helps the attendant / PM notice if
// birds may have been under-fed, so they can investigate and catch up.
//
// Threshold (mirrored from brooder.service.ts): alert if shortfall > 0.05 kg
// (rounding tolerance), applied uniformly regardless of batch age. A batch
// that isn't eating at all yet is caught separately by the
// BROODER_EARLY_PHASE_NOT_EATING alert, not by relaxing this one.

import { AlertTriangle, Info } from 'lucide-react';
import { useMissedFeedAlerts } from '../../hooks/useBrooderCageMap';
import dayjs from '../../lib/dayjs';

export function BrooderMissedFeedAlert() {
  const { data, isLoading } = useMissedFeedAlerts();

  if (isLoading) return null;

  const alerts = data?.alerts ?? [];
  if (alerts.length === 0) return null;

  return (
    <div className="bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-300 dark:border-amber-700 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
        <p className="font-bold text-amber-700 dark:text-amber-400 text-sm">
          {alerts.length} {alerts.length === 1 ? 'Level' : 'Levels'} Below Schedule —{' '}
          {dayjs(data!.date).format('ddd D MMM')}
        </p>
      </div>
      <div className="flex items-start gap-1.5 mb-3">
        <Info className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-600 dark:text-amber-400">
          These levels issued less than the HyLine schedule yesterday. If birds had
          carry-forward feed from a previous day, log a "No New Feed" entry to clear
          this alert. Otherwise consider topping up feed today.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {alerts.map(a => (
          <div key={a.levelId} className="bg-white dark:bg-dark-card rounded-xl p-3 border border-amber-100 dark:border-amber-800 text-xs">
            <p className="font-semibold text-gray-800 dark:text-gray-200">
              {a.rowLabel} · {a.levelLabel} · <span className="font-mono">{a.batchCode}</span>
            </p>
            <p className="text-amber-600 dark:text-amber-400 mt-1 font-medium">
              Issued {a.dispensedKg}kg · Schedule {a.requiredKg}kg · shortfall {a.shortfallKg}kg
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
