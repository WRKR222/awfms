// src/components/shared/BrooderLevelFeedLogModal.tsx
//
// Log feed dispensed to a specific brooder level.
// Req 3: Shows the daily HyLine ration; warns before the server blocks if the
//        entered quantity would exceed it. The server enforces the hard cap.
// Req 4: Residual carry-forward is shown for awareness (displayed in parent summary).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { X, AlertTriangle, Info, CheckCircle } from 'lucide-react';
import { api } from '../../lib/api';
import dayjs from '../../lib/dayjs';
import type { BrooderLevelData, BrooderRowData } from '../../hooks/useBrooderCageMap';

const FEED_TYPE_OPTIONS = [
  { value: 'CHICK_MASH',  label: 'Chick & Duckling Mash' },
  { value: 'GROWER_MASH', label: "Grower's Mash" },
  { value: 'LAYER_MASH',  label: "Layer's Mash" },
] as const;

interface Props {
  level:   BrooderLevelData;
  row:     BrooderRowData;
  onClose: () => void;
}

export function BrooderLevelFeedLogModal({ level, row, onClose }: Props) {
  const qc    = useQueryClient();
  const today = dayjs().format('YYYY-MM-DD');

  const dailyRationKg    = level.dailyRationKg    ?? null;
  const dispensedToday   = level.dispensedKgToday  ?? 0;
  const remainingKg      = dailyRationKg !== null
    ? Math.max(0, Math.round((dailyRationKg - dispensedToday) * 100) / 100)
    : null;

  const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';
  const lCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1';

  const { register, handleSubmit, watch, formState: { errors } } = useForm({
    defaultValues: {
      feedType:            '',
      entryDate:           today,
      quantityDispensedKg: '',
      notes:               '',
    },
  });

  const qty = Number(watch('quantityDispensedKg') || 0);

  // Warn if entry would exceed the daily ration (server will also block it)
  const wouldExceed  = dailyRationKg !== null && (dispensedToday + qty) > dailyRationKg;
  const overByKg     = dailyRationKg !== null
    ? Math.max(0, Math.round(((dispensedToday + qty) - dailyRationKg) * 100) / 100)
    : 0;

  const submit = useMutation({
    mutationFn: (data: any) =>
      api.post('/brooder/feed-logs', {
        levelId:             level.levelId,
        feedType:            data.feedType,
        entryDate:           data.entryDate,
        quantityDispensedKg: Number(data.quantityDispensedKg),
        notes:               data.notes || undefined,
      }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brooder-cage-map'] });
      qc.invalidateQueries({ queryKey: ['brooder-feed-summary'] });
      qc.invalidateQueries({ queryKey: ['brooder-level-feed-logs', level.levelId] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white dark:bg-dark-card w-full md:max-w-lg rounded-t-3xl md:rounded-2xl shadow-2xl overflow-y-auto max-h-[95vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-dark-border sticky top-0 bg-white dark:bg-dark-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-brand-green rounded-xl flex items-center justify-center">
              <span className="text-white text-sm">🌾</span>
            </div>
            <div>
              <p className="font-bold text-gray-800 dark:text-gray-100">Log Feed Dispensed</p>
              <p className="text-xs text-gray-400">
                {row.label} · {level.label}
                {level.batch && ` · ${level.batch.batchCode}`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-bg transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Daily ration banner (Req 3) */}
        {dailyRationKg !== null && level.hylineWeek !== null && (
          <div className={`mx-5 mt-4 rounded-xl p-3 text-xs flex items-start gap-2 ${
            remainingKg === 0
              ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
              : 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400'
          }`}>
            {remainingKg === 0
              ? <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              : <Info        className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
            <div className="space-y-0.5">
              <p className="font-semibold">
                HyLine Week {level.hylineWeek} ration — {dailyRationKg.toFixed(2)} kg/day
                ({level.assignment?.birdCount ?? 0} birds)
              </p>
              <p>
                Already dispensed today: <strong>{dispensedToday.toFixed(2)} kg</strong>
                {remainingKg !== null && remainingKg > 0 && (
                  <> · Remaining: <strong>{remainingKg.toFixed(2)} kg</strong></>
                )}
                {remainingKg === 0 && <> · Daily ration fully met</>}
              </p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit(d => submit.mutate(d))} className="p-5 space-y-4">
          {/* Feed type */}
          <div>
            <label className={lCls}>Feed type</label>
            <select
              {...register('feedType', { required: 'Select a feed type' })}
              className={iCls}
            >
              <option value="">Select feed type…</option>
              {FEED_TYPE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {errors.feedType && (
              <p className="text-red-500 text-xs mt-1">{String(errors.feedType.message)}</p>
            )}
          </div>

          {/* Date */}
          <div>
            <label className={lCls}>Date</label>
            <input
              {...register('entryDate', { required: true })}
              type="date"
              max={today}
              className={iCls}
            />
          </div>

          {/* Quantity */}
          <div>
            <label className={lCls}>Quantity dispensed (kg)</label>
            <input
              {...register('quantityDispensedKg', {
                required: 'Enter a quantity',
                min: { value: 0.01, message: 'Must be > 0' },
                validate: v => {
                  if (remainingKg !== null && Number(v) > (remainingKg + 0.001)) {
                    return `Exceeds remaining daily ration (${remainingKg.toFixed(2)} kg left)`;
                  }
                  return true;
                },
              })}
              type="number" step="0.01" min="0.01"
              className={`${iCls} ${wouldExceed ? 'border-red-400 ring-red-200' : ''}`}
              placeholder={remainingKg !== null ? `Max ${remainingKg.toFixed(2)} kg` : 'e.g. 5.50'}
            />
            {errors.quantityDispensedKg && (
              <p className="text-red-500 text-xs mt-1">{String(errors.quantityDispensedKg.message)}</p>
            )}
          </div>

          {/* Over-issue warning (Req 3) */}
          {wouldExceed && qty > 0 && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3 text-xs text-red-700 dark:text-red-400 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Feed over-issue — will be blocked by server</p>
                <p className="mt-0.5">
                  This quantity exceeds the daily ration by{' '}
                  <strong>{overByKg.toFixed(2)} kg</strong>.
                  Reduce the quantity to {remainingKg?.toFixed(2) ?? '—'} kg or less.
                  Excess from previous logs should be deducted from tomorrow's issuance.
                </p>
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className={lCls}>Notes (optional)</label>
            <textarea
              {...register('notes')}
              rows={2}
              className={`${iCls} resize-none`}
              placeholder="Any observations…"
            />
          </div>

          {/* Server error */}
          {submit.isError && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3 text-sm text-red-600 dark:text-red-400">
              {(submit.error as any)?.response?.data?.message ?? 'Failed to save. Please try again.'}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button" onClick={onClose}
              className="flex-1 border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 rounded-xl py-3 font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submit.isPending || wouldExceed}
              className="flex-1 bg-brand-green text-white rounded-xl py-3 font-semibold disabled:opacity-60"
            >
              {submit.isPending ? 'Saving…' : 'Log Feed'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
