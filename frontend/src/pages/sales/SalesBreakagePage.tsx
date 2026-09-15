// src/pages/sales/SalesBreakagePage.tsx
//
// Fixes:
//  1. Internal Server Error on submit — errors now shown to user cleanly.
//  2. Stock Overview updates after submit via query invalidation.
//  3. Adjustment type logic:
//       • Source = STANDARD EGG  → result can be CONSUMABLE or NON_CONSUMABLE
//       • Source = CONSUMABLE BROKEN → result can ONLY be NON_CONSUMABLE
//  4. Reference tally shows AM+PM combined counts (fetched from /sales/tally-aggregate).
//  5. Dashboard + Egg Stock page re-fetched after submit.

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Plus, EggOff, AlertTriangle, Info, ChevronDown, ChevronUp } from 'lucide-react';
import dayjs from '../../lib/dayjs';
import { api } from '../../lib/api/client';
import { LoadErrorNote } from '../../components/shared/LoadErrorNote';

const iCls =
  'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green disabled:opacity-60 disabled:bg-gray-50 dark:disabled:bg-gray-900';

/** Which egg broke */
type SourceType = 'STANDARD' | 'CONSUMABLE';
/** What it becomes */
type ResultType = 'CONSUMABLE' | 'NON_CONSUMABLE';

type FormData = {
  adjustmentDate: string;
  sourceType: SourceType;
  adjustmentType: ResultType;
  tallySessionId: string;
  newStandard: number;
  newNonConsumable: number;
  newConsumable: number;
  notes?: string;
};

type BreakageRecord = {
  id: string;
  adjustmentRef: string;
  adjustmentDate: string;
  adjustmentType: ResultType;
  quantityStandardBefore: number;
  quantityStarterBefore: number;
  quantityNonConsumableBefore: number;
  quantityConsumableBefore: number;
  newNonConsumable: number;
  newConsumable: number;
  quantityDiff: number;
  notes?: string | null;
  createdAt: string;
  reportedBy?: { fullName: string };
};

const SOURCE_LABELS: Record<SourceType, string> = {
  STANDARD:   'Standard Egg broke',
  CONSUMABLE: 'Consumable Broken Egg got destroyed',
};

const RESULT_BADGE: Record<ResultType, string> = {
  NON_CONSUMABLE: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  CONSUMABLE:     'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
};

/**
 * Available result types per source type:
 *  - STANDARD egg → can become CONSUMABLE (sellable broken) OR NON_CONSUMABLE (unsellable)
 *  - CONSUMABLE broken egg further destroyed → can ONLY become NON_CONSUMABLE
 */
const RESULT_OPTIONS: Record<SourceType, { value: ResultType; label: string; hint: string }[]> = {
  STANDARD: [
    {
      value: 'CONSUMABLE',
      label: 'Consumable Broken (Sellable)',
      hint: 'The egg cracked but content is intact — can still be sold at a lower price.',
    },
    {
      value: 'NON_CONSUMABLE',
      label: 'Non-Consumable Broken (Unsellable)',
      hint: 'The egg is fully broken / contaminated — must be disposed of.',
    },
  ],
  CONSUMABLE: [
    {
      value: 'NON_CONSUMABLE',
      label: 'Non-Consumable Broken (Unsellable)',
      hint: 'The consumable broken egg was further damaged and can no longer be sold.',
    },
  ],
};

