// src/components/shared/BrooderLevelAssignModal.tsx
// Bird placement / reassignment modal.
//
// BEHAVIOUR:
//  • Tapping an EMPTY level → "Place birds here" mode.
//    - If any other levels are occupied, a source row+level selector is shown
//      and is REQUIRED (can't place birds without specifying where they came from).
//    - If the entire cage map is empty (first-ever placement), source is not required.
//  • Tapping an OCCUPIED level → "Reassign / update" mode.
//    - Source row+level selector is ALWAYS shown and REQUIRED.
//  • A live summary banner shows: "Moving N birds  Row A · L1 → Row B · L2"
//    before the user submits.
//  • The API receives `sourceLevelId` so the backend can decrement the source.

import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import {
  X, Bird, Layers, AlertTriangle, ArrowRight, MoveRight,
} from 'lucide-react';
import dayjs from '../../lib/dayjs';
import {
  useAssignBrooderLevel,
  useRemoveBrooderLevelAssignment,
  type BrooderLevelData,
  type BrooderRowData,
} from '../../hooks/useBrooderCageMap';

interface BatchOption {
  id: string;
  batchCode: string;
  currentBirdCount: number;
  quantityReceived?: number;
  alreadyAssignedCount?: number;
}

interface Props {
  level:    BrooderLevelData;
  row:      BrooderRowData;
  batches:  BatchOption[];
  /** Full cage map rows so user can pick a source row+level */
  allRows:  BrooderRowData[];
  onClose:  () => void;
}

