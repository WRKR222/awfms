// src/pages/store/FeedLabTestsPage.tsx
//
// Store enters each feed's laboratory nutrient analysis. A result applies to
// that feed from its "effective from" date until a newer test replaces it.
// The breed-standards checks use it to work out each batch's nutrient intake
// and compare it with the breed guide. A lab report PDF/photo can be read by
// AI to fill the form — Store checks the figures before saving.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, UploadCloud, Pencil, Trash2, AlertTriangle, CheckCircle } from 'lucide-react';
import { api } from '../../lib/api/client';
import { useAuthStore } from '../../stores/auth.store';
import dayjs from '../../lib/dayjs';

const cardCls = 'bg-white dark:bg-dark-card rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-dark-border';
const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100';
const lCls = 'block text-[11px] font-semibold text-gray-500 mb-1';
const errMsg = (e: any) => e?.response?.data?.message ?? e?.message ?? 'Something went wrong';

interface Nutrient { key: string; label: string; unit: string; compared: boolean }
interface FeedItem { id: string; name: string; feedFamily: string | null; latestTest: { effectiveFrom: string } | null }

const emptyForm = () => ({
  id: null as string | null,
  storeItemId: '', labName: '', sampleRef: '',
  sampleDate: dayjs().format('YYYY-MM-DD'), resultDate: '', effectiveFrom: '',
  basis: 'AS_FED' as 'AS_FED' | 'DRY_MATTER', energyUnit: 'KCAL' as 'KCAL' | 'MJ',
  values: {} as Record<string, string>, notes: '', reportFileName: '', aiInterpretation: '',
});

