// src/components/shared/BrooderLevelAssignModal.tsx
// Bird placement / reassignment modal.
//
// Population, mortality, reassignment, and weighing are now tracked per
// CAGE — clicking a level opens this modal, but the very first field is a
// CAGE picker restricted to that level's cages (44 per level on rows 1, 2,
// 4, 5, 6; 42 per level on row 3). Everything downstream (place / reassign /
// clear) acts on the selected cage; the level's aggregate figures shown
// elsewhere are an automatic rollup of its cages.
//
// BEHAVIOUR:
//  • Selecting an EMPTY cage → "Place birds here" mode.
//    - If any other cages (anywhere on the map) are occupied, a source
//      row+level+cage selector is shown and is REQUIRED.
//    - If the entire cage map is empty (first-ever placement), source is
//      not required.
//  • Selecting an OCCUPIED cage → "Reassign / update" mode.
//    - Source selector is ALWAYS shown and REQUIRED.
//  • A live summary banner shows: "Moving N birds  Row A · L1 · Cage 03 →
//    Row B · L2 · Cage 07" before the user submits.
//  • The API receives `sourceCageId` so the backend can decrement the
//    source cage (and roll both levels' aggregates up automatically).

import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import {
  X, Bird, Layers, AlertTriangle, ArrowRight, MoveRight,
} from 'lucide-react';
import dayjs from '../../lib/dayjs';
import {
  useAssignBrooderCage,
  useAssignBrooderLevelEqually,
  useRemoveBrooderCageAssignment,
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
  /** Full cage map rows so user can pick a source row+level+cage */
  allRows:  BrooderRowData[];
  onClose:  () => void;
}

