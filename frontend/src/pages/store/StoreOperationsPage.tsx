// src/pages/store/StoreOperationsPage.tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api } from '../../lib/api/client';
import { Plus, Trash2, Pill, Wrench, Stethoscope, Users, ChevronDown } from 'lucide-react';
import dayjs from 'dayjs';

// ── shared helpers ──────────────────────────────────────────────────────────

function fmt(kes: number) {
  return `KES ${Number(kes).toLocaleString()}`;
}

function useHouses() {
  return useQuery({
    queryKey: ['houses'],
    queryFn: async () => {
      const res = await api.get('/flock/houses');
      return res.data as Array<{ id: string; name: string; code: string }>;
    },
    staleTime: 5 * 60_000,
  });
}

function useBatches() {
  return useQuery({
    queryKey: ['batches-active'],
    queryFn: async () => {
      const res = await api.get('/flock/batches?isActive=true');
      return res.data as Array<{ id: string; batchCode: string; houseId: string }>;
    },
    staleTime: 5 * 60_000,
  });
}

// ── Tab: Medication ──────────────────────────────────────────────────────────

function MedicationTab() {
  const qc = useQueryClient();
  const { data: batches = [] } = useBatches();
  const { register, handleSubmit, reset } = useForm<any>();
  const [showForm, setShowForm] = useState(false);

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['store-medication'],
    queryFn: async () => {
      const res = await api.get('/store/operations/medication-logs');
      return res.data as any[];
    },
  });

  const create = useMutation({
    mutationFn: (data: any) => api.post('/store/operations/medication-logs', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['store-medication'] }); reset(); setShowForm(false); },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/store/operations/medication-logs/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['store-medication'] }),
  });

  const onSubmit = (data: any) => create.mutate({ ...data, costKes: Number(data.costKes) });

  return (
    <div className="space-y-4">
      <button
        onClick={() => setShowForm(v => !v)}
        className="flex items-center gap-2 bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold"
      >
        <Plus className="w-4 h-4" /> Log Medication
      </button>

      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Batch</label>
              <select {...register('batchId', { required: true })} className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2">
                <option value="">Select batch</option>
                {batches.map(b => <option key={b.id} value={b.id}>{b.batchCode}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Block ID</label>
              <input {...register('houseId', { required: true })} placeholder="e.g. BLOCK1" className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Date</label>
              <input type="date" {...register('logDate', { required: true })} defaultValue={dayjs().format('YYYY-MM-DD')} className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Medication Name</label>
              <input {...register('medicationName', { required: true })} placeholder="e.g. Tylosin" className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Dosage</label>
              <input {...register('dosage')} placeholder="e.g. 1g/L water" className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Qty / Units</label>
              <input {...register('quantityUnits')} placeholder="e.g. 500ml" className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Cost (KES)</label>
              <input type="number" step="0.01" {...register('costKes', { required: true, min: 0 })} defaultValue={0} className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Notes</label>
              <input {...register('notes')} placeholder="Optional" className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2" />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={create.isPending} className="bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50">
              {create.isPending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl text-sm text-gray-500 border border-gray-200 dark:border-dark-border">Cancel</button>
          </div>
        </form>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-400 py-4 text-center">Loading…</p>
      ) : logs.length === 0 ? (
        <p className="text-sm text-gray-400 py-4 text-center">No medication logs yet</p>
      ) : (
        <div className="space-y-2">
          {logs.map((log: any) => (
            <div key={log.id} className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border flex items-center gap-3">
              <Pill className="w-5 h-5 text-purple-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{log.medicationName}</p>
                <p className="text-xs text-gray-400">{log.batch?.batchCode} · {dayjs(log.logDate).format('D MMM')} {log.dosage ? `· ${log.dosage}` : ''}</p>
              </div>
              <p className="text-sm font-bold text-gray-700 dark:text-gray-300 flex-shrink-0">{fmt(log.costKes)}</p>
              <button onClick={() => remove.mutate(log.id)} className="text-red-400 hover:text-red-600 flex-shrink-0">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tab: Equipment ────────────────────────────────────────────────────────────

function EquipmentTab() {
  const qc = useQueryClient();
  const { register, handleSubmit, reset } = useForm<any>();
  const [showForm, setShowForm] = useState(false);

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['store-equipment'],
    queryFn: async () => {
      const res = await api.get('/store/operations/equipment-logs');
      return res.data as any[];
    },
  });

  const create = useMutation({
    mutationFn: (data: any) => api.post('/store/operations/equipment-logs', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['store-equipment'] }); reset(); setShowForm(false); },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/store/operations/equipment-logs/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['store-equipment'] }),
  });

  const eventTypeColors: Record<string, string> = {
    PURCHASE:    'bg-green-100 text-green-700',
    REPAIR:      'bg-amber-100 text-amber-700',
    MAINTENANCE: 'bg-blue-100 text-blue-700',
  };

  return (
    <div className="space-y-4">
      <button onClick={() => setShowForm(v => !v)} className="flex items-center gap-2 bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold">
        <Plus className="w-4 h-4" /> Log Equipment
      </button>

      {showForm && (
        <form onSubmit={handleSubmit(d => create.mutate({ ...d, costKes: Number(d.costKes) }))} className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Date</label>
              <input type="date" {...register('logDate', { required: true })} defaultValue={dayjs().format('YYYY-MM-DD')} className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Event Type</label>
              <select {...register('eventType', { required: true })} className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2">
                <option value="PURCHASE">Purchase</option>
                <option value="REPAIR">Repair</option>
                <option value="MAINTENANCE">Maintenance</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Equipment Name</label>
              <input {...register('equipmentName', { required: true })} placeholder="e.g. Feed trough" className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Vendor</label>
              <input {...register('vendorName')} placeholder="Optional" className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Cost (KES)</label>
              <input type="number" step="0.01" {...register('costKes', { required: true })} defaultValue={0} className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Description / Notes</label>
              <input {...register('description')} placeholder="Optional" className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2" />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={create.isPending} className="bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50">{create.isPending ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl text-sm text-gray-500 border border-gray-200 dark:border-dark-border">Cancel</button>
          </div>
        </form>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-400 py-4 text-center">Loading…</p>
      ) : logs.length === 0 ? (
        <p className="text-sm text-gray-400 py-4 text-center">No equipment logs yet</p>
      ) : (
        <div className="space-y-2">
          {logs.map((log: any) => (
            <div key={log.id} className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border flex items-center gap-3">
              <Wrench className="w-5 h-5 text-amber-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{log.equipmentName}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${eventTypeColors[log.eventType] ?? 'bg-gray-100 text-gray-600'}`}>{log.eventType}</span>
                </div>
                <p className="text-xs text-gray-400">{dayjs(log.logDate).format('D MMM YYYY')} {log.vendorName ? `· ${log.vendorName}` : ''}</p>
              </div>
              <p className="text-sm font-bold text-gray-700 dark:text-gray-300 flex-shrink-0">{fmt(log.costKes)}</p>
              <button onClick={() => remove.mutate(log.id)} className="text-red-400 hover:text-red-600 flex-shrink-0"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tab: Vet Visits ───────────────────────────────────────────────────────────

function VetVisitsTab() {
  const qc = useQueryClient();
  const { register, handleSubmit, reset } = useForm<any>();
  const [showForm, setShowForm] = useState(false);

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['store-vet-visits'],
    queryFn: async () => {
      const res = await api.get('/store/operations/vet-visits');
      return res.data as any[];
    },
  });

  const create = useMutation({
    mutationFn: (data: any) => api.post('/store/operations/vet-visits', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['store-vet-visits'] }); reset(); setShowForm(false); },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/store/operations/vet-visits/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['store-vet-visits'] }),
  });

  return (
    <div className="space-y-4">
      <button onClick={() => setShowForm(v => !v)} className="flex items-center gap-2 bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold">
        <Plus className="w-4 h-4" /> Log Vet Visit
      </button>

      {showForm && (
        <form onSubmit={handleSubmit(d => create.mutate({ ...d, costKes: Number(d.costKes) }))} className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Visit Date</label>
              <input type="date" {...register('visitDate', { required: true })} defaultValue={dayjs().format('YYYY-MM-DD')} className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Vet Name</label>
              <input {...register('vetName', { required: true })} placeholder="Dr. Name" className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-500 mb-1 block">Purpose</label>
              <input {...register('purpose', { required: true })} placeholder="e.g. Routine health check" className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Cost (KES)</label>
              <input type="number" step="0.01" {...register('costKes', { required: true })} defaultValue={0} className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Findings</label>
              <input {...register('findings')} placeholder="Optional" className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-500 mb-1 block">Notes</label>
              <input {...register('notes')} placeholder="Optional" className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2" />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={create.isPending} className="bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50">{create.isPending ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl text-sm text-gray-500 border border-gray-200 dark:border-dark-border">Cancel</button>
          </div>
        </form>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-400 py-4 text-center">Loading…</p>
      ) : logs.length === 0 ? (
        <p className="text-sm text-gray-400 py-4 text-center">No vet visit logs yet</p>
      ) : (
        <div className="space-y-2">
          {logs.map((log: any) => (
            <div key={log.id} className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border flex items-center gap-3">
              <Stethoscope className="w-5 h-5 text-teal-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{log.vetName}</p>
                <p className="text-xs text-gray-400">{dayjs(log.visitDate).format('D MMM YYYY')} · {log.purpose}</p>
                {log.findings && <p className="text-xs text-gray-500 mt-0.5 truncate">{log.findings}</p>}
              </div>
              <p className="text-sm font-bold text-gray-700 dark:text-gray-300 flex-shrink-0">{fmt(log.costKes)}</p>
              <button onClick={() => remove.mutate(log.id)} className="text-red-400 hover:text-red-600 flex-shrink-0"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tab: Workers ──────────────────────────────────────────────────────────────

function WorkersTab() {
  const qc = useQueryClient();
  const { data: houses = [] } = useHouses();
  const { register, handleSubmit, reset } = useForm<any>();
  const [showForm, setShowForm] = useState(false);

  const { data: assignments = [], isLoading } = useQuery({
    queryKey: ['store-workers'],
    queryFn: async () => {
      const res = await api.get('/store/operations/worker-assignments');
      return res.data as any[];
    },
  });

  const create = useMutation({
    mutationFn: (data: any) => api.post('/store/operations/worker-assignments', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['store-workers'] }); reset(); setShowForm(false); },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/store/operations/worker-assignments/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['store-workers'] }),
  });

  // Group by week
  const grouped: Record<string, any[]> = {};
  for (const a of assignments) {
    const wk = dayjs(a.weekStartDate).format('D MMM YYYY');
    if (!grouped[wk]) grouped[wk] = [];
    grouped[wk].push(a);
  }

  return (
    <div className="space-y-4">
      <button onClick={() => setShowForm(v => !v)} className="flex items-center gap-2 bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold">
        <Plus className="w-4 h-4" /> Add Worker
      </button>

      {showForm && (
        <form onSubmit={handleSubmit(d => create.mutate({ ...d, salaryKes: Number(d.salaryKes) }))} className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Week Start (Monday)</label>
              <input type="date" {...register('weekStartDate', { required: true })} defaultValue={dayjs().startOf('week').add(1,'day').format('YYYY-MM-DD')} className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Worker Name</label>
              <input {...register('workerName', { required: true })} placeholder="Full name" className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Block</label>
              <select {...register('houseId', { required: true })} className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2">
                <option value="">Select block</option>
                {houses.map(h => <option key={h.id} value={h.id}>{h.name} ({h.code})</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Role / Title</label>
              <input {...register('roleTitle')} placeholder="e.g. Attendant" className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Weekly Salary (KES)</label>
              <input type="number" step="0.01" {...register('salaryKes', { required: true })} defaultValue={0} className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Notes</label>
              <input {...register('notes')} placeholder="Optional" className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2" />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={create.isPending} className="bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50">{create.isPending ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl text-sm text-gray-500 border border-gray-200 dark:border-dark-border">Cancel</button>
          </div>
        </form>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-400 py-4 text-center">Loading…</p>
      ) : assignments.length === 0 ? (
        <p className="text-sm text-gray-400 py-4 text-center">No worker assignments yet</p>
      ) : (
        Object.entries(grouped).map(([week, workers]) => (
          <div key={week}>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Week of {week}</p>
            <div className="space-y-2">
              {workers.map((w: any) => (
                <div key={w.id} className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border flex items-center gap-3">
                  <Users className="w-5 h-5 text-brand-green flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{w.workerName}</p>
                    <p className="text-xs text-gray-400">{w.house?.name ?? '—'} {w.roleTitle ? `· ${w.roleTitle}` : ''}</p>
                  </div>
                  <p className="text-sm font-bold text-gray-700 dark:text-gray-300 flex-shrink-0">{fmt(w.salaryKes)}</p>
                  <button onClick={() => remove.mutate(w.id)} className="text-red-400 hover:text-red-600 flex-shrink-0"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
              <div className="text-right text-xs text-gray-500 pr-8">
                Week total: {fmt(workers.reduce((s: number, w: any) => s + Number(w.salaryKes), 0))}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'medication', label: 'Medication', Icon: Pill },
  { id: 'equipment',  label: 'Equipment',  Icon: Wrench },
  { id: 'vet-visits', label: 'Vet Visits', Icon: Stethoscope },
  { id: 'workers',    label: 'Workers',    Icon: Users },
] as const;

type TabId = typeof TABS[number]['id'];

export default function StoreOperationsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('medication');

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-4xl mx-auto">
      <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">Store Operations</h1>

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-2xl p-1 overflow-x-auto">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 flex-1 justify-center px-3 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
              activeTab === id
                ? 'bg-white dark:bg-dark-card text-brand-green shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'medication' && <MedicationTab />}
      {activeTab === 'equipment'  && <EquipmentTab />}
      {activeTab === 'vet-visits' && <VetVisitsTab />}
      {activeTab === 'workers'    && <WorkersTab />}
    </div>
  );
}
