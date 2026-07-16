// src/components/shared/BrooderReassignModal.tsx
//
// Dedicated "move birds OUT" modal — now cage-to-cage.
//
// The user first picks the SOURCE cage (any occupied cage on the clicked
// level), then the DESTINATION cage from the full cage map.
// On submit the API call is:
//   POST /brooder/cages/{destinationCageId}/assign
//   body: { sourceCageId: source.cageId, batchId, birdCount, placedDate }
//
// This is the opposite direction from BrooderLevelAssignModal, which treats
// the clicked cage as the destination and asks "where are birds coming from?"

import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  X, Bird, Layers, AlertTriangle, ArrowRight, MoveRight, Lock,
} from 'lucide-react';
import dayjs from '../../lib/dayjs';
import {
  useAssignBrooderCage,
  type BrooderLevelData,
  type BrooderRowData,
} from '../../hooks/useBrooderCageMap';

interface Props {
  /** The level the user clicked — birds move OUT of one of its cages. */
  sourceLevel: BrooderLevelData;
  sourceRow:   BrooderRowData;
  /** Full cage map so user can pick a destination. */
  allRows:     BrooderRowData[];
  onClose:     () => void;
}

export function BrooderReassignModal({
  sourceLevel, sourceRow, allRows, onClose,
}: Props) {
  const assign = useAssignBrooderCage();

  const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';
  const lCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1';

  // ── Source cage picker — any occupied cage on the clicked level ─────────
  const sourceCageOptions = sourceLevel.cages.filter(c => !!c.assignment);
  const [sourceCageId, setSourceCageId] = useState(sourceCageOptions[0]?.cageId ?? '');
  const sourceCage       = sourceCageOptions.find(c => c.cageId === sourceCageId) ?? null;
  const sourceBirdCount  = sourceCage?.assignment?.birdCount ?? 0;

  // ── Destination cage options — every cage except the source, grouped by
  // row → level so the dropdown stays navigable despite the large count. ──
  const destinationOptions = useMemo(() => {
    const opts: {
      rowLabel: string; levelLabel: string; cageId: string; cageLabel: string;
      existingBirdCount: number; batchId: string | null;
      isIsolation: boolean; isolationReason: string | null;
    }[] = [];
    for (const r of allRows) {
      for (const l of r.levels) {
        for (const c of l.cages) {
          if (c.cageId === sourceCageId) continue; // skip source itself
          opts.push({
            rowLabel:          r.label,
            levelLabel:        l.label,
            cageId:            c.cageId,
            cageLabel:         c.label,
            existingBirdCount: c.assignment?.birdCount ?? 0,
            batchId:           c.assignment?.batchId ?? null,
            isIsolation:       c.assignment?.isIsolation ?? false,
            isolationReason:   c.assignment?.isolationReason ?? null,
          });
        }
      }
    }
    return opts;
  }, [allRows, sourceCageId]);

  const {
    register, handleSubmit, watch, formState: { errors },
  } = useForm({
    defaultValues: {
      destinationCageId: '',
      birdCount:         sourceBirdCount || '',
      placedDate:        dayjs().format('YYYY-MM-DD'),
      notes:             '',
      isIsolation:       false,
      isolationReason:   '',
    },
  });

  const watchedDestId      = watch('destinationCageId');
  const watchedBirdCount   = watch('birdCount');
  const watchedIsIsolation = watch('isIsolation');
  const selectedDest       = destinationOptions.find(o => o.cageId === watchedDestId);

  const exceedsSource =
    !!watchedBirdCount && Number(watchedBirdCount) > sourceBirdCount;

  const submit = (data: any) => {
    if (exceedsSource || !data.destinationCageId || !sourceCage) return;
    if (data.isIsolation && (!data.isolationReason || data.isolationReason.trim().length < 3)) return;
    assign.mutate(
      {
        // POST to the DESTINATION cage
        cageId: data.destinationCageId,
        data: {
          batchId:      sourceCage.assignment!.batchId,
          birdCount:    Number(data.birdCount),
          placedDate:   data.placedDate,
          notes:        data.notes || undefined,
          // Tell the backend to decrement the SOURCE cage
          sourceCageId: sourceCage.cageId,
          isIsolation:     !!data.isIsolation,
          isolationReason: data.isIsolation ? data.isolationReason.trim() : undefined,
        },
      },
      { onSuccess: onClose },
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white dark:bg-dark-card w-full md:max-w-md rounded-t-3xl md:rounded-2xl shadow-2xl overflow-y-auto max-h-[95vh]">

        {/* ── Header ── */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-dark-border sticky top-0 bg-white dark:bg-dark-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-500 rounded-xl flex items-center justify-center">
              <MoveRight className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-bold text-gray-800 dark:text-gray-100">
                Move birds from {sourceRow.label} · {sourceLevel.label}
              </p>
              <p className="text-xs text-gray-400">
                {sourceCageOptions.length} occupied cage{sourceCageOptions.length !== 1 ? 's' : ''} on this level
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-bg">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit(submit)} className="p-5 space-y-4">

          {/* ── Source cage picker ── */}
          <div>
            <label className={lCls}>Move FROM which cage? *</label>
            <select
              value={sourceCageId}
              onChange={e => setSourceCageId(e.target.value)}
              className={iCls}
            >
              <option value="">— Select source cage —</option>
              {sourceCageOptions.map(c => (
                <option key={c.cageId} value={c.cageId}>
                  {c.label} — {c.assignment?.birdCount.toLocaleString()} birds
                </option>
              ))}
            </select>
            {sourceCageOptions.length === 0 && (
              <p className="text-red-500 text-xs mt-1">No occupied cages on this level.</p>
            )}
          </div>

          {/* ── Source summary (read-only) ── */}
          {sourceCage && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 flex items-center gap-3">
              <Layers className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <div className="text-xs">
                <p className="font-bold text-amber-700 dark:text-amber-300">
                  Moving FROM: {sourceRow.label} · {sourceLevel.label} · {sourceCage.label}
                </p>
                <p className="text-amber-600 dark:text-amber-400 mt-0.5">
                  Batch {sourceLevel.batch?.batchCode} ·{' '}
                  {sourceBirdCount.toLocaleString()} birds currently here
                </p>
              </div>
            </div>
          )}

          {/* ── Destination picker ── */}
          <div>
            <label className={lCls}>
              <ArrowRight className="w-3.5 h-3.5 inline mr-1 text-blue-500" />
              Move TO (destination row · level · cage) *
            </label>
            <select
              {...register('destinationCageId', { required: 'Select a destination cage' })}
              className={iCls}
            >
              <option value="">— Select destination —</option>
              {destinationOptions.map(o => (
                <option key={o.cageId} value={o.cageId}>
                  {o.rowLabel} · {o.levelLabel} · {o.cageLabel}
                  {o.isIsolation ? '  🔒 ISOLATION' : ''}
                  {o.existingBirdCount > 0
                    ? `  (has ${o.existingBirdCount.toLocaleString()} birds — will merge)`
                    : '  (empty)'}
                </option>
              ))}
            </select>
            {errors.destinationCageId && (
              <p className="text-red-500 text-xs mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {errors.destinationCageId.message as string}
              </p>
            )}
            {selectedDest?.isIsolation && (
              <p className="text-purple-600 dark:text-purple-400 text-xs mt-1 flex items-center gap-1">
                <Lock className="w-3 h-3" />
                This cage is already an isolation cage{selectedDest.isolationReason ? ` (${selectedDest.isolationReason})` : ''}.
                Check "Mark as isolation" below to keep it flagged, or leave it unchecked to lift the isolation status.
              </p>
            )}
          </div>

          {/* ── Isolation ── */}
          <div className={`rounded-xl border p-3 ${
            watchedIsIsolation
              ? 'border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-900/20'
              : 'border-gray-200 dark:border-dark-border'
          }`}>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                {...register('isIsolation')}
                className="mt-0.5 w-4 h-4 accent-purple-600"
              />
              <span className="text-sm">
                <span className="font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-1">
                  <Lock className="w-3.5 h-3.5 text-purple-500" />
                  Mark destination as an isolation cage
                </span>
                <span className="block text-xs text-gray-400 mt-0.5">
                  Use this when separating these birds from the rest of the batch
                  (e.g. sick, injured, or under observation).
                </span>
              </span>
            </label>
            {watchedIsIsolation && (
              <div className="mt-3">
                <label className={lCls}>Reason for isolation *</label>
                <textarea
                  {...register('isolationReason', {
                    validate: v => !watchedIsIsolation || (!!v && v.trim().length >= 3)
                      || 'Enter a reason (at least 3 characters)',
                  })}
                  rows={2}
                  className={`${iCls} resize-none`}
                  placeholder="e.g. Suspected respiratory infection — under observation"
                />
                {errors.isolationReason && (
                  <p className="text-red-500 text-xs mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {errors.isolationReason.message as string}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── Live transfer summary ── */}
          {selectedDest && watchedBirdCount && Number(watchedBirdCount) > 0 && !exceedsSource && sourceCage && (() => {
            const moving   = Number(watchedBirdCount);
            const existing = selectedDest.existingBirdCount;
            const total    = existing + moving;
            const srcAfter = sourceBirdCount - moving;
            return (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl px-3 py-2 text-xs flex-wrap">
                  <Bird className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                  <span className="font-bold text-blue-700 dark:text-blue-300">
                    {moving.toLocaleString()} birds moving
                  </span>
                  <ArrowRight className="w-3 h-3 text-gray-400 flex-shrink-0" />
                  <span className="text-red-500 font-semibold line-through">
                    {sourceCage.label}
                  </span>
                  <ArrowRight className="w-3 h-3 text-gray-400 flex-shrink-0" />
                  <span className="text-green-600 dark:text-green-400 font-semibold">
                    {selectedDest.rowLabel} · {selectedDest.levelLabel} · {selectedDest.cageLabel}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-xs">
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                    <p className="text-gray-500 mb-0.5">Source cage after move</p>
                    <p className={`font-bold ${srcAfter === 0 ? 'text-red-600' : 'text-gray-700 dark:text-gray-200'}`}>
                      {srcAfter === 0 ? 'Empty (cage cleared)' : `${srcAfter.toLocaleString()} birds`}
                    </p>
                  </div>
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
                    <p className="text-gray-500 mb-0.5">Destination cage after move</p>
                    <p className="font-bold text-green-700 dark:text-green-400">
                      {total.toLocaleString()} birds
                      {existing > 0 && (
                        <span className="font-normal text-gray-400 ml-1">
                          ({existing.toLocaleString()} + {moving.toLocaleString()})
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── Bird count ── */}
          <div>
            <label className={lCls}>
              <Bird className="w-3.5 h-3.5 inline mr-1 text-amber-500" />
              Birds to move *{' '}
              <span className="font-normal text-gray-400">
                (max {sourceBirdCount.toLocaleString()})
              </span>
            </label>
            <input
              {...register('birdCount', {
                required: true,
                min: 1,
                max: sourceBirdCount,
              })}
              type="number"
              min="1"
              max={sourceBirdCount}
              className={`${iCls} font-bold text-center`}
              placeholder={`e.g. ${sourceBirdCount}`}
            />
            {exceedsSource && (
              <p className="text-red-500 text-xs mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Cannot move more than {sourceBirdCount.toLocaleString()} birds from this cage.
              </p>
            )}
            {errors.birdCount && !exceedsSource && (
              <p className="text-red-500 text-xs mt-1">Enter a valid bird count (1 – {sourceBirdCount.toLocaleString()})</p>
            )}
          </div>

          {/* ── Date ── */}
          <div>
            <label className={lCls}>Date of move</label>
            <input
              {...register('placedDate', { required: true })}
              type="date"
              className={iCls}
              max={dayjs().format('YYYY-MM-DD')}
            />
          </div>

          {/* ── Notes ── */}
          <div>
            <label className={lCls}>Notes</label>
            <textarea
              {...register('notes')}
              rows={2}
              className={`${iCls} resize-none`}
              placeholder="Optional"
            />
          </div>

          {assign.isError && (
            <p className="text-red-500 text-sm bg-red-50 dark:bg-red-900/20 rounded-xl p-3">
              {(assign.error as any)?.response?.data?.message ?? 'Failed to move birds. Please try again.'}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 rounded-xl py-3 font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                assign.isPending || exceedsSource || !sourceCage || destinationOptions.length === 0 ||
                (watchedIsIsolation && !!errors.isolationReason)
              }
              className="flex-1 bg-blue-500 text-white rounded-xl py-3 font-semibold disabled:opacity-60"
            >
              {assign.isPending ? 'Moving…' : 'Move Birds'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}