export function BrooderLevelAssignModal({ level, row, batches, allRows, onClose }: Props) {
  const assign = useAssignBrooderLevel();
  const remove = useRemoveBrooderLevelAssignment();
  const [confirmRemove, setConfirmRemove] = useState(false);

  // ── Determine whether a source is required ───────────────────────────────
  // A source is REQUIRED unless this is the very first placement on the entire map
  // (i.e. no level anywhere has an assignment).
  const isFirstEverPlacement = useMemo(() =>
    allRows.every(r => r.levels.every(l => !l.assignment)),
    [allRows],
  );
  const isOccupied       = !!level.assignment;
  const sourceRequired   = isOccupied || !isFirstEverPlacement;

  // ── Build source options: all occupied levels except the target level ─────
  const sourceOptions = useMemo(() => {
    const opts: { rowLabel: string; levelLabel: string; levelId: string; birdCount: number }[] = [];
    for (const r of allRows) {
      for (const l of r.levels) {
        if (l.assignment && l.levelId !== level.levelId) {
          opts.push({
            rowLabel:   r.label,
            levelLabel: l.label,
            levelId:    l.levelId,
            birdCount:  l.assignment.birdCount,
          });
        }
      }
    }
    return opts;
  }, [allRows, level.levelId]);

  const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';
  const lCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1';

  const { register, handleSubmit, watch, formState: { errors } } = useForm({
    defaultValues: {
      batchId:       level.assignment?.batchId ?? '',
      birdCount:     level.assignment?.birdCount ?? '',
      placedDate:    level.assignment?.placedDate
        ? dayjs(level.assignment.placedDate).format('YYYY-MM-DD')
        : dayjs().format('YYYY-MM-DD'),
      notes:         level.assignment?.notes ?? '',
      sourceLevelId: '',   // which level birds are coming FROM
    },
  });

  const watchedSourceId  = watch('sourceLevelId');
  const watchedBirdCount = watch('birdCount');

  // Find the selected source for the summary banner
  const selectedSource = sourceOptions.find(o => o.levelId === watchedSourceId);

  const submit = (data: any) => {
    assign.mutate(
      {
        levelId: level.levelId,
        data: {
          batchId:       data.batchId,
          birdCount:     Number(data.birdCount),
          placedDate:    data.placedDate,
          notes:         data.notes || undefined,
          sourceLevelId: data.sourceLevelId || undefined,
        },
      },
      { onSuccess: onClose },
    );
  };

  const isPlacing   = !isOccupied;
  const modeLabel   = isPlacing ? 'Place birds here' : 'Move / update placement';
  const accentColor = isPlacing ? 'bg-amber-500' : 'bg-brand-green';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white dark:bg-dark-card w-full md:max-w-md rounded-t-3xl md:rounded-2xl shadow-2xl overflow-y-auto max-h-[95vh]">

        {/* ── Header ── */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-dark-border sticky top-0 bg-white dark:bg-dark-card z-10">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 ${accentColor} rounded-xl flex items-center justify-center`}>
              <Layers className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-bold text-gray-800 dark:text-gray-100">
                {row.label} · {level.label}
              </p>
              <p className="text-xs text-gray-400">{modeLabel}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-bg">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit(submit)} className="p-5 space-y-4">

          {/* ── SOURCE ROW + LEVEL selector ─────────────────────────────────
               Shown whenever sourceRequired is true.
               Required if sourceRequired AND there are occupied levels to pick from.
          ────────────────────────────────────────────────────────────────── */}
          {sourceRequired && (
            <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <MoveRight className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <p className="text-xs font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wide">
                  Where are these birds coming from?
                </p>
              </div>

              {sourceOptions.length === 0 ? (
                <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  No other occupied levels found. You cannot reassign birds — there is no source to move them from.
                </p>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1">
                      Source row &amp; level *
                    </label>
                    <select
                      {...register('sourceLevelId', {
                        required: sourceRequired ? 'You must specify where these birds are coming from' : false,
                      })}
                      className={`${iCls} border-blue-300 dark:border-blue-700 focus:ring-blue-500`}
                    >
                      <option value="">— Select source row &amp; level —</option>
                      {sourceOptions.map(o => (
                        <option key={o.levelId} value={o.levelId}>
                          {o.rowLabel} · {o.levelLabel}  ({o.birdCount.toLocaleString()} birds)
                        </option>
                      ))}
                    </select>
                    {errors.sourceLevelId && (
                      <p className="text-red-500 text-xs mt-1 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        {errors.sourceLevelId.message as string}
                      </p>
                    )}
                  </div>

                  {/* Live transfer summary banner */}
                  {selectedSource && watchedBirdCount && Number(watchedBirdCount) > 0 && (
                    <div className="flex items-center gap-2 bg-white dark:bg-dark-bg border border-blue-200 dark:border-blue-700 rounded-xl px-3 py-2 text-xs">
                      <Bird className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                      <span className="font-bold text-blue-700 dark:text-blue-300">
                        {Number(watchedBirdCount).toLocaleString()} birds
                      </span>
                      <ArrowRight className="w-3 h-3 text-gray-400 flex-shrink-0" />
                      <span className="text-gray-500">
                        <span className="text-red-500 font-semibold line-through mr-1">
                          {selectedSource.rowLabel} · {selectedSource.levelLabel}
                        </span>
                      </span>
                      <ArrowRight className="w-3 h-3 text-gray-400 flex-shrink-0" />
                      <span className="text-green-600 dark:text-green-400 font-semibold">
                        {row.label} · {level.label}
                      </span>
                    </div>
                  )}

                  {/* Warn if trying to move more birds than the source has */}
                  {selectedSource && watchedBirdCount && Number(watchedBirdCount) > selectedSource.birdCount && (
                    <div className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-3 py-2">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      <span>
                        You're assigning <strong>{Number(watchedBirdCount).toLocaleString()}</strong> birds but{' '}
                        <strong>{selectedSource.rowLabel} · {selectedSource.levelLabel}</strong> only has{' '}
                        <strong>{selectedSource.birdCount.toLocaleString()}</strong>. Check the count.
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Batch ── */}
          <div>
            <label className={lCls}>Batch</label>
            <select {...register('batchId', { required: true })} className={iCls}>
              <option value="">Select batch...</option>
              {batches.map(b => (
                <option key={b.id} value={b.id}>
                  {b.batchCode} ({b.currentBirdCount.toLocaleString()} birds available)
                </option>
              ))}
            </select>
            {errors.batchId && <p className="text-red-500 text-xs mt-1">Batch is required</p>}
          </div>

          {/* ── Bird count ── */}
          <div>
            <label className={lCls}>
              <Bird className="w-3.5 h-3.5 inline mr-1 text-amber-500" />
              Chick Count on this Level
            </label>
            <input
              {...register('birdCount', { required: true, min: 1 })}
              type="number" min="1" className={`${iCls} font-bold text-center`}
              placeholder="e.g. 250"
            />
            {errors.birdCount && (
              <p className="text-red-500 text-xs mt-1">Enter the number of chicks (must be ≥ 1)</p>
            )}
          </div>

          {/* ── Date placed ── */}
          <div>
            <label className={lCls}>Date Placed</label>
            <input
              {...register('placedDate', { required: true })}
              type="date" className={iCls}
              max={dayjs().format('YYYY-MM-DD')}
            />
          </div>

          {/* ── Notes ── */}
          <div>
            <label className={lCls}>Notes</label>
            <textarea
              {...register('notes')} rows={2}
              className={`${iCls} resize-none`}
              placeholder="Optional"
            />
          </div>

          {assign.isError && (
            <p className="text-red-500 text-sm bg-red-50 dark:bg-red-900/20 rounded-xl p-3">
              {(assign.error as any)?.response?.data?.message ?? 'Failed to save placement. Please try again.'}
            </p>
          )}

          {/* Block submission if source is required but none are available */}
          {sourceRequired && sourceOptions.length === 0 ? (
            <button
              type="button"
              onClick={onClose}
              className="w-full border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 rounded-xl py-3 font-semibold"
            >
              Close
            </button>
          ) : (
            <div className="flex gap-3 pt-1">
              <button
                type="button" onClick={onClose}
                className="flex-1 border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 rounded-xl py-3 font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit" disabled={assign.isPending}
                className={`flex-1 ${accentColor} text-white rounded-xl py-3 font-semibold disabled:opacity-60`}
              >
                {assign.isPending ? 'Saving…' : isPlacing ? 'Place Birds' : 'Save Reassignment'}
              </button>
            </div>
          )}

          {/* ── Clear level ── */}
          {isOccupied && (
            <div className="border-t border-gray-100 dark:border-dark-border pt-3">
              {!confirmRemove ? (
                <button
                  type="button"
                  onClick={() => setConfirmRemove(true)}
                  className="w-full text-xs text-red-500 font-semibold py-2"
                >
                  Clear this level (chicks moved / transferred out)
                </button>
              ) : (
                <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 space-y-2">
                  <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                    This frees the level for a new batch. Confirm?
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(false)}
                      className="flex-1 text-xs border border-gray-200 dark:border-dark-border rounded-lg py-2"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => remove.mutate(level.levelId, { onSuccess: onClose })}
                      disabled={remove.isPending}
                      className="flex-1 text-xs bg-red-500 text-white rounded-lg py-2 font-semibold disabled:opacity-60"
                    >
                      {remove.isPending ? 'Clearing…' : 'Yes, clear level'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
