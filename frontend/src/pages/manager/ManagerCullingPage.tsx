// src/pages/manager/ManagerCullingPage.tsx
// Farm Events — covers all event types per PDF spec
import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import { useBatches } from '../../hooks/useFlock';
import { useAuthStore } from '../../stores/auth.store';
import {
  AlertTriangle, Plus, CheckCircle, Trash2, Scale, ShieldOff,
  ShieldCheck, Scissors, Bug, Stethoscope, Package, Archive,
  Activity, Syringe, ClipboardList, HeartCrack, Upload, Wand2, X,
} from 'lucide-react';
import dayjs from '../../lib/dayjs';

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
  { value: 'BIRD_MORTALITY',      label: 'Bird Mortality',      showDisease: false, showWeight: false },
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
  BIRD_MORTALITY:     HeartCrack,
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
  notes?: string;
  // Row selector for CULLING / BIRD_MORTALITY in production house
  selectedRow?: string;
}

/** PM-only modal for uploading a bird weight report spreadsheet — see
 *  BirdWeightReportService on the backend for the accepted column layout
 *  (Date + Batch + either "Bird 1..N" individual-weight columns or a
 *  Sample Count / Total Weight (g) pair). Purely an upload+parse step;
 *  nothing is written to any batch until the PM picks a batch + date below
 *  and hits "Autofill from report". */
