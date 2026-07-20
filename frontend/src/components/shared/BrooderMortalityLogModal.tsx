// src/components/shared/BrooderMortalityLogModal.tsx
//
// Records a mortality or culling event for a specific brooder Row + Level.
// Req 1: captures row, level, and count.
// Req 2: after save the service auto-decrements bird counts, so the next
//        feed calculation in getCageMap will reflect the updated population.
// The cage map is fully independent of the general population sheet and does
// NOT run the Req 7 HyLine mortality-threshold check — that check (and its
// notification) only fires from the general population sheet
// (BrooderGeneralRecordModal).

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { X, AlertTriangle, XCircle, Info } from 'lucide-react';
import { api } from '../../lib/api';
import dayjs from '../../lib/dayjs';
import type { BrooderLevelData, BrooderRowData } from '../../hooks/useBrooderCageMap';

const CAUSE_OPTIONS = [
  { value: 'DISEASE',                label: 'Disease' },
  { value: 'INJURY',                 label: 'Injury' },
  { value: 'HEAT_STRESS',            label: 'Heat Stress' },
  { value: 'PREDATOR',               label: 'Predator' },
  { value: 'CULLED_SICK',            label: 'Culled — Sick' },
  { value: 'CULLED_LOW_PRODUCTIVITY',label: 'Culled — Low Productivity' },
  { value: 'CULLED_OVERPOPULATION',  label: 'Culled — Overpopulation' },
  { value: 'UNKNOWN',                label: 'Unknown' },
] as const;

interface Props {
  level: BrooderLevelData;
  row:   BrooderRowData;
  onClose: () => void;
}

export function BrooderMortalityLogModal({ level, row, onClose }: Props) {
  const qc    = useQueryClient();
  const today = dayjs().format('YYYY-MM-DD');

  const occupiedCages = level.cages.filter(c => !!c.assignment);
  const [cageId, setCageId] = useState(occupiedCages[0]?.cageId ?? '');
  const selectedCage = occupiedCages.find(c => c.cageId === cageId) ?? null;

  const batchId    = selectedCage?.assignment?.batchId ?? '';
  const birdCount  = selectedCage?.assignment?.birdCount ?? 0;

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

  const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-400';
  const lCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1';

  const submit = useMutation({
    mutationFn: (data: any) =>
      api.post('/brooder/mortality-logs', {
        levelId:        level.levelId,
        cageId,
        batchId,
        logDate:        data.logDate,
        mortalityCount: Number(data.mortalityCount) || 0,
        cullingCount:   Number(data.cullingCount)   || 0,
        cause:          data.cause || undefined,
        notes:          data.notes || undefined,
      }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brooder-cage-map'] });
      qc.invalidateQueries({ queryKey: ['brooder-feed-summary'] });
      qc.invalidateQueries({ queryKey: ['batches'] });
      onClose();
    },
  });

  // If violation message is showing, display a warning then allow close
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white dark:bg-dark-card w-full md:max-w-lg rounded-t-3xl md:rounded-2xl shadow-2xl overflow-y-auto max-h-[95vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-dark-border sticky top-0 bg-white dark:bg-dark-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-red-500 rounded-xl flex items-center justify-center">
              <XCircle className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-bold text-gray-800 dark:text-gray-100">Log Mortality / Culling</p>
              <p className="text-xs text-gray-400">
                {row.label} · {level.label}{selectedCage ? ` · ${selectedCage.label}` : ''}
                {level.batch && ` · ${level.batch.batchCode}`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-bg transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Current bird count banner */}
        <div className="mx-5 mt-4 flex items-center gap-2 bg-gray-50 dark:bg-dark-bg rounded-xl p-3 text-sm">
          <Info className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <div className="space-y-0.5">
            <span className="text-gray-600 dark:text-gray-300">
              Live birds currently in this cage:{' '}
              <strong className="text-gray-800 dark:text-gray-100">{birdCount.toLocaleString()}</strong>
            </span>
            <p className="text-[10px] text-gray-400">
              Deaths recorded here are counted against live birds only.
              Birds that arrived dead (DOA) are not included in this count
              and do not affect the farm&apos;s HyLine mortality %.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit(d => submit.mutate(d))} className="p-5 space-y-4">
          {/* Cage — population/mortality is recorded per cage */}
          <div>
            <label className={lCls}>Cage</label>
            <select
              value={cageId}
              onChange={e => setCageId(e.target.value)}
              className={iCls}
            >
              <option value="">Select an occupied cage…</option>
              {occupiedCages.map(c => (
                <option key={c.cageId} value={c.cageId}>
                  {c.label} — {c.assignment?.birdCount.toLocaleString()} birds
                </option>
              ))}
            </select>
            {occupiedCages.length === 0 && (
              <p className="text-[10px] text-red-500 mt-1">No occupied cages on this level.</p>
            )}
          </div>

          {/* Date */}
          <div>
            <label className={lCls}>Date of event</label>
            <input
              {...register('logDate', { required: true })}
              type="date"
              max={today}
              className={iCls}
            />
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

          {/* Running total */}
          {totalLost > 0 && (
            <div className={`rounded-xl p-3 text-sm font-semibold flex items-center gap-2 ${
              totalLost > birdCount
                ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
                : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
            }`}>
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {totalLost > birdCount
                ? `⚠ Total (${totalLost}) exceeds birds on this level (${birdCount})`
                : `${totalLost} bird${totalLost !== 1 ? 's' : ''} will be removed from this level`}
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
            <textarea
              {...register('notes')}
              rows={2}
              className={`${iCls} resize-none`}
              placeholder="Any observations..."
            />
          </div>

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
              disabled={submit.isPending || !cageId || totalLost === 0 || totalLost > birdCount}
              className="flex-1 bg-red-600 text-white rounded-xl py-3 font-semibold disabled:opacity-60"
            >
              {submit.isPending ? 'Saving…' : 'Record Event'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