export default function SalesBreakagePage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [expandedRecord, setExpandedRecord] = useState<string | null>(null);

  const { register, handleSubmit, watch, reset, setValue } = useForm<FormData>({
    defaultValues: {
      adjustmentDate:   dayjs().format('YYYY-MM-DD'),
      sourceType:       'STANDARD',
      adjustmentType:   'CONSUMABLE',
      tallySessionId:   '',
      newStandard:      0,
      newNonConsumable: 0,
      newConsumable:    0,
    },
  });

  const sourceType    = watch('sourceType');
  const adjustmentType = watch('adjustmentType');
  const selectedDate  = watch('adjustmentDate');

  // When source changes to CONSUMABLE, force result to NON_CONSUMABLE
  useEffect(() => {
    if (sourceType === 'CONSUMABLE') {
      setValue('adjustmentType', 'NON_CONSUMABLE');
    }
  }, [sourceType, setValue]);

  // ── Queries ───────────────────────────────────────────────────────────────
  // FIX: `stock` used to `.catch(() => null)`, so a failed fetch fell back
  // to 0 for every "before" quantity below — an attendant could then submit
  // a breakage adjustment recording a real, permanent audit entry against a
  // false zero baseline instead of the actual stock. This one gets blocked
  // at submission (see the disabled-submit check), not just a note, given
  // what's actually at stake.
  const { data: stock, isError: stockError, refetch: refetchStock } = useQuery({
    queryKey: ['sales-stock'],
    queryFn: () => api.get('/sales/stock').then(r => r.data),
  });

  const { data: records = [], isLoading } = useQuery<BreakageRecord[]>({
    queryKey: ['breakage-adjustments'],
    queryFn: () => api.get('/sales/breakage-adjustments').then(r => r.data),
  });

  // Reference tally aggregate: AM+PM combined for selected date
  const { data: tallyAggregate } = useQuery({
    queryKey: ['tally-aggregate', selectedDate],
    queryFn: () =>
      api.get(`/sales/tally-aggregate?date=${selectedDate}`).then(r => r.data),
    enabled: !!selectedDate,
  });

  // Current quantities for display
  const qtyStandard      = stock?.standardEggs      ?? 0;
  const qtyStarter       = stock?.starterEggs        ?? 0;
  const qtyNonConsumable = stock?.nonConsumableEggs  ?? 0;
  const qtyConsumable    = stock?.consumableEggs     ?? 0;

  const newNonConsumable = Number(watch('newNonConsumable') || 0);
  const newConsumable    = Number(watch('newConsumable')    || 0);
  const newStandard      = Number(watch('newStandard')      || 0);
  const diffNonConsumable = newNonConsumable - qtyNonConsumable;
  const diffConsumable    = newConsumable    - qtyConsumable;
  const diffStandard      = newStandard      - qtyStandard;

  // Pre-populate new quantities when form opens
  useEffect(() => {
    if (showForm) {
      setValue('newStandard',      qtyStandard);
      setValue('newNonConsumable', qtyNonConsumable);
      setValue('newConsumable',    qtyConsumable);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showForm]);

  const resultOptions = RESULT_OPTIONS[sourceType];

  // ── Mutation ──────────────────────────────────────────────────────────────
  const create = useMutation({
    mutationFn: (data: FormData) =>
      api.post('/sales/breakage-adjustments', {
        adjustmentDate:              data.adjustmentDate,
        sourceType:                  data.sourceType,
        adjustmentType:              data.adjustmentType,
        tallySessionId:              data.tallySessionId || undefined,
        quantityStandardBefore:      qtyStandard,
        quantityStarterBefore:       qtyStarter,
        quantityNonConsumableBefore: qtyNonConsumable,
        quantityConsumableBefore:    qtyConsumable,
        newStandard:                 Number(data.newStandard),
        newNonConsumable:            Number(data.newNonConsumable),
        newConsumable:               Number(data.newConsumable),
        notes:                       data.notes,
      }),
    onSuccess: () => {
      // Invalidate all stock-related queries so dashboard + egg stock page update
      qc.invalidateQueries({ queryKey: ['breakage-adjustments'] });
      qc.invalidateQueries({ queryKey: ['sales-stock'] });
      qc.invalidateQueries({ queryKey: ['daily-aggregate'] });
      qc.invalidateQueries({ queryKey: ['sales-summary'] });
      reset({
        adjustmentDate:   dayjs().format('YYYY-MM-DD'),
        sourceType:       'STANDARD',
        adjustmentType:   'CONSUMABLE',
        tallySessionId:   '',
        newStandard:      0,
        newNonConsumable: 0,
        newConsumable:    0,
      });
      setShowForm(false);
    },
  });

  // ── Error message helper ──────────────────────────────────────────────────
  const errorMessage =
    (create.error as any)?.response?.data?.message ??
    (create.error as any)?.message ??
    'Failed to submit. Please try again.';

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <EggOff className="w-5 h-5 text-red-500" /> Egg Breakage Adjustments
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Reclassify broken eggs. Stock updates on submit.
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

      {/* Stock Overview */}
      {stock && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
              Stock Overview
            </p>
            {stock.lastVerifiedDate && (
              <p className="text-xs text-gray-400">
                Last verified: {dayjs(stock.lastVerifiedDate).format('D MMM YYYY')}
              </p>
            )}
          </div>
          <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border overflow-hidden">
            <div className="grid grid-cols-3 bg-gray-50 dark:bg-gray-800 px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100 dark:border-dark-border">
              <span>Egg Type</span>
              <span className="text-center">
                Original Stock
                <br />
                <span className="font-normal normal-case text-gray-400">(from tally sign-off)</span>
              </span>
              <span className="text-right">
                Current Stock
                <br />
                <span className="font-normal normal-case text-gray-400">(after adjustments)</span>
              </span>
            </div>
            {[
              {
                label: 'Standard Eggs',
                orig: stock.originalStandardEggs     ?? stock.standardEggs      ?? 0,
                curr: stock.standardEggs             ?? 0,
                color: 'text-brand-green',
              },
              {
                label: 'Starter Eggs',
                orig: stock.originalStarterEggs      ?? stock.starterEggs       ?? 0,
                curr: stock.starterEggs              ?? 0,
                color: 'text-blue-500',
              },
              {
                label: 'Consumable Broken',
                orig: stock.originalConsumableEggs   ?? stock.consumableEggs    ?? 0,
                curr: stock.consumableEggs           ?? 0,
                color: 'text-amber-500',
              },
              {
                label: 'Non-Consumable Broken',
                orig: stock.originalNonConsumableEggs ?? stock.nonConsumableEggs ?? 0,
                curr: stock.nonConsumableEggs         ?? 0,
                color: 'text-red-500',
              },
            ].map(({ label, orig, curr, color }) => {
              const diff = curr - orig;
              return (
                <div
                  key={label}
                  className="grid grid-cols-3 px-4 py-2.5 border-b border-gray-50 dark:border-gray-800 last:border-0 items-center"
                >
                  <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
                  <span className="text-sm font-semibold text-gray-500 dark:text-gray-400 text-center">
                    {orig.toLocaleString()}
                  </span>
                  <span className="text-right flex items-center justify-end gap-2">
                    <span className={`text-sm font-bold ${color}`}>{curr.toLocaleString()}</span>
                    {diff !== 0 && (
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                          diff > 0 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'
                        }`}
                      >
                        {diff > 0 ? `+${diff}` : diff}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* New Adjustment Form */}
      {showForm && (
        <form
          onSubmit={handleSubmit(d => create.mutate(d))}
          className="bg-white dark:bg-dark-card rounded-2xl p-5 border border-gray-100 dark:border-dark-border space-y-4"
        >
          <h2 className="font-semibold text-gray-700 dark:text-gray-200 text-sm">
            New Breakage Adjustment
          </h2>

          {/* Date */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Adjustment Date *</label>
            <input
              type="date"
              {...register('adjustmentDate', { required: true })}
              className={iCls}
            />
          </div>

          {/* Step 1: What broke? */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block font-semibold uppercase tracking-wider">
              Step 1 — What broke?
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(['STANDARD', 'CONSUMABLE'] as SourceType[]).map(src => (
                <label
                  key={src}
                  className={`flex items-start gap-3 rounded-xl border-2 p-3 cursor-pointer transition-colors ${
                    sourceType === src
                      ? 'border-brand-green bg-brand-green/5 dark:bg-brand-green/10'
                      : 'border-gray-200 dark:border-dark-border bg-white dark:bg-dark-bg'
                  }`}
                >
                  <input
                    type="radio"
                    value={src}
                    {...register('sourceType')}
                    className="mt-0.5 accent-brand-green"
                  />
                  <div>
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                      {SOURCE_LABELS[src]}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {src === 'STANDARD'
                        ? 'A standard (good) egg was cracked or damaged.'
                        : 'A consumable broken egg was further damaged / destroyed.'}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Step 2: What does it become? */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block font-semibold uppercase tracking-wider">
              Step 2 — What does it become?
            </label>
            {sourceType === 'CONSUMABLE' && (
              <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-3 py-2 mb-2 text-xs text-amber-700 dark:text-amber-400">
                <Info className="w-3 h-3 flex-shrink-0 mt-0.5" />
                <span>
                  A consumable broken egg that is further damaged can <strong>only</strong>{' '}
                  become Non-Consumable (unsellable). It cannot go back to being consumable.
                </span>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {resultOptions.map(opt => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-3 rounded-xl border-2 p-3 cursor-pointer transition-colors ${
                    adjustmentType === opt.value
                      ? 'border-brand-green bg-brand-green/5 dark:bg-brand-green/10'
                      : 'border-gray-200 dark:border-dark-border bg-white dark:bg-dark-bg'
                  }`}
                >
                  <input
                    type="radio"
                    value={opt.value}
                    {...register('adjustmentType')}
                    className="mt-0.5 accent-brand-green"
                    disabled={resultOptions.length === 1}
                  />
                  <div>
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                      {opt.label}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">{opt.hint}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Reference Tally — shows AM+PM combined aggregate */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">
              Reference Verified Tally (AM + PM combined for selected date)
            </label>
            {tallyAggregate && (
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl px-3 py-2 mb-2 text-xs text-blue-700 dark:text-blue-400 space-y-1">
                <p className="font-semibold">
                  Tally aggregate for {dayjs(selectedDate).format('D MMM YYYY')}
                  {tallyAggregate.shifts && (
                    <span className="font-normal ml-1">
                      ({(tallyAggregate.shifts as string[]).join(' + ')} sessions)
                    </span>
                  )}
                </p>
                <div className="grid grid-cols-2 gap-1">
                  <span>Standard Eggs: <strong>{tallyAggregate.totalStdEggs?.toLocaleString() ?? '—'}</strong></span>
                  <span>Starter Eggs: <strong>{tallyAggregate.totalStarterEggs?.toLocaleString() ?? '—'}</strong></span>
                  <span>Consumable Broken: <strong>{tallyAggregate.totalBrokenSellable?.toLocaleString() ?? '—'}</strong></span>
                  <span>Non-Consumable: <strong>{tallyAggregate.totalBrokenUnsellable?.toLocaleString() ?? '—'}</strong></span>
                </div>
              </div>
            )}
          </div>

          {/* Current quantities (auto-populated) */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Current Stock (auto-populated)
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Standard Eggs',        val: qtyStandard },
                { label: 'Starter Eggs',          val: qtyStarter },
                { label: 'Non-Consumable Broken', val: qtyNonConsumable },
                { label: 'Consumable Broken',     val: qtyConsumable },
              ].map(({ label, val }) => (
                <div
                  key={label}
                  className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 border border-gray-200 dark:border-dark-border"
                >
                  <p className="text-sm font-bold text-gray-700 dark:text-gray-200">
                    {(val as number).toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* New quantities */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              New Quantities After Adjustment
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Standard Eggs — editable when source is STANDARD (eggs leave this pool) */}
              <div>
                <label className="text-xs text-gray-500 mb-1 block">
                  New Standard Egg Count
                  {sourceType === 'STANDARD' && (
                    <span className="ml-1 text-brand-green font-medium">← enter the reduced count</span>
                  )}
                  {sourceType === 'CONSUMABLE' && (
                    <span className="ml-1 text-gray-400">(unchanged — breakage came from consumable pool)</span>
                  )}
                </label>
                <input
                  type="number"
                  min="0"
                  {...register('newStandard', { min: 0, valueAsNumber: true })}
                  className={iCls}
                  disabled={sourceType === 'CONSUMABLE'}
                />
                {(() => {
                  const newStd = Number(watch('newStandard') || 0);
                  const diff = newStd - qtyStandard;
                  return diff !== 0 ? (
                    <p className={`text-xs mt-1 font-medium ${diff > 0 ? 'text-amber-500' : 'text-green-600'}`}>
                      {diff > 0 ? `+${diff}` : diff} standard eggs
                    </p>
                  ) : null;
                })()}
              </div>

              {/* Non-Consumable */}
              <div>
                <label className="text-xs text-gray-500 mb-1 block">
                  New Non-Consumable Broken Count (Unsellable)
                </label>
                <input
                  type="number"
                  min="0"
                  {...register('newNonConsumable', { min: 0, valueAsNumber: true })}
                  className={iCls}
                />
                {diffNonConsumable !== 0 && (
                  <p
                    className={`text-xs mt-1 font-medium ${
                      diffNonConsumable > 0 ? 'text-red-500' : 'text-green-600'
                    }`}
                  >
                    {diffNonConsumable > 0 ? `+${diffNonConsumable}` : diffNonConsumable}{' '}
                    non-consumable
                  </p>
                )}
              </div>

              {/* Consumable — always editable */}
              <div>
                <label className="text-xs text-gray-500 mb-1 block">
                  New Consumable Broken Count (Sellable)
                  {sourceType === 'CONSUMABLE' && (
                    <span className="ml-1 text-amber-500 font-medium">← enter the reduced count after destruction</span>
                  )}
                </label>
                <input
                  type="number"
                  min="0"
                  {...register('newConsumable', { min: 0, valueAsNumber: true })}
                  className={iCls}
                />
                {diffConsumable !== 0 && (
                  <p
                    className={`text-xs mt-1 font-medium ${
                      diffConsumable > 0 ? 'text-amber-500' : 'text-green-600'
                    }`}
                  >
                    {diffConsumable > 0 ? `+${diffConsumable}` : diffConsumable} consumable broken
                    {sourceType === 'CONSUMABLE' && diffConsumable < 0 && (
                      <span className="ml-1 text-gray-400">(these become non-consumable)</span>
                    )}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Diff summary */}
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 border border-gray-200 dark:border-dark-border space-y-1.5">
            <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-1">
              Movement Summary
            </p>
            {diffStandard !== 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">Standard Eggs</span>
                <span className={`font-bold ${diffStandard < 0 ? 'text-red-500' : 'text-green-600'}`}>
                  {diffStandard > 0 ? `+${diffStandard}` : diffStandard}
                </span>
              </div>
            )}
            {diffConsumable !== 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">Consumable Broken</span>
                <span className={`font-bold ${diffConsumable > 0 ? 'text-amber-500' : 'text-red-500'}`}>
                  {diffConsumable > 0 ? `+${diffConsumable}` : diffConsumable}
                </span>
              </div>
            )}
            {diffNonConsumable !== 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">Non-Consumable Broken</span>
                <span className="font-bold text-red-500">
                  +{diffNonConsumable}
                </span>
              </div>
            )}
            {diffStandard === 0 && diffConsumable === 0 && diffNonConsumable === 0 && (
              <p className="text-xs text-gray-400">No changes entered yet.</p>
            )}
          </div>

          <p className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-xl px-3 py-2">
            After submitting, your stock will update in real-time and the accountant will be
            notified to log this as an expense.
          </p>

          {/* Notes */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Notes (optional)</label>
            <textarea
              rows={2}
              {...register('notes')}
              className={iCls}
              placeholder="e.g. Transit damage on morning route…"
            />
          </div>

          {stockError && (
            <LoadErrorNote label="current stock — cannot submit until this loads" onRetry={() => refetchStock()} />
          )}

          <button
            type="submit"
            disabled={create.isPending || stockError}
            title={stockError ? "Couldn't load current stock — retry above before submitting" : undefined}
            className="bg-brand-green text-white px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60"
          >
            {create.isPending ? 'Submitting…' : 'Submit Adjustment'}
          </button>

          {create.isError && (
            <div className="flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl px-3 py-2">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-600 dark:text-red-400">{errorMessage}</p>
            </div>
          )}
        </form>
      )}

      {/* History */}
      <div>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
          Adjustment History
        </p>
        {isLoading ? (
          <p className="text-sm text-gray-400 text-center py-6">Loading…</p>
        ) : (records as BreakageRecord[]).length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No breakage adjustments yet.</p>
        ) : (
          <div className="space-y-3">
            {(records as BreakageRecord[]).map(rec => {
              const isOpen = expandedRecord === rec.id;
              return (
                <div
                  key={rec.id}
                  className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border"
                >
                  <button
                    className="w-full flex items-center justify-between px-4 py-3 text-left"
                    onClick={() => setExpandedRecord(isOpen ? null : rec.id)}
                  >
                    <div>
                      <p className="text-sm font-bold text-gray-800 dark:text-gray-100">
                        {rec.adjustmentRef}
                      </p>
                      <p className="text-xs text-gray-400">
                        {dayjs(rec.adjustmentDate).format('D MMM YYYY')} ·{' '}
                        by {rec.reportedBy?.fullName ?? '—'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                          RESULT_BADGE[rec.adjustmentType]
                        }`}
                      >
                        {rec.adjustmentType === 'NON_CONSUMABLE'
                          ? 'Non-Consumable'
                          : 'Consumable'}
                      </span>
                      <span
                        className={`text-xs font-bold ${
                          rec.quantityDiff > 0
                            ? 'text-red-500'
                            : rec.quantityDiff < 0
                            ? 'text-green-600'
                            : 'text-gray-400'
                        }`}
                      >
                        {rec.quantityDiff > 0 ? `+${rec.quantityDiff}` : rec.quantityDiff}
                      </span>
                      {isOpen ? (
                        <ChevronUp className="w-4 h-4 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                      )}
                    </div>
                  </button>
                  {isOpen && (
                    <div className="border-t border-gray-100 dark:border-dark-border px-4 pb-4 pt-3 space-y-2">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        {[
                          { label: 'Standard',      val: rec.quantityStandardBefore },
                          { label: 'Starter',       val: rec.quantityStarterBefore  },
                          {
                            label: 'Non-Consumable',
                            val: `${rec.quantityNonConsumableBefore} → ${rec.newNonConsumable}`,
                          },
                          {
                            label: 'Consumable',
                            val: `${rec.quantityConsumableBefore} → ${rec.newConsumable}`,
                          },
                        ].map(({ label, val }) => (
                          <div key={label} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2">
                            <p className="font-semibold text-gray-700 dark:text-gray-300">{val}</p>
                            <p className="text-gray-400">{label}</p>
                          </div>
                        ))}
                      </div>
                      {rec.notes && (
                        <p className="text-xs text-gray-400 italic">{rec.notes}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