export function BrooderLevelAssignModal({ level, row, batches, allRows, onClose }: Props) {
  const assign      = useAssignBrooderCage();
  const assignLevel = useAssignBrooderLevelEqually();
  const remove      = useRemoveBrooderCageAssignment();
  const [confirmRemove, setConfirmRemove] = useState(false);

  // ── Whole-level split mode ─────────────────────────────────────────────
  // Only offered when this level's cages are either all empty or all
  // already hold the SAME batch (mirrors the backend's one-batch-per-level
  // rule) — otherwise there's no single batch total to divide.
  const levelBatchIds = new Set(
    level.cages.filter(c => c.assignment).map(c => c.assignment!.batchId),
  );
  const canSplitEqually = levelBatchIds.size <= 1;
  const [splitMode, setSplitMode] = useState(canSplitEqually);
  const existingLevelBatchId = levelBatchIds.size === 1 ? [...levelBatchIds][0] : '';
  const existingLevelTotal = level.cages.reduce((s, c) => s + (c.assignment?.birdCount ?? 0), 0);

  // ── Target cage picker — restricted to this level's cages ────────────────
  const [cageId, setCageId] = useState(
    level.cages.find(c => !c.assignment)?.cageId ?? level.cages[0]?.cageId ?? '',
  );
  const targetCage  = level.cages.find(c => c.cageId === cageId) ?? null;
  const isOccupied  = !!targetCage?.assignment;

  // ── Determine whether a source is required ───────────────────────────────
  // A source is REQUIRED unless this is the very first placement on the
  // entire map (i.e. no cage anywhere has an assignment).
  const isFirstEverPlacement = useMemo(() =>
    allRows.every(r => r.levels.every(l => l.cages.every(c => !c.assignment))),
    [allRows],
  );
  const sourceRequired = isOccupied || !isFirstEverPlacement;

  // ── Build source options: all occupied cages except the target cage ──────
  const sourceOptions = useMemo(() => {
    const opts: { rowLabel: string; levelLabel: string; cageLabel: string; cageId: string; birdCount: number }[] = [];
    for (const r of allRows) {
      for (const l of r.levels) {
        for (const c of l.cages) {
          if (c.assignment && c.cageId !== cageId) {
            opts.push({
              rowLabel:   r.label,
              levelLabel: l.label,
              cageLabel:  c.label,
              cageId:     c.cageId,
              birdCount:  c.assignment.birdCount,
            });
          }
        }
      }
    }
    return opts;
  }, [allRows, cageId]);

  const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';
  const lCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1';

  const { register, handleSubmit, watch, formState: { errors }, setValue } = useForm({
    defaultValues: {
      batchId:      existingLevelBatchId || targetCage?.assignment?.batchId || '',
      birdCount:    canSplitEqually && existingLevelTotal > 0
        ? existingLevelTotal
        : (targetCage?.assignment?.birdCount ?? ''),
      placedDate:   targetCage?.assignment?.placedDate
        ? dayjs(targetCage.assignment.placedDate).format('YYYY-MM-DD')
        : dayjs().format('YYYY-MM-DD'),
      notes:        targetCage?.assignment?.notes ?? '',
      sourceCageId: '',   // which cage birds are coming FROM
    },
  });

  const watchedSourceId  = watch('sourceCageId');
  const watchedBirdCount = watch('birdCount');

  // Find the selected source for the summary banner
  const selectedSource = sourceOptions.find(o => o.cageId === watchedSourceId);

  // Guard: cannot reassign more birds than the source cage has
  const exceedsSource =
    !!selectedSource &&
    !!watchedBirdCount &&
    Number(watchedBirdCount) > selectedSource.birdCount;

  const handleCageChange = (newCageId: string) => {
    setCageId(newCageId);
    const c = level.cages.find(x => x.cageId === newCageId);
    setValue('batchId', c?.assignment?.batchId ?? '');
    setValue('birdCount', c?.assignment?.birdCount ?? ('' as any));
    setValue('placedDate', c?.assignment?.placedDate
      ? dayjs(c.assignment.placedDate).format('YYYY-MM-DD')
      : dayjs().format('YYYY-MM-DD'));
    setValue('notes', c?.assignment?.notes ?? '');
    setValue('sourceCageId', '');
  };

  const submit = (data: any) => {
    if (splitMode) {
      assignLevel.mutate(
        {
          levelId: level.levelId,
          data: {
            batchId:    data.batchId,
            birdCount:  Number(data.birdCount),
            placedDate: data.placedDate,
            notes:      data.notes || undefined,
          },
        },
        { onSuccess: onClose },
      );
      return;
    }
    if (exceedsSource || !cageId) return; // safety — button is also disabled
    assign.mutate(
      {
        cageId,
        data: {
          batchId:      data.batchId,
          birdCount:    Number(data.birdCount),
          placedDate:   data.placedDate,
          notes:        data.notes || undefined,
          sourceCageId: data.sourceCageId || undefined,
        },
      },
      { onSuccess: onClose },
    );
  };

  const isPlacing   = !isOccupied;
  const modeLabel   = splitMode
    ? (existingLevelTotal > 0 ? 'Redistribute this level evenly' : 'Place birds across this level')
    : isPlacing ? 'Place birds here' : 'Move / update placement';
  const accentColor = splitMode
    ? 'bg-brand-green'
    : isPlacing ? 'bg-amber-500' : 'bg-brand-green';

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
                {row.label} · {level.label}{!splitMode && targetCage ? ` · ${targetCage.label}` : ''}
              </p>
              <p className="text-xs text-gray-400">{modeLabel}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-bg">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit(submit)} className="p-5 space-y-4">

          {/* ── Whole-level vs single-cage mode ── */}
          {canSplitEqually && (
            <div className="flex rounded-xl border border-gray-200 dark:border-dark-border overflow-hidden">
              <button
                type="button"
                onClick={() => setSplitMode(true)}
                className={`flex-1 text-xs font-semibold py-2.5 transition-colors ${
                  splitMode ? 'bg-brand-green text-white' : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                Whole level ({level.cages.length} cages, split evenly)
              </button>
              <button
                type="button"
                onClick={() => setSplitMode(false)}
                className={`flex-1 text-xs font-semibold py-2.5 transition-colors ${
                  !splitMode ? 'bg-brand-green text-white' : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                Single cage
              </button>
            </div>
          )}

          {/* ── Target cage picker (single-cage mode only) ── */}
          {!splitMode && (
            <div>
              <label className={lCls}>
                Cage <span className="font-normal text-gray-400">({level.cages.length} on this level)</span>
              </label>
              <select
                value={cageId}
                onChange={e => handleCageChange(e.target.value)}
                className={iCls}
              >
                {level.cages.map(c => (
                  <option key={c.cageId} value={c.cageId}>
                    {c.label}{c.assignment ? ` — ${c.assignment.birdCount.toLocaleString()} birds` : ' — empty'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* ── SOURCE ROW + LEVEL + CAGE selector (single-cage mode only) ───
               Shown whenever sourceRequired is true.
               Required if sourceRequired AND there are occupied cages to pick from.
          ────────────────────────────────────────────────────────────────── */}
          {!splitMode && sourceRequired && (
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
                  No other occupied cages found. You cannot reassign birds — there is no source to move them from.
                </p>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1">
                      Source row, level &amp; cage *
                    </label>
                    <select
                      {...register('sourceCageId', {
                        required: sourceRequired ? 'You must specify where these birds are coming from' : false,
                      })}
                      className={`${iCls} border-blue-300 dark:border-blue-700 focus:ring-blue-500`}
                    >
                      <option value="">— Select source row, level &amp; cage —</option>
                      {sourceOptions.map(o => (
                        <option key={o.cageId} value={o.cageId}>
                          {o.rowLabel} · {o.levelLabel} · {o.cageLabel}  ({o.birdCount.toLocaleString()} birds)
                        </option>
                      ))}
                    </select>
                    {errors.sourceCageId && (
                      <p className="text-red-500 text-xs mt-1 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        {errors.sourceCageId.message as string}
                      </p>
                    )}
                  </div>

                  {/* Live transfer summary banner */}
                  {selectedSource && watchedBirdCount && Number(watchedBirdCount) > 0 && !exceedsSource && (() => {
                    const moving = Number(watchedBirdCount);
                    const targetExisting = targetCage?.assignment?.birdCount ?? 0;
                    const resultingCount = targetExisting + moving;
                    return (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 bg-white dark:bg-dark-bg border border-blue-200 dark:border-blue-700 rounded-xl px-3 py-2 text-xs flex-wrap">
                          <Bird className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                          <span className="font-bold text-blue-700 dark:text-blue-300">
                            {moving.toLocaleString()} birds moving
                          </span>
                          <ArrowRight className="w-3 h-3 text-gray-400 flex-shrink-0" />
                          <span className="text-red-500 font-semibold line-through">
                            {selectedSource.rowLabel} · {selectedSource.levelLabel} · {selectedSource.cageLabel}
                          </span>
                          <ArrowRight className="w-3 h-3 text-gray-400 flex-shrink-0" />
                          <span className="text-green-600 dark:text-green-400 font-semibold">
                            {row.label} · {level.label} · {targetCage?.label}
                          </span>
                        </div>
                        {targetExisting > 0 && (
                          <div className="flex items-center gap-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl px-3 py-2 text-xs">
                            <Bird className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                            <span className="text-gray-500">
                              {targetExisting.toLocaleString()} existing + {moving.toLocaleString()} incoming
                            </span>
                            <span className="text-gray-400">=</span>
                            <span className="font-bold text-green-700 dark:text-green-400">
                              {resultingCount.toLocaleString()} birds total in {targetCage?.label}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Error: cannot move more birds than the source cage has */}
                  {selectedSource && watchedBirdCount && Number(watchedBirdCount) > selectedSource.birdCount && (
                    <div className="flex items-start gap-1.5 text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-xl px-3 py-2">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      <span>
                        Cannot reassign <strong>{Number(watchedBirdCount).toLocaleString()}</strong> birds —{' '}
                        <strong>{selectedSource.rowLabel} · {selectedSource.levelLabel} · {selectedSource.cageLabel}</strong> only has{' '}
                        <strong>{selectedSource.birdCount.toLocaleString()}</strong>. Reduce the count to{' '}
                        {selectedSource.birdCount.toLocaleString()} or fewer.
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
              {splitMode
                ? `Total Chick Count for ${level.label} (split across ${level.cages.length} cages)`
                : sourceRequired ? 'Birds to Move' : 'Chick Count in this Cage'}
              {!splitMode && selectedSource && (
                <span className="ml-1 font-normal text-gray-400">
                  (max {selectedSource.birdCount.toLocaleString()} from {selectedSource.rowLabel} · {selectedSource.levelLabel} · {selectedSource.cageLabel})
                </span>
              )}
            </label>
            <input
              {...register('birdCount', {
                required: true,
                min: 1,
                ...(selectedSource ? { max: selectedSource.birdCount } : {}),
              })}
              type="number" min="1"
              max={selectedSource ? selectedSource.birdCount : undefined}
              className={`${iCls} font-bold text-center`}
              placeholder="e.g. 68"
            />
            {errors.birdCount && (
              <p className="text-red-500 text-xs mt-1">Enter the number of chicks (must be ≥ 1)</p>
            )}
            {splitMode && Number(watchedBirdCount) > 0 && (() => {
              const n = level.cages.length;
              const total = Number(watchedBirdCount);
              const base = Math.floor(total / n);
              const remainder = total % n;
              return (
                <p className="text-xs text-gray-400 mt-1">
                  {remainder === 0
                    ? `${base.toLocaleString()} birds in each of ${n} cages`
                    : `${remainder} cage${remainder === 1 ? '' : 's'} get ${(base + 1).toLocaleString()}, ` +
                      `${n - remainder} cage${n - remainder === 1 ? '' : 's'} get ${base.toLocaleString()}`}
                </p>
              );
            })()}
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

          {(splitMode ? assignLevel.isError : assign.isError) && (
            <p className="text-red-500 text-sm bg-red-50 dark:bg-red-900/20 rounded-xl p-3">
              {(splitMode ? (assignLevel.error as any) : (assign.error as any))?.response?.data?.message
                ?? 'Failed to save placement. Please try again.'}
            </p>
          )}

          {/* Block submission if source is required but none are available (single-cage mode only) */}
          {!splitMode && sourceRequired && sourceOptions.length === 0 ? (
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
                type="submit"
                disabled={splitMode ? assignLevel.isPending : (assign.isPending || exceedsSource || !cageId)}
                className={`flex-1 ${accentColor} text-white rounded-xl py-3 font-semibold disabled:opacity-60`}
              >
                {splitMode
                  ? (assignLevel.isPending ? 'Saving…' : 'Split Across Level')
                  : (assign.isPending ? 'Saving…' : isPlacing ? 'Place Birds' : 'Save Reassignment')}
              </button>
            </div>
          )}

          {/* ── Clear cage (single-cage mode only) ── */}
          {!splitMode && isOccupied && (
            <div className="border-t border-gray-100 dark:border-dark-border pt-3">
              {!confirmRemove ? (
                <button
                  type="button"
                  onClick={() => setConfirmRemove(true)}
                  className="w-full text-xs text-red-500 font-semibold py-2"
                >
                  Clear this cage (chicks moved / transferred out)
                </button>
              ) : (
                <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 space-y-2">
                  <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                    This frees the cage for a new batch. Confirm?
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
                      onClick={() => remove.mutate(cageId, { onSuccess: onClose })}
                      disabled={remove.isPending}
                      className="flex-1 text-xs bg-red-500 text-white rounded-lg py-2 font-semibold disabled:opacity-60"
                    >
                      {remove.isPending ? 'Clearing…' : 'Yes, clear cage'}
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
