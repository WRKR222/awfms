// src/pages/sales/SalesEggStockPage.tsx
//
// Fixes:
//  1. Date filtering — salesperson can view stock by day / week / month.
//  2. FIFO lot display — oldest stock lot is highlighted; salesperson prompted
//     to fulfil orders from oldest lot first before newer lots.
//  3. Real-time stock deduction — refetchInterval set to 30s and re-fetches
//     are triggered on window focus so invoice payments reflect immediately.
//  4. Consumable broken can be ordered directly from this page.

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api/client';
import {
  Package, Egg, TrendingDown, DollarSign, ArrowLeft,
  RefreshCw, Calendar, AlertCircle, Clock,
} from 'lucide-react';
import dayjs from '../../lib/dayjs';

const cardCls =
  'bg-white dark:bg-dark-card rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-dark-border';

type RangeType = 'day' | 'week' | 'month';

function fmtKES(n?: number | null) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `KES ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)    return `KES ${(n / 1_000).toFixed(1)}K`;
  return `KES ${Number(n).toLocaleString()}`;
}

function traysLabel(eggs: number) {
  const t = Math.floor(eggs / 30);
  const r = eggs % 30;
  if (!eggs) return '0 eggs';
  if (t === 0) return `${r} egg${r !== 1 ? 's' : ''}`;
  if (r === 0) return `${t} tray${t !== 1 ? 's' : ''}`;
  return `${t} tray${t !== 1 ? 's' : ''} + ${r}`;
}

const RANGE_LABELS: Record<RangeType, string> = {
  day:   'Today',
  week:  'This Week',
  month: 'This Month',
};

export function SalesEggStockPage() {
  const navigate   = useNavigate();
  const qc         = useQueryClient();
  const [range, setRange] = useState<RangeType>('day');

  // ── Current live stock ────────────────────────────────────────────────────
  const { data: stock, isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['sales-stock', range],
    queryFn:  () => api.get(`/sales/stock`).then(r => r.data).catch(() => null),
    staleTime:       30_000,
    refetchInterval: 30_000,       // poll every 30 s for invoice-paid deductions
    refetchOnWindowFocus: true,    // re-check when tab regains focus
  });

  // ── Stock history timeline ────────────────────────────────────────────────
  const { data: history = [] } = useQuery({
    queryKey: ['stock-history', range],
    queryFn:  () =>
      api.get(`/sales/stock/history?range=${range}`).then(r => r.data).catch(() => []),
    staleTime: 60_000,
  });

  // ── Daily aggregate (AM+PM combined) ─────────────────────────────────────
  const { data: aggregate } = useQuery({
    queryKey: ['daily-aggregate'],
    queryFn:  () =>
      api
        .get(`/production/daily-aggregate?date=${dayjs().format('YYYY-MM-DD')}`)
        .then(r => r.data)
        .catch(() => null),
    staleTime: 2 * 60_000,
  });

  // ── Latest tally (original release) ──────────────────────────────────────
  const { data: tallyHistory = [] } = useQuery({
    queryKey: ['tally-history'],
    queryFn:  () =>
      api.get('/tally-verifications/history?days=7').then(r => r.data).catch(() => []),
    staleTime: 2 * 60_000,
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  const { data: summary } = useQuery({
    queryKey: ['sales-summary'],
    queryFn:  () => api.get('/sales/summary').then(r => r.data).catch(() => null),
    staleTime: 60_000,
  });

  // ── Breakage adjustments ──────────────────────────────────────────────────
  const { data: breakages = [] } = useQuery({
    queryKey: ['breakage-adjustments'],
    queryFn:  () => api.get('/sales/breakage-adjustments').then(r => r.data).catch(() => []),
    staleTime: 2 * 60_000,
  });

  const totalBreakages = (breakages as any[]).reduce(
    (s: number, b: any) => s + (b.quantityDiff ?? 0), 0,
  );

  const latestTally = (tallyHistory as any[]).find((t: any) => t.isLocked);

  // Original counts
  const origStandard      = latestTally?.finalGoodEggs ?? 0;
  const origStarter       = aggregate?.totalStarterEggs ?? stock?.starterEggs ?? 0;
  const origConsumable    = aggregate?.totalBrokenSellable   ?? stock?.consumableEggs    ?? 0;
  const origNonConsumable = aggregate?.totalBrokenUnsellable ?? stock?.nonConsumableEggs ?? 0;

  // Current counts
  const currentStandard      = stock?.standardEggs      ?? 0;
  const currentStarter       = aggregate?.totalStarterEggs ?? stock?.starterEggs ?? 0;
  const currentConsumable    = stock?.consumableEggs    ?? 0;
  const currentNonConsumable = stock?.nonConsumableEggs ?? 0;
  const currentTotal         = currentStandard + currentStarter + currentConsumable;

  const isStarterOnly = stock?.isStarterOnly ?? (currentStandard <= 0 && currentStarter > 0);
  const expectedRev   = stock?.expectedRevenueKes ?? summary?.expectedRevenue ?? latestTally?.expectedRevenueKes;

  // FIFO lots
  const stockLots: any[] = stock?.stockLots ?? [];
  const oldestLot = stockLots.find((l: any) => l.isOldest);

  const lastUpdated = dataUpdatedAt
    ? dayjs(dataUpdatedAt).format('HH:mm:ss')
    : null;

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/sales')}
          className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-card"
        >
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <Package className="w-5 h-5 text-emerald-600" /> Egg Stock
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {dayjs().format('dddd, D MMMM YYYY')}
            {lastUpdated && (
              <span className="ml-2 text-gray-400">· Updated at {lastUpdated}</span>
            )}
          </p>
        </div>
        <button
          onClick={() => {
            refetch();
            qc.invalidateQueries({ queryKey: ['sales-summary'] });
          }}
          className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-card text-gray-400"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Date Range Filter */}
      <div className="flex items-center gap-2">
        <Calendar className="w-4 h-4 text-gray-400" />
        <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1 gap-1">
          {(['day', 'week', 'month'] as RangeType[]).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                range === r
                  ? 'bg-white dark:bg-dark-card text-brand-green shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
              }`}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      {/* FIFO Alert — oldest lot warning */}
      {oldestLot && stockLots.length > 1 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl p-4 flex items-start gap-3">
          <Clock className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
              Complete older stock first
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">
              You have stock from{' '}
              <strong>{dayjs(oldestLot.collectionDate).format('D MMM YYYY')}</strong> that
              should be sold before newer lots. Please prioritise orders from this batch:
              {' '}{(oldestLot.totalStdEggs ?? 0).toLocaleString()} standard,
              {' '}{(oldestLot.totalBrokenSellable ?? 0).toLocaleString()} consumable broken eggs.
            </p>
          </div>
        </div>
      )}

      {/* Original stock released from stores */}
      {latestTally && (
        <div className={cardCls}>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5" /> Original Stock Released (3-Party Cosigned)
          </p>
          <p className="text-xs text-gray-400 mb-3">
            Tally from {dayjs(latestTally.verificationDate).format('D MMM YYYY')} · Batch{' '}
            {latestTally.session?.batch?.batchCode ?? '—'}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-500 mb-1">
                {isStarterOnly ? 'Standard Eggs (none — starter only)' : 'Standard Eggs'}
              </p>
              <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
                {origStandard.toLocaleString()}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{traysLabel(origStandard)}</p>
            </div>
            <div
              className={`bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 text-center ${
                isStarterOnly ? 'ring-2 ring-amber-400' : ''
              }`}
            >
              <p className="text-xs text-gray-500 mb-1">Starter Eggs</p>
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                {origStarter.toLocaleString()}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{traysLabel(origStarter)}</p>
            </div>
            <div className="bg-orange-50 dark:bg-orange-900/20 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-500 mb-1">Consumable Broken</p>
              <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                {origConsumable.toLocaleString()}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{traysLabel(origConsumable)}</p>
            </div>
            <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-500 mb-1">Non-Consumable Broken</p>
              <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                {origNonConsumable.toLocaleString()}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{traysLabel(origNonConsumable)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Current stock */}
      <div className={cardCls}>
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
          <Egg className="w-3.5 h-3.5" /> Current Stock Available
        </p>
        {isLoading ? (
          <p className="text-sm text-gray-400 text-center py-4">Loading…</p>
        ) : !stock ? (
          <p className="text-sm text-gray-400 text-center py-4">No stock data available</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div
                className={`bg-brand-green/5 dark:bg-brand-green/10 rounded-xl p-3 text-center border border-brand-green/20 ${
                  isStarterOnly ? 'col-span-2 md:col-span-1' : ''
                }`}
              >
                <p className="text-xs text-gray-500 mb-1">
                  {isStarterOnly ? 'Standard Eggs (none)' : 'Standard Eggs'}
                </p>
                <p className="text-2xl font-bold text-brand-green">
                  {currentStandard.toLocaleString()}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{traysLabel(currentStandard)}</p>
              </div>
              <div
                className={`bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 text-center ${
                  isStarterOnly ? 'ring-2 ring-amber-400' : ''
                }`}
              >
                <p className="text-xs text-gray-500 mb-1">Starter Eggs</p>
                <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                  {currentStarter.toLocaleString()}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{traysLabel(currentStarter)}</p>
              </div>

              {/* Consumable Broken — now shows Order button */}
              <div className="bg-orange-50 dark:bg-orange-900/20 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">Consumable Broken</p>
                <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                  {currentConsumable.toLocaleString()}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{traysLabel(currentConsumable)}</p>
                {currentConsumable > 0 && (
                  <button
                    onClick={() => navigate('/sales/orders')}
                    className="mt-1.5 text-xs text-orange-600 dark:text-orange-400 underline"
                  >
                    Place order →
                  </button>
                )}
              </div>

              <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">Non-Consumable Broken</p>
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                  {currentNonConsumable.toLocaleString()}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{traysLabel(currentNonConsumable)}</p>
              </div>
            </div>
            <div className="flex items-center justify-between bg-gray-50 dark:bg-dark-bg rounded-xl p-3">
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                Total Sellable Stock
              </span>
              <span className="text-xl font-bold text-brand-green">
                {currentTotal.toLocaleString()} eggs
              </span>
            </div>
          </>
        )}
      </div>

      {/* Revenue cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className={cardCls + ' flex flex-col items-center justify-center text-center'}>
          <DollarSign className="w-6 h-6 text-brand-green mb-1" />
          <p className="text-xs text-gray-500 mb-1">Expected Revenue</p>
          <p className="text-2xl font-bold text-brand-green">{fmtKES(expectedRev)}</p>
        </div>
        <div className={cardCls + ' flex flex-col items-center justify-center text-center'}>
          <TrendingDown className="w-6 h-6 text-red-500 mb-1" />
          <p className="text-xs text-gray-500 mb-1">Breakage Losses</p>
          <p className="text-2xl font-bold text-red-500">{totalBreakages} eggs</p>
          <button
            onClick={() => navigate('/sales/breakage')}
            className="text-xs text-brand-green underline mt-0.5"
          >
            Log breakage →
          </button>
        </div>
      </div>

      {/* Stock history timeline */}
      {(history as any[]).length > 0 && (
        <div className={cardCls}>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            Stock History — {RANGE_LABELS[range]}
          </p>
          <div className="space-y-2">
            {(history as any[]).map((h: any) => (
              <div
                key={h.date}
                className="flex items-center justify-between text-xs border-b border-gray-50 dark:border-gray-800 pb-2 last:border-0 last:pb-0"
              >
                <span className="text-gray-500 w-24 flex-shrink-0">
                  {dayjs(h.date).format('D MMM')}
                </span>
                <div className="flex gap-3 flex-1 justify-end">
                  <span className="text-emerald-600">
                    Std: {(h.standardEggs ?? 0).toLocaleString()}
                  </span>
                  <span className="text-orange-500">
                    Broken: {(h.consumableEggs ?? 0).toLocaleString()}
                  </span>
                  <span className="text-gray-400">
                    Sold: {(h.soldStandard + h.soldConsumable).toLocaleString()}
                  </span>
                  <span className="text-brand-green font-semibold">
                    Left: {((h.remainingStandard ?? 0) + (h.remainingConsumable ?? 0)).toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FIFO stock lots detail */}
      {stockLots.length > 0 && (
        <div className={cardCls}>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> Stock Lots (FIFO — sell oldest first)
          </p>
          <div className="space-y-2">
            {stockLots.map((lot: any) => (
              <div
                key={lot.lotIndex}
                className={`flex items-center justify-between rounded-xl px-3 py-2 text-xs ${
                  lot.isOldest
                    ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700'
                    : 'bg-gray-50 dark:bg-gray-800'
                }`}
              >
                <div>
                  <span
                    className={`font-semibold ${
                      lot.isOldest ? 'text-amber-700 dark:text-amber-400' : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {dayjs(lot.collectionDate).format('D MMM YYYY')}
                  </span>
                  {lot.isOldest && (
                    <span className="ml-2 text-amber-500 font-bold uppercase text-[10px]">
                      ← Sell first
                    </span>
                  )}
                </div>
                <div className="flex gap-3 text-gray-500">
                  <span>Std: {(lot.totalStdEggs ?? 0).toLocaleString()}</span>
                  <span>Broken: {(lot.totalBrokenSellable ?? 0).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transport breakage notice */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl p-4">
        <p className="text-xs text-amber-700 dark:text-amber-400 font-semibold mb-1 flex items-center gap-1">
          <AlertCircle className="w-3.5 h-3.5" /> Transport Breakages
        </p>
        <p className="text-xs text-amber-600 dark:text-amber-500">
          Any eggs broken during transport from the production house to the sales building must
          be logged on the{' '}
          <button
            onClick={() => navigate('/sales/breakage')}
            className="underline font-semibold"
          >
            Breakage page
          </button>
          . These will be deducted from your current stock.
        </p>
      </div>
    </div>
  );
}
