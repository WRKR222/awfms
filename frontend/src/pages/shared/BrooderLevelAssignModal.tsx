// src/components/shared/BrooderLevelAssignModal.tsx
// Attendant places (or moves) a batch's chick population onto one specific
// brooder row/level cell.
//
// Rules enforced here:
//   • Only batches already located in the BROODER can be assigned to a level.
//     (The batch must have been created/received into the brooder first.)
//   • The bird count entered for THIS level must be ≤ the batch's remaining
//     unassigned birds (quantityReceived − sum of birds already on other levels).
//   • The attendant sees how many birds are still unplaced so they know
//     how to distribute across rows/levels until the total matches quantityReceived.

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { X, Bird, Layers, AlertTriangle, Info } from 'lucide-react';
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
  quantityReceived: number;
  /** Birds already assigned to OTHER levels (not this one) for this batch. */
  alreadyAssignedCount: number;
}

export function BrooderLevelAssignModal({
  level, row, batches, onClose,
}: {
  level: BrooderLevelData;
  row: BrooderRowData;
  batches: BatchOption[];
  onClose: () => void;
}) {
  const assign = useAssignBrooderLevel();
  const remove = useRemoveBrooderLevelAssignment();
  const [confirmRemove, setConfirmRemove] = useState(false);

  const { register, handleSubmit, watch, formState: { errors } } = useForm({
    defaultValues: {
      batchId: level.assignment?.batchId ?? '',
      birdCount: level.assignment?.birdCount ?? '',
      placedDate: level.assignment?.placedDate
        ? dayjs(level.assignment.placedDate).format('YYYY-MM-DD')
        : dayjs().format('YYYY-MM-DD'),
      notes: level.assignment?.notes ?? '',
    },
  });

  const selectedBatchId = watch('batchId');
  const enteredBirdCount = Number(watch('birdCount')) || 0;

  const selectedBatch = batches.find(b => b.id === selectedBatchId);

  // Birds still unplaced = quantityReceived − already placed on other levels
  // (excludes this level's current assignment so editing is non-destructive)
  const unplacedBirds = selectedBatch
    ? selectedBatch.quantityReceived - selectedBatch.alreadyAssignedCount
    : null;

  const overLimit =
    unplacedBirds != null &&
    enteredBirdCount > 0 &&
    enteredBirdCount > unplacedBirds;

  const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';
  const lCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1';

  const submit = (data: any) => {
    if (overLimit) return; // guard
    assign.mutate(
      {
        levelId: level.levelId,
        data: {
          batchId: data.batchId,
          birdCount: Number(data.birdCount),
          placedDate: data.placedDate,
          notes: data.notes || undefined,
        },
      },
      { onSuccess: onClose },
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white dark:bg-dark-card w-full md:max-w-md rounded-t-3xl md:rounded-2xl shadow-2xl overflow-y-auto max-h-[95vh]">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-dark-border sticky top-0 bg-white dark:bg-dark-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-500 rounded-xl flex items-center justify-center">
              <Layers className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-bold text-gray-800 dark:text-gray-100">{row.label} · {level.label}</p>
              <p className="text-xs text-gray-400">
                {level.assignment ? 'Move / update placement' : 'Place a batch on this level'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-bg">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit(submit)} className="p-5 space-y-4">
          {/* Batch selector — only BROODER batches */}
          <div>
            <label className={lCls}>Batch (Brooder batches only)</label>
            <select {...register('batchId', { required: true })} className={iCls}>
              <option value="">Select batch...</option>
              {batches.length === 0 ? (
                <option disabled>No brooder batches available</option>
              ) : (
                batches.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.batchCode} · {b.quantityReceived.toLocaleString()} received
                  </option>
                ))
              )}
            </select>
            {errors.batchId && <p className="text-red-500 text-xs mt-1">Batch is required</p>}
          </div>

          {/* Distribution hint */}
          {selectedBatch && unplacedBirds != null && (
            <div className={`rounded-xl p-3 flex items-start gap-2 text-xs ${
              unplacedBirds === 0
                ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
                : 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400'
            }`}>
              <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">
                  {selectedBatch.batchCode} — bird distribution
                </p>
                <p className="mt-0.5">
                  Received: <strong>{selectedBatch.quantityReceived.toLocaleString()}</strong>
                  {' · '}
                  Placed on other levels: <strong>{selectedBatch.alreadyAssignedCount.toLocaleString()}</strong>
                  {' · '}
                  Still to place: <strong>{unplacedBirds.toLocaleString()}</strong>
                </p>
                {unplacedBirds === 0 && (
                  <p className="mt-0.5 font-semibold">All birds accounted for ✓</p>
                )}
              </div>
            </div>
          )}

          {/* Bird count */}
          <div>
            <label className={lCls}>
              <Bird className="w-3.5 h-3.5 inline mr-1 text-amber-500" />
              Chick Count on this Level
              {unplacedBirds != null && unplacedBirds > 0 && (
                <span className="ml-1 text-amber-500 font-normal">(max {unplacedBirds.toLocaleString()} remaining)</span>
              )}
            </label>
            <input
              {...register('birdCount', {
                required: true,
                min: { value: 1, message: 'Must be at least 1' },
                validate: val =>
                  unplacedBirds == null ||
                  Number(val) <= unplacedBirds ||
                  `Cannot exceed ${unplacedBirds} unplaced birds`,
              })}
              type="number" min="1" className={`${iCls} font-bold text-center`}
              placeholder="e.g. 250"
            />
            {errors.birdCount && (
              <p className="text-red-500 text-xs mt-1">{errors.birdCount.message as string || 'Enter the number of chicks'}</p>
            )}
            {overLimit && !errors.birdCount && (
              <p className="text-red-500 text-xs mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Exceeds the {unplacedBirds} birds still unplaced for this batch
              </p>
            )}
          </div>

          <div>
            <label className={lCls}>Date Placed</label>
            <input {...register('placedDate', { required: true })} type="date" className={iCls} max={dayjs().format('YYYY-MM-DD')} />
          </div>

          <div>
            <label className={lCls}>Notes</label>
            <textarea {...register('notes')} rows={2} className={`${iCls} resize-none`} placeholder="Optional" />
          </div>

          {assign.isError && (
            <p className="text-red-500 text-sm">Failed to save placement. Please try again.</p>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 rounded-xl py-3 font-semibold">
              Cancel
            </button>
            <button
              type="submit"
              disabled={assign.isPending || overLimit}
              className="flex-1 bg-amber-500 text-white rounded-xl py-3 font-semibold disabled:opacity-60"
            >
              {assign.isPending ? 'Saving…' : 'Save Placement'}
            </button>
          </div>

          {level.assignment && (
            <div className="border-t border-gray-100 dark:border-dark-border pt-3">
              {!confirmRemove ? (
                <button
                  type="button"
                  onClick={() => setConfirmRemove(true)}
                  className="w-full text-xs text-red-500 font-semibold py-2"
                >
                  Clear this level (chicks moved/transferred out)
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
