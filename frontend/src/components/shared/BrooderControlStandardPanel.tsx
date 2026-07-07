// src/components/shared/BrooderControlStandardPanel.tsx
//
// Displays the HyLine Brown rearing control standard table (weeks 1-19)
// alongside the live batch status. Flags any breaches on:
//   • Feed consumption  (advisory reference vs. actual)
//   • Bird weight       (Req 6)
//   • Mortality rate    (Req 6)
//
// Used on Director (OwnerHome) and Production Manager (ManagerHome) dashboards.
// The panel is read-only; editing is done via BrooderPage modals.
//
// ── Week calculation (IMPORTANT) ───────────────────────────────────────────
// The "current week" row in the standard table and the week number shown on
// the mortality status card are determined using the BATCH-RELATIVE week
// (days since hatch ÷ 7, 1-indexed), NOT the calendar week.  Batches almost
// never hatch on a calendar Monday, so calendar-week comparisons will
// routinely point to the wrong row in the HyLine schedule.
//
// The batch age in weeks is computed as:
//   Math.max(1, Math.floor(daysSinceHatch / 7) + 1)
// matching the backend's `batchAgeWeeks()` in feed-standard.util.ts.
// Do NOT use `dayjs(today).diff(dayjs(batch.dateOfHatch), 'week')` clamped
// with Math.max(1, ...) — that expression is 0-indexed, so the clamp only
// fixes week 1 and silently freezes every later week one behind.
//
// ── Mortality display (IMPORTANT) ──────────────────────────────────────────
// The mortality percentage and "deaths from N birds" display use
// `effectiveBirdsReceived` (= quantityReceived − mortalityOnArrival), NOT
// raw `quantityReceived`.  Birds that arrived dead (DOA) are the supplier's
// responsibility and must not inflate the farm's cumulative mortality %.
// The backend already returns `effectiveBirdsReceived` and `mortalityOnArrival`
// from the /mortality-check endpoint — we just need to use them here.

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle, Info } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../lib/api';
import dayjs from '../../lib/dayjs';

interface ControlStandard {
  week:                    number;
  deheusPhase:             string;
  feedingGramsPerBird:     number;
  deheusWeeklyIntakeKg:    number;
  expectedWeightMinG:      number;
  expectedWeightMaxG:      number;
  cumulativeMortalityPct:  number;
  productionTraysPerWeek?: number | null;
}

interface MortalityCheck {
  batchId:               string;
  batchCode:             string;
  ageWeeks:              number;
  // Raw figures returned by the backend ─────────────────────────────────────
  originalCount:         number;  // batch.quantityReceived (for display only)
  mortalityOnArrival:    number;  // DOA birds — excluded from the farm's % calc
  effectiveBirdsReceived: number; // originalCount − mortalityOnArrival (the real base)
  currentCount:          number;
  farmDeaths:            number;  // deaths that occurred on-farm (= effectiveBirdsReceived − currentCount)
  actualMortalityPct:    number;
  standardCeilingPct:    number;
  phase:                 string;
  violated:              boolean;
  message:               string | null;
}

interface FeedSummaryRow {
  rowId:               string;
  rowNumber:           number;
  label:               string;
  birdTotal:           number;
  requiredKgThisWeek:  number;
  dispensedKgThisWeek: number;
  levels: {
    levelId:             string;
    label:               string;
    batchCode:           string | null;
    birdCount:           number;
    hylineWeek:          number | null;
    dailyRationKg:       number | null;
    requiredKgThisWeek:  number | null;
    dispensedKgThisWeek: number;
    // The batch-relative (hatch-anchored) week this level's weekly figures
    // actually cover — NOT the calendar week. Different batches/levels can
    // have different windows here; that's expected, see brooder.service.ts.
    weekStart:           string | null;
    weekEnd:             string | null;
    dispensedKgToday:    number;
    feedVariancePercent: number | null;
  }[];
}

