// src/components/shared/BrooderFeedCalendar.tsx
//
// PM-facing "feed issuance calendar" — how much feed was dispensed
// farm-wide on each day, for the current week AND a selectable range of
// past weeks, so the PM can review feed issuance history rather than only
// ever seeing "this week".
//
// Lives on the PM dashboard (ManagerHome). To avoid piling more onto an
// already busy dashboard: it opens showing only THIS week by default (a
// single compact bar-chart row, same footprint as the widget it replaced);
// past weeks are opt-in — picking a "past N weeks" pill is what triggers
// the heavier multi-week fetch (see useFeedIssuanceCalendar's `enabled`
// flag), and the whole panel can be collapsed away entirely via its header.

import { useState } from 'react';
import { AlertTriangle, CalendarRange, ChevronDown, ChevronUp, Wheat } from 'lucide-react';
import { useFeedIssuanceCalendar } from '../../hooks/useBrooderCageMap';

const RANGE_OPTIONS: { label: string; weeks: number }[] = [
  { label: 'This week', weeks: 1 },
  { label: 'Past 2 weeks', weeks: 2 },
  { label: 'Past 4 weeks', weeks: 4 },
  { label: 'Past 8 weeks', weeks: 8 },
];

function WeekRow({ week }: { week: import('../../hooks/useBrooderCageMap').FeedIssuanceCalendarWeek }) {
  const maxKg = Math.max(1, ...week.days.map(d => d.dispensedKg));

  return (
    <div className="bg-gray-50 dark:bg-dark-bg rounded-xl p-3 border border-gray-100 dark:border-dark-border">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">
          {week.weekLabel} {week.isCurrentWeek && <span className="text-brand-green">· current</span>}
        </p>
        <p className="text-xs font-bold text-gray-700 dark:text-gray-200">{week.totalKg}kg total</p>
      </div>

      {week.skippedDays.length > 0 && (
        <div className="flex items-start gap-1.5 mb-2 text-[11px] text-red-600 dark:text-red-400">
          <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
          <span>No feed logged: {week.skippedDays.join(', ')}</span>
        </div>
      )}

      <div className="grid grid-cols-7 gap-1">
        {week.days.map(d => (
          <div
            key={d.date}
            className={`rounded-lg p-1.5 text-center border ${
              d.skipped
                ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                : 'bg-white dark:bg-dark-card border-gray-100 dark:border-dark-border'
            }`}
          >
            <p className="text-[8px] text-gray-400 uppercase truncate">{d.dayLabel.slice(0, 3)}</p>
            <div className="h-6 flex items-end justify-center my-0.5">
              <div
                className={`w-2 rounded-t ${d.skipped ? 'bg-red-300 dark:bg-red-700' : 'bg-amber-400'}`}
                style={{ height: `${Math.max(4, (d.dispensedKg / maxKg) * 100)}%` }}
              />
            </div>
            <p className={`text-[9px] font-bold ${d.skipped ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-200'}`}>
              {d.dispensedKg}
            </p>
          </div>
        ))}
        {/* Pad out weeks that haven't finished yet (current week) so every
            row lines up at 7 columns regardless of how many days have passed. */}
        {Array.from({ length: Math.max(0, 7 - week.days.length) }).map((_, i) => (
          <div key={`pad-${i}`} className="rounded-lg p-1.5 border border-dashed border-gray-100 dark:border-dark-border opacity-40" />
        ))}
      </div>
    </div>
  );
}

export function BrooderFeedCalendar() {
  // Open by default so "feed given so far this week" is visible at a glance
  // without an extra click — only the *past-weeks* history is opt-in (via
  // the range pills below), which is where the real payload weight is.
  const [open, setOpen] = useState(true);
  const [weeks, setWeeks] = useState(1);

  // Only fetches once the panel is opened — keeps this off the default
  // page-load cost entirely.
  const { data, isLoading } = useFeedIssuanceCalendar(weeks, open);

  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full p-4 flex items-center gap-3 text-left hover:bg-gray-50 dark:hover:bg-dark-bg transition-colors"
      >
        <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center flex-shrink-0">
          <CalendarRange className="w-4 h-4 text-amber-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Feed Issuance — This Week &amp; History</p>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Feed dispensed per day · tap a range below for past weeks
          </p>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />}
      </button>

      {open && (
        <div className="px-4 pb-4 pt-0 border-t border-gray-50 dark:border-dark-border space-y-3">
          <div className="flex gap-1.5 flex-wrap pt-3">
            {RANGE_OPTIONS.map(opt => (
              <button
                key={opt.weeks}
                onClick={() => setWeeks(opt.weeks)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                  weeks === opt.weeks
                    ? 'bg-brand-green text-white'
                    : 'bg-gray-100 dark:bg-dark-bg text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-dark-border'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: Math.min(weeks, 3) }).map((_, i) => (
                <div key={i} className="h-28 rounded-xl bg-gray-100 dark:bg-dark-bg animate-pulse" />
              ))}
            </div>
          ) : !data?.weeks.length ? (
            <p className="text-xs text-gray-400 text-center py-4 italic">No feed data yet.</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {data.weeks.map(w => <WeekRow key={w.weekStart} week={w} />)}
            </div>
          )}

          <p className="text-[10px] text-gray-400 italic flex items-center gap-1">
            <Wheat className="w-3 h-3" />
            Farm-wide feed dispensed per calendar day, most recent week first.
          </p>
        </div>
      )}
    </div>
  );
}
