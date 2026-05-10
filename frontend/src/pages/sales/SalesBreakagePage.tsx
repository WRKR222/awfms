// src/pages/sales/SalesBreakagePage.tsx
// FIXED: Adjustment type properly constrains which fields are editable.
//        Standard → NON_CONSUMABLE or CONSUMABLE (both). Consumable → NON_CONSUMABLE only.
//        notifyExpense() to accountant (handled by backend). Stock updates after submit.
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Plus, EggOff, AlertTriangle, Info } from 'lucide-react';
import dayjs from 'dayjs';
import { api } from '../../lib/api/client';

const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green disabled:opacity-60 disabled:bg-gray-50 dark:disabled:bg-gray-900';

type AdjType = 'NON_CONSUMABLE' | 'CONSUMABLE';
type FormData = {
  adjustmentDate: string;
  adjustmentType: AdjType;
  tallySessionId: string;
  newNonConsumable: number;
  newConsumable: number;
  notes?: string;
};
type BreakageRecord = {
  id: string; adjustmentRef: string; adjustmentDate: string; adjustmentType: AdjType;
  quantityStandardBefore: number; quantityStarterBefore: number;
  quantityNonConsumableBefore: number; quantityConsumableBefore: number;
  newNonConsumable: number; newConsumable: number; quantityDiff: number;
  notes?: string | null; createdAt: string; reportedBy?: { fullName: string };
};
const TYPE_BADGE: Record<AdjType, string> = {
  NON_CONSUMABLE: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  CONSUMABLE:     'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
};

// Transformation rules per spec:
// NON_CONSUMABLE type: standard/consumable → non-consumable (edit newNonConsumable only)
// CONSUMABLE type: standard → consumable (edit newConsumable only)
// Consumable broken can ONLY become non-consumable (never re-become consumable if broken again)
const ADJ_RULES: Record<AdjType, { editNon: boolean; editConsumable: boolean; description: string }> = {
  NON_CONSUMABLE: {
    editNon: true,
    editConsumable: false,
    description: 'Standard or consumable eggs that are now non-consumable (unsellable, no market value).',
  },
  CONSUMABLE: {
    editNon: false,
    editConsumable: true,
    description: 'Standard eggs that became consumable broken (still sellable at reduced price).',
  },
};

