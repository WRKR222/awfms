// src/components/shared/BrooderGeneralFeedSchedule.tsx
//
// General (whole-brooder) feed SCHEDULE, by day — the fallback view for
// when the cage map's row/level bird counts can't be relied on (birds
// moved or culled without the row/level assignment being updated). Instead
// of a per-row breakdown, this shows what should be fed each day of the
// current calendar week, computed farm-wide from each batch's own
// general/official population (Batch.currentBirdCount +
// BrooderGeneralMortalityLog) — entirely independent of the cage map.
//
// Expand a day to see the per-batch figures (bird count, g/bird/day) that
// day's farm-wide total was calculated from.

import { useState } from 'react';
import { ChevronDown, ChevronUp, Info, Wheat } from 'lucide-react';
import { useGeneralFeedScheduleByDay, type GeneralFeedScheduleDay } from '../../hooks/useBrooderCageMap';

function DayRow({ day, isToday }: { day: GeneralFeedScheduleDay; isToday: boolean }) {
  const [open, setOpen] = useState(isToday);

  if (day.batches.length === 0) return null;

  return (
    <div className="rounded-xl border border-gray-100 dark:border-dark-border bg-gray-50 dark:bg-dark-bg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-xs"
      >
        <div className="flex items-center gap-2">
          <span className="font-bold text-gray-800 dark:text-gray-100">{day.dayLabel}</span>
          {isToday && <span className="text-[10px] font-semibold text-brand-green">· today</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-gray-600 dark:text-gray-300">{day.totalKg}kg</span>
          {open ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-1.5 border-t border-gray-100 dark:border-dark-border pt-2">
          {day.batches.map(b => (
            <div key={b.batchId} className="flex items-start gap-1 text-[11px]">
              <Wheat className="w-2.5 h-2.5 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="leading-snug text-gray-600 dark:text-gray-300">
                <span className="font-mono font-semibold">{b.batchCode}</span>
                {' — '}{b.birdCount.toLocaleString()} birds
                {b.hadMortality && <span className="text-amber-500"> (mortality logged that day)</span>}
                {' × '}{b.gramsPerBirdPerDay}g ÷ 1000 ≈ <span className="font-semibold">{b.kg.toFixed(2)} kg</span>
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function BrooderGeneralFeedSchedule() {
  const { data, isLoading } = useGeneralFeedScheduleByDay();

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2].map(i => (
          <div key={i} className="h-12 rounded-xl bg-gray-100 dark:bg-dark-bg animate-pulse" />
        ))}
      </div>
    );
  }

  const days = data?.days ?? [];
  const todayKey = new Date().toISOString().slice(0, 10);

  if (days.every(d => d.batches.length === 0)) {
    return (
      <div className="text-xs text-gray-400 text-center py-4 italic">
        No brooder batches on the general population sheet yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1">
          <Wheat className="w-3 h-3 text-amber-500" />
          General schedule — this week, {data?.totalKg ?? 0}kg total
        </p>
      </div>

      <p className="text-[10px] text-gray-400 italic flex items-start gap-1">
        <Info className="w-3 h-3 flex-shrink-0 mt-0.5" />
        Whole-brooder figures from each batch's official population — use this when row/level
        bird counts on the cage map aren't kept up to date.
      </p>

      {days.map(d => (
        <DayRow key={d.date} day={d} isToday={d.date === todayKey} />
      ))}
    </div>
  );
}
