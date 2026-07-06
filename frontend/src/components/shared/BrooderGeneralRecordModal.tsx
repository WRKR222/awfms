// src/components/shared/BrooderGeneralRecordModal.tsx
//
// "General population record sheet" — for a Lead Attendant who cannot break
// feed dispensed or mortality down by individual row/level and needs to
// record it against the batch's whole population instead.
//
// Two tabs, each hitting its own endpoint:
//   • Feed:      POST /brooder/general-feed-logs
//   • Mortality: POST /brooder/general-mortality-logs
//
// Both support backdating (date input, max = today) and are refused by the
// server if row/level-specific entries already exist for the same batch +
// date, to prevent the same feeding/mortality being counted twice.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { X, AlertTriangle, XCircle, Info, Wheat, HeartCrack } from 'lucide-react';
import { api } from '../../lib/api';
import dayjs from '../../lib/dayjs';
import { useIssuableStoreItems, FEED_CATEGORIES } from '../../hooks/useIssuableStoreItems';

const FEED_TYPE_OPTIONS = [
  { value: 'CHICK_MASH',        label: 'Chick Mash' },
  { value: 'GROWER_MASH',       label: 'Grower Mash' },
  { value: 'LAYER_MASH',        label: 'Layer Mash' },
  { value: 'KIENYEJI_STARTER',  label: 'Kienyeji Starter' },
  { value: 'KIENYEJI_GROWER',   label: 'Kienyeji Grower' },
  { value: 'KIENYEJI_FINISHER', label: 'Kienyeji Finisher' },
] as const;

const CAUSE_OPTIONS = [
  { value: 'DISEASE',                 label: 'Disease' },
  { value: 'INJURY',                  label: 'Injury' },
  { value: 'HEAT_STRESS',             label: 'Heat Stress' },
  { value: 'PREDATOR',                label: 'Predator' },
  { value: 'CULLED_SICK',             label: 'Culled — Sick' },
  { value: 'CULLED_LOW_PRODUCTIVITY', label: 'Culled — Low Productivity' },
  { value: 'CULLED_OVERPOPULATION',   label: 'Culled — Overpopulation' },
  { value: 'UNKNOWN',                 label: 'Unknown' },
] as const;

interface BatchLite {
  id: string;
  batchCode: string;
  currentBirdCount: number;
}

interface Props {
  batch: BatchLite;
  onClose: () => void;
}

const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-500';
const lCls = 'block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide';

// ── Clash error helper ────────────────────────────────────────────────────
// The server returns a 409 with a plain-language explanation when row/level
// data already exists for this batch + date. Surface it verbatim — it
// already tells the attendant exactly what to do instead.
function extractErrorMessage(err: any, fallback: string): string {
  return err?.response?.data?.message ?? fallback;
}

export function BrooderGeneralRecordModal({ batch, onClose }: Props) {
  const qc    = useQueryClient();
  const today = dayjs().format('YYYY-MM-DD');
  const [tab, setTab] = useState<'FEED' | 'MORTALITY'>('FEED');

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white dark:bg-dark-card w-full md:max-w-lg rounded-t-3xl md:rounded-2xl shadow-2xl overflow-y-auto max-h-[95vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-dark-border sticky top-0 bg-white dark:bg-dark-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-500 rounded-xl flex items-center justify-center">
              <Wheat className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-bold text-gray-800 dark:text-gray-100">General Population Record</p>
              <p className="text-xs text-gray-400">{batch.batchCode} · whole batch, not tied to a row/level</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-bg transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Explainer */}
        <div className="mx-5 mt-4 flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 text-xs text-amber-700 dark:text-amber-400">
          <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <p>
            Use this sheet only when you can&apos;t track feed or mortality by individual
            row and level for this batch. Entries here count against the batch&apos;s
            whole population. The system will refuse a general entry for any
            date that already has row/level entries (and vice versa), so nothing
            is counted twice.
          </p>
        </div>

        {/* Tabs */}
        <div className="mx-5 mt-4 flex gap-2 bg-gray-50 dark:bg-dark-bg rounded-xl p-1">
          <button
            onClick={() => setTab('FEED')}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors ${
              tab === 'FEED'
                ? 'bg-white dark:bg-dark-card shadow text-amber-600 dark:text-amber-400'
                : 'text-gray-400'
            }`}
          >
            <Wheat className="w-3.5 h-3.5" /> Feed
          </button>
          <button
            onClick={() => setTab('MORTALITY')}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors ${
              tab === 'MORTALITY'
                ? 'bg-white dark:bg-dark-card shadow text-red-600 dark:text-red-400'
                : 'text-gray-400'
            }`}
          >
            <HeartCrack className="w-3.5 h-3.5" /> Mortality
          </button>
        </div>

        {tab === 'FEED'
          ? <GeneralFeedForm batch={batch} today={today} onClose={onClose} qc={qc} />
          : <GeneralMortalityForm batch={batch} today={today} onClose={onClose} qc={qc} />}
      </div>
    </div>
  );
}

