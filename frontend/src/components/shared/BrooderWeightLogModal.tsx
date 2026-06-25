// src/components/shared/BrooderWeightLogModal.tsx
//
// Logs a bird weight sample against a specific occupied brooder Row + Level.
// Req 6: compares the sample's average weight to the HyLine min/max band for
//        the batch's age that week.
// Req 7: if the average is below the min or above the max, the server fires
//        a BROODER_WEIGHT_ANOMALY notification to Manager/Owner and the
//        response is shown here as a flagged warning.

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { X, AlertTriangle, CheckCircle2, Scale, Info } from 'lucide-react';
import dayjs from '../../lib/dayjs';
import { useCheckBrooderWeightSample } from '../../hooks/useBrooderCageMap';
import type { BrooderLevelData, BrooderRowData } from '../../hooks/useBrooderCageMap';

interface Props {
  level:   BrooderLevelData;
  row:     BrooderRowData;
  onClose: () => void;
}

export function BrooderWeightLogModal({ level, row, onClose }: Props) {
  const qc    = useQueryClient();
  const today = dayjs().format('YYYY-MM-DD');
  const [result, setResult] = useState<{
    withinBounds: boolean;
    violation:    string | null;
    averageWeightG: number;
    standard: { week: number; minG: number; maxG: number; phase: string };
  } | null>(null);

  const birdCount = level.assignment?.birdCount ?? 0;

  const { register, handleSubmit, watch, formState: { errors } } = useForm({
    defaultValues: {
      sampleDate:   today,
      sampleCount:  '',
      totalWeightG: '',
      notes:        '',
    },
  });

  const sampleCount  = Number(watch('sampleCount') || 0);
  const totalWeightG = Number(watch('totalWeightG') || 0);
  const previewAvgG  = sampleCount > 0 ? totalWeightG / sampleCount : null;

  const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400';
  const lCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1';

  const mutation = useCheckBrooderWeightSample();

  const onSubmit = (data: any) => {
    mutation.mutate(
      {
        levelId:      level.levelId,
        sampleDate:   data.sampleDate,
        sampleCount:  Number(data.sampleCount),
        totalWeightG: Number(data.totalWeightG),
        notes:        data.notes || undefined,
      },
      {
        onSuccess: (res) => {
          qc.invalidateQueries({ queryKey: ['brooder-cage-map'] });
          setResult({
            withinBounds:   res.withinBounds,
            violation:      res.violation,
            averageWeightG: res.averageWeightG,
            standard:       res.standard,
          });
        },
      },
    );
  };

  // ── Result screen — shown after a successful submit ──────────────────────
  if (result) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
        <div className="bg-white dark:bg-dark-card w-full md:max-w-md rounded-t-3xl md:rounded-2xl shadow-2xl p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
              result.withinBounds
                ? 'bg-green-100 dark:bg-green-900/30'
                : 'bg-red-100 dark:bg-red-900/30'
            }`}>
              {result.withinBounds
                ? <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                : <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />}
            </div>
            <div>
              <p className={`font-bold ${result.withinBounds ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                {result.withinBounds ? 'Weight Within HyLine Band' : 'Weight Flagged — Outside HyLine Band'}
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                Week {result.standard.week} ({result.standard.phase}) standard:{' '}
                <strong>{result.standard.minG}g – {result.standard.maxG}g</strong>.{' '}
                Sample average: <strong>{result.averageWeightG}g</strong>.
              </p>
              {!result.withinBounds && (
                <p className="text-xs text-gray-400 mt-2">
                  This has been flagged on the Manager's and Owner's dashboards.
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className={`w-full rounded-xl py-3 font-semibold text-white ${
              result.withinBounds ? 'bg-green-600' : 'bg-red-600'
            }`}
          >
            Understood — Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white dark:bg-dark-card w-full md:max-w-lg rounded-t-3xl md:rounded-2xl shadow-2xl overflow-y-auto max-h-[95vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-dark-border sticky top-0 bg-white dark:bg-dark-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-indigo-500 rounded-xl flex items-center justify-center">
              <Scale className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-bold text-gray-800 dark:text-gray-100">Log Bird Weight</p>
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

        {/* Context banner */}
        <div className="mx-5 mt-4 flex items-center gap-2 bg-gray-50 dark:bg-dark-bg rounded-xl p-3 text-sm">
          <Info className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <span className="text-gray-600 dark:text-gray-300">
            Birds on this level:{' '}
            <strong className="text-gray-800 dark:text-gray-100">{birdCount.toLocaleString()}</strong>
            {level.hylineWeek && <> · HyLine week <strong>{level.hylineWeek}</strong></>}
          </span>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-4">
          {/* Date */}
          <div>
            <label className={lCls}>Sample date</label>
            <input
              {...register('sampleDate', { required: true })}
              type="date"
              max={today}
              className={iCls}
            />
          </div>

          {/* Sample count + total weight */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={lCls}>Birds sampled</label>
              <input
                {...register('sampleCount', { required: 'Required', min: { value: 1, message: 'Must be ≥ 1' } })}
                type="number" min="1"
                className={iCls}
                placeholder="e.g. 20"
              />
              {errors.sampleCount && (
                <p className="text-red-500 text-xs mt-1">{String(errors.sampleCount.message)}</p>
              )}
            </div>
            <div>
              <label className={lCls}>Total weight (g)</label>
              <input
                {...register('totalWeightG', { required: 'Required', min: { value: 1, message: 'Must be ≥ 1' } })}
                type="number" min="1"
                className={iCls}
                placeholder="e.g. 4200"
              />
              {errors.totalWeightG && (
                <p className="text-red-500 text-xs mt-1">{String(errors.totalWeightG.message)}</p>
              )}
            </div>
          </div>

          {/* Live preview of average vs band */}
          {previewAvgG !== null && previewAvgG > 0 && (
            <div className="rounded-xl p-3 text-sm bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 flex items-center gap-2">
              <Scale className="w-4 h-4 flex-shrink-0" />
              Average: <strong>{previewAvgG.toFixed(0)}g</strong>/bird
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

          {mutation.isError && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3 text-sm text-red-600 dark:text-red-400">
              {(mutation.error as any)?.response?.data?.message ?? 'Failed to save. Please try again.'}
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
              disabled={mutation.isPending}
              className="flex-1 bg-indigo-600 text-white rounded-xl py-3 font-semibold disabled:opacity-60"
            >
              {mutation.isPending ? 'Saving…' : 'Log Weight'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
