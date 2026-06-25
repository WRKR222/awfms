// src/components/shared/BrooderWeightLogModal.tsx
//
// Logs a bird weight sample against a specific occupied brooder Row + Level.
//
// CHANGES:
//  • Individual weight slots — one input per sampled bird. The attendant
//    enters how many birds they weighed, then one field per bird appears.
//  • Live avg / min / max computed from the individual entries, then
//    compared against the HyLine standard band (min–max).
//  • API still receives sampleCount + totalWeightG (unchanged contract).

import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X, AlertTriangle, CheckCircle2, Scale, Info, Plus, Minus } from 'lucide-react';
import dayjs from '../../lib/dayjs';
import { useCheckBrooderWeightSample } from '../../hooks/useBrooderCageMap';
import type { BrooderLevelData, BrooderRowData } from '../../hooks/useBrooderCageMap';

interface Props {
  level:   BrooderLevelData;
  row:     BrooderRowData;
  onClose: () => void;
}

const MAX_SAMPLE = 50;
const MIN_SAMPLE = 1;

const iCls =
  'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm ' +
  'bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 ' +
  'focus:outline-none focus:ring-2 focus:ring-indigo-400';
const lCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1';

export function BrooderWeightLogModal({ level, row, onClose }: Props) {
  const qc    = useQueryClient();
  const today = dayjs().format('YYYY-MM-DD');

  const [sampleDate, setSampleDate]   = useState(today);
  const [sampleCount, setSampleCount] = useState(5);
  const [weights, setWeights]         = useState<(number | '')[]>(Array(5).fill(''));
  const [notes, setNotes]             = useState('');

  const [result, setResult] = useState<{
    withinBounds:   boolean;
    violation:      string | null;
    averageWeightG: number;
    standard: { week: number; minG: number; maxG: number; phase: string };
  } | null>(null);

  const mutation = useCheckBrooderWeightSample();

  // ── Derived stats from filled slots ─────────────────────────────────────
  const filled = weights.filter((w): w is number => typeof w === 'number' && w > 0);

  const avgG = filled.length > 0
    ? filled.reduce((s, v) => s + v, 0) / filled.length
    : null;
  const minG = filled.length > 0 ? Math.min(...filled) : null;
  const maxG = filled.length > 0 ? Math.max(...filled) : null;

  // ── Adjust sample count ──────────────────────────────────────────────────
  const adjustCount = useCallback((delta: number) => {
    setSampleCount(prev => {
      const next = Math.min(MAX_SAMPLE, Math.max(MIN_SAMPLE, prev + delta));
      setWeights(w => {
        const arr = [...w];
        while (arr.length < next) arr.push('');
        return arr.slice(0, next);
      });
      return next;
    });
  }, []);

  const setWeight = (i: number, raw: string) => {
    const val = raw === '' ? '' : Number(raw);
    setWeights(prev => {
      const next = [...prev];
      next[i] = val;
      return next;
    });
  };

  // ── Submit ───────────────────────────────────────────────────────────────
  const canSubmit = filled.length === sampleCount && sampleCount >= 1;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    const totalWeightG = filled.reduce((s, v) => s + v, 0);

    mutation.mutate(
      {
        levelId:      level.levelId,
        sampleDate,
        sampleCount,
        totalWeightG,
        notes: notes || undefined,
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

  const birdCount = level.assignment?.birdCount ?? 0;

  // ── Standard from level (used for live preview colouring) ───────────────
  const std = level.weightCheck
    ? { minG: level.weightCheck.minG, maxG: level.weightCheck.maxG }
    : null;

  const avgStatus = avgG !== null && std
    ? avgG < std.minG ? 'low' : avgG > std.maxG ? 'high' : 'ok'
    : null;

  // ── Result screen ────────────────────────────────────────────────────────
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
            <div className="flex-1 min-w-0">
              <p className={`font-bold ${result.withinBounds ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                {result.withinBounds ? 'Weight Within HyLine Band' : 'Weight Flagged — Outside HyLine Band'}
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                Week {result.standard.week} ({result.standard.phase}) standard:{' '}
                <strong>{result.standard.minG}g – {result.standard.maxG}g</strong>
              </p>

              {/* Sample summary table */}
              <div className="mt-3 rounded-xl overflow-hidden border border-gray-200 dark:border-dark-border text-sm">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-dark-bg text-xs text-gray-500 dark:text-gray-400">
                      <th className="px-3 py-2 text-left font-semibold">Metric</th>
                      <th className="px-3 py-2 text-right font-semibold">Sample</th>
                      <th className="px-3 py-2 text-right font-semibold">Standard</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-dark-border">
                    <tr>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-300">Avg weight</td>
                      <td className={`px-3 py-2 text-right font-bold ${result.withinBounds ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {result.averageWeightG}g
                      </td>
                      <td className="px-3 py-2 text-right text-gray-500 dark:text-gray-400">
                        {result.standard.minG}–{result.standard.maxG}g
                      </td>
                    </tr>
                    {minG !== null && (
                      <tr>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-300">Min (sample)</td>
                        <td className="px-3 py-2 text-right font-semibold text-gray-800 dark:text-gray-100">{minG}g</td>
                        <td className="px-3 py-2 text-right text-gray-500 dark:text-gray-400">{result.standard.minG}g min</td>
                      </tr>
                    )}
                    {maxG !== null && (
                      <tr>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-300">Max (sample)</td>
                        <td className="px-3 py-2 text-right font-semibold text-gray-800 dark:text-gray-100">{maxG}g</td>
                        <td className="px-3 py-2 text-right text-gray-500 dark:text-gray-400">{result.standard.maxG}g max</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

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

  // ── Entry form ───────────────────────────────────────────────────────────
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
            {std && <> · Standard: <strong>{std.minG}–{std.maxG}g</strong></>}
          </span>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {/* Date */}
          <div>
            <label className={lCls}>Sample date</label>
            <input
              type="date"
              value={sampleDate}
              max={today}
              onChange={e => setSampleDate(e.target.value)}
              className={iCls}
            />
          </div>

          {/* Sample size stepper */}
          <div>
            <label className={lCls}>Number of birds to weigh</label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => adjustCount(-1)}
                disabled={sampleCount <= MIN_SAMPLE}
                className="w-9 h-9 rounded-xl border border-gray-200 dark:border-dark-border flex items-center justify-center hover:bg-gray-50 dark:hover:bg-dark-bg disabled:opacity-40 transition-colors"
              >
                <Minus className="w-4 h-4 text-gray-600 dark:text-gray-300" />
              </button>
              <span className="text-xl font-bold text-gray-800 dark:text-gray-100 w-10 text-center">
                {sampleCount}
              </span>
              <button
                type="button"
                onClick={() => adjustCount(1)}
                disabled={sampleCount >= MAX_SAMPLE}
                className="w-9 h-9 rounded-xl border border-gray-200 dark:border-dark-border flex items-center justify-center hover:bg-gray-50 dark:hover:bg-dark-bg disabled:opacity-40 transition-colors"
              >
                <Plus className="w-4 h-4 text-gray-600 dark:text-gray-300" />
              </button>
              <span className="text-xs text-gray-400">birds (max {MAX_SAMPLE})</span>
            </div>
          </div>

          {/* Individual weight slots */}
          <div>
            <label className={lCls}>
              Individual weights (g) — {filled.length}/{sampleCount} entered
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {weights.map((w, i) => (
                <div key={i} className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-gray-400 select-none pointer-events-none">
                    #{i + 1}
                  </span>
                  <input
                    type="number"
                    min="1"
                    max="9999"
                    value={w}
                    onChange={e => setWeight(i, e.target.value)}
                    placeholder="—"
                    className={`${iCls} pl-8 text-center`}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Live avg / min / max preview */}
          {filled.length > 0 && (
            <div className={`rounded-xl p-4 text-sm border ${
              avgStatus === 'ok'
                ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800'
                : avgStatus === 'low' || avgStatus === 'high'
                  ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                  : 'bg-gray-50 dark:bg-dark-bg border-gray-200 dark:border-dark-border'
            }`}>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
                Live sample stats ({filled.length} bird{filled.length !== 1 ? 's' : ''})
              </p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide">Min</p>
                  <p className="font-bold text-gray-800 dark:text-gray-100">{minG}g</p>
                  {std && <p className={`text-[10px] mt-0.5 ${minG! < std.minG ? 'text-red-500' : 'text-gray-400'}`}>std {std.minG}g</p>}
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide">Avg</p>
                  <p className={`font-bold text-lg ${
                    avgStatus === 'ok' ? 'text-indigo-600 dark:text-indigo-400'
                    : avgStatus != null ? 'text-red-600 dark:text-red-400'
                    : 'text-gray-800 dark:text-gray-100'
                  }`}>
                    {avgG!.toFixed(0)}g
                  </p>
                  {std && (
                    <p className={`text-[10px] mt-0.5 ${avgStatus === 'ok' ? 'text-indigo-400' : 'text-red-500'}`}>
                      {avgStatus === 'ok' ? '✓ within band' : avgStatus === 'low' ? '↓ below min' : '↑ above max'}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide">Max</p>
                  <p className="font-bold text-gray-800 dark:text-gray-100">{maxG}g</p>
                  {std && <p className={`text-[10px] mt-0.5 ${maxG! > std.maxG ? 'text-red-500' : 'text-gray-400'}`}>std {std.maxG}g</p>}
                </div>
              </div>
              {std && (
                <p className="text-[10px] text-center text-gray-400 mt-2">
                  HyLine wk{level.hylineWeek} standard: {std.minG}g – {std.maxG}g
                </p>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <label className={lCls}>Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className={`${iCls} resize-none`}
              placeholder="Any observations…"
            />
          </div>

          {!canSubmit && filled.length > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Fill in all {sampleCount} weight slots before submitting.
            </p>
          )}

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
              disabled={mutation.isPending || !canSubmit}
              className="flex-1 bg-indigo-600 text-white rounded-xl py-3 font-semibold disabled:opacity-60"
            >
              {mutation.isPending ? 'Saving…' : `Log ${sampleCount} Weight${sampleCount !== 1 ? 's' : ''}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
