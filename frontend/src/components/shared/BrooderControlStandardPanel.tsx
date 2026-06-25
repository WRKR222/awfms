// src/components/shared/BrooderControlStandardPanel.tsx
//
// Displays the HyLine Brown rearing control standard table (weeks 1-19)
// alongside the live batch status. Flags any breaches on:
//   • Feed consumption  (Req 5 / Req 6)
//   • Bird weight       (Req 6)
//   • Mortality rate    (Req 6)
//
// Used on Director (OwnerHome) and Production Manager (ManagerHome) dashboards.
// The panel is read-only; editing is done via BrooderPage modals.

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle, ChevronDown, ChevronUp, Info } from 'lucide-react';
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
  batchId:             string;
  batchCode:           string;
  ageWeeks:            number;
  originalCount:       number;
  currentCount:        number;
  totalDeaths:         number;
  actualMortalityPct:  number;
  standardCeilingPct:  number;
  phase:               string;
  violated:            boolean;
  message:             string | null;
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
    birdCount:           number;
    hylineWeek:          number | null;
    dailyRationKg:       number | null;
    dispensedKgToday:    number;
    feedVariancePercent: number | null;
  }[];
}

interface FeedSummary {
  weekStart:                string;
  totalChicks:              number;
  totalRequiredKgThisWeek:  number;
  totalDispensedKgThisWeek: number;
  residualCarryForwardKg:   number;
  netToIssueKg:             number;
  rows:                     FeedSummaryRow[];
}

// ── Utility helpers ───────────────────────────────────────────────────────────

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

// ── Brooder batches hook ──────────────────────────────────────────────────────

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

// ── Sub-components ────────────────────────────────────────────────────────────

function MortalityStatusRow({ batchId }: { batchId: string }) {
  const { data: check, isLoading } = useMortalityCheck(batchId);
  if (isLoading) return <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded animate-pulse" />;
  if (!check) return null;

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
          <span className="text-xs text-gray-400">Wk {check.ageWeeks} · {check.phase}</span>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {check.totalDeaths} deaths from {check.originalCount.toLocaleString()} birds
        </div>
        {pctBar(check.actualMortalityPct, check.standardCeilingPct)}
        <div className="text-[10px] text-gray-400">
          Ceiling: ≤ {check.standardCeilingPct}% cumulative
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
  const [showTable, setShowTable]   = useState(false);
  const [activeTab, setActiveTab]   = useState<'status' | 'table'>('status');

  const { data: standards = [], isLoading: stdLoading } = useQuery<ControlStandard[]>({
    queryKey: ['brooder-control-standards'],
    queryFn:  () => api.get('/brooder/control-standards').then(r => r.data),
    staleTime: 600_000, // 10 min — rarely changes
  });

  const { data: feedSummary, isLoading: feedLoading } = useQuery<FeedSummary>({
    queryKey: ['brooder-feed-summary'],
    queryFn:  () => api.get('/brooder/feed-requirement-summary').then(r => r.data),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const { data: batches = [] } = useBrooderBatches();

  const hasResidual = (feedSummary?.residualCarryForwardKg ?? 0) > 0;

  // Detect any feed over-variance this week
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
              Feed — This Week
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
                    <p className="text-[9px] text-gray-400 uppercase">Required</p>
                  </div>
                  <div className="bg-gray-50 dark:bg-dark-bg rounded-xl p-2">
                    <p className="text-sm font-bold text-gray-800 dark:text-gray-100">
                      {feedSummary.totalDispensedKgThisWeek.toFixed(1)} kg
                    </p>
                    <p className="text-[9px] text-gray-400 uppercase">Dispensed</p>
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

                {/* Residual carry-forward */}
                {hasResidual && (
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-2.5 text-xs text-blue-700 dark:text-blue-400 flex items-center gap-2">
                    <Info className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>
                      <strong>{feedSummary.residualCarryForwardKg.toFixed(2)} kg</strong> residual from last week
                      carried forward — deducted from this week's store issuance.
                    </span>
                  </div>
                )}

                {/* Per-row level issues */}
                {feedViolations.length > 0 && (
                  <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl p-2.5 text-xs text-orange-700 dark:text-orange-400 space-y-1">
                    <p className="font-semibold flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Levels with feed variance &gt;10%
                    </p>
                    {feedViolations.map(l => (
                      <p key={l.levelId}>
                        {l.label}: {(l.feedVariancePercent ?? 0).toFixed(1)}% variance
                        (today {l.dispensedKgToday.toFixed(2)} kg, ration {l.dailyRationKg?.toFixed(2) ?? '—'} kg/day)
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center py-4">No brooder data</p>
            )}
          </div>

          {/* Mortality status per batch */}
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
                  // Highlight the current age-week row for any active batch
                  const isCurrentWeek = batches.some((b: any) => {
                    const weeks = Math.max(1, dayjs().diff(dayjs(b.dateOfHatch), 'week'));
                    return Math.min(19, weeks) === std.week;
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
            HyLine Brown rearing schedule. Weight columns show the expected bird weight at end of each week.
            Mortality column shows maximum cumulative % mortality allowed. ◀ = current age week for active batch.
          </div>
        </div>
      )}
    </div>
  );
}
