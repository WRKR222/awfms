// src/pages/sales/SalesEggStockPage.tsx
// Shows original egg stock received from stores (after 3-party tally cosign)
// and current remaining stock after sales and breakages.

import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api/client';
import { Package, Egg, TrendingDown, DollarSign, ArrowLeft, RefreshCw } from 'lucide-react';
import dayjs from 'dayjs';

const cardCls = 'bg-white dark:bg-dark-card rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-dark-border';

function fmtKES(n?: number | null) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `KES ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)    return `KES ${(n / 1_000).toFixed(1)}K`;
  return `KES ${Number(n).toLocaleString()}`;
}

function traysLabel(eggs: number) {
  const t = Math.floor(eggs / 30), r = eggs % 30;
  if (!eggs) return '0 eggs';
  if (t === 0) return `${r} egg${r !== 1 ? 's' : ''}`;
  if (r === 0) return `${t} tray${t !== 1 ? 's' : ''}`;
  return `${t} tray${t !== 1 ? 's' : ''} + ${r}`;
}

export function SalesEggStockPage() {
  const navigate = useNavigate();

  // Current stock from /sales/stock (updated in real-time as orders are placed)
  const { data: stock, isLoading, refetch } = useQuery({
    queryKey: ['sales-stock'],
    queryFn: () => api.get('/sales/stock').then(r => r.data).catch(() => null),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  // FIX: Also fetch DailyEggAggregate — this is written once BOTH AM+PM tallies
  // are fully signed off and contains the true AM+PM combined starter egg total.
  const { data: aggregate } = useQuery({
    queryKey: ['daily-aggregate'],
    queryFn: () =>
      api.get(`/production/daily-aggregate?date=${dayjs().format('YYYY-MM-DD')}`).then(r => r.data).catch(() => null),
    staleTime: 2 * 60_000,
  });

  // Latest tally (cosigned by all 3 parties) — original stock released from stores
  const { data: tallyHistory = [] } = useQuery({
    queryKey: ['tally-history'],
    queryFn: () => api.get('/tally-verifications/history?days=7').then(r => r.data).catch(() => []),
    staleTime: 2 * 60_000,
  });

  // Summary: today sold + expected revenue
  const { data: summary } = useQuery({
    queryKey: ['sales-summary'],
    queryFn: () => api.get('/sales/summary').then(r => r.data).catch(() => null),
    staleTime: 60_000,
  });

  // Breakage adjustments today
  const { data: breakages = [] } = useQuery({
    queryKey: ['breakage-adjustments'],
    queryFn: () => api.get('/sales/breakage-adjustments').then(r => r.data).catch(() => []),
    staleTime: 2 * 60_000,
  });

  const totalBreakages = (breakages as any[]).reduce((s: number, b: any) => s + (b.quantity ?? 0), 0);

  // Latest locked tally gives original release counts
  const latestTally = (tallyHistory as any[]).find((t: any) => t.isLocked);

  const origStandard   = latestTally?.finalGoodEggs ?? 0;
  // FIX: Prefer DailyEggAggregate for starter eggs (AM+PM combined total).
  // Falls back to /sales/stock for legacy compatibility.
  const origStarter    = aggregate?.totalStarterEggs ?? stock?.starterEggs ?? 0;
  // Consumable broken = broken SELLABLE eggs; Non-consumable broken = broken
  // UNSELLABLE eggs (per next-morning 3-party tally data).
  const origConsumable    = aggregate?.totalBrokenSellable   ?? stock?.consumableEggs    ?? 0;
  const origNonConsumable = aggregate?.totalBrokenUnsellable ?? stock?.nonConsumableEggs ?? 0;

  const currentStandard   = stock?.standardEggs ?? 0;
  const currentStarter    = aggregate?.totalStarterEggs ?? stock?.starterEggs ?? 0;
  const currentConsumable = stock?.consumableEggs ?? 0;
  const currentNonConsumable = stock?.nonConsumableEggs ?? 0;
  const currentTotal = currentStandard + currentStarter + currentConsumable;

  // FIX: When standard (good) eggs are zero/negative because the day's
  // collection was all starter eggs, the dashboard shows starter eggs as its
  // own KPI in place of/alongside Standard Eggs.
  const isStarterOnly = (stock?.isStarterOnly ?? (currentStandard <= 0 && currentStarter > 0));

  const expectedRev = stock?.expectedRevenueKes ?? summary?.expectedRevenue ?? latestTally?.expectedRevenueKes;

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/sales')} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-card">
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <Package className="w-5 h-5 text-emerald-600" /> Egg Stock
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {dayjs().format('dddd, D MMMM YYYY')} · Updated every 5 min
          </p>
        </div>
        <button onClick={() => refetch()} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-card text-gray-400">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Original stock released from stores */}
      {latestTally && (
        <div className={cardCls}>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5" /> Original Stock Released (3-Party Cosigned)
          </p>
          <p className="text-xs text-gray-400 mb-3">
            Tally from {dayjs(latestTally.verificationDate).format('D MMM YYYY')} · Batch {latestTally.session?.batch?.batchCode ?? '—'}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className={`bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 text-center ${isStarterOnly ? 'col-span-2 md:col-span-1' : ''}`}>
              <p className="text-xs text-gray-500 mb-1">{isStarterOnly ? 'Standard Eggs (none — starter only)' : 'Standard Eggs'}</p>
              <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{origStandard.toLocaleString()}</p>
              <p className="text-xs text-gray-400 mt-0.5">{traysLabel(origStandard)}</p>
            </div>
            <div className={`bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 text-center ${isStarterOnly ? 'ring-2 ring-amber-400' : ''}`}>
              <p className="text-xs text-gray-500 mb-1">Starter Eggs</p>
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{origStarter.toLocaleString()}</p>
              <p className="text-xs text-gray-400 mt-0.5">{traysLabel(origStarter)}</p>
            </div>
            <div className="bg-orange-50 dark:bg-orange-900/20 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-500 mb-1">Consumable Broken</p>
              <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">{origConsumable.toLocaleString()}</p>
              <p className="text-xs text-gray-400 mt-0.5">{traysLabel(origConsumable)}</p>
            </div>
            <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-500 mb-1">Non-Consumable Broken</p>
              <p className="text-2xl font-bold text-red-600 dark:text-red-400">{origNonConsumable.toLocaleString()}</p>
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
          <p className="text-sm text-gray-400 text-center py-4">Loading...</p>
        ) : !stock ? (
          <p className="text-sm text-gray-400 text-center py-4">No stock data available</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className={`bg-brand-green/5 dark:bg-brand-green/10 rounded-xl p-3 text-center border border-brand-green/20 ${isStarterOnly ? 'col-span-2 md:col-span-1' : ''}`}>
                <p className="text-xs text-gray-500 mb-1">{isStarterOnly ? 'Standard Eggs (none — starter only)' : 'Standard Eggs'}</p>
                <p className="text-2xl font-bold text-brand-green">{currentStandard.toLocaleString()}</p>
                <p className="text-xs text-gray-400 mt-0.5">{traysLabel(currentStandard)}</p>
              </div>
              <div className={`bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 text-center ${isStarterOnly ? 'ring-2 ring-amber-400' : ''}`}>
                <p className="text-xs text-gray-500 mb-1">Starter Eggs</p>
                <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{currentStarter.toLocaleString()}</p>
                <p className="text-xs text-gray-400 mt-0.5">{traysLabel(currentStarter)}</p>
              </div>
              <div className="bg-orange-50 dark:bg-orange-900/20 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">Consumable Broken</p>
                <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">{currentConsumable.toLocaleString()}</p>
                <p className="text-xs text-gray-400 mt-0.5">{traysLabel(currentConsumable)}</p>
              </div>
              <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">Non-Consumable Broken</p>
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">{currentNonConsumable.toLocaleString()}</p>
                <p className="text-xs text-gray-400 mt-0.5">{traysLabel(currentNonConsumable)}</p>
              </div>
            </div>
            <div className="flex items-center justify-between bg-gray-50 dark:bg-dark-bg rounded-xl p-3">
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Total Current Stock</span>
              <span className="text-xl font-bold text-brand-green">{currentTotal.toLocaleString()} eggs</span>
            </div>
          </>
        )}
      </div>

      {/* Revenue */}
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
          <p className="text-xs text-gray-400 mt-0.5">
            <button onClick={() => navigate('/sales/breakage')} className="text-brand-green underline">Log breakage →</button>
          </p>
        </div>
      </div>

      {/* Note about breakages */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl p-4">
        <p className="text-xs text-amber-700 dark:text-amber-400 font-semibold mb-1">⚠ Transport Breakages</p>
        <p className="text-xs text-amber-600 dark:text-amber-500">
          Any eggs broken during transport from the production house to the sales building must be logged on the <button onClick={() => navigate('/sales/breakage')} className="underline font-semibold">Breakage page</button>. These will be deducted from your current stock.
        </p>
      </div>
    </div>
  );
}
