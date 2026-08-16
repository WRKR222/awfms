// src/components/shared/BrooderFeedRequirement.tsx
//
// Feed schedule reference vs. actual issuance — per brooder row/level.
//
// KEY FRAMING:
//   The HyLine schedule (population × g/bird/day) is a REFERENCE, not a
//   maximum.  The component shows:
//     • Schedule reference for the week (what the standard says the birds
//       should eat, daily and weekly).
//     • Amount actually issued this week per row/level.
//     • Variance from schedule — informs the store issuance plan.
//     • "No feed issued" entries show a carry-forward icon so the attendant
//       and manager can see that the day was deliberately skipped.
//
//   Colour coding reflects deviation from schedule (informational only):
//     Green  — within ±5% of schedule
//     Amber  — >5% deviation (possible wastage or under-feeding)
//     (No red hard-block — the schedule is advisory)
//
// ── Early-phase display (Days 1–2) ──────────────────────────────────────────
//   Batches ≤ 2 days old are in the EARLY phase.  Since brooderAdjustedWeeklyFeedKg
//   now counts the full HyLine ration for EARLY days (not 0), the schedule
//   and net-to-issue figures are non-zero even on Day 1.  An "Early phase"
//   badge is shown next to the variance pill so attendants understand the
//   advisory (not enforced) nature of the figure.

import { useState } from 'react';
import {
  Wheat, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp,
  Archive, Info, Baby, Calculator,
} from 'lucide-react';
import { useBrooderFeedSummary, type FeedRequirementRow, type FeedRequirementLevel } from '../../hooks/useBrooderCageMap';
import { BrooderGeneralFeedSchedule } from './BrooderGeneralFeedSchedule';

