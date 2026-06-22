// src/components/shared/BrooderLevelAssignModal.tsx
// Attendant places (or moves) a batch's chick population onto one specific
// brooder row/level cell. This is the entry point for "accounting for every
// chick from the moment a batch is keyed into the brooder".

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { X, Bird, Layers, AlertTriangle } from 'lucide-react';
import dayjs from '../../lib/dayjs';
import { useAssignBrooderLevel, useRemoveBrooderLevelAssignment, type BrooderLevelData, type BrooderRowData } from '../../hooks/useBrooderCageMap';

interface BatchOption {
  id: string;
  batchCode: string;
  currentBirdCount: number;
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

  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: {
      batchId: level.assignment?.batchId ?? '',
      birdCount: level.assignment?.birdCount ?? '',
      placedDate: level.assignment?.placedDate
        ? dayjs(level.assignment.placedDate).format('YYYY-MM-DD')
        : dayjs().format('YYYY-MM-DD'),
      notes: level.assignment?.notes ?? '',
    },
  });

  const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';
  const lCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1';

  const submit = (data: any) => {
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

          <div>
            <label className={lCls}>
              <Bird className="w-3.5 h-3.5 inline mr-1 text-amber-500" />
              Chick Count on this Level
            </label>
            <input
              {...register('birdCount', { required: true, min: 0 })}
              type="number" min="0" className={`${iCls} font-bold text-center`}
              placeholder="e.g. 250"
            />
            {errors.birdCount && <p className="text-red-500 text-xs mt-1">Enter the number of chicks</p>}
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
            <button type="submit" disabled={assign.isPending} className="flex-1 bg-amber-500 text-white rounded-xl py-3 font-semibold disabled:opacity-60">
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
