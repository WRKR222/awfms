// src/pages/manager/ManagerCullingPage.tsx
// Farm Events — covers all event types per PDF spec
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import { useBatches } from '../../hooks/useFlock';
import {
  AlertTriangle, Plus, CheckCircle, Trash2, Scale, ShieldOff,
  ShieldCheck, Scissors, Bug, Stethoscope, Package, Archive,
  Activity, Syringe, ClipboardList,
} from 'lucide-react';
import dayjs from 'dayjs';

// changes.pdf — Production Manager → Events:
// Remove DISEASE_OUTBREAK, INJURY, QUARANTINE_IMPOSED, QUARANTINE_LIFTED.
// When BATCH_SOLD or BATCH_DISCARDED is logged, the backend marks the batch
// inactive and closedAt — that's what reflects on the production-house live map.
// Farm Events — unified per PM Activity Diagram.
// Merged from HealthBiosecurity.tsx. HealthBiosecurity now shows Vaccinations only.
const EVENT_TYPES = [
  // ── Health events ──────────────────────────────────────────────────────────
  { value: 'DISEASE_OUTBREAK',    label: 'Disease Outbreak',    showDisease: true,  showWeight: false },
  { value: 'INJURY',              label: 'Bird Injury',         showDisease: false, showWeight: false },
  { value: 'ROUTINE_CHECKUP',     label: 'Routine Checkup',     showDisease: false, showWeight: false },
  { value: 'MEDICATION',          label: 'Medication',          showDisease: false, showWeight: false },
  { value: 'QUARANTINE_IMPOSED',  label: 'Quarantine Imposed',  showDisease: false, showWeight: false },
  { value: 'QUARANTINE_LIFTED',   label: 'Quarantine Lifted',   showDisease: false, showWeight: false },
  // ── Batch / physical events ────────────────────────────────────────────────
  { value: 'CULLING',             label: 'Bird Culling',        showDisease: false, showWeight: false },
  { value: 'BATCH_SOLD',          label: 'Batch Sold',          showDisease: false, showWeight: false },
  { value: 'BATCH_DISCARDED',     label: 'Batch Discarded',     showDisease: false, showWeight: false },
  { value: 'WEIGHING',            label: 'Bird Weighing',       showDisease: false, showWeight: true  },
];

const EVENT_ICONS: Record<string, React.ElementType> = {
  DISEASE_OUTBREAK:   Bug,
  INJURY:             Activity,
  ROUTINE_CHECKUP:    ClipboardList,
  MEDICATION:         Syringe,
  QUARANTINE_IMPOSED: ShieldOff,
  QUARANTINE_LIFTED:  ShieldCheck,
  CULLING:            Scissors,
  BATCH_SOLD:         Package,
  BATCH_DISCARDED:    Archive,
  WEIGHING:           Scale,
};

const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';
const lCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide';

interface EventForm {
  batchId: string;
  eventType: string;
  eventDate: string;
  affectedCount: number;
  symptoms?: string;
  diagnosis?: string;
  treatment?: string;
  sampleCount?: number;
  totalWeightG?: number;
  notes?: string;
}

