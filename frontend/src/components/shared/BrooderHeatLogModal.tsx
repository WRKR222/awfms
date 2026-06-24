// src/components/shared/BrooderHeatLogModal.tsx
// Logs heating for a brooder row: CHARCOAL (quantity used) or HEAT_BULB
// (start/stop timer so total minutes-on is captured).

import { useState } from 'react';
import { X, Flame, Zap, Clock } from 'lucide-react';
import dayjs from '../../lib/dayjs';
import {
  useCreateBrooderHeatLog, useStopBrooderHeatLog,
  type BrooderRowData,
} from '../../hooks/useBrooderCageMap';

export function BrooderHeatLogModal({ row, onClose }: { row: BrooderRowData; onClose: () => void }) {
  const [sourceType, setSourceType] = useState<'CHARCOAL' | 'HEAT_BULB'>(
    row.heatToday?.sourceType ?? 'CHARCOAL',
  );
  const [charcoalKg, setCharcoalKg] = useState('');
  const [bulbCount, setBulbCount] = useState('1');
  const [notes, setNotes] = useState('');

  const logCharcoal = useCreateBrooderHeatLog();
  const startBulb   = useCreateBrooderHeatLog();
  const stopBulb    = useStopBrooderHeatLog();

  const today = dayjs().format('YYYY-MM-DD');
  const bulbRunning = row.heatToday?.sourceType === 'HEAT_BULB' && row.heatToday.isRunning;

  const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';
  const lCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white dark:bg-dark-card w-full md:max-w-md rounded-t-3xl md:rounded-2xl shadow-2xl overflow-y-auto max-h-[95vh]">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-dark-border sticky top-0 bg-white dark:bg-dark-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-orange-500 rounded-xl flex items-center justify-center">
              <Flame className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-bold text-gray-800 dark:text-gray-100">{row.label} · Heating</p>
              <p className="text-xs text-gray-400">Track charcoal use or bulb on-time</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-bg">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {bulbRunning ? (
            // ── Bulb currently running — show a stop control only ──
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 text-center space-y-3">
              <Zap className="w-8 h-8 text-amber-500 mx-auto animate-pulse" />
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                Heat bulb running
                {row.heatToday?.bulbCount ? ` · ${row.heatToday.bulbCount} bulb(s)` : ''}
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-500 flex items-center justify-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                Started {row.heatToday?.bulbStartedAt ? dayjs(row.heatToday.bulbStartedAt).format('HH:mm') : '—'}
              </p>
              <textarea
                value={notes} onChange={e => setNotes(e.target.value)}
                rows={2} className={`${iCls} resize-none`} placeholder="Optional note before stopping..."
              />
              <button
                onClick={() => row.heatToday && stopBulb.mutate(
                  { id: row.heatToday.id, data: { notes: notes || undefined } },
                  { onSuccess: onClose },
                )}
                disabled={stopBulb.isPending}
                className="w-full bg-amber-500 text-white rounded-xl py-3 font-semibold disabled:opacity-60"
              >
                {stopBulb.isPending ? 'Stopping…' : 'Stop Bulb Timer'}
              </button>
            </div>
          ) : (
            <>
              {/* ── Source type toggle ── */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setSourceType('CHARCOAL')}
                  className={`rounded-xl py-3 text-sm font-semibold border flex items-center justify-center gap-1.5 ${
                    sourceType === 'CHARCOAL'
                      ? 'bg-orange-500 text-white border-orange-500'
                      : 'border-gray-200 dark:border-dark-border text-gray-500'
                  }`}
                >
                  <Flame className="w-4 h-4" /> Charcoal
                </button>
                <button
                  onClick={() => setSourceType('HEAT_BULB')}
                  className={`rounded-xl py-3 text-sm font-semibold border flex items-center justify-center gap-1.5 ${
                    sourceType === 'HEAT_BULB'
                      ? 'bg-amber-500 text-white border-amber-500'
                      : 'border-gray-200 dark:border-dark-border text-gray-500'
                  }`}
                >
                  <Zap className="w-4 h-4" /> Heat Bulb
                </button>
              </div>

              {sourceType === 'CHARCOAL' ? (
                <div>
                  <label className={lCls}>Charcoal Used (kg)</label>
                  <input
                    value={charcoalKg} onChange={e => setCharcoalKg(e.target.value)}
                    type="number" step="0.1" min="0" className={iCls} placeholder="e.g. 2.5"
                  />
                </div>
              ) : (
                <div>
                  <label className={lCls}>Number of Bulbs</label>
                  <input
                    value={bulbCount} onChange={e => setBulbCount(e.target.value)}
                    type="number" min="1" className={iCls} placeholder="e.g. 2"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">
                    Starts a timer now. Come back and tap "Stop Bulb Timer" when switched off — total minutes-on is recorded automatically.
                  </p>
                </div>
              )}

              <div>
                <label className={lCls}>Notes</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={`${iCls} resize-none`} placeholder="Optional" />
              </div>

              {(logCharcoal.isError || startBulb.isError) && (
                <p className="text-red-500 text-sm">Failed to save. Please try again.</p>
              )}

              <div className="flex gap-3 pt-1">
                <button onClick={onClose} className="flex-1 border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 rounded-xl py-3 font-semibold">
                  Cancel
                </button>
                {sourceType === 'CHARCOAL' ? (
                  <button
                    onClick={() => logCharcoal.mutate(
                      { rowId: row.rowId, logDate: today, sourceType: 'CHARCOAL', charcoalKg: Number(charcoalKg), notes: notes || undefined },
                      { onSuccess: onClose },
                    )}
                    disabled={logCharcoal.isPending || !charcoalKg}
                    className="flex-1 bg-orange-500 text-white rounded-xl py-3 font-semibold disabled:opacity-60"
                  >
                    {logCharcoal.isPending ? 'Saving…' : 'Log Charcoal'}
                  </button>
                ) : (
                  <button
                    onClick={() => startBulb.mutate(
                      { rowId: row.rowId, logDate: today, sourceType: 'HEAT_BULB', bulbCount: Number(bulbCount) || 1, notes: notes || undefined },
                      { onSuccess: onClose },
                    )}
                    disabled={startBulb.isPending}
                    className="flex-1 bg-amber-500 text-white rounded-xl py-3 font-semibold disabled:opacity-60"
                  >
                    {startBulb.isPending ? 'Starting…' : 'Start Bulb Timer'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