export function FeedLabTestsPage() {
  const qc = useQueryClient();
  const canEdit = ['STORE', 'OWNER'].includes(useAuthStore(s => s.user?.role) ?? '');
  const { data: nutrients = [] } = useQuery<Nutrient[]>({ queryKey: ['feed-lab', 'nutrients'], queryFn: () => api.get('/feed-lab-tests/nutrients').then(r => r.data), staleTime: 3_600_000 });
  const { data: items = [] } = useQuery<FeedItem[]>({ queryKey: ['feed-lab', 'items'], queryFn: () => api.get('/feed-lab-tests/feed-items').then(r => r.data) });
  const [filter, setFilter] = useState('');
  const { data: tests = [] } = useQuery<any[]>({
    queryKey: ['feed-lab', 'tests', filter],
    queryFn: () => api.get('/feed-lab-tests', { params: filter ? { storeItemId: filter } : {} }).then(r => r.data),
  });
  const [form, setForm] = useState(emptyForm);
  const [readError, setReadError] = useState<string | null>(null);
  useEffect(() => { if (!form.storeItemId && items.length) setForm(f => ({ ...f, storeItemId: items[0].id })); }, [items, form.storeItemId]);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['feed-lab'] });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        storeItemId: form.storeItemId, labName: form.labName, sampleRef: form.sampleRef,
        sampleDate: form.sampleDate, resultDate: form.resultDate || null, effectiveFrom: form.effectiveFrom || null,
        basis: form.basis, energyUnit: form.energyUnit, notes: form.notes,
        reportFileName: form.reportFileName || null, aiInterpretation: form.aiInterpretation || null,
        values: Object.fromEntries(Object.entries(form.values).filter(([, v]) => v !== '')),
      };
      return form.id ? api.patch(`/feed-lab-tests/${form.id}`, body) : api.post('/feed-lab-tests', body);
    },
    onSuccess: () => { setForm(f => ({ ...emptyForm(), storeItemId: f.storeItemId })); invalidate(); },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/feed-lab-tests/${id}`), onSuccess: invalidate });
  const read = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData(); fd.append('file', file);
      return api.post('/feed-lab-tests/read', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180_000 }).then(r => r.data);
    },
    onSuccess: (r: any) => {
      setReadError(null);
      setForm(f => ({
        ...f,
        labName: r.labName ?? f.labName, sampleRef: r.sampleRef ?? f.sampleRef, sampleDate: r.sampleDate ?? f.sampleDate,
        basis: r.basis, energyUnit: r.energyUnit, reportFileName: r.reportFileName, aiInterpretation: r.interpretation,
        values: { ...f.values, ...Object.fromEntries(Object.entries(r.values).map(([k, v]) => [k, String(v)])) },
      }));
    },
    onError: (e: any) => setReadError(errMsg(e)),
  });

  const edit = (t: any) => setForm({
    ...emptyForm(), id: t.id, storeItemId: t.storeItemId, labName: t.labName ?? '', sampleRef: t.sampleRef ?? '',
    sampleDate: dayjs(t.sampleDate).format('YYYY-MM-DD'), resultDate: t.resultDate ? dayjs(t.resultDate).format('YYYY-MM-DD') : '',
    effectiveFrom: dayjs(t.effectiveFrom).format('YYYY-MM-DD'), notes: t.notes ?? '',
    values: Object.fromEntries(Object.entries(t.values ?? {}).map(([k, v]) => [k, String(v)])),
  });

  const compared = nutrients.filter(n => n.compared);
  const recordOnly = nutrients.filter(n => !n.compared);
  const untested = items.filter(i => !i.latestTest);
  const label = useMemo(() => new Map(nutrients.map(n => [n.key, n])), [nutrients]);

  const field = (n: Nutrient) => (
    <div key={n.key}>
      <label className={lCls}>{n.label} <span className="font-normal text-gray-400">({n.key === 'ENERGY' ? (form.energyUnit === 'MJ' ? 'MJ/kg' : 'kcal/kg') : n.unit})</span></label>
      <input type="number" step="any" min="0" value={form.values[n.key] ?? ''} disabled={!canEdit}
        onChange={e => setForm(f => ({ ...f, values: { ...f.values, [n.key]: e.target.value } }))} className={iCls} />
    </div>
  );

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-6xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-brand-green" /> Feed Lab Tests
        </h1>
        <p className="text-xs text-gray-400 mt-0.5">Enter each feed’s laboratory analysis. The system uses it to check every batch’s nutrient intake against its breed guide.</p>
      </div>

      {untested.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl p-3 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span><strong>No lab test yet:</strong> {untested.map(i => i.name).join(', ')}. Nutrient checks are skipped for days birds eat these feeds.</span>
        </div>
      )}

      {canEdit && (
        <div className={cardCls}>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{form.id ? 'Edit lab test' : 'New lab test'}</p>
            <label className="flex items-center gap-2 text-xs bg-gray-100 dark:bg-dark-bg rounded-xl px-3 py-2 cursor-pointer w-fit">
              <UploadCloud className="w-4 h-4 text-brand-green" /> {read.isPending ? 'Reading report…' : 'Fill from lab report (PDF/photo)'}
              <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" className="hidden" disabled={read.isPending}
                onChange={e => { const f = e.target.files?.[0]; if (f) read.mutate(f); e.target.value = ''; }} />
            </label>
          </div>
          {readError && <p className="text-xs text-red-500 mb-2">{readError}</p>}
          {form.aiInterpretation && (
            <p className="text-xs text-blue-600 dark:text-blue-400 mb-3 italic">Read from {form.reportFileName}: {form.aiInterpretation} Check every figure before saving.</p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className={lCls}>Feed tested *</label>
              <select value={form.storeItemId} onChange={e => setForm({ ...form, storeItemId: e.target.value })} className={iCls}>
                {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
            <div><label className={lCls}>Laboratory</label><input value={form.labName} onChange={e => setForm({ ...form, labName: e.target.value })} className={iCls} placeholder="e.g. KALRO" /></div>
            <div><label className={lCls}>Sample / report number</label><input value={form.sampleRef} onChange={e => setForm({ ...form, sampleRef: e.target.value })} className={iCls} /></div>
            <div><label className={lCls}>Sample taken *</label><input type="date" value={form.sampleDate} onChange={e => setForm({ ...form, sampleDate: e.target.value })} className={iCls} /></div>
            <div><label className={lCls}>Results received</label><input type="date" value={form.resultDate} onChange={e => setForm({ ...form, resultDate: e.target.value })} className={iCls} /></div>
            <div><label className={lCls}>Applies from (default: sample date)</label><input type="date" value={form.effectiveFrom} onChange={e => setForm({ ...form, effectiveFrom: e.target.value })} className={iCls} /></div>
            <div>
              <label className={lCls}>Results are on</label>
              <select value={form.basis} onChange={e => setForm({ ...form, basis: e.target.value as any })} className={iCls}>
                <option value="AS_FED">As fed (as received)</option>
                <option value="DRY_MATTER">Dry matter basis — enter moisture too</option>
              </select>
            </div>
            <div>
              <label className={lCls}>Energy unit</label>
              <select value={form.energyUnit} onChange={e => setForm({ ...form, energyUnit: e.target.value as any })} className={iCls}>
                <option value="KCAL">kcal/kg</option>
                <option value="MJ">MJ/kg</option>
              </select>
            </div>
          </div>

          <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 mt-4 mb-2">Compared with the breed guide <span className="font-normal text-gray-400">— amino acids as TOTAL (what labs report); enter what the report has, leave the rest blank</span></p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{compared.map(field)}</div>
          <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 mt-4 mb-2">Recorded only</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{recordOnly.map(field)}</div>
          <div className="mt-3"><label className={lCls}>Notes</label><input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className={iCls} /></div>
          {save.error && <p className="text-xs text-red-500 mt-2">{errMsg(save.error)}</p>}
          <div className="flex gap-2 mt-3">
            <button onClick={() => save.mutate()} disabled={!form.storeItemId || save.isPending}
              className="flex-1 bg-brand-green text-white rounded-xl py-2.5 text-sm font-bold disabled:opacity-50">{save.isPending ? 'Saving…' : form.id ? 'Save changes' : 'Save lab test'}</button>
            {form.id && <button onClick={() => setForm(f => ({ ...emptyForm(), storeItemId: f.storeItemId }))} className="bg-gray-100 dark:bg-dark-bg rounded-xl px-4 text-sm">Cancel</button>}
          </div>
          {save.isSuccess && <p className="text-xs text-green-600 mt-2 flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> Saved. Batches are being re-checked against their breed guide.</p>}
        </div>
      )}

      <div className={cardCls}>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Lab tests on file</p>
          <select value={filter} onChange={e => setFilter(e.target.value)} className={`${iCls} md:w-64`}>
            <option value="">All feeds</option>
            {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
        {tests.length === 0 ? <p className="text-sm text-gray-400 italic">No lab tests yet.</p> : (
          <div className="space-y-2">
            {tests.map(t => (
              <div key={t.id} className="border border-gray-100 dark:border-dark-border rounded-xl p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t.storeItem?.name}</p>
                    <p className="text-[11px] text-gray-500">
                      Sample {dayjs(t.sampleDate).format('D MMM YYYY')}{t.labName ? ` · ${t.labName}` : ''}{t.sampleRef ? ` · ${t.sampleRef}` : ''}
                      {' · '}applies from {dayjs(t.effectiveFrom).format('D MMM YYYY')}{t.reportedBasis === 'DRY_MATTER' ? ' · converted from dry matter' : ''}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex gap-1">
                      <button onClick={() => edit(t)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-dark-bg" title="Edit"><Pencil className="w-4 h-4 text-gray-500" /></button>
                      <button onClick={() => { if (confirm('Remove this lab test?')) remove.mutate(t.id); }} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-dark-bg" title="Remove"><Trash2 className="w-4 h-4 text-red-500" /></button>
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-gray-600 dark:text-gray-300 mt-1.5">
                  {Object.entries(t.values ?? {}).map(([k, v]) => {
                    const n = label.get(k);
                    const num = Number(v);
                    return `${n?.label ?? k} ${k === 'ENERGY' ? Math.round(num).toLocaleString() : Math.round(num * 1000) / 1000}${n?.unit === '%' ? '%' : ` ${n?.unit ?? ''}`}`;
                  }).join(' · ')}
                </p>
                {t.notes && <p className="text-[11px] text-gray-400 mt-0.5">{t.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