export function ManagerCullingPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { data: batches = [] } = useBatches({ isActive: true });

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['health-events'],
    queryFn: () => api.get('/health/events?limit=50').then(r => r.data).catch(() => []),
  });

  const { register, handleSubmit, watch, reset, formState: { errors } } = useForm<EventForm>({
    defaultValues: {
      batchId: '', eventType: 'CULLING', eventDate: dayjs().format('YYYY-MM-DD'),
      affectedCount: 1, notes: '',
    },
  });

  const selectedType = watch('eventType');
  const eventCfg = EVENT_TYPES.find(e => e.value === selectedType);
  const sampleCount = watch('sampleCount');
  const totalWeightG = watch('totalWeightG');
  const avgWeight = (sampleCount && totalWeightG && Number(sampleCount) > 0)
    ? (Number(totalWeightG) / Number(sampleCount)).toFixed(1)
    : null;

  const create = useMutation({
    mutationFn: (data: EventForm) => api.post('/health/events', {
      ...data,
      affectedCount: Number(data.affectedCount),
      sampleCount: data.sampleCount ? Number(data.sampleCount) : undefined,
      totalWeightG: data.totalWeightG ? Number(data.totalWeightG) : undefined,
    }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['health-events'] });
      qc.invalidateQueries({ queryKey: ['batches'] });
      setSubmitted(true);
      reset();
      setTimeout(() => { setSubmitted(false); setShowForm(false); }, 2000);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/health/events/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['health-events'] }),
  });

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Farm Events</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Log disease outbreaks, culling, weighing, batch closures and more</p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-brand-green/90 transition-colors"
        >
          <Plus className="w-4 h-4" /> Log Event
        </button>
      </div>

      {submitted && (
        <div className="flex items-center gap-2 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 px-4 py-3 rounded-xl text-sm font-medium">
          <CheckCircle className="w-4 h-4" /> Event logged successfully.
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit(d => create.mutate(d))}
          className="bg-white dark:bg-dark-card rounded-2xl p-5 border border-gray-100 dark:border-dark-border space-y-4">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">New Farm Event</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={lCls}>Batch</label>
              <select className={iCls} {...register('batchId', { required: true })}>
                <option value="">Select batch…</option>
                {batches.map((b: any) => (
                  <option key={b.id} value={b.id}>{b.batchCode}</option>
                ))}
              </select>
              {errors.batchId && <p className="text-xs text-red-500 mt-1">Required</p>}
            </div>
            <div>
              <label className={lCls}>Event Type</label>
              <select className={iCls} {...register('eventType', { required: true })}>
                {EVENT_TYPES.map(e => (
                  <option key={e.value} value={e.value}>{e.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={lCls}>Event Date</label>
              <input type="date" className={iCls} {...register('eventDate', { required: true })} />
            </div>
            <div>
              <label className={lCls}>
                {selectedType === 'WEIGHING' ? 'Birds Sampled' : 'Affected Birds'}
              </label>
              <input type="number" min={1} className={iCls}
                {...register('affectedCount', { required: true, min: 1, valueAsNumber: true })} />
            </div>
          </div>

          {eventCfg?.showDisease && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={lCls}>Symptoms</label>
                <input className={iCls} {...register('symptoms')} placeholder="e.g. laboured breathing" />
              </div>
              <div>
                <label className={lCls}>Diagnosis</label>
                <input className={iCls} {...register('diagnosis')} placeholder="e.g. Newcastle disease" />
              </div>
              <div>
                <label className={lCls}>Treatment</label>
                <input className={iCls} {...register('treatment')} placeholder="e.g. Tylan + vitamins" />
              </div>
            </div>
          )}

          {eventCfg?.showWeight && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={lCls}>Sample Count</label>
                <input type="number" min={1} className={iCls} {...register('sampleCount', { valueAsNumber: true })} />
              </div>
              <div>
                <label className={lCls}>Total Weight (g)</label>
                <input type="number" min={1} className={iCls} {...register('totalWeightG', { valueAsNumber: true })} />
              </div>
              <div>
                <label className={lCls}>Avg Weight / Bird</label>
                <div className={`${iCls} bg-gray-50 dark:bg-dark-bg cursor-not-allowed text-gray-500`}>
                  {avgWeight ? `${avgWeight} g` : '—'}
                </div>
              </div>
            </div>
          )}

          <div>
            <label className={lCls}>Notes (optional)</label>
            <textarea rows={2} className={iCls} {...register('notes')} placeholder="Additional context, reasons, outcome…" />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={create.isPending}
              className="bg-brand-green text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-brand-green/90 disabled:opacity-60">
              {create.isPending ? 'Saving…' : 'Log Event'}
            </button>
            <button type="button" onClick={() => { setShowForm(false); reset(); }}
              className="px-5 py-2 rounded-xl text-sm font-semibold border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-300">
              Cancel
            </button>
          </div>
          {create.isError && <p className="text-xs text-red-500">Failed to save. Please try again.</p>}
        </form>
      )}

      <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-dark-border">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Event History</p>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
        ) : (logs as any[]).length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">No events logged yet.</div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-dark-border">
            {(logs as any[]).map(log => {
              const IconComp = EVENT_ICONS[log.eventType] ?? AlertTriangle;
              const cfg = EVENT_TYPES.find(e => e.value === log.eventType);
              return (
                <div key={log.id} className="flex items-start gap-3 px-5 py-3 group hover:bg-gray-50 dark:hover:bg-dark-bg">
                  <div className="w-8 h-8 rounded-lg bg-brand-green/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <IconComp className="w-4 h-4 text-brand-green" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{cfg?.label ?? log.eventType}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {dayjs(log.eventDate).format('DD MMM YYYY')} · {log.affectedCount} bird{log.affectedCount !== 1 ? 's' : ''}
                      {log.batch?.batchCode && ` · ${log.batch.batchCode}`}
                    </p>
                    {log.symptoms && <p className="text-xs text-gray-500 mt-0.5">Symptoms: {log.symptoms}</p>}
                    {log.diagnosis && <p className="text-xs text-gray-500">Diagnosis: {log.diagnosis}</p>}
                    {log.notes && <p className="text-xs text-gray-400 italic mt-0.5">{log.notes}</p>}
                  </div>
                  <button onClick={() => remove.mutate(log.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-500">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
