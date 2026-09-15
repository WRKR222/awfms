// src/components/shared/BrooderFeedWastagePanel.tsx
//
// Director-facing view of whole-brooder feed over-issuance: days the
// general-population feed log gave out more than the HyLine daily ration,
// and the cost of that excess where the feed was linked to a store item.
// Backed by GET /brooder/feed-wastage-summary. The row/level feed path
// can never appear here — it's hard-blocked from exceeding its ration —
// so every kg/cost shown here comes from the whole-brooder sheet.

import { useState } from 'react';
import { TrendingDown, Coins, Scale } from 'lucide-react';
import { useFeedWastageSummary, useIssuedVsRecordedSummary } from '../../hooks/useBrooderCageMap';
import dayjs from '../../lib/dayjs';

type Period = 'daily' | 'weekly' | 'monthly';

const PERIOD_LABELS: Record<Period, string> = {
  daily:   'Daily',
  weekly:  'Weekly',
  monthly: 'Monthly',
};

export function BrooderFeedWastagePanel() {
  const [period, setPeriod] = useState<Period>('daily');
  const { data, isLoading } = useFeedWastageSummary(period);

  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TrendingDown className="w-4 h-4 text-red-500" />
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            Feed Wastage — Over-Issued vs Estimate
          </span>
        </div>
        <div className="flex rounded-lg border border-gray-200 dark:border-dark-border overflow-hidden text-xs">
          {(['daily', 'weekly', 'monthly'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 font-medium transition-colors ${
                period === p
                  ? 'bg-red-500 text-white'
                  : 'bg-white dark:bg-dark-card text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-dark-border'
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : !data || data.totals.eventCount === 0 ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          No over-issued feed recorded in this window — the general feed sheet has stayed
          within the HyLine daily ration.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3">
              <p className="text-xs text-red-600 dark:text-red-400 font-medium">Excess Feed</p>
              <p className="text-lg font-bold text-red-700 dark:text-red-400">
                {data.totals.excessKg.toFixed(2)} kg
              </p>
            </div>
            <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3">
              <p className="text-xs text-red-600 dark:text-red-400 font-medium flex items-center gap-1">
                <Coins className="w-3 h-3" /> Cost of Excess
              </p>
              <p className="text-lg font-bold text-red-700 dark:text-red-400">
                KES {data.totals.excessCostKes.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>

          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {data.buckets.slice().reverse().map(b => (
              <div
                key={b.periodStart}
                className="flex items-center justify-between text-xs bg-gray-50 dark:bg-dark-border/40 rounded-lg px-3 py-2"
              >
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  {period === 'monthly'
                    ? dayjs(`${b.periodStart}-01`).format('MMM YYYY')
                    : dayjs(b.periodStart).format('ddd D MMM')}
                </span>
                <span className="text-gray-500 dark:text-gray-400">
                  +{b.excessKg.toFixed(2)}kg · KES {b.excessCostKes.toLocaleString('en-KE', { maximumFractionDigits: 0 })}
                  {' '}· {b.eventCount} {b.eventCount === 1 ? 'entry' : 'entries'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Issued vs Recorded ────────────────────────────────────────────────────
//
// Egg Collection and Brooder feed logging no longer gate on a specific
// Store-issued item — the attendant just records a feed-stage name + kg.
// This tile is the monitoring that replaced that gate: per day, how much
// Store actually issued to a batch (StoreStockOut) vs how much attendants
// recorded feeding it that day. A "mismatch day" is one where the two
// disagree by more than a small tolerance (issuance is naturally lumpier
// than a strict daily ration, so this doesn't flag ordinary timing noise).
export function FeedIssuedVsRecordedPanel() {
  const [period, setPeriod] = useState<Period>('daily');
  const { data, isLoading } = useIssuedVsRecordedSummary(period);

  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Scale className="w-4 h-4 text-amber-500" />
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            Feed — Issued vs Recorded
          </span>
        </div>
        <div className="flex rounded-lg border border-gray-200 dark:border-dark-border overflow-hidden text-xs">
          {(['daily', 'weekly', 'monthly'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 font-medium transition-colors ${
                period === p
                  ? 'bg-amber-500 text-white'
                  : 'bg-white dark:bg-dark-card text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-dark-border'
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : !data || (data.totals.issuedKg === 0 && data.totals.recordedKg === 0) ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          No feed issued or recorded in this window yet.
        </p>
      ) : (
        <>
          {/* FIX: was a fixed 3-column grid, which squeezed "Store Issued" /
              "Recorded Fed" / "Mismatch Days" and their values into unreadably
              narrow tiles on a phone screen. Stacks to 1 column below the sm
              breakpoint, 3 columns from sm up. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            <div className="bg-gray-50 dark:bg-dark-border/40 rounded-xl p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">Store Issued</p>
              <p className="text-lg font-bold text-gray-800 dark:text-gray-100">
                {data.totals.issuedKg.toFixed(2)} kg
              </p>
            </div>
            <div className="bg-gray-50 dark:bg-dark-border/40 rounded-xl p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">Recorded Fed</p>
              <p className="text-lg font-bold text-gray-800 dark:text-gray-100">
                {data.totals.recordedKg.toFixed(2)} kg
              </p>
            </div>
            <div className={`rounded-xl p-3 ${data.totals.mismatchDays > 0 ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-green-50 dark:bg-green-900/20'}`}>
              <p className={`text-xs font-medium ${data.totals.mismatchDays > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>
                Mismatch Days
              </p>
              <p className={`text-lg font-bold ${data.totals.mismatchDays > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-green-700 dark:text-green-400'}`}>
                {data.totals.mismatchDays}
              </p>
            </div>
          </div>

          {/* FIX: was a single flex row forcing the date label and the long
              "Issued/Recorded/diff" string onto one line, causing the same
              squeeze on mobile. Stacks the two below sm. */}
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {data.buckets.slice().reverse().map(b => (
              <div
                key={b.periodStart}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5 sm:gap-2 text-xs bg-gray-50 dark:bg-dark-border/40 rounded-lg px-3 py-2"
              >
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  {period === 'monthly'
                    ? dayjs(`${b.periodStart}-01`).format('MMM YYYY')
                    : dayjs(b.periodStart).format('ddd D MMM')}
                </span>
                <span className="text-gray-500 dark:text-gray-400">
                  Issued {b.issuedKg.toFixed(2)}kg · Recorded {b.recordedKg.toFixed(2)}kg
                  {' '}· {b.diffKg > 0 ? `+${b.diffKg.toFixed(2)}` : b.diffKg.toFixed(2)}kg diff
                  {b.mismatchDays > 0 && (
                    <span className="text-amber-600 dark:text-amber-400 font-semibold"> · mismatch</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