interface FeedSummary {
  // Farm-wide aggregate across every occupied row/level — there is no
  // single calendar week backing totalRequiredKgThisWeek/totalDispensedKgThisWeek
  // below, since each level's contribution uses its own batch's
  // dateReceived-anchored week (Day 1 = day birds were received on the farm).
  scope:                    string;
  totalChicks:              number;
  totalRequiredKgThisWeek:  number;
  totalDispensedKgThisWeek: number;
  residualCarryForwardKg:   number;
  earlyPhaseResidualKg:     number;  // portion of residual from early-phase over-stocking
  standardResidualKg:       number;  // portion from last approved issuance plan
  netToIssueKg:             number;
  rows:                     FeedSummaryRow[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Batch-relative age in completed weeks (1-indexed HyLine week number).
 * Week 1 = days 0-6 since hatch, Week 2 = days 7-13, etc.
 *
 * IMPORTANT: this must NOT be computed as `Math.max(1, dayjs().diff(dateOfHatch, 'week'))`.
 * dayjs's week-diff is already 0-indexed (0 for the first 7 days, 1 for the
 * next 7, etc.), so clamping it to a minimum of 1 silently freezes the
 * result at 1 for the entire second week too, and every later week ends up
 * one behind where it should be. Mirrors the backend's `batchAgeWeeks()`
 * in feed-standard.util.ts — keep both in sync.
 */
function batchAgeWeeks(dateOfHatch: string): number {
  const ageInDays = dayjs().diff(dayjs(dateOfHatch), 'day');
  return Math.max(1, Math.floor(Math.max(0, ageInDays) / 7) + 1);
}

function pctBar(actual: number, ceiling: number) {
  const pct = Math.min(100, (actual / ceiling) * 100);
  const color = actual > ceiling
    ? 'bg-red-500'
    : actual > ceiling * 0.9
    ? 'bg-amber-400'
    : 'bg-green-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[10px] font-bold min-w-[36px] text-right ${
        actual > ceiling ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'
      }`}>
        {actual.toFixed(2)}%
      </span>
    </div>
  );
}

// ── Data hooks ────────────────────────────────────────────────────────────────

function useBrooderBatches() {
  return useQuery({
    queryKey: ['brooder-batches-for-control'],
    queryFn: () =>
      api.get('/flock/batches').then(r =>
        (r.data as any[]).filter(b => b.location === 'BROODER' && b.isActive),
      ),
    staleTime: 60_000,
  });
}

function useMortalityCheck(batchId: string) {
  return useQuery<MortalityCheck>({
    queryKey: ['brooder-mortality-check', batchId],
    queryFn: () => api.get(`/brooder/batches/${batchId}/mortality-check`).then(r => r.data),
    staleTime: 30_000,
    enabled:   !!batchId,
  });
}

// ── MortalityStatusRow ────────────────────────────────────────────────────────

function MortalityStatusRow({ batchId }: { batchId: string }) {
  const { data: check, isLoading } = useMortalityCheck(batchId);
  if (isLoading) return <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded animate-pulse" />;
  if (!check) return null;

  // ── Correct mortality denominator ─────────────────────────────────────────
  // farmDeaths  = deaths that happened on the farm (arrival DOAs excluded)
  // effectiveBirdsReceived = the base population the farm is accountable for
  //
  // We display "N farm deaths from M birds" where M = effectiveBirdsReceived.
  // If there were arrival DOAs we show a parenthetical so the manager can see
  // the full picture without the DOAs polluting the HyLine comparison.
  const hasDOA = check.mortalityOnArrival > 0;

  return (
    <div className={`rounded-xl p-3 text-sm flex items-start gap-2 ${
      check.violated
        ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
        : 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
    }`}>
      {check.violated
        ? <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
        : <CheckCircle   className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />}
      <div className="space-y-1 flex-1">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-gray-700 dark:text-gray-200">{check.batchCode}</span>
          {/* ── Batch-relative week (hatch-anchored, not calendar week) ─────── */}
          <span className="text-xs text-gray-400">Wk {check.ageWeeks} · {check.phase}</span>
        </div>

        {/* ── Farm deaths vs effective base population ─────────────────────── */}
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {check.farmDeaths} farm {check.farmDeaths === 1 ? 'death' : 'deaths'} from{' '}
          {check.effectiveBirdsReceived.toLocaleString()} birds
          {hasDOA && (
            <span className="ml-1 text-[10px] text-gray-400 italic">
              (+{check.mortalityOnArrival} DOA on arrival — excluded from farm %)</span>
          )}
        </div>

        {pctBar(check.actualMortalityPct, check.standardCeilingPct)}
        <div className="text-[10px] text-gray-400">
          Ceiling: ≤ {check.standardCeilingPct}% cumulative (HyLine Week {check.ageWeeks})
        </div>
        {check.violated && (
          <p className="text-xs font-semibold text-red-600 dark:text-red-400">{check.message}</p>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function BrooderControlStandardPanel() {
  const [activeTab, setActiveTab] = useState<'status' | 'table'>('status');

  const { data: standards = [], isLoading: stdLoading } = useQuery<ControlStandard[]>({
    queryKey: ['brooder-control-standards'],
    queryFn:  () => api.get('/brooder/control-standards').then(r => r.data),
    staleTime: 600_000,
  });

  const { data: feedSummary, isLoading: feedLoading } = useQuery<FeedSummary>({
    queryKey: ['brooder-feed-summary'],
    queryFn:  () => api.get('/brooder/feed-requirement-summary').then(r => r.data),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const { data: batches = [] } = useBrooderBatches();

  const hasResidual = (feedSummary?.residualCarryForwardKg ?? 0) > 0;

  const feedViolations = feedSummary?.rows.flatMap(r =>
    r.levels.filter(l => (l.feedVariancePercent ?? 0) > 10),
  ) ?? [];

  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-dark-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-amber-500 rounded-xl flex items-center justify-center">
            <Info className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="font-bold text-gray-800 dark:text-gray-100 text-sm">Brooder Control</p>
            <p className="text-[10px] text-gray-400">HyLine Brown · Weeks 1-19</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {feedViolations.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 px-2 py-1 rounded-full font-semibold">
              <AlertTriangle className="w-3 h-3" />
              {feedViolations.length} feed {feedViolations.length === 1 ? 'issue' : 'issues'}
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-100 dark:border-dark-border">
        {(['status', 'table'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${
              activeTab === tab
                ? 'text-amber-600 dark:text-amber-400 border-b-2 border-amber-500'
                : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
            }`}
          >
            {tab === 'status' ? 'Live Status' : 'Standard Table'}
          </button>
        ))}
      </div>

      {/* ── LIVE STATUS TAB ── */}
      {activeTab === 'status' && (
        <div className="p-4 space-y-4">
          {/* Feed summary */}
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
              Feed — Farm-wide (schedule reference)
            </p>
            <p className="text-[10px] text-gray-400 -mt-1 mb-2">
              Sum of every occupied level, each on its own batch's week.
            </p>
            {feedLoading ? (
              <div className="h-16 bg-gray-50 dark:bg-dark-bg rounded-xl animate-pulse" />
            ) : feedSummary ? (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-gray-50 dark:bg-dark-bg rounded-xl p-2">
                    <p className="text-sm font-bold text-gray-800 dark:text-gray-100">
                      {feedSummary.totalRequiredKgThisWeek.toFixed(1)} kg
                    </p>
                    <p className="text-[9px] text-gray-400 uppercase">Schedule</p>
                  </div>
                  <div className="bg-gray-50 dark:bg-dark-bg rounded-xl p-2">
                    <p className="text-sm font-bold text-gray-800 dark:text-gray-100">
                      {feedSummary.totalDispensedKgThisWeek.toFixed(1)} kg
                    </p>
                    <p className="text-[9px] text-gray-400 uppercase">Issued</p>
                  </div>
                  <div className={`rounded-xl p-2 ${
                    feedSummary.netToIssueKg > 0
                      ? 'bg-amber-50 dark:bg-amber-900/20'
                      : 'bg-green-50 dark:bg-green-900/20'
                  }`}>
                    <p className={`text-sm font-bold ${
                      feedSummary.netToIssueKg > 0
                        ? 'text-amber-700 dark:text-amber-400'
                        : 'text-green-700 dark:text-green-400'
                    }`}>
                      {feedSummary.netToIssueKg.toFixed(1)} kg
                    </p>
                    <p className="text-[9px] text-gray-400 uppercase">Net to Issue</p>
                  </div>
                </div>

                {hasResidual && (
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-2.5 text-xs text-blue-700 dark:text-blue-400 flex items-center gap-2">
                    <Info className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>
                      <strong>{feedSummary.residualCarryForwardKg.toFixed(2)} kg</strong> residual
                      carried forward — deducted from this week's store issuance.
                      {(feedSummary.earlyPhaseResidualKg ?? 0) > 0 && (
                        <span className="ml-1 text-blue-500 dark:text-blue-300">
                          ({feedSummary.earlyPhaseResidualKg.toFixed(2)} kg from early-phase starter feed)
                        </span>
                      )}
                    </span>
                  </div>
                )}

                {feedViolations.length > 0 && (
                  <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl p-2.5 text-xs text-orange-700 dark:text-orange-400 space-y-1">
                    <p className="font-semibold flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Levels with feed variance &gt;10% vs schedule
                    </p>
                    {feedViolations.map(l => (
                      <p key={l.levelId}>
                        {l.label}: {(l.feedVariancePercent ?? 0).toFixed(1)}% variance
                        (today {l.dispensedKgToday.toFixed(2)} kg, schedule {l.dailyRationKg?.toFixed(2) ?? '—'} kg/day)
                      </p>
                    ))}
                  </div>
                )}

              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center py-4">No brooder data</p>
            )}
          </div>

          {/* Mortality per batch */}
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
              Mortality — Cumulative vs HyLine Standard
            </p>
            {batches.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-3">No active brooder batches</p>
            ) : (
              <div className="space-y-2">
                {batches.map((b: any) => (
                  <MortalityStatusRow key={b.id} batchId={b.id} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── STANDARD TABLE TAB ── */}
      {activeTab === 'table' && (
        <div className="overflow-x-auto">
          {stdLoading ? (
            <div className="p-6 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-8 bg-gray-50 dark:bg-dark-bg rounded animate-pulse" />
              ))}
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 dark:bg-dark-bg text-gray-400 uppercase text-[10px] tracking-wide">
                  <th className="px-3 py-2.5 text-left font-semibold">Wk</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Phase</th>
                  <th className="px-3 py-2.5 text-right font-semibold">g/bird/day</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Wt min (g)</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Wt max (g)</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Mort ≤</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-dark-border">
                {standards.map(std => {
                  // ── Batch-relative week (hatch-anchored, not calendar week) ──
                  // We compare against each batch's own age in completed weeks
                  // (days-since-hatch ÷ 7), not any calendar week boundary.
                  // A batch hatched on a Wednesday will be in "Week 1" until
                  // the following Wednesday — calendar-week comparisons would
                  // flip to "Week 2" on the next Monday instead.
                  const isCurrentWeek = batches.some((b: any) => {
                    const ageWks = batchAgeWeeks(b.dateOfHatch);
                    return Math.min(19, ageWks) === std.week;
                  });

                  return (
                    <tr
                      key={std.week}
                      className={isCurrentWeek
                        ? 'bg-amber-50 dark:bg-amber-900/20 font-semibold'
                        : 'hover:bg-gray-50 dark:hover:bg-dark-bg/50'}
                    >
                      <td className="px-3 py-2 font-mono">
                        {std.week}
                        {isCurrentWeek && (
                          <span className="ml-1 text-amber-600 dark:text-amber-400">◀</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{std.deheusPhase}</td>
                      <td className="px-3 py-2 text-right font-mono text-gray-700 dark:text-gray-200">
                        {Number(std.feedingGramsPerBird).toFixed(1)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-green-700 dark:text-green-400">
                        {Number(std.expectedWeightMinG).toFixed(0)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-blue-700 dark:text-blue-400">
                        {Number(std.expectedWeightMaxG).toFixed(0)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-red-700 dark:text-red-400">
                        {Number(std.cumulativeMortalityPct).toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="px-4 py-3 text-[10px] text-gray-400 border-t border-gray-50 dark:border-dark-border">
            HyLine Brown rearing schedule. Weight columns show expected bird weight at end of each week.
            Mortality column shows maximum cumulative % (farm deaths only, arrival DOAs excluded).
            ◀ = current batch-relative week (days since hatch ÷ 7, not calendar week).
          </div>
        </div>
      )}
    </div>
  );
}