export default function SalesBreakagePage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { register, handleSubmit, watch, reset, setValue } = useForm<FormData>({
    defaultValues: {
      adjustmentDate: dayjs().format('YYYY-MM-DD'),
      adjustmentType: 'NON_CONSUMABLE',
      tallySessionId: '',
      newNonConsumable: 0,
      newConsumable: 0,
    },
  });

  const selectedTallyId = watch('tallySessionId');
  const adjustmentType  = watch('adjustmentType');
  const rules           = ADJ_RULES[adjustmentType];

  const { data: tallies = [] } = useQuery({
    queryKey: ['verified-tallies'],
    queryFn: () => api.get('/tally-verifications?locked=true&limit=30').then(r => r.data),
  });
  const { data: stock } = useQuery({
    queryKey: ['sales-stock'],
    queryFn: () => api.get('/sales/stock').then(r => r.data).catch(() => null),
  });
  const { data: records = [], isLoading } = useQuery<BreakageRecord[]>({
    queryKey: ['breakage-adjustments'],
    queryFn: () => api.get('/sales/breakage-adjustments').then(r => r.data),
  });

  const selectedTally    = (tallies as any[]).find((t: any) => t.id === selectedTallyId);
  const qtyStandard      = selectedTally?.finalGoodEggs      ?? stock?.standardEggs      ?? 0;
  const qtyStarter       = selectedTally?.session?.totalStarterEggs ?? stock?.starterEggs       ?? 0;
  const qtyNonConsumable = selectedTally?.session?.totalBrokenEggs  ?? stock?.nonConsumableEggs ?? 0;
  const qtyConsumable    = stock?.consumableEggs ?? 0;

  const newNonConsumable = Number(watch('newNonConsumable') || 0);
  const newConsumable    = Number(watch('newConsumable')    || 0);
  const diffNonConsumable = newNonConsumable - qtyNonConsumable;
  const diffConsumable    = newConsumable    - qtyConsumable;
  const totalDiff         = (rules.editNon ? diffNonConsumable : 0) + (rules.editConsumable ? diffConsumable : 0);

  // When adjustment type changes, reset the locked (non-editable) field
  function handleTypeChange(type: AdjType) {
    setValue('adjustmentType', type);
    const newRules = ADJ_RULES[type];
    if (!newRules.editNon)        setValue('newNonConsumable', qtyNonConsumable); // reset to current
    if (!newRules.editConsumable) setValue('newConsumable',    qtyConsumable);
  }

  const create = useMutation({
    mutationFn: (data: FormData) => api.post('/sales/breakage-adjustments', {
      adjustmentDate:              data.adjustmentDate,
      adjustmentType:              data.adjustmentType,
      tallySessionId:              data.tallySessionId || undefined,
      quantityStandardBefore:      qtyStandard,
      quantityStarterBefore:       qtyStarter,
      quantityNonConsumableBefore: qtyNonConsumable,
      quantityConsumableBefore:    qtyConsumable,
      // Only send the editable field; backend computes quantityDiff
      newNonConsumable: rules.editNon        ? Number(data.newNonConsumable) : qtyNonConsumable,
      newConsumable:    rules.editConsumable ? Number(data.newConsumable)    : qtyConsumable,
      notes: data.notes,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['breakage-adjustments'] });
      qc.invalidateQueries({ queryKey: ['sales-stock'] });
      reset({ adjustmentDate: dayjs().format('YYYY-MM-DD'), adjustmentType: 'NON_CONSUMABLE', tallySessionId: '', newNonConsumable: 0, newConsumable: 0 });
      setShowForm(false);
    },
  });

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <EggOff className="w-5 h-5 text-red-500" /> Egg Breakage Adjustments
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Reclassify broken eggs. Stock updates on submit. Expected revenue is <strong>not affected</strong>.
            Accountant is notified automatically as an expense.
          </p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold"
        >
          <Plus className="w-4 h-4" /> {showForm ? 'Cancel' : 'New Adjustment'}
        </button>
      </div>

      {/* Current stock */}
      {stock && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Standard',           val: stock.standardEggs      ?? 0, color: 'text-brand-green' },
            { label: 'Starter',            val: stock.starterEggs       ?? 0, color: 'text-blue-500'    },
            { label: 'Non-Consumable',     val: stock.nonConsumableEggs ?? 0, color: 'text-red-500'     },
            { label: 'Consumable Broken',  val: stock.consumableEggs    ?? 0, color: 'text-amber-500'   },
          ].map(({ label, val, color }) => (
            <div key={label} className="bg-white dark:bg-dark-card rounded-2xl p-3 border border-gray-100 dark:border-dark-border">
              <p className={`text-xl font-bold ${color}`}>{(val as number).toLocaleString()}</p>
              <p className="text-xs text-gray-400 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleSubmit(d => create.mutate(d))}
          className="bg-white dark:bg-dark-card rounded-2xl p-5 border border-gray-100 dark:border-dark-border space-y-4"
        >
          <h2 className="font-semibold text-gray-700 dark:text-gray-200 text-sm">New Breakage Adjustment</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Adjustment Date *</label>
              <input type="date" {...register('adjustmentDate', { required: true })} className={iCls} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Adjustment Type *</label>
              <select
                value={adjustmentType}
                onChange={e => handleTypeChange(e.target.value as AdjType)}
                className={iCls}
              >
                <option value="NON_CONSUMABLE">Non-Consumable Broken (Unsellable)</option>
                <option value="CONSUMABLE">Consumable Broken (Sellable)</option>
              </select>
            </div>
          </div>

          {/* Rule explanation */}
          <div className="flex items-start gap-2 bg-blue-50 dark:bg-blue-900/20 rounded-xl px-3 py-2 text-xs text-blue-700 dark:text-blue-400">
            <Info className="w-3 h-3 flex-shrink-0 mt-0.5" />
            <span>{rules.description}</span>
          </div>

          {/* Reference tally */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Reference Verified Tally (next-day tally)</label>
            <select {...register('tallySessionId')} className={iCls}>
              <option value="">— Use current stock only —</option>
              {(tallies as any[]).map((t: any) => (
                <option key={t.id} value={t.id}>
                  {dayjs(t.sessionDate).format('D MMM YYYY')} · {t.shift} · {t.session?.batchCode ?? 'N/A'} [Verified]
                </option>
              ))}
            </select>
          </div>

          {/* Current quantities */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Quantity Collected (auto-populated)</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Standard Eggs',        val: qtyStandard },
                { label: 'Starter Eggs',          val: qtyStarter },
                { label: 'Non-Consumable Broken', val: qtyNonConsumable },
                { label: 'Consumable Broken',     val: qtyConsumable },
              ].map(({ label, val }) => (
                <div key={label} className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 border border-gray-200 dark:border-dark-border">
                  <p className="text-sm font-bold text-gray-700 dark:text-gray-200">{(val as number).toLocaleString()}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* New quantities — only show fields that are editable */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">New Quantities</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">
                  New Non-Consumable Broken Count
                  {!rules.editNon && <span className="ml-1 text-gray-400">(locked for this type)</span>}
                </label>
                <input
                  type="number" min="0"
                  {...register('newNonConsumable', { min: 0, valueAsNumber: true })}
                  disabled={!rules.editNon}
                  className={iCls}
                  defaultValue={qtyNonConsumable}
                />
                {rules.editNon && diffNonConsumable !== 0 && (
                  <p className={`text-xs mt-1 font-medium ${diffNonConsumable > 0 ? 'text-red-500' : 'text-green-600'}`}>
                    {diffNonConsumable > 0 ? `+${diffNonConsumable}` : diffNonConsumable} non-consumable
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">
                  New Consumable Broken Count
                  {!rules.editConsumable && <span className="ml-1 text-gray-400">(locked for this type)</span>}
                </label>
                <input
                  type="number" min="0"
                  {...register('newConsumable', { min: 0, valueAsNumber: true })}
                  disabled={!rules.editConsumable}
                  className={iCls}
                  defaultValue={qtyConsumable}
                />
                {rules.editConsumable && diffConsumable !== 0 && (
                  <p className={`text-xs mt-1 font-medium ${diffConsumable > 0 ? 'text-amber-500' : 'text-green-600'}`}>
                    {diffConsumable > 0 ? `+${diffConsumable}` : diffConsumable} consumable
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Diff summary */}
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 border border-gray-200 dark:border-dark-border flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">Quantity Difference (auto-calculated)</p>
            <p className={`text-base font-bold ${totalDiff > 0 ? 'text-red-500' : totalDiff < 0 ? 'text-green-600' : 'text-gray-400'}`}>
              {totalDiff > 0 ? `+${totalDiff}` : totalDiff} eggs
            </p>
          </div>

          <p className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-xl px-3 py-2">
            After submitting, your stock will update and the accountant will be notified to log this as an expense.
          </p>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">Notes (optional)</label>
            <textarea rows={2} {...register('notes')} className={iCls} placeholder="e.g. Transit damage on morning route..." />
          </div>

          <button
            type="submit"
            disabled={create.isPending}
            className="bg-brand-green text-white px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60"
          >
            {create.isPending ? 'Submitting…' : 'Submit Adjustment'}
          </button>
          {create.isError && (
            <p className="text-xs text-red-600 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {(create.error as any)?.response?.data?.message ?? 'Failed to submit.'}
            </p>
          )}
        </form>
      )}

      {/* History */}
      <div>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Adjustment History</p>
        {isLoading ? (
          <p className="text-sm text-gray-400 text-center py-6">Loading…</p>
        ) : (records as BreakageRecord[]).length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No breakage adjustments yet.</p>
        ) : (
          <div className="space-y-3">
            {(records as BreakageRecord[]).map(rec => (
              <div key={rec.id} className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-sm font-bold text-gray-800 dark:text-gray-100">{rec.adjustmentRef}</p>
                    <p className="text-xs text-gray-400">
                      {dayjs(rec.adjustmentDate).format('D MMM YYYY')} · by {rec.reportedBy?.fullName ?? '—'}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${TYPE_BADGE[rec.adjustmentType]}`}>
                    {rec.adjustmentType === 'NON_CONSUMABLE' ? 'Non-Consumable' : 'Consumable'}
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  {[
                    { label: 'Standard', val: rec.quantityStandardBefore },
                    { label: 'Starter',  val: rec.quantityStarterBefore  },
                    { label: 'Non-Consumable', val: `${rec.quantityNonConsumableBefore} → ${rec.newNonConsumable}` },
                    { label: 'Consumable',     val: `${rec.quantityConsumableBefore} → ${rec.newConsumable}`     },
                  ].map(({ label, val }) => (
                    <div key={label} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2">
                      <p className="font-semibold text-gray-700 dark:text-gray-300">{val}</p>
                      <p className="text-gray-400">{label}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-xs text-gray-400">{rec.notes ?? ''}</p>
                  <p className={`text-xs font-bold ${rec.quantityDiff > 0 ? 'text-red-500' : rec.quantityDiff < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                    Diff: {rec.quantityDiff > 0 ? `+${rec.quantityDiff}` : rec.quantityDiff}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
