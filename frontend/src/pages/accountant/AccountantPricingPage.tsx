import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, TrendingUp, DollarSign, Calendar, Info } from 'lucide-react';
import { api } from '../../lib/api/client';
import dayjs from 'dayjs';

const inputCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-4 py-3 text-base bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';
const cardCls  = 'bg-white dark:bg-dark-card rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-dark-border';
const labelCls = 'block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1';
const subLabelCls = 'block text-xs text-gray-400 dark:text-gray-500 mb-2';

interface PriceFormData {
  priceDate: string;
  // Production house eggs
  pricePerEggProduction: string;
  // Brooder starter eggs
  pricePerEggStarter: string;
  // Broken but sellable (full broken)
  pricePerEggFullBroken: string;
  notes: string;
}

// Fetch today's tally totals for auto-calculating expected revenue
function useTallyTotals(date: string) {
  return useQuery({
    queryKey: ['tally-totals', date],
    queryFn: () => api.get(`/tally/totals?date=${date}`).then(r => r.data).catch(() => null),
    staleTime: 60_000,
  });
}

function useTodayPrice() {
  return useQuery({
    queryKey: ['daily-price', 'today'],
    queryFn: () => api.get('/pricing/daily/today').then(r => r.data).catch(() => null),
  });
}

function usePriceHistory() {
  return useQuery({
    queryKey: ['daily-price', 'history'],
    queryFn: () => api.get('/pricing/daily/history?limit=14').then(r => r.data),
  });
}

