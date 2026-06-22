// src/components/shared/BrooderLevelFeedLogModal.tsx
// Attendant logs feed dispensed to one specific level. Shows the required
// amount (population × standard ration) right alongside the input so the
// attendant can match it exactly — and that match is what PM/Director see.

import { useState } from 'react';
import { X, Wheat, CheckCircle2, AlertTriangle } from 'lucide-react';
import dayjs from '../../lib/dayjs';
import { useLogLevelFeed, type BrooderLevelData, type BrooderRowData } from '../../hooks/useBrooderCageMap';

export function BrooderLevelFeedLogModal({
  level, row, onClose,
}: {
  level: BrooderLevelData;
  row: BrooderRowData;
  onClose: () => void;
}) {
  const logFeed = useLogLevelFeed();
  const [feedType, setFeedType] = useState(level.feedType ?? 'CHICK_MASH');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');

  const today = dayjs().format('YYYY-MM-DD');
  const required = level.requiredKgThisWeek;
  const givenSoFar = level.dispensedKgThisWeek;
  const remaining = required != null ? Math.max(0, Math.round((required - givenSoFar) * 100) / 100) : null;

  const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';
  const lCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white dark:bg-dark-card w-full md:max-w-md rounded-t-3xl md:rounded-2xl shadow-2xl overflow-y-auto max-h-[95vh]">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-dark-border sticky top-0 bg-white dark:bg-dark-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-500 rounded-xl flex items-center justify-center">
              <Wheat className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-bold text-gray-800 dark:text-gray-100">{row.label} · {level.label}</p>
              <p className="text-xs text-gray-400 font-mono">{level.batch?.batchCode}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-bg">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Required-vs-given summary */}
          {required != null && (
            <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[10px] text-gray-400 uppercase">Required/wk</p>
                <p className="text-sm font-bold text-gray-800 dark:text-gray-100">{required}kg</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400 uppercase">Given so far</p>
                <p className="text-sm font-bold text-gray-800 dark:text-gray-100">{givenSoFar}kg</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400 uppercase">Remaining</p>
                <p className={`text-sm font-bold ${remaining === 0 ? 'text-green-500' : 'text-amber-600'}`}>
                  {remaining}kg
                </p>
              </div>
            </div>
          )}

          <div>
            <label className={lCls}>Feed Type</label>
            <select value={feedType} onChange={e => setFeedType(e.target.value)} className={iCls}>
              <option value="CHICK_MASH">Chick Mash</option>
              <option value="GROWER_MASH">Grower Mash</option>
              <option value="LAYER_MASH">Layer Mash</option>
            </select>
          </div>

          <div>
            <label className={lCls}>Quantity Dispensed (kg)</label>
            <input
              value={quantity} onChange={e => setQuantity(e.target.value)}
              type="number" step="0.1" min="0" className={`${iCls} font-bold text-center text-lg`}
              placeholder="e.g. 5.5"
            />
            {remaining != null && Number(quantity) > 0 && (
              <p className={`text-xs mt-1.5 flex items-center gap-1 ${
                Number(quantity) === remaining ? 'text-green-600' : 'text-amber-600'
              }`}>
                {Number(quantity) === remaining ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                {Number(quantity) === remaining
                  ? 'Matches exact remaining requirement'
                  : `Remaining requirement is ${remaining}kg`}
              </p>
            )}
          </div>

          <div>
            <label className={lCls}>Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={`${iCls} resize-none`} placeholder="Optional" />
          </div>

          {logFeed.isError && <p className="text-red-500 text-sm">Failed to save. Please try again.</p>}

          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 rounded-xl py-3 font-semibold">
              Cancel
            </button>
            <button
              onClick={() => logFeed.mutate(
                {
                  levelId: level.levelId,
                  feedType,
                  entryDate: today,
                  quantityDispensedKg: Number(quantity),
                  notes: notes || undefined,
                },
                { onSuccess: onClose },
              )}
              disabled={logFeed.isPending || !quantity || Number(quantity) <= 0}
              className="flex-1 bg-amber-500 text-white rounded-xl py-3 font-semibold disabled:opacity-60"
            >
              {logFeed.isPending ? 'Saving…' : 'Log Feed'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
