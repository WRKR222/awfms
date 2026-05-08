// src/pages/manager/BrooderPage.tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api } from '../../lib/api';
import dayjs from 'dayjs';
import {
  Bird, Thermometer, Droplets, Sun, XCircle, Plus,
  X, CheckCircle, AlertTriangle, ChevronRight, Flame,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────
interface BrooderBatch {
  id: string;
  batchCode: string;
  currentBirdCount: number;
  quantityReceived: number;
  dateOfHatch: string;
  stage: string;
  location: string;
  supplierName?: string;
  supplier?: { name: string };
  isActive: boolean;
}

interface BrooderLog {
  id: string;
  batchId: string;
  logDate: string;
  waterConsumptionL?: number;
  feedConsumedKg?: number;
  temperature?: number;
  lightingOk: boolean;
  mortalityCount: number;
  vaccineGiven?: string;
  supplement?: string;
  notes?: string;
}

// ── Log Modal ─────────────────────────────────────────────────────────────────
function LogModal({
  batch,
  onClose,
}: {
  batch: BrooderBatch;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: {
      logDate: dayjs().format('YYYY-MM-DD'),
      waterConsumptionL: '',
      feedConsumedKg: '',
      temperature: '',
      lightingOk: true,
      mortalityCount: '0',
      vaccineGiven: '',
      supplement: '',
      notes: '',
    },
  });

  const submit = useMutation({
    mutationFn: (data: any) =>
      api
        .post('/flock/brooder-logs', {
          ...data,
          batchId: batch.id,
          mortalityCount: Number(data.mortalityCount) || 0,
          waterConsumptionL: data.waterConsumptionL ? Number(data.waterConsumptionL) : undefined,
          feedConsumedKg: data.feedConsumedKg ? Number(data.feedConsumedKg) : undefined,
          temperature: data.temperature ? Number(data.temperature) : undefined,
        })
        .then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brooder-logs', batch.id] });
      qc.invalidateQueries({ queryKey: ['batches'] });
      onClose();
    },
  });

  const iCls =
    'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';
  const lCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white dark:bg-dark-card w-full md:max-w-lg rounded-t-3xl md:rounded-2xl shadow-2xl overflow-y-auto max-h-[95vh]">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-dark-border sticky top-0 bg-white dark:bg-dark-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-500 rounded-xl flex items-center justify-center">
              <Flame className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-bold text-gray-800 dark:text-gray-100">Log Brooder Entry</p>
              <p className="text-xs text-gray-400">{batch.batchCode}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-bg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit(d => submit.mutate(d))}
          className="p-5 space-y-4"
        >
          <div>
            <label className={lCls}>Log Date</label>
            <input {...register('logDate')} type="date" className={iCls} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lCls}>Water Consumed (L)</label>
              <input
                {...register('waterConsumptionL')}
                type="number"
                step="0.1"
                min="0"
                className={iCls}
                placeholder="e.g. 25"
              />
            </div>
            <div>
              <label className={lCls}>Feed Consumed (kg)</label>
              <input
                {...register('feedConsumedKg')}
                type="number"
                step="0.1"
                min="0"
                className={iCls}
                placeholder="e.g. 10"
              />
            </div>
            <div>
              <label className={lCls}>Temperature (°C)</label>
              <input
                {...register('temperature')}
                type="number"
                step="0.1"
                className={iCls}
                placeholder="e.g. 32"
              />
            </div>
            <div>
              <label className={lCls}>Mortality Count</label>
              <input
                {...register('mortalityCount')}
                type="number"
                min="0"
                className={`${iCls} text-center font-bold`}
                placeholder="0"
              />
            </div>
          </div>

          {/* Lighting */}
          <label className="flex items-center gap-2 cursor-pointer p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20">
            <input
              {...register('lightingOk')}
              type="checkbox"
              className="w-4 h-4 accent-amber-500"
            />
            <Sun className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Lighting is adequate (chicks getting enough light)
            </span>
          </label>

          <div>
            <label className={lCls}>Vaccine Given (if any)</label>
            <input
              {...register('vaccineGiven')}
              className={iCls}
              placeholder="e.g. Newcastle ND1 (leave blank if none)"
            />
          </div>
          <div>
            <label className={lCls}>Supplement (if any)</label>
            <input
              {...register('supplement')}
              className={iCls}
              placeholder="e.g. Vitamins, Electrolytes"
            />
          </div>
          <div>
            <label className={lCls}>Notes</label>
            <textarea
              {...register('notes')}
              rows={2}
              className={`${iCls} resize-none`}
              placeholder="Any observations or concerns..."
            />
          </div>

          {submit.isError && (
            <p className="text-red-500 text-sm">Failed to save log. Please try again.</p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 rounded-xl py-3 font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submit.isPending}
              className="flex-1 bg-amber-500 text-white rounded-xl py-3 font-semibold disabled:opacity-60"
            >
              {submit.isPending ? 'Saving…' : 'Save Entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Brooder Batch Card ────────────────────────────────────────────────────────
function BrooderBatchCard({ batch }: { batch: BrooderBatch }) {
  const [showLog, setShowLog] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const ageDays = dayjs().diff(dayjs(batch.dateOfHatch), 'day');
  const ageWeeks = Math.floor(ageDays / 7);
  const survivalRate =
    batch.quantityReceived > 0
      ? ((batch.currentBirdCount / batch.quantityReceived) * 100).toFixed(1)
      : '—';
  const weeksToTransfer = Math.max(0, 18 - ageWeeks);

  const { data: logs = [] } = useQuery<BrooderLog[]>({
    queryKey: ['brooder-logs', batch.id],
    queryFn: () =>
      api.get(`/flock/brooder-logs?batchId=${batch.id}&limit=5`).then(r => r.data).catch(() => []),
    enabled: expanded,
    staleTime: 30_000,
  });

  const lastLog = logs[0];

  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border shadow-sm p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-bold text-gray-800 dark:text-gray-100 text-lg font-mono">
              {batch.batchCode}
            </p>
            <span className="text-xs px-2.5 py-1 rounded-full font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              Brooder
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {batch.supplier?.name ?? batch.supplierName ?? 'Unknown supplier'} ·{' '}
            {ageWeeks} weeks old ({ageDays} days)
          </p>
        </div>
        {weeksToTransfer <= 2 && weeksToTransfer > 0 && (
          <span className="text-[10px] px-2 py-1 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 font-semibold flex-shrink-0">
            Transfer in {weeksToTransfer}wk
          </span>
        )}
        {weeksToTransfer === 0 && (
          <span className="text-[10px] px-2 py-1 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 font-semibold flex-shrink-0">
            Ready to transfer!
          </span>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-brand-green/5 dark:bg-brand-green/10 p-2.5 text-center">
          <Bird className="w-3.5 h-3.5 text-brand-green mx-auto mb-0.5" />
          <p className="text-lg font-bold text-brand-green">
            {batch.currentBirdCount.toLocaleString()}
          </p>
          <p className="text-[9px] text-gray-400 uppercase tracking-wide">Live birds</p>
        </div>
        <div className="rounded-xl bg-gray-50 dark:bg-dark-bg p-2.5 text-center">
          <p className="text-lg font-bold text-gray-700 dark:text-gray-300">{survivalRate}%</p>
          <p className="text-[9px] text-gray-400 uppercase tracking-wide">Survival</p>
        </div>
        <div className="rounded-xl bg-gray-50 dark:bg-dark-bg p-2.5 text-center">
          <p className="text-lg font-bold text-gray-700 dark:text-gray-300">{ageWeeks}wk</p>
          <p className="text-[9px] text-gray-400 uppercase tracking-wide">Age</p>
        </div>
      </div>

      {/* Last log summary */}
      {lastLog && (
        <div className="bg-gray-50 dark:bg-dark-bg rounded-xl p-3 text-xs text-gray-500 dark:text-gray-400">
          <p className="font-semibold text-gray-600 dark:text-gray-300 mb-1.5">
            Last log — {dayjs(lastLog.logDate).format('D MMM YYYY')}
          </p>
          <div className="flex items-center gap-4 flex-wrap">
            {lastLog.temperature != null && (
              <span className="flex items-center gap-1">
                <Thermometer className="w-3 h-3 text-orange-400" />
                {lastLog.temperature}°C
              </span>
            )}
            {lastLog.waterConsumptionL != null && (
              <span className="flex items-center gap-1">
                <Droplets className="w-3 h-3 text-blue-400" />
                {lastLog.waterConsumptionL}L water
              </span>
            )}
            <span className="flex items-center gap-1">
              {lastLog.lightingOk ? (
                <><Sun className="w-3 h-3 text-amber-400" /> Lighting OK</>
              ) : (
                <><AlertTriangle className="w-3 h-3 text-red-400" /> Lighting issue</>
              )}
            </span>
            {lastLog.mortalityCount > 0 && (
              <span className="flex items-center gap-1 text-red-400">
                <XCircle className="w-3 h-3" />
                {lastLog.mortalityCount} mortality
              </span>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => setShowLog(true)}
          className="flex-1 bg-amber-500 text-white rounded-xl py-2.5 text-xs font-semibold hover:bg-amber-600 transition-colors flex items-center justify-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          Log Today
        </button>
        <button
          onClick={() => setExpanded(e => !e)}
          className="px-4 border border-gray-200 dark:border-dark-border rounded-xl text-xs font-semibold text-gray-500 hover:bg-gray-50 dark:hover:bg-dark-bg transition-colors flex items-center gap-1"
        >
          History
          <ChevronRight className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </button>
      </div>

      {/* Log history */}
      {expanded && (
        <div className="space-y-2 border-t border-gray-100 dark:border-dark-border pt-3">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
            Recent logs
          </p>
          {logs.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">No logs yet — press "Log Today" to start.</p>
          ) : (
            logs.map(log => (
              <div
                key={log.id}
                className="bg-gray-50 dark:bg-dark-bg rounded-xl p-3 text-xs text-gray-500 dark:text-gray-400"
              >
                <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1">
                  {dayjs(log.logDate).format('ddd D MMM')}
                  {log.mortalityCount > 0 && (
                    <span className="ml-2 text-red-400">· {log.mortalityCount} mortality</span>
                  )}
                </p>
                <div className="flex gap-3 flex-wrap">
                  {log.temperature != null && <span>🌡 {log.temperature}°C</span>}
                  {log.waterConsumptionL != null && <span>💧 {log.waterConsumptionL}L</span>}
                  {log.feedConsumedKg != null && <span>🌾 {log.feedConsumedKg}kg feed</span>}
                  {log.vaccineGiven && <span>💉 {log.vaccineGiven}</span>}
                  {!log.lightingOk && <span className="text-red-400">⚠ Lighting issue</span>}
                </div>
                {log.notes && <p className="mt-1 text-gray-400 italic">{log.notes}</p>}
              </div>
            ))
          )}
        </div>
      )}

      {showLog && <LogModal batch={batch} onClose={() => setShowLog(false)} />}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export function BrooderPage() {
  const { data: allBatches = [], isLoading } = useQuery<BrooderBatch[]>({
    queryKey: ['batches'],
    queryFn: () => api.get('/flock/batches').then(r => r.data),
    staleTime: 60_000,
  });

  const brooderBatches = allBatches.filter(
    b => b.location === 'BROODER' && b.isActive
  );

  const totalBrooderBirds = brooderBatches.reduce(
    (sum, b) => sum + (b.currentBirdCount ?? 0),
    0
  );

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Brooder</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          {brooderBatches.length} active batch{brooderBatches.length !== 1 ? 'es' : ''} ·{' '}
          <span className="font-semibold text-amber-600 dark:text-amber-400">
            {totalBrooderBirds.toLocaleString()} chicks
          </span>{' '}
          in brooder
        </p>
      </div>

      {/* Info banner */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-3 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
        <Flame className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold">Brooder Management</p>
          <p className="mt-0.5 text-amber-600 dark:text-amber-500">
            Chicks stay in the brooder up to 18 weeks. Log daily entries to track temperature,
            water, feed, lighting and any mortality. Batches ready for transfer at 18 weeks will
            be highlighted.
          </p>
        </div>
      </div>

      {/* Batch cards */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map(i => (
            <div
              key={i}
              className="bg-gray-100 dark:bg-dark-card rounded-2xl h-48 animate-pulse"
            />
          ))}
        </div>
      ) : brooderBatches.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <Flame className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="font-semibold">No active brooder batches</p>
          <p className="text-sm mt-1">
            Register a new batch and assign it to the Brooder from the Batches page.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {brooderBatches.map(batch => (
            <BrooderBatchCard key={batch.id} batch={batch} />
          ))}
        </div>
      )}
    </div>
  );
}