export function AccountantPricingPage() {
  const qc = useQueryClient();
  const today = dayjs().format('YYYY-MM-DD');

  const { data: todayPrice } = useTodayPrice();
  const { data: history = [] } = usePriceHistory();
  const { data: tallyTotals } = useTallyTotals(today);

  const { register, handleSubmit, watch, reset, setValue } = useForm<PriceFormData>({
    defaultValues: {
      priceDate: today,
      pricePerEggProduction: '',
      pricePerEggStarter: '',
      pricePerEggFullBroken: '',
      notes: '',
    },
  });

  // Pre-fill from today's price if already set
  useEffect(() => {
    if (todayPrice) {
      setValue('pricePerEggProduction', todayPrice.pricePerEggProduction ?? '');
      setValue('pricePerEggStarter',   todayPrice.pricePerEggStarter ?? '');
      setValue('pricePerEggFullBroken',todayPrice.pricePerEggFullBroken ?? '');
      setValue('notes', todayPrice.notes ?? '');
    }
  }, [todayPrice, setValue]);

  const priceProduction  = Number(watch('pricePerEggProduction')  ?? 0);
  const priceStarter     = Number(watch('pricePerEggStarter')     ?? 0);
  const priceFullBroken  = Number(watch('pricePerEggFullBroken')  ?? 0);

  // Tally totals (pulled from final confirmed store tally)
  const totalProductionEggs = Number(tallyTotals?.productionEggs ?? 0);
  const totalStarterEggs    = Number(tallyTotals?.starterEggs    ?? 0);
  const totalFullBroken     = Number(tallyTotals?.fullBrokenEggs ?? 0);

  // Auto-calculated expected revenue
  const expectedRevenue =
    (priceProduction * totalProductionEggs) +
    (priceStarter    * totalStarterEggs) +
    (priceFullBroken * totalFullBroken);

  const save = useMutation({
    mutationFn: (d: any) => api.post('/pricing/daily', d).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['daily-price'] });
      qc.invalidateQueries({ queryKey: ['finance-summary'] });
    },
  });

  function onSubmit(data: PriceFormData) {
    save.mutate({
      priceDate:             data.priceDate,
      pricePerEggProduction: Number(data.pricePerEggProduction),
      pricePerEggStarter:    Number(data.pricePerEggStarter),
      pricePerEggFullBroken: Number(data.pricePerEggFullBroken),
      expectedRevenue:       expectedRevenue > 0 ? expectedRevenue : undefined,
      notes:                 data.notes || undefined,
    });
  }

  const hasAllPrices = priceProduction > 0 && priceStarter > 0 && priceFullBroken > 0;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      <div className="mb-1">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
          <DollarSign className="w-6 h-6 text-brand-green" /> Daily Egg Pricing
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Set today's price per egg for each category. Expected revenue is calculated automatically from the final tally.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

        {/* Set Price Form */}
        <div className={cardCls}>
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-brand-green" />
            {todayPrice ? 'Update' : 'Set'} Today's Prices
          </h2>

          {todayPrice && (
            <div className="mb-4 bg-green-50 dark:bg-green-900/20 rounded-xl p-3 border border-green-200 dark:border-green-800">
              <p className="text-xs text-green-700 dark:text-green-400 font-medium">Prices set today</p>
              <div className="mt-1 space-y-0.5">
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  Production: <span className="font-bold text-brand-green">KES {Number(todayPrice.pricePerEggProduction ?? 0).toFixed(2)}/egg</span>
                </p>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  Starter: <span className="font-bold text-brand-green">KES {Number(todayPrice.pricePerEggStarter ?? 0).toFixed(2)}/egg</span>
                </p>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  Full Broken: <span className="font-bold text-brand-green">KES {Number(todayPrice.pricePerEggFullBroken ?? 0).toFixed(2)}/egg</span>
                </p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div>
              <label className={labelCls}>Price Date</label>
              <input {...register('priceDate')} type="date" className={inputCls} />
            </div>

            {/* Production House Eggs */}
            <div className="space-y-1">
              <label className={labelCls}>Production House Eggs — KES / egg</label>
              <span className={subLabelCls}>Standard eggs collected from the production house</span>
              <input
                {...register('pricePerEggProduction', { required: true })}
                type="number" min="0" step="0.01" inputMode="decimal"
                placeholder="e.g. 12.00"
                className={inputCls}
              />
              {priceProduction > 0 && (
                <p className="text-xs text-gray-400 mt-1">
                  = KES {(priceProduction * 30).toFixed(2)} per tray
                  {totalProductionEggs > 0 && ` · ${totalProductionEggs} eggs in tally = KES ${(priceProduction * totalProductionEggs).toLocaleString()}`}
                </p>
              )}
            </div>

            {/* Brooder Starter Eggs */}
            <div className="space-y-1">
              <label className={labelCls}>Brooder Starter Eggs — KES / egg</label>
              <span className={subLabelCls}>First eggs collected from chicks in the brooder</span>
              <input
                {...register('pricePerEggStarter', { required: true })}
                type="number" min="0" step="0.01" inputMode="decimal"
                placeholder="e.g. 10.00"
                className={inputCls}
              />
              {priceStarter > 0 && (
                <p className="text-xs text-gray-400 mt-1">
                  = KES {(priceStarter * 30).toFixed(2)} per tray
                  {totalStarterEggs > 0 && ` · ${totalStarterEggs} eggs in tally = KES ${(priceStarter * totalStarterEggs).toLocaleString()}`}
                </p>
              )}
            </div>

            {/* Full Broken (sellable) Eggs */}
            <div className="space-y-1">
              <label className={labelCls}>Broken but Sellable Eggs — KES / egg</label>
              <span className={subLabelCls}>Full broken eggs that are still sellable (cracked but intact contents)</span>
              <input
                {...register('pricePerEggFullBroken', { required: true })}
                type="number" min="0" step="0.01" inputMode="decimal"
                placeholder="e.g. 8.00"
                className={inputCls}
              />
              {priceFullBroken > 0 && (
                <p className="text-xs text-gray-400 mt-1">
                  {totalFullBroken > 0 && `${totalFullBroken} eggs in tally = KES ${(priceFullBroken * totalFullBroken).toLocaleString()}`}
                </p>
              )}
            </div>

            <div>
              <label className={labelCls}>Notes</label>
              <input {...register('notes')} className={inputCls} placeholder="e.g. Market price adjustment" />
            </div>

            {/* Auto-calculated expected revenue */}
            <div className="bg-gray-50 dark:bg-dark-bg rounded-xl p-4 border border-gray-100 dark:border-dark-border">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-brand-green flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">Expected Revenue (auto-calculated)</p>
                  {tallyTotals ? (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>Production ({totalProductionEggs} eggs × KES {priceProduction.toFixed(2)})</span>
                        <span className="font-medium">KES {(priceProduction * totalProductionEggs).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>Starter ({totalStarterEggs} eggs × KES {priceStarter.toFixed(2)})</span>
                        <span className="font-medium">KES {(priceStarter * totalStarterEggs).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>Full Broken ({totalFullBroken} eggs × KES {priceFullBroken.toFixed(2)})</span>
                        <span className="font-medium">KES {(priceFullBroken * totalFullBroken).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm font-bold text-gray-800 dark:text-gray-100 border-t border-gray-200 dark:border-gray-700 pt-1 mt-1">
                        <span>Total Expected Revenue</span>
                        <span className="text-brand-green">KES {expectedRevenue.toLocaleString()}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400">
                      Final tally not yet confirmed — revenue will auto-calculate once the store confirms egg counts.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {save.isError && (
              <p className="text-red-500 text-sm">{(save.error as any)?.response?.data?.message ?? 'Failed to save.'}</p>
            )}

            <button
              type="submit"
              disabled={save.isPending || !hasAllPrices}
              className="w-full bg-brand-green text-white rounded-xl py-3 font-bold disabled:opacity-60 hover:bg-green-800 transition-colors flex items-center justify-center gap-2"
            >
              {save.isSuccess
                ? <><CheckCircle className="w-4 h-4" /> Prices Saved!</>
                : save.isPending
                  ? 'Saving...'
                  : hasAllPrices
                    ? `Save Prices — Revenue KES ${expectedRevenue > 0 ? expectedRevenue.toLocaleString() : '(pending tally)'}`
                    : 'Enter all three price categories to save'
              }
            </button>
          </form>
        </div>

        {/* Price History */}
        <div className={cardCls}>
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-brand-green" /> Price History
          </h2>
          {history.length === 0 ? (
            <p className="text-gray-400 text-sm">No price history yet.</p>
          ) : (
            <div className="space-y-2 max-h-[520px] overflow-y-auto">
              {history.map((h: any) => {
                const isToday = dayjs(h.priceDate).isSame(dayjs(), 'day');
                return (
                  <div
                    key={h.id}
                    className={`py-3 px-3 rounded-xl border ${
                      isToday
                        ? 'bg-brand-green/10 border-brand-green/30'
                        : 'bg-gray-50 dark:bg-dark-bg border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                        {isToday ? 'Today' : dayjs(h.priceDate).format('D MMM YYYY')}
                      </p>
                      {h.expectedRevenue && (
                        <p className="text-xs font-medium text-brand-green">
                          KES {Number(h.expectedRevenue).toLocaleString()} expected
                        </p>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {[
                        { label: 'Prod.',    val: h.pricePerEggProduction },
                        { label: 'Starter',  val: h.pricePerEggStarter },
                        { label: 'Broken',   val: h.pricePerEggFullBroken },
                      ].map(({ label, val }) => (
                        <div key={label} className="text-center bg-white dark:bg-dark-card rounded-lg py-1.5 px-1">
                          <p className="text-[10px] text-gray-400">{label}</p>
                          <p className="text-xs font-bold text-brand-green">
                            {val ? `KES ${Number(val).toFixed(2)}` : '—'}
                          </p>
                        </div>
                      ))}
                    </div>
                    {h.notes && <p className="text-xs text-gray-400 mt-1.5">{h.notes}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
