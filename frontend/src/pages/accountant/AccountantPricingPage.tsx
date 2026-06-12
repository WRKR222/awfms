// frontend/src/pages/accountant/AccountantPricingPage.tsx
// Fixes: GAP-01 (field name mismatch pricePerEgg vs pricePerEggProduction)
//        GAP-17 (history display reads wrong field names)
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, TrendingUp, DollarSign, Calendar, Info } from 'lucide-react';
import { api } from '../../lib/api/client';
import dayjs from 'dayjs';

const inputCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-4 py-3 text-base bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';
const cardCls  = 'bg-white dark:bg-dark-card rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-dark-border';
const labelCls = 'block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1';
const subLbl   = 'block text-xs text-gray-400 dark:text-gray-500 mb-2';

// GAP-01 FIX: field names now match backend DTO (pricePerEgg, pricePerEggBroken)
interface PriceFormData {
  priceDate: string;
  pricePerEgg: string;
  pricePerEggStarter: string;
  pricePerEggBroken: string;
  notes: string;
}

function useTallyTotals(date: string) {
  return useQuery({
    queryKey: ['tally-totals', date],
    queryFn: () => api.get(`/tally-verifications/totals?date=${date}`).then(r => r.data).catch(() => null),
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

  const { register, handleSubmit, watch, setValue } = useForm<PriceFormData>({
    defaultValues: { priceDate: today, pricePerEgg: '', pricePerEggStarter: '', pricePerEggBroken: '', notes: '' },
  });

  useEffect(() => {
    if (todayPrice) {
      setValue('pricePerEgg',        String(todayPrice.pricePerEgg        ?? ''));
      setValue('pricePerEggStarter', String(todayPrice.pricePerEggStarter ?? ''));
      setValue('pricePerEggBroken',  String(todayPrice.pricePerEggBroken  ?? ''));
      setValue('notes', todayPrice.notes ?? '');
    }
  }, [todayPrice, setValue]);

  const pricePerEgg        = Number(watch('pricePerEgg')        || 0);
  const pricePerEggStarter = Number(watch('pricePerEggStarter') || 0);
  const pricePerEggBroken  = Number(watch('pricePerEggBroken')  || 0);
  // Expected revenue = total eggs collected (AM + PM) × price per standard egg.
  // totalProduction comes from getTallyTotalsForDate which returns the sum of
  // every row's totalEggs across both locked sessions.
  const totalProduction    = Number(tallyTotals?.productionEggs ?? 0);
  const totalStarter       = Number(tallyTotals?.starterEggs    ?? 0);
  const totalBroken        = Number(tallyTotals?.fullBrokenEggs ?? 0);
  const expectedRevenue    = pricePerEgg * totalProduction;

  const save = useMutation({
    mutationFn: (d: any) => api.post('/pricing/daily', d).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['daily-price'] }); qc.invalidateQueries({ queryKey: ['finance-summary'] }); },
  });

  function onSubmit(data: PriceFormData) {
    save.mutate({
      priceDate:          data.priceDate,
      pricePerEgg:        Number(data.pricePerEgg),
      pricePerEggStarter: Number(data.pricePerEggStarter) || undefined,
      pricePerEggBroken:  Number(data.pricePerEggBroken)  || undefined,
      expectedRevenue:    expectedRevenue > 0 ? expectedRevenue : undefined,
      notes:              data.notes || undefined,
    });
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
          <DollarSign className="w-6 h-6 text-brand-green" /> Daily Egg Pricing
        </h1>
        <p className="text-sm text-gray-500 mt-1">Set today's prices per egg category. Revenue auto-calculates from the locked morning tally.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Form */}
        <div className={cardCls}>
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-brand-green" /> {todayPrice ? 'Update' : 'Set'} Today's Prices
          </h2>

          {todayPrice && (
            <div className="mb-4 bg-green-50 dark:bg-green-900/20 rounded-xl p-3 border border-green-200">
              <p className="text-xs text-green-700 font-medium">Prices already set today</p>
              <div className="mt-1 space-y-0.5 text-sm text-gray-700 dark:text-gray-300">
                <p>Production: <strong className="text-brand-green">KES {Number(todayPrice.pricePerEgg ?? 0).toFixed(2)}/egg</strong></p>
                {todayPrice.pricePerEggStarter && <p>Starter: <strong className="text-brand-green">KES {Number(todayPrice.pricePerEggStarter).toFixed(2)}/egg</strong></p>}
                {todayPrice.pricePerEggBroken  && <p>Consumable Broken: <strong className="text-brand-green">KES {Number(todayPrice.pricePerEggBroken).toFixed(2)}/egg</strong></p>}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className={labelCls}>Price Date</label>
              <input {...register('priceDate')} type="date" className={inputCls} />
            </div>

            <div className="space-y-1">
              <label className={labelCls}>Production House Eggs (Standard) — KES/egg *</label>
              <span className={subLbl}>Standard eggs from production house</span>
              <input {...register('pricePerEgg', { required: true })} type="number" min="0" step="0.01" placeholder="e.g. 12.00" className={inputCls} />
              {pricePerEgg > 0 && (
                <p className="text-xs text-gray-400 mt-1">
                  KES {(pricePerEgg * 30).toFixed(2)}/tray
                  {totalProduction > 0 && ` · ${totalProduction} eggs = KES ${(pricePerEgg * totalProduction).toLocaleString()}`}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <label className={labelCls}>Starter Eggs — KES/egg</label>
              <span className={subLbl}>First eggs from chicks in early lay (optional)</span>
              <input {...register('pricePerEggStarter')} type="number" min="0" step="0.01" placeholder="e.g. 10.00" className={inputCls} />
              {pricePerEggStarter > 0 && totalStarter > 0 && (
                <p className="text-xs text-gray-400 mt-1">{totalStarter} eggs = KES {(pricePerEggStarter * totalStarter).toLocaleString()}</p>
              )}
            </div>

            <div className="space-y-1">
              <label className={labelCls}>Consumable Broken Eggs — KES/egg</label>
              <span className={subLbl}>Cracked but contents intact — sellable at reduced price</span>
              <input {...register('pricePerEggBroken')} type="number" min="0" step="0.01" placeholder="e.g. 8.00" className={inputCls} />
              {pricePerEggBroken > 0 && totalBroken > 0 && (
                <p className="text-xs text-gray-400 mt-1">{totalBroken} eggs = KES {(pricePerEggBroken * totalBroken).toLocaleString()}</p>
              )}
            </div>

            <div>
              <label className={labelCls}>Notes</label>
              <input {...register('notes')} className={inputCls} placeholder="e.g. Market price adjustment" />
            </div>

            {/* Revenue summary */}
            <div className="bg-gray-50 dark:bg-dark-bg rounded-xl p-3 border border-gray-100 dark:border-dark-border">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-brand-green flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-xs font-semibold text-gray-600 mb-1">Expected Revenue</p>
                  {tallyTotals ? (
                    <>
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>Standard Eggs AM+PM ({totalProduction} × KES {pricePerEgg.toFixed(2)})</span>
                        <span>KES {(totalProduction * pricePerEgg).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm font-bold border-t border-gray-200 pt-1 mt-1">
                        <span>Total</span>
                        <span className="text-brand-green">KES {expectedRevenue.toLocaleString()}</span>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-gray-400">Tally not yet confirmed — revenue will auto-calculate once the cosigned AM &amp; PM tally is locked.</p>
                  )}
                </div>
              </div>
            </div>

            {save.isError && <p className="text-red-500 text-sm">{(save.error as any)?.response?.data?.message ?? 'Failed to save.'}</p>}

            <button type="submit" disabled={save.isPending || pricePerEgg <= 0}
              className="w-full bg-brand-green text-white rounded-xl py-3 font-bold disabled:opacity-60 flex items-center justify-center gap-2">
              {save.isSuccess ? <><CheckCircle className="w-4 h-4" /> Prices Saved!</>
                : save.isPending ? 'Saving…'
                : pricePerEgg > 0 ? `Save & Forward — KES ${expectedRevenue > 0 ? expectedRevenue.toLocaleString() : '(tally pending)'}`
                : 'Enter production egg price to save'}
            </button>
          </form>
        </div>

        {/* History — GAP-17 FIX: use correct field names */}
        <div className={cardCls}>
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-brand-green" /> Price History
          </h2>
          {history.length === 0 ? <p className="text-gray-400 text-sm">No price history yet.</p> : (
            <div className="space-y-2 max-h-[520px] overflow-y-auto">
              {history.map((h: any) => {
                const isToday = dayjs(h.priceDate).isSame(dayjs(), 'day');
                return (
                  <div key={h.id} className={`py-3 px-3 rounded-xl border ${isToday ? 'bg-brand-green/10 border-brand-green/30' : 'bg-gray-50 dark:bg-dark-bg border-transparent'}`}>
                    <div className="flex justify-between mb-1.5">
                      <p className="text-sm font-semibold">{isToday ? 'Today' : dayjs(h.priceDate).format('D MMM YYYY')}</p>
                      {h.expectedRevenue && <p className="text-xs text-brand-green font-medium">KES {Number(h.expectedRevenue).toLocaleString()}</p>}
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {[
                        { label: 'Production', val: h.pricePerEgg },           // GAP-17 FIX
                        { label: 'Starter',    val: h.pricePerEggStarter },     // GAP-17 FIX
                        { label: 'Broken',     val: h.pricePerEggBroken },      // GAP-17 FIX
                      ].map(({ label, val }) => (
                        <div key={label} className="text-center bg-white dark:bg-dark-card rounded-lg py-1.5 px-1">
                          <p className="text-[10px] text-gray-400">{label}</p>
                          <p className="text-xs font-bold text-brand-green">{val ? `KES ${Number(val).toFixed(2)}` : '—'}</p>
                        </div>
                      ))}
                    </div>
                    {h.notes && <p className="text-xs text-gray-400 mt-1">{h.notes}</p>}
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