// ── Schedule vs actual pill ───────────────────────────────────────────────────
function VariancePill({ pct, viaGeneral }: { pct: number | null; viaGeneral?: boolean }) {
  if (pct === null) {
    return (
      <span className="text-[10px] text-gray-400 italic">
        {viaGeneral ? 'Via general log' : 'No schedule'}
      </span>
    );
  }
  if (Math.abs(pct) <= 1) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
        <CheckCircle2 className="w-2.5 h-2.5" /> On schedule
      </span>
    );
  }
  const over  = pct > 0;
  const color = Math.abs(pct) <= 10
    ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
    : 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400';
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${color}`}>
      <Info className="w-2.5 h-2.5" />
      {over ? '+' : ''}{pct}% {over ? 'above' : 'below'} schedule
    </span>
  );
}

/** Badge shown for levels still in the early learning-to-eat window (Week 1, Days 1–2). */
function EarlyPhaseBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
      title="Days 1–2: chicks are learning to eat. The HyLine ration is advisory — over-issue enforcement is relaxed."
    >
      <Baby className="w-2 h-2" /> Early phase
    </span>
  );
}

// ── Row-level expandable detail ───────────────────────────────────────────────
function RowLine({ row }: { row: FeedRequirementRow }) {
  const [open, setOpen] = useState(false);
  if (row.birdTotal === 0) return null;

  // A row is in early phase if ALL its occupied levels are early-phase
  // (hylineWeek === 1 and dispensed is still very low relative to schedule).
  // We use hylineWeek === 1 as the proxy — Week 1 covers Days 0-6.
  const allEarlyPhase = row.levels.every(
    l => l.birdCount > 0 && l.hylineWeek === 1,
  );

  const weekVariancePct = row.requiredKgThisWeek > 0
    ? Math.round(((row.dispensedKgThisWeek - row.requiredKgThisWeek) / row.requiredKgThisWeek) * 1000) / 10
    : null;

  return (
    <div className="rounded-xl border border-gray-100 dark:border-dark-border bg-gray-50 dark:bg-dark-bg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-xs"
      >
        <div className="flex items-center gap-2">
          <span className="font-bold text-gray-800 dark:text-gray-100">{row.label}</span>
          <span className="text-gray-400">{row.birdTotal.toLocaleString()} chicks</span>
          {allEarlyPhase && <EarlyPhaseBadge />}
        </div>
        <div className="flex items-center gap-2">
          {/* Issued / Schedule */}
          <span className="font-mono text-gray-600 dark:text-gray-300" title="Issued this week / Schedule this week">
            {row.dispensedKgThisWeek}
            <span className="text-gray-400 font-normal">/{row.requiredKgThisWeek}kg</span>
          </span>
          <VariancePill pct={weekVariancePct} />
          {open ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-1.5 border-t border-gray-100 dark:border-dark-border pt-2">
          {row.levels.map((l: FeedRequirementLevel) => {
            const lvlVariance  = l.feedVariancePercent;
            const isEarlyLevel = l.birdCount > 0 && l.hylineWeek === 1;
            return (
              <div key={l.levelId} className="space-y-0.5">
                <div className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-gray-500 dark:text-gray-400 flex-shrink-0">{l.label}</span>
                    <span className="font-mono text-gray-700 dark:text-gray-200 truncate">{l.batchCode}</span>
                    <span
                      className="text-gray-400 flex-shrink-0"
                      title={l.populationAsOf ? `Population updated as of ${new Date(l.populationAsOf).toLocaleDateString()}` : 'Population not yet counted'}
                    >
                      {l.birdCount.toLocaleString()}b
                    </span>
                    {isEarlyLevel && <EarlyPhaseBadge />}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="font-mono text-gray-500 dark:text-gray-400" title="Issued / Schedule">
                      {l.dispensedKgThisWeek}
                      <span className="text-gray-300 dark:text-gray-600">/{l.requiredKgThisWeek ?? '—'}kg</span>
                    </span>
                    <VariancePill pct={lvlVariance ?? null} viaGeneral={l.feedSource === 'GENERAL' || l.feedSource === 'MIXED'} />
                  </div>
                </div>
                {l.scheduleByDay && l.scheduleByDay.length > 0 && l.birdCount > 0 && (
                  <div className="flex items-start gap-1 pl-1">
                    <Calculator className="w-2.5 h-2.5 text-blue-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] leading-snug text-blue-500 dark:text-blue-400 mb-0.5">
                        {l.gramsPerBirdPerDay}g/bird/day · {l.requiredKgThisWeek?.toFixed(2) ?? '—'} kg scheduled this week, by day:
                      </p>
                      <div className="space-y-0.5">
                        {l.scheduleByDay.map(d => (
                          <p key={d.date} className="text-[10px] leading-snug text-blue-500 dark:text-blue-400">
                            <span className="font-semibold">{d.dayLabel}</span>{' — '}
                            {d.hadMortality && d.endBirdCount !== d.startBirdCount ? (
                              <>{d.startBirdCount.toLocaleString()}→{d.endBirdCount.toLocaleString()} birds (mortality that day)</>
                            ) : (
                              <>{d.startBirdCount.toLocaleString()} birds</>
                            )}
                            {' × '}{l.gramsPerBirdPerDay}g ÷ 1000 ≈ {d.kg.toFixed(2)} kg
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────

export function BrooderFeedRequirement() {
  // "By row" uses the cage map's row/level bird counts — accurate only if
  // they're kept up to date as birds are moved/culled. "General" is the
  // fallback: the same schedule computed farm-wide from each batch's own
  // official population, independent of any row/level assignment, for when
  // the cage map counts can't be relied on.
  const [view, setView] = useState<'row' | 'general'>('row');
  const { data, isLoading } = useBrooderFeedSummary();

  const viewToggle = (
    <div className="flex gap-1.5 mb-2">
      <button
        onClick={() => setView('row')}
        className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors ${
          view === 'row'
            ? 'bg-brand-green text-white'
            : 'bg-gray-100 dark:bg-dark-bg text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-dark-border'
        }`}
      >
        By row
      </button>
      <button
        onClick={() => setView('general')}
        className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors ${
          view === 'general'
            ? 'bg-brand-green text-white'
            : 'bg-gray-100 dark:bg-dark-bg text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-dark-border'
        }`}
      >
        General (whole brooder)
      </button>
    </div>
  );

  if (view === 'general') {
    return (
      <div className="space-y-2">
        {viewToggle}
        <BrooderGeneralFeedSchedule />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {viewToggle}
        {[1, 2].map(i => (
          <div key={i} className="h-12 rounded-xl bg-gray-100 dark:bg-dark-bg animate-pulse" />
        ))}
      </div>
    );
  }

  const rows = (data?.rows ?? []).filter((r: FeedRequirementRow) => r.birdTotal > 0);

  if (rows.length === 0) {
    return (
      <div className="space-y-2">
        {viewToggle}
        <div className="text-xs text-gray-400 text-center py-4 italic">
          No chicks placed on the cage map yet — switch to "General" for a schedule that
          doesn't depend on row/level placement.
        </div>
      </div>
    );
  }

  const totalRequired  = data?.totalRequiredKgThisWeek  ?? 0;
  const totalDispensed = data?.totalDispensedKgThisWeek ?? 0;
  const netToIssue     = data?.netToIssueKg             ?? 0;

  const weekVariance   = totalRequired > 0
    ? Math.round(((totalDispensed - totalRequired) / totalRequired) * 1000) / 10
    : null;

  return (
    <div className="space-y-2">
      {viewToggle}

      {/* ── Summary header ─────────────────────────────────────────────── */}
      <div className="space-y-1 mb-2">
        {/* Weekly schedule vs issued */}
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1">
            <Wheat className="w-3 h-3 text-amber-500" />
            This week — schedule {totalRequired}kg · issued {totalDispensed}kg
          </p>
          {weekVariance !== null && <VariancePill pct={weekVariance} />}
        </div>

        {/* Net amount still needed this week */}
        {netToIssue > 0 && (
          <div className="flex items-center gap-1.5 text-[10px] text-green-700 dark:text-green-400 font-medium">
            <Archive className="w-3 h-3" />
            <span>
              Net store issuance needed: <strong>{netToIssue}kg</strong>
            </span>
          </div>
        )}

        {/* Advisory note */}
        <p className="text-[10px] text-gray-400 italic">
          Schedule is advisory — no maximum enforced. Variance informs store issuance plan.
        </p>
      </div>

      {/* ── Per-row breakdown ──────────────────────────────────────────── */}
      {rows.map((row: FeedRequirementRow) => <RowLine key={row.rowId} row={row} />)}
    </div>
  );
}