function BirdWeightReportUploadModal({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('No file selected');
      const form = new FormData();
      form.append('file', file);
      return api.post('/weight/reports/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
    },
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-dark-card rounded-2xl p-5 max-w-md w-full space-y-3"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">Upload Bird Weight Report</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <p className="text-xs text-gray-500">
          Upload a spreadsheet (.xlsx/.csv) of weights taken outside the app — with a "Date" and "Batch" column,
          plus either individual "Bird 1", "Bird 2"… weight columns (grams) or a Sample Count + Total Weight (g)
          pair. Once uploaded, open "Log Event" → Bird Weighing, pick the batch and date, and tap
          "Autofill from report" to pull the weights in.
        </p>
        <label className="flex items-center justify-center gap-2 border-2 border-dashed border-gray-200 dark:border-dark-border rounded-xl py-6 cursor-pointer text-sm text-gray-500 hover:border-brand-green">
          <Upload className="w-4 h-4" />
          {file ? file.name : 'Choose file…'}
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={e => setFile(e.target.files?.[0] ?? null)} />
        </label>
        {upload.isSuccess && (
          <div className="bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-xs rounded-xl p-3">
            Parsed {upload.data.rows.length} row(s).
            {upload.data.unmatchedBatchCodes.length > 0 && (
              <p className="mt-1 text-amber-600 dark:text-amber-400">
                Unmatched batch code(s): {upload.data.unmatchedBatchCodes.join(', ')} — these rows won't autofill until the batch code is corrected and re-uploaded.
              </p>
            )}
          </div>
        )}
        {upload.isError && (
          <p className="text-xs text-red-500">{(upload.error as any)?.response?.data?.message ?? 'Upload failed. Check the file format.'}</p>
        )}
        <div className="flex gap-2">
          <button
            onClick={() => upload.mutate()}
            disabled={!file || upload.isPending}
            className="flex-1 bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-brand-green/90 disabled:opacity-50"
          >
            {upload.isPending ? 'Uploading…' : 'Upload & Parse'}
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-300">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export function ManagerCullingPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [individualWeights, setIndividualWeights] = useState<(number | '')[]>([]);
  const [autofillNote, setAutofillNote] = useState<string | null>(null);
  const { data: batches = [] } = useBatches({ isActive: true });
  const role = useAuthStore(s => s.user?.role);

  const { data: logs = [], isLoading, isError: logsError, refetch: refetchLogs } = useQuery({
    queryKey: ['health-events'],
    queryFn: () => api.get('/health/events?limit=50').then(r => r.data),
  });

  const { register, handleSubmit, watch, reset, setValue, formState: { errors } } = useForm<EventForm>({
    defaultValues: {
      batchId: '', eventType: 'CULLING', eventDate: dayjs().format('YYYY-MM-DD'),
      affectedCount: 1, notes: '', selectedRow: '',
    },
  });

  const selectedType = watch('eventType');
  const selectedBatchId = watch('batchId');
  const eventDate = watch('eventDate');
  const eventCfg = EVENT_TYPES.find(e => e.value === selectedType);
  const affectedCount = watch('affectedCount');

  // Individual per-bird weights (grams) drive everything else for WEIGHING —
  // resize the array to match "Birds Sampled" as it changes, keeping any
  // values already entered for the birds still in range.
  useEffect(() => {
    if (selectedType !== 'WEIGHING') return;
    const n = Math.max(0, Number(affectedCount) || 0);
    setIndividualWeights(prev => {
      if (prev.length === n) return prev;
      if (n > prev.length) return [...prev, ...Array(n - prev.length).fill('')];
      return prev.slice(0, n);
    });
  }, [affectedCount, selectedType]);

  const filledWeights = individualWeights.filter(w => Number(w) > 0) as number[];
  const totalWeightG = filledWeights.length > 0 ? filledWeights.reduce((s, w) => s + Number(w), 0) : 0;
  const avgWeight = filledWeights.length > 0 ? (totalWeightG / filledWeights.length).toFixed(1) : null;

  // Autofill from a PM-uploaded bird weight report (see BirdWeightReportService).
  const autofill = useMutation({
    mutationFn: () => api.get('/weight/reports/autofill', { params: { batchId: selectedBatchId, date: eventDate } }).then(r => r.data),
    onSuccess: (data) => {
      if (!data.found) { setAutofillNote('No uploaded bird weight report found for this batch and date.'); return; }
      const weights: number[] = data.individualWeightsG?.length ? data.individualWeightsG : [];
      setValue('affectedCount', data.sampleCount);
      setIndividualWeights(weights.length > 0 ? weights : Array(data.sampleCount).fill(''));
      setAutofillNote(
        weights.length > 0
          ? `Autofilled ${weights.length} individual bird weight(s) from the uploaded report (${dayjs(data.reportDate).format('D MMM YYYY')}).`
          : `Autofilled sample count (${data.sampleCount}) and total weight (${data.totalWeightG}g) from the uploaded report — no individual weights were in that upload, so you can still enter them below.`,
      );
    },
  });

  // Determine if selected batch is in production house
  const selectedBatch = (batches as any[]).find((b: any) => b.id === selectedBatchId);
  const isProductionHouse = selectedBatch?.location === 'PRODUCTION_HOUSE';

  // Whether this event type supports row-level selection
  const supportsRowSelect = (selectedType === 'CULLING' || selectedType === 'BIRD_MORTALITY') && isProductionHouse;

  // Fetch cage assignments (rows) for the selected production-house batch
  const { data: cageAssignments = [] } = useQuery({
    queryKey: ['cage-assignments', selectedBatchId],
    queryFn: () => isProductionHouse && selectedBatchId
      ? api.get(`/cage-map/assignments?batchId=${selectedBatchId}`).then(r => r.data)
      : Promise.resolve([]),
    enabled: isProductionHouse && !!selectedBatchId,
  });

  const create = useMutation({
    mutationFn: (data: EventForm) => {
      // Build notes: prepend row info for culling/mortality in production house
      let notes = data.notes ?? '';
      if (supportsRowSelect && data.selectedRow) {
        const prefix = data.eventType === 'BIRD_MORTALITY'
          ? `Mortality in row ${data.selectedRow}`
          : `Culled from row ${data.selectedRow}`;
        notes = notes ? `${prefix}. ${notes}` : prefix;
      }
      return api.post('/health/events', {
        ...data,
        notes,
        // Send rowCode explicitly so the backend can reliably identify the row
        // without having to regex-parse the notes string.
        rowCode: (supportsRowSelect && data.selectedRow) ? data.selectedRow : undefined,
        selectedRow: undefined, // don't send this extra field
        affectedCount: Number(data.affectedCount),
        // Weighing: individual per-bird weights (grams) are the source of
        // truth — sampleCount/totalWeightG are derived from them here so
        // the backend never has to guess which is authoritative. Sent only
        // for WEIGHING events; harmless/ignored otherwise.
        sampleCount: data.eventType === 'WEIGHING' ? filledWeights.length : undefined,
        totalWeightG: data.eventType === 'WEIGHING' ? totalWeightG : undefined,
        individualWeightsG: data.eventType === 'WEIGHING' ? filledWeights : undefined,
      }).then(r => r.data);
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['health-events'] });
      qc.invalidateQueries({ queryKey: ['batches'] });
      // FIX: the PM Batches page reads bird counts via useBatches(), which is
      // keyed ['flock', 'batches', filters] — a different cache entry from the
      // raw ['batches'] key used by the Brooder pages. Without this, logging a
      // mortality/culling event here would update the backend but the Batches
      // page would keep showing the stale count until a hard refresh.
      qc.invalidateQueries({ queryKey: ['flock', 'batches'] });
      qc.invalidateQueries({ queryKey: ['cage-map'] });
      qc.invalidateQueries({ queryKey: ['cage-assignments'] });

      // FIX (brooder): When BATCH_SOLD or BATCH_DISCARDED is logged for a batch
      // that was in BROODING, the backend deletes its BrooderLevelAssignment rows
      // and marks the batch inactive — but the frontend React Query cache for the
      // brooder cage map and feed summary was never invalidated here, so the
      // brooder UI kept showing occupied levels and non-zero required/given feed
      // until a hard refresh. These three keys match the hooks used by
      // BrooderCageMapGrid, BrooderFeedSummary, and BrooderFeedRequirement.
      if (variables.eventType === 'BATCH_SOLD' || variables.eventType === 'BATCH_DISCARDED') {
        qc.invalidateQueries({ queryKey: ['brooder-cage-map'] });
        qc.invalidateQueries({ queryKey: ['brooder-feed-summary'] });
        qc.invalidateQueries({ queryKey: ['brooder-rows-and-levels'] });
      }

      setSubmitted(true);
      reset();
      setIndividualWeights([]);
      setAutofillNote(null);
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
        <div className="flex items-center gap-2">
          {role === 'MANAGER' && (
            <button
              onClick={() => setShowUploadModal(true)}
              className="flex items-center gap-2 border border-gray-200 dark:border-dark-border text-gray-700 dark:text-gray-200 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-gray-50 dark:hover:bg-dark-bg transition-colors"
            >
              <Upload className="w-4 h-4" /> Upload Bird Weight Report
            </button>
          )}
          <button
            onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-2 bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-brand-green/90 transition-colors"
          >
            <Plus className="w-4 h-4" /> Log Event
          </button>
        </div>
      </div>

      {showUploadModal && <BirdWeightReportUploadModal onClose={() => setShowUploadModal(false)} />}

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
                  <option key={b.id} value={b.id}>
                    {b.batchCode} — {b.location === 'BROODER' ? 'Brooder' : b.location === 'PRODUCTION_HOUSE' ? 'Production House' : b.house?.name ?? ''}
                  </option>
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

          {/* Row selector for CULLING / BIRD_MORTALITY in production house */}
          {supportsRowSelect && (() => {
            // Use live cage assignments if available, fall back to hardcoded rows
            const rows: string[] = (cageAssignments as any[]).length
              ? (cageAssignments as any[]).map((a: any) => a.rowCode ?? a.row?.rowCode).filter(Boolean)
              : ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

            const label = selectedType === 'BIRD_MORTALITY'
              ? 'Row where mortality occurred'
              : 'Unit / Row (Production House)';
            const placeholder = selectedType === 'BIRD_MORTALITY'
              ? 'Select row where mortality occurred…'
              : 'Select row where culling occurred…';
            const hint = selectedType === 'BIRD_MORTALITY'
              ? 'Bird count will be subtracted from this row and the batch total will be recalculated.'
              : 'Bird count will be subtracted from this row in the cage map.';
            const color = selectedType === 'BIRD_MORTALITY'
              ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/40'
              : 'bg-brand-green/5 dark:bg-brand-green/10 border-brand-green/30';

            return (
              <div className={`${color} border rounded-xl p-3`}>
                <label className={lCls}>{label}</label>
                <select className={iCls} {...register('selectedRow', { required: supportsRowSelect })}>
                  <option value="">{placeholder}</option>
                  {rows.map(row => (
                    <option key={row} value={row}>Row {row}</option>
                  ))}
                </select>
                {errors.selectedRow && <p className="text-xs text-red-500 mt-1">Please select a row</p>}
                <p className="text-[10px] text-gray-400 mt-1">{hint}</p>
              </div>
            );
          })()}

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
            <div className="bg-gray-50 dark:bg-dark-bg border border-gray-100 dark:border-dark-border rounded-xl p-3 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                  Individual bird weights (g) — one box per bird sampled
                </p>
                <button
                  type="button"
                  onClick={() => autofill.mutate()}
                  disabled={!selectedBatchId || !eventDate || autofill.isPending}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-green hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Wand2 className="w-3.5 h-3.5" /> {autofill.isPending ? 'Checking…' : 'Autofill from report'}
                </button>
              </div>

              {autofillNote && (
                <p className="text-[11px] text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/10 rounded-lg px-2.5 py-1.5">{autofillNote}</p>
              )}

              {individualWeights.length === 0 ? (
                <p className="text-xs text-gray-400">Set "Birds Sampled" above (or use Autofill) to enter individual weights.</p>
              ) : (
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                  {individualWeights.map((w, i) => (
                    <div key={i}>
                      <label className="block text-[10px] text-gray-400 mb-0.5">Bird {i + 1}</label>
                      <input
                        type="number" min={1} step="1" placeholder="g"
                        value={w}
                        onChange={e => {
                          const val = e.target.value === '' ? '' : Number(e.target.value);
                          setIndividualWeights(prev => prev.map((p, idx) => (idx === i ? val : p)));
                        }}
                        className="w-full border border-gray-200 dark:border-dark-border rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-dark-card text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green"
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="bg-white dark:bg-dark-card rounded-lg px-3 py-2 border border-gray-100 dark:border-dark-border">
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide">Total Weight (auto)</p>
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{totalWeightG > 0 ? `${totalWeightG} g` : '—'}</p>
                </div>
                <div className="bg-white dark:bg-dark-card rounded-lg px-3 py-2 border border-gray-100 dark:border-dark-border">
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide">Avg Weight / Bird (auto)</p>
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{avgWeight ? `${avgWeight} g` : '—'}</p>
                </div>
              </div>
              <p className="text-[10px] text-gray-400">
                Compared automatically against the HyLine standard band for this batch's age — the Director is
                notified if the average falls outside it.
              </p>
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
            <button type="button" onClick={() => { setShowForm(false); reset(); setIndividualWeights([]); setAutofillNote(null); }}
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
        ) : logsError ? (
          <div className="p-8 text-center space-y-2">
            <p className="text-sm text-red-600 font-medium">Couldn't load event history — connection or server problem.</p>
            <button onClick={() => refetchLogs()} className="text-xs font-semibold text-brand-green hover:underline">Retry</button>
          </div>
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
