// src/components/shared/BrooderFeedRequirement.tsx
// Required vs dispensed feed, per brooder row/level, for the current week.
// requiredKg = population on that level × standard g/bird/day × 7.
// Surfaced identically on Attendant, PM (Manager) and Director (Owner)
// dashboards — when a row/level gets the EXACT required amount, the
// Director sees that confirmation here too.

import { useState } from 'react';
import { Wheat, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { useBrooderFeedRequirement, type FeedRequirementRow } from '../../hooks/useBrooderCageMap';

function variancePill(pct: number | null) {
  if (pct === null) {
    return <span className="text-[10px] text-gray-400 italic">No population</span>;
  }
  if (pct === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
        <CheckCircle2 className="w-2.5 h-2.5" /> Exact amount given
      </span>
    );
  }
  const over = pct > 0;
  const color = Math.abs(pct) <= 5
    ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
    : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400';
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${color}`}>
      <AlertTriangle className="w-2.5 h-2.5" /> {over ? '+' : ''}{pct}% {over ? 'over' : 'under'}
    </span>
  );
}

function RowLine({ row }: { row: FeedRequirementRow }) {
  const [open, setOpen] = useState(false);
  if (row.birdTotal === 0) return null;

  return (
    <div className="rounded-xl border border-gray-100 dark:border-dark-border bg-gray-50 dark:bg-dark-bg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-xs"
      >
        <div className="flex items-center gap-2">
          <span className="font-bold text-gray-800 dark:text-gray-100">{row.label}</span>
          <span className="text-gray-400">{row.birdTotal.toLocaleString()} chicks</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-gray-600 dark:text-gray-300">
            {row.dispensedKgThisWeek}/{row.requiredKgThisWeek}kg
          </span>
          {row.exactMatch ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          )}
          {open ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
        </div>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-1.5 border-t border-gray-100 dark:border-dark-border pt-2">
          {row.levels.map(l => (
            <div key={l.levelId} className="flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-gray-500 dark:text-gray-400 flex-shrink-0">{l.label}</span>
                <span className="font-mono text-gray-700 dark:text-gray-200 truncate">{l.batchCode}</span>
                <span className="text-gray-400 flex-shrink-0">{l.birdCount.toLocaleString()}b</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="font-mono text-gray-500 dark:text-gray-400">
                  {l.dispensedKgThisWeek}/{l.requiredKgThisWeek ?? '—'}kg
                </span>
                {variancePill(l.feedVariancePercent)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function BrooderFeedRequirement() {
  const { data, isLoading } = useBrooderFeedRequirement();

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2].map(i => (
          <div key={i} className="h-12 rounded-xl bg-gray-100 dark:bg-dark-bg animate-pulse" />
        ))}
      </div>
    );
  }

  const rows = (data?.rows ?? []).filter(r => r.birdTotal > 0);

  if (rows.length === 0) {
    return (
      <div className="text-xs text-gray-400 text-center py-4 italic">
        No chicks placed on the cage map yet.
      </div>
    );
  }

  const exactRows = rows.filter(r => r.exactMatch).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1">
          <Wheat className="w-3 h-3 text-amber-500" />
          Required this week: {data?.totalRequiredKgThisWeek}kg · Given: {data?.totalDispensedKgThisWeek}kg
        </p>
        <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">
          {exactRows}/{rows.length} rows exact
        </span>
      </div>
      {rows.map(row => <RowLine key={row.rowId} row={row} />)}
    </div>
  );
}
