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
//     • Variance from schedule — informs the store issuance plan and
//       residual carry-forward calculation.
//     • "No feed issued" entries show a carry-forward icon so the attendant
//       and manager can see that the day was deliberately skipped.
//
//   Colour coding reflects deviation from schedule (informational only):
//     Green  — within ±5% of schedule
//     Amber  — >5% deviation (possible wastage or under-feeding)
//     (No red hard-block — the schedule is advisory)

import { useState } from 'react';
import {
  Wheat, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp,
  Archive, Info,
} from 'lucide-react';
import { useBrooderFeedSummary, type FeedRequirementRow } from '../../hooks/useBrooderCageMap';

// ── Schedule vs actual pill ───────────────────────────────────────────────────
function VariancePill({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <span className="text-[10px] text-gray-400 italic">No population</span>;
  }
  if (Math.abs(pct) <= 1) {
    // ≤1% — on schedule
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

// ── Row-level expandable detail ───────────────────────────────────────────────
function RowLine({ row }: { row: FeedRequirementRow }) {
  const [open, setOpen] = useState(false);
  if (row.birdTotal === 0) return null;

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
          {row.levels.map(l => {
            const lvlVariance = l.feedVariancePercent;
            return (
              <div key={l.levelId} className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-gray-500 dark:text-gray-400 flex-shrink-0">{l.label}</span>
                  <span className="font-mono text-gray-700 dark:text-gray-200 truncate">{l.batchCode}</span>
                  <span className="text-gray-400 flex-shrink-0">{l.birdCount.toLocaleString()}b</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="font-mono text-gray-500 dark:text-gray-400" title="Issued / Schedule">
                    {l.dispensedKgThisWeek}
                    <span className="text-gray-300 dark:text-gray-600">/{l.requiredKgThisWeek ?? '—'}kg</span>
                  </span>
                  <VariancePill pct={lvlVariance ?? null} />
                </div>
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
  const { data, isLoading } = useBrooderFeedSummary();

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2].map(i => (
          <div key={i} className="h-12 rounded-xl bg-gray-100 dark:bg-dark-bg animate-pulse" />
        ))}
      </div>
    );
  }

  const rows = (data?.rows ?? []).filter((r: FeedRequirementRow) => r.birdTotal > 0);

  if (rows.length === 0) {
    return (
      <div className="text-xs text-gray-400 text-center py-4 italic">
        No chicks placed on the cage map yet.
      </div>
    );
  }

  const totalRequired  = data?.totalRequiredKgThisWeek  ?? 0;
  const totalDispensed = data?.totalDispensedKgThisWeek ?? 0;
  const residual       = data?.residualCarryForwardKg   ?? 0;
  const netToIssue     = data?.netToIssueKg             ?? 0;

  const weekVariance   = totalRequired > 0
    ? Math.round(((totalDispensed - totalRequired) / totalRequired) * 1000) / 10
    : null;

  return (
    <div className="space-y-2">
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

        {/* Residual carry-forward & net to issue */}
        {residual > 0 && (
          <div className="flex items-center gap-1.5 text-[10px] text-green-700 dark:text-green-400 font-medium">
            <Archive className="w-3 h-3" />
            <span>
              Carry-forward residual: <strong>{residual}kg</strong>
              {' '}· Net store issuance needed: <strong>{netToIssue}kg</strong>
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