// ── Feed tab ─────────────────────────────────────────────────────────────
function GeneralFeedForm({ batch, today, onClose, qc }: {
  batch: BatchLite; today: string; onClose: () => void; qc: ReturnType<typeof useQueryClient>;
}) {
  const { data: feedItems = [] } = useIssuableStoreItems(FEED_CATEGORIES);

  const { register, handleSubmit, watch, formState: { errors } } = useForm({
    defaultValues: {
      entryDate:           today,
      feedType:            'CHICK_MASH',
      storeItemId:         '',
      quantityDispensedKg: '',
      notes:               '',
    },
  });

  const submit = useMutation({
    mutationFn: (data: any) =>
      api.post('/brooder/general-feed-logs', {
        batchId:             batch.id,
        entryDate:           data.entryDate,
        feedType:            data.feedType,
        storeItemId:         data.storeItemId || undefined,
        quantityDispensedKg: Number(data.quantityDispensedKg),
        notes:               data.notes || undefined,
      }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['batches'] });
      qc.invalidateQueries({ queryKey: ['brooder-cage-map'] });
      qc.invalidateQueries({ queryKey: ['brooder-feed-summary'] });
      qc.invalidateQueries({ queryKey: ['brooder-general-feed-logs', batch.id] });
      onClose();
    },
  });

  return (
    <form onSubmit={handleSubmit(d => submit.mutate(d))} className="p-5 space-y-4">
      {/* Date */}
      <div>
        <label className={lCls}>Date fed</label>
        <input {...register('entryDate', { required: true })} type="date" max={today} className={iCls} />
      </div>

      {/* Feed type dropdown */}
      <div>
        <label className={lCls}>Feed type</label>
        <select {...register('feedType', { required: true })} className={iCls}>
          {FEED_TYPE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Optional linked store item, for residual tracking */}
      {feedItems.length > 0 && (
        <div>
          <label className={lCls}>Store item issued (optional)</label>
          <select {...register('storeItemId')} className={iCls}>
            <option value="">Not linked to a specific store item</option>
            {feedItems.map(it => (
              <option key={it.id} value={it.id}>
                {it.name} — residual {it.residual.toFixed(2)} {it.unit}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-gray-400 mt-1">
            Linking lets the system track leftover stock for this item automatically.
          </p>
        </div>
      )}

      {/* Quantity */}
      <div>
        <label className={lCls}>Quantity dispensed (kg)</label>
        <input
          {...register('quantityDispensedKg', {
            required: 'Enter the quantity dispensed',
            min: { value: 0.01, message: 'Must be greater than 0' },
          })}
          type="number" step="0.01" min="0"
          className={`${iCls} text-center font-bold text-amber-600 dark:text-amber-400`}
          placeholder="0.00"
        />
        {errors.quantityDispensedKg && (
          <p className="text-red-500 text-xs mt-1">{String(errors.quantityDispensedKg.message)}</p>
        )}
      </div>

      {/* Notes */}
      <div>
        <label className={lCls}>Notes</label>
        <textarea {...register('notes')} rows={2} className={`${iCls} resize-none`} placeholder="Any observations..." />
      </div>

      {submit.isError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3 text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{extractErrorMessage(submit.error, 'Failed to save. Please try again.')}</span>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onClose}
          className="flex-1 border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 rounded-xl py-3 font-semibold">
          Cancel
        </button>
        <button type="submit" disabled={submit.isPending}
          className="flex-1 bg-amber-500 text-white rounded-xl py-3 font-semibold disabled:opacity-60">
          {submit.isPending ? 'Saving…' : 'Record Feed'}
        </button>
      </div>
    </form>
  );
}

// ── Mortality tab ────────────────────────────────────────────────────────
function GeneralMortalityForm({ batch, today, onClose, qc }: {
  batch: BatchLite; today: string; onClose: () => void; qc: ReturnType<typeof useQueryClient>;
}) {
  const [violationMsg, setViolationMsg] = useState<string | null>(null);
  const birdCount = batch.currentBirdCount;

  const { register, handleSubmit, watch, formState: { errors } } = useForm({
    defaultValues: {
      logDate:        today,
      mortalityCount: '0',
      cullingCount:   '0',
      cause:          '',
      notes:          '',
    },
  });

  const mortalityVal = Number(watch('mortalityCount') || 0);
  const cullingVal   = Number(watch('cullingCount')   || 0);
  const totalLost    = mortalityVal + cullingVal;

  const submit = useMutation({
    mutationFn: (data: any) =>
      api.post('/brooder/general-mortality-logs', {
        batchId:        batch.id,
        logDate:        data.logDate,
        mortalityCount: Number(data.mortalityCount) || 0,
        cullingCount:   Number(data.cullingCount)   || 0,
        cause:          data.cause || undefined,
        notes:          data.notes || undefined,
      }).then(r => r.data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['batches'] });
      qc.invalidateQueries({ queryKey: ['brooder-cage-map'] });
      qc.invalidateQueries({ queryKey: ['brooder-general-mortality-logs', batch.id] });
      if (res?.mortalityViolation?.violated) {
        setViolationMsg(res.mortalityViolation.message);
      } else {
        onClose();
      }
    },
  });

  if (violationMsg) {
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-xl flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <p className="font-bold text-red-700 dark:text-red-400">Mortality Threshold Exceeded</p>
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{violationMsg}</p>
            <p className="text-xs text-gray-400 mt-2">
              This has been flagged on the Director's and Production Manager's dashboards.
            </p>
          </div>
        </div>
        <button onClick={onClose} className="w-full bg-red-600 text-white rounded-xl py-3 font-semibold">
          Understood — Close
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(d => submit.mutate(d))} className="p-5 space-y-4">
      {/* Live bird count banner */}
      <div className="flex items-center gap-2 bg-gray-50 dark:bg-dark-bg rounded-xl p-3 text-sm">
        <Info className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <span className="text-gray-600 dark:text-gray-300">
          Live birds in batch: <strong className="text-gray-800 dark:text-gray-100">{birdCount.toLocaleString()}</strong>
        </span>
      </div>

      {/* Date */}
      <div>
        <label className={lCls}>Date of event</label>
        <input {...register('logDate', { required: true })} type="date" max={today} className={iCls} />
      </div>

      {/* Mortality + culling counts */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={lCls}>Deaths (mortality)</label>
          <input
            {...register('mortalityCount', {
              min: { value: 0, message: 'Must be ≥ 0' },
              validate: v => (Number(v) + cullingVal > 0) || 'Enter at least 1 death or culling',
            })}
            type="number" min="0"
            className={`${iCls} text-center font-bold text-red-600 dark:text-red-400`}
            placeholder="0"
          />
        </div>
        <div>
          <label className={lCls}>Culled birds</label>
          <input
            {...register('cullingCount', { min: { value: 0, message: 'Must be ≥ 0' } })}
            type="number" min="0"
            className={`${iCls} text-center font-bold text-orange-600 dark:text-orange-400`}
            placeholder="0"
          />
        </div>
      </div>

      {totalLost > 0 && (
        <div className={`rounded-xl p-3 text-sm font-semibold flex items-center gap-2 ${
          totalLost > birdCount
            ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
            : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
        }`}>
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {totalLost > birdCount
            ? `⚠ Total (${totalLost}) exceeds birds in this batch (${birdCount})`
            : `${totalLost} bird${totalLost !== 1 ? 's' : ''} will be removed from this batch`}
        </div>
      )}

      {errors.mortalityCount && (
        <p className="text-red-500 text-xs">{String(errors.mortalityCount.message)}</p>
      )}

      {/* Cause */}
      <div>
        <label className={lCls}>Cause</label>
        <select {...register('cause')} className={iCls}>
          <option value="">Select cause (optional)</option>
          {CAUSE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Notes */}
      <div>
        <label className={lCls}>Notes</label>
        <textarea {...register('notes')} rows={2} className={`${iCls} resize-none`} placeholder="Any observations..." />
      </div>

      {submit.isError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3 text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{extractErrorMessage(submit.error, 'Failed to save. Please try again.')}</span>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onClose}
          className="flex-1 border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 rounded-xl py-3 font-semibold">
          Cancel
        </button>
        <button type="submit" disabled={submit.isPending || totalLost === 0 || totalLost > birdCount}
          className="flex-1 bg-red-600 text-white rounded-xl py-3 font-semibold disabled:opacity-60">
          {submit.isPending ? 'Saving…' : 'Record Event'}
        </button>
      </div>
    </form>
  );
}
