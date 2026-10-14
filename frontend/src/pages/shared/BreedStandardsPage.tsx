// src/pages/shared/BreedStandardsPage.tsx
//
// Breed guide benchmarking (Manager + Director):
//   • Batch      — one batch against its breed guide edition: what is off
//                  standard and why it matters, practices outside the guide,
//                  what is not recorded, this week's guide reference, and
//                  lessons from earlier batches of the same breed.
//   • Compare    — same-breed batches side by side, week by week.
//   • Guides     — breeds and guide editions (upload a new edition; the
//                  Director activates it and the old one is archived).
//   • Farm standards — where the farm's own results beat the guide.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, AlertTriangle, CheckCircle, RefreshCw, Plus, UploadCloud, Download, Award, History } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api/client';
import { useAuthStore } from '../../stores/auth.store';
import dayjs from '../../lib/dayjs';
import { BreedSetup, breedSetupPayload } from '../../components/shared/BreedRecordingPlan';

const cardCls = 'bg-white dark:bg-dark-card rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-dark-border';
const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100';
const hCls = 'text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-2';
const errMsg = (e: any) => e?.response?.data?.message ?? e?.message ?? 'Something went wrong';

type Tab = 'overview' | 'batch' | 'compare' | 'guides' | 'farm' | 'decisions';

const fmt = (v: number | null | undefined) => v == null ? '—' : Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : String(Math.round(v * 100) / 100);
const band = (r: { min?: number | null; max?: number | null; target?: number | null }) =>
  r.min != null && r.max != null ? `${fmt(r.min)}–${fmt(r.max)}` : r.min != null ? `≥ ${fmt(r.min)}` : r.max != null ? `≤ ${fmt(r.max)}` : fmt(r.target);
const period = (unit: string, idx: number) => unit === 'WEEK' ? `wk ${idx}` : unit === 'DAY' ? `day ${idx}+` : 'milestone';
const statusCls = (s: string) =>
  s === 'IN_BAND' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
    : s === 'BELOW' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
const statusLabel = (s: string) => s === 'IN_BAND' ? 'on standard' : s.toLowerCase();

export function BreedStandardsPage() {
  const role = useAuthStore(s => s.user?.role);
  const isOwner = role === 'OWNER';
  // The Director sees what is off, what it means and what needs a decision;
  // the Production Manager keeps the working tabs (practices, recording plans,
  // guide uploads, farm-standard proposals).
  const [tab, setTab] = useState<Tab>(isOwner ? 'overview' : 'batch');
  const [batchId, setBatchId] = useState('');
  const { data: overview } = useQuery<any>({
    queryKey: ['breed-standards', 'overview'],
    queryFn: () => api.get('/breed-standards/overview').then(r => r.data),
    enabled: isOwner,
  });
  const pending = overview
    ? overview.decisions.draftGuides.length + overview.decisions.farmStandards.filter((f: any) => f.status === 'PROPOSED').length
    : 0;
  const tabs: [Tab, string][] = isOwner
    ? [['overview', 'Overview'], ['batch', 'Batch detail'], ['compare', 'Compare batches'], ['decisions', `Decisions${pending ? ` (${pending})` : ''}`]]
    : [['batch', 'Batch'], ['compare', 'Compare batches'], ['guides', 'Guides'], ['farm', 'Farm standards']];

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-6xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-brand-green" /> Breed Standards
        </h1>
        <p className="text-xs text-gray-400 mt-0.5">Every batch checked against its breed guide — and against the farm’s own best results.</p>
      </div>
      <div className="flex gap-2 overflow-x-auto">
        {tabs.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded-xl text-sm font-semibold whitespace-nowrap ${tab === k ? 'bg-brand-green text-white' : 'bg-gray-100 dark:bg-dark-bg text-gray-600 dark:text-gray-300'}`}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'overview' && <OverviewTab data={overview} onOpen={id => { setBatchId(id); setTab('batch'); }} />}
      {tab === 'batch' && <BatchTab readOnly={isOwner} batchId={batchId} setBatchId={setBatchId} />}
      {tab === 'compare' && <CompareTab />}
      {tab === 'guides' && <GuidesTab />}
      {tab === 'farm' && <FarmTab />}
      {tab === 'decisions' && <DecisionsTab data={overview} />}
    </div>
  );
}

// ── Batch ─────────────────────────────────────────────────────────────────

function useBatches() {
  return useQuery<any[]>({ queryKey: ['flock', 'batches', 'all-active'], queryFn: () => api.get('/flock/batches?isActive=true').then(r => r.data) });
}
function useCatalog() {
  return useQuery<any[]>({ queryKey: ['breed-catalog'], queryFn: () => api.get('/breed-standards/catalog').then(r => r.data), staleTime: 3_600_000 });
}

function BatchTab({ readOnly, batchId, setBatchId }: { readOnly: boolean; batchId: string; setBatchId: (id: string) => void }) {
  const qc = useQueryClient();
  const { data: batches = [] } = useBatches();
  useEffect(() => { if (!batchId && batches.length) setBatchId(batches[0].id); }, [batches, batchId, setBatchId]);
  const { data, isLoading, error } = useQuery<any>({
    queryKey: ['breed-standards', 'batch', batchId],
    queryFn: () => api.get(`/breed-standards/batches/${batchId}`).then(r => r.data),
    enabled: !!batchId,
  });
  const evaluate = useMutation({
    mutationFn: () => api.post(`/breed-standards/batches/${batchId}/evaluate`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['breed-standards', 'batch', batchId] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-2">
        <select value={batchId} onChange={e => setBatchId(e.target.value)} className={iCls}>
          {batches.map(b => <option key={b.id} value={b.id}>{b.batchCode} — {b.strain}</option>)}
        </select>
        {!readOnly && (
          <button onClick={() => evaluate.mutate()} disabled={!batchId || evaluate.isPending}
            className="flex items-center justify-center gap-2 bg-brand-green text-white rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-50 whitespace-nowrap">
            <RefreshCw className={`w-4 h-4 ${evaluate.isPending ? 'animate-spin' : ''}`} /> Re-check now
          </button>
        )}
      </div>
      {evaluate.data?.skipped && <p className="text-xs text-amber-600">{evaluate.data.skipped}</p>}
      {isLoading ? <p className="text-sm text-gray-400">Loading…</p>
        : error ? <p className="text-sm text-red-500">{errMsg(error)}</p>
        : !data ? null
        : !data.guide ? <NoGuide data={data} />
        : <BatchDetail data={data} readOnly={readOnly} />}
    </div>
  );
}

function NoGuide({ data }: { data: any }) {
  return (
    <div className={cardCls}>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        {data.batchCode} has no breed guide{data.breed ? ` (breed: ${data.breed.name})` : ''}. Add the breed’s guide on the Guides tab, or add the batch’s
        breed name as an alias of an existing breed, and it will be benchmarked automatically.
      </p>
    </div>
  );
}

function BatchDetail({ data, readOnly }: { data: any; readOnly: boolean }) {
  const role = useAuthStore(st => st.user?.role);
  const labLink = role === 'OWNER' ? '/owner/feed-lab-tests' : '/manager/feed-lab-tests';
  return (
    <div className="space-y-4">
      <div className={`${cardCls} flex flex-col md:flex-row md:items-center md:justify-between gap-2`}>
        <div>
          <p className="text-sm font-bold text-gray-800 dark:text-gray-100">
            {data.breed?.name}{data.breed?.variety ? ` (${data.breed.variety})` : ''} · week {data.ageWeeks}
          </p>
          <p className="text-xs text-gray-500">Guide: {data.guide.title} — <strong>{data.guide.versionLabel}</strong> edition</p>
        </div>
        <p className="text-xs text-gray-500">
          {data.setup.housingType === 'OPEN_SIDED' ? 'Open-sided' : 'Light-controlled'}
          {data.setup.declaredLightHours != null ? ` · ${data.setup.declaredLightHours} h light` : ''}
          {' · '}nutrition: {data.setup.nutritionProgram === 'BOTH' ? 'economical + optimal' : data.setup.nutritionProgram.toLowerCase()}
        </p>
      </div>

      <Deviations data={data} />
      {data.feedsWithoutLabTest?.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl p-3 text-xs text-amber-800 dark:text-amber-300">
          <strong>Feeds without a lab test (last 4 weeks):</strong> {data.feedsWithoutLabTest.map((f: any) => `${f.name} (${f.kg} kg)`).join(', ')}.
          {' '}Nutrient intake can’t be checked for days on these feeds{readOnly ? ' until Store enters their lab results' : <> — Store can enter results under <Link to={labLink} className="underline font-semibold">Feed Lab Tests</Link></>}.
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Practices data={data} readOnly={readOnly} />
        <RecordingPlan data={data} readOnly={readOnly} />
      </div>
      {data.lessons && <Lessons lessons={data.lessons} />}
      {readOnly ? (
        <details className={cardCls}>
          <summary className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide cursor-pointer">All parameters and guide figures</summary>
          <div className="mt-3 space-y-4">
            <MetricsTable data={data} />
            {data.reference && <Reference r={data.reference} nutritionProgram={data.setup.nutritionProgram} />}
          </div>
        </details>
      ) : (
        <>
          <MetricsTable data={data} />
          {data.reference && <Reference r={data.reference} nutritionProgram={data.setup.nutritionProgram} />}
        </>
      )}
    </div>
  );
}

function Deviations({ data }: { data: any }) {
  return (
    <div className={cardCls}>
      <p className={hCls}><AlertTriangle className="w-4 h-4 text-amber-500" /> Off standard now</p>
      {data.openDeviations.length === 0 ? (
        <p className="text-sm text-green-600 flex items-center gap-2"><CheckCircle className="w-4 h-4" /> Everything recorded is on standard for the latest period.</p>
      ) : (
        <div className="space-y-2">
          {data.openDeviations.map((d: any) => (
            <div key={d.key} className="border border-gray-100 dark:border-dark-border rounded-xl p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{d.label}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${statusCls(d.status)}`}>{statusLabel(d.status)}</span>
                <span className="text-[11px] text-gray-400">{period(d.ageUnit, d.ageIndex)}{d.runLength > 1 ? ` · ${d.runLength} periods running` : ''}</span>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                {d.actual != null ? <>Actual <strong>{fmt(d.actual)}</strong> vs {d.basis === 'FARM' ? 'farm standard' : d.basis === 'GUIDE_EXTENDED' ? 'guide (last week held)' : 'guide'} {band(d)}</> : d.actualText}
              </p>
              {d.implication && <p className="text-[11px] text-gray-500 mt-1">{d.implication}</p>}
            </div>
          ))}
        </div>
      )}
      {data.pastDeviations?.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs text-gray-500 cursor-pointer flex items-center gap-1"><History className="w-3.5 h-3.5" /> Earlier in this batch ({data.pastDeviations.length})</summary>
          <ul className="mt-2 space-y-1">
            {data.pastDeviations.map((d: any, i: number) => (
              <li key={i} className="text-[11px] text-gray-500">
                <strong>{d.label}</strong> {statusLabel(d.status)} {d.ageUnit === 'DAY' ? 'days' : 'weeks'} {d.from}{d.to !== d.from ? `–${d.to}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Practices({ data, readOnly }: { data: any; readOnly: boolean }) {
  const qc = useQueryClient();
  const { data: catalog = [] } = useCatalog();
  const [form, setForm] = useState({ metric: 'LIGHT_HOURS', practice: '', reason: '', effectiveFrom: dayjs().format('YYYY-MM-DD') });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['breed-standards', 'batch', data.batchId] });
  const add = useMutation({
    mutationFn: () => api.post(`/breed-standards/batches/${data.batchId}/practices`, form),
    onSuccess: () => { setForm(f => ({ ...f, practice: '', reason: '' })); invalidate(); },
  });
  const end = useMutation({ mutationFn: (id: string) => api.patch(`/breed-standards/practices/${id}/end`), onSuccess: invalidate });
  const choices = catalog.filter(m => m.capture !== 'NO_INPUT' && !['GUIDE_NOTE'].includes(m.key));

  return (
    <div className={cardCls}>
      <p className={hCls}>Practices different from the guide</p>
      {data.practiceNotes.length === 0 && <p className="text-xs text-gray-400 italic mb-3">None noted.</p>}
      <div className="space-y-2 mb-3">
        {data.practiceNotes.map((n: any) => (
          <div key={n.id} className="border border-gray-100 dark:border-dark-border rounded-xl p-2.5">
            <p className="text-xs text-gray-800 dark:text-gray-100">
              <strong>{catalog.find(m => m.key === n.metric)?.label ?? n.metric}:</strong> {n.practice}
              {n.source === 'AUTO' && <span className="ml-1 text-[10px] text-gray-400">(noted by system)</span>}
            </p>
            {n.guideRecommendation && <p className="text-[11px] text-gray-500">Guide: {n.guideRecommendation}</p>}
            {n.reason && <p className="text-[11px] text-gray-500">Reason: {n.reason}</p>}
            {n.implication && <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">{n.implication}</p>}
            <p className="text-[10px] text-gray-400 mt-0.5">
              From {dayjs(n.effectiveFrom).format('D MMM YYYY')}{n.effectiveTo ? ` to ${dayjs(n.effectiveTo).format('D MMM YYYY')}` : ''}
              {!n.effectiveTo && !readOnly && <button onClick={() => end.mutate(n.id)} className="ml-2 text-brand-green underline">ended today</button>}
            </p>
          </div>
        ))}
      </div>
      {!readOnly && <div className="space-y-2 border-t border-gray-100 dark:border-dark-border pt-3">
        <select value={form.metric} onChange={e => setForm({ ...form, metric: e.target.value })} className={iCls}>
          {choices.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        <input value={form.practice} onChange={e => setForm({ ...form, practice: e.target.value })} className={iCls} placeholder="What the farm does, e.g. 14 h light" />
        <div className="grid grid-cols-2 gap-2">
          <input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} className={iCls} placeholder="Why (optional)" />
          <input type="date" value={form.effectiveFrom} onChange={e => setForm({ ...form, effectiveFrom: e.target.value })} className={iCls} />
        </div>
        {add.error && <p className="text-xs text-red-500">{errMsg(add.error)}</p>}
        <button onClick={() => add.mutate()} disabled={!form.practice.trim() || add.isPending}
          className="w-full flex items-center justify-center gap-2 bg-brand-green text-white rounded-xl py-2 text-sm font-bold disabled:opacity-50">
          <Plus className="w-4 h-4" /> Note practice
        </button>
      </div>}
    </div>
  );
}

function RecordingPlan({ data, readOnly }: { data: any; readOnly: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const recordable = [...data.plan.recorded, ...data.plan.notRecorded.filter((p: any) => p.reason !== 'NO_INPUT')];
  const [setup, setSetup] = useState<BreedSetup>({
    untrackedMetrics: data.plan.notRecorded.filter((p: any) => p.reason === 'FARM_CHOICE').map((p: any) => p.key),
    housingType: data.setup.housingType ?? 'LIGHT_CONTROLLED',
    housingDescription: data.setup.housingDescription ?? '',
    declaredLightHours: data.setup.declaredLightHours != null ? String(data.setup.declaredLightHours) : '',
    nutritionProgram: data.setup.nutritionProgram ?? 'BOTH',
  });
  const save = useMutation({
    mutationFn: () => api.patch(`/breed-standards/batches/${data.batchId}/setup`, breedSetupPayload(setup)),
    onSuccess: () => { setEditing(false); qc.invalidateQueries({ queryKey: ['breed-standards', 'batch', data.batchId] }); },
  });

  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between mb-3">
        <p className={`${hCls} mb-0`}>{readOnly ? 'Not recorded — what that means' : 'Recording plan'}</p>
        {!readOnly && <button onClick={() => setEditing(e => !e)} className="text-xs text-brand-green font-semibold">{editing ? 'Cancel' : 'Change'}</button>}
      </div>
      {!editing ? (
        <>
          <p className="text-[11px] text-gray-500 mb-1">Recorded: {data.plan.recorded.map((p: any) => p.label).join(', ') || '—'}</p>
          {data.plan.notRecorded.length > 0 && (
            <div className="space-y-1 mt-2">
              <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">Not recorded — implications</p>
              {data.plan.notRecorded.map((p: any) => (
                <p key={p.key} className="text-[11px] text-gray-500">
                  <strong>{p.label}</strong>{p.reason === 'NO_INPUT' ? ' (not measured at the farm)' : p.reason === 'NOT_DECLARED' ? ' (not declared)' : ' (farm choice)'}: {p.implication}
                </p>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-2">
          {recordable.filter((m: any) => m.capture === 'SYSTEM').map((m: any) => (
            <label key={m.key} className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
              <input type="checkbox" className="w-4 h-4 accent-brand-green" checked={!setup.untrackedMetrics.includes(m.key)}
                onChange={e => setSetup(s => ({ ...s, untrackedMetrics: e.target.checked ? s.untrackedMetrics.filter(k => k !== m.key) : [...s.untrackedMetrics, m.key] }))} />
              {m.label}
            </label>
          ))}
          <div className="grid grid-cols-2 gap-2">
            <select value={setup.housingType} onChange={e => setSetup({ ...setup, housingType: e.target.value as BreedSetup['housingType'] })} className={iCls}>
              <option value="LIGHT_CONTROLLED">Light-controlled</option>
              <option value="OPEN_SIDED">Open-sided</option>
            </select>
            <input type="number" min="0" max="24" step="0.5" value={setup.declaredLightHours} placeholder="Light h/day"
              onChange={e => setSetup({ ...setup, declaredLightHours: e.target.value })} className={iCls} />
          </div>
          <input value={setup.housingDescription} onChange={e => setSetup({ ...setup, housingDescription: e.target.value })} className={iCls} placeholder="House description" />
          <select value={setup.nutritionProgram} onChange={e => setSetup({ ...setup, nutritionProgram: e.target.value as BreedSetup['nutritionProgram'] })} className={iCls}>
            <option value="BOTH">Both programmes</option>
            <option value="ECONOMICAL">Economical</option>
            <option value="OPTIMAL">Optimal</option>
          </select>
          {save.error && <p className="text-xs text-red-500">{errMsg(save.error)}</p>}
          <button onClick={() => save.mutate()} disabled={save.isPending} className="w-full bg-brand-green text-white rounded-xl py-2 text-sm font-bold disabled:opacity-50">Save</button>
        </div>
      )}
    </div>
  );
}

function MetricsTable({ data }: { data: any }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className={cardCls}>
      <p className={hCls}>Parameters vs standard (latest period)</p>
      {data.metrics.length === 0 ? <p className="text-xs text-gray-400 italic">Nothing evaluated yet — records are checked every night, or press “Re-check now”.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 border-b border-gray-100 dark:border-dark-border">
                <th className="text-left py-1.5 pr-2 font-medium">Parameter</th>
                <th className="text-left px-2 font-medium">Period</th>
                <th className="text-right px-2 font-medium">Actual</th>
                <th className="text-right px-2 font-medium">Standard</th>
                <th className="text-left px-2 font-medium">Status</th>
                <th className="text-right pl-2 font-medium">On standard</th>
              </tr>
            </thead>
            <tbody>
              {data.metrics.map((m: any) => (
                <Fragment key={m.key}>
                  <tr onClick={() => setOpen(open === m.key ? null : m.key)} className="border-b border-gray-50 dark:border-dark-border/50 cursor-pointer hover:bg-gray-50 dark:hover:bg-dark-bg">
                    <td className="py-1.5 pr-2 font-semibold text-gray-700 dark:text-gray-200">{m.label}{m.unit ? <span className="text-gray-400 font-normal"> ({m.unit})</span> : null}</td>
                    <td className="px-2 text-gray-500">{period(m.latest.ageUnit, m.latest.ageIndex)}</td>
                    <td className="text-right px-2">{m.latest.actual != null ? fmt(m.latest.actual) : <span className="text-gray-500">{m.latest.actualText}</span>}</td>
                    <td className="text-right px-2 text-gray-500">{band(m.latest)}{m.latest.basis === 'FARM' ? ' (farm)' : m.latest.basis === 'GUIDE_EXTENDED' ? ' (held)' : ''}</td>
                    <td className="px-2"><span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${statusCls(m.latest.status)}`}>{statusLabel(m.latest.status)}</span></td>
                    <td className="text-right pl-2 text-gray-500">{m.inBandRate != null ? `${m.inBandRate}%` : '—'}</td>
                  </tr>
                  {open === m.key && (
                    <tr><td colSpan={6} className="py-2">
                      <div className="flex flex-wrap gap-1">
                        {m.history.map((h: any) => (
                          <span key={`${h.ageUnit}${h.ageIndex}`} title={`${band(h)}`} className={`text-[10px] px-1.5 py-0.5 rounded ${statusCls(h.status)}`}>
                            {period(h.ageUnit, h.ageIndex)}: {h.actual != null ? fmt(h.actual) : '•'}
                          </span>
                        ))}
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Reference({ r, nutritionProgram }: { r: any; nutritionProgram: string }) {
  const programs = nutritionProgram === 'BOTH' ? ['ECONOMICAL', 'OPTIMAL'] : [nutritionProgram];
  return (
    <div className={cardCls}>
      <p className={hCls}><BookOpen className="w-4 h-4 text-blue-500" /> What the guide says for week {r.ageWeeks}</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-3">
        {[['Body weight (g)', r.bodyWeight], ['Feed (g/bird/day)', r.feedIntake], ['Water (ml/bird/day)', r.waterIntake], ['Light (h)', r.lightHours],
          ['Hen-day %', r.henDay], ['Egg weight (g)', r.eggWeight]].filter(([, v]) => v).map(([l, v]: any) => (
          <div key={l} className="bg-gray-50 dark:bg-dark-bg rounded-xl p-2">
            <p className="text-[10px] text-gray-400">{l}</p>
            <p className="font-semibold text-gray-700 dark:text-gray-200">{band(v)}{v.basis === 'GUIDE_EXTENDED' ? ' (held)' : ''}</p>
          </div>
        ))}
        {r.feedPhase && (
          <div className="bg-gray-50 dark:bg-dark-bg rounded-xl p-2">
            <p className="text-[10px] text-gray-400">Diet phase</p>
            <p className="font-semibold text-gray-700 dark:text-gray-200">{r.feedPhase.phase}</p>
          </div>
        )}
      </div>
      {programs.filter(p => r.layingPhase?.[p]).map(p => (
        <div key={p} className="mb-2">
          <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">{p === 'ECONOMICAL' ? 'Economical' : 'Optimal'} programme — {r.layingPhase[p]} (daily intake per bird)</p>
          <p className="text-[11px] text-gray-500">{(r.layingNutrients[p] ?? []).map((n: any) => `${n.label} ${n.text} ${n.unit}`).join(' · ')}</p>
        </div>
      ))}
      {r.rearingNutrients?.length > 0 && (
        <p className="text-[11px] text-gray-500 mb-2"><strong>{r.rearingNutrients[0].phase} diet:</strong> {r.rearingNutrients.map((n: any) => `${n.label} ${n.text}${n.unit === '%' ? '%' : ` ${n.unit}`}`).join(' · ')}</p>
      )}
      {r.calciumPhosphorus?.length > 0 && (
        <p className="text-[11px] text-gray-500 mb-2"><strong>Calcium & phosphorus:</strong> {r.calciumPhosphorus.map((n: any) => `${n.label} ${n.target ?? n.text}${n.unit ? ` ${n.unit}` : ''}`).join(' · ')}</p>
      )}
      {r.space?.length > 0 && <p className="text-[11px] text-gray-500 mb-2"><strong>Space:</strong> {r.space.map((s: any) => s.label).join(' · ')}</p>}
      {r.notes?.map((n: any) => <p key={n.label} className="text-[11px] text-gray-500"><strong>{n.label}:</strong> {n.text}</p>)}
    </div>
  );
}

function Lessons({ lessons }: { lessons: any }) {
  if (!lessons.batchesCompared) return null;
  return (
    <div className={cardCls}>
      <p className={hCls}><Award className="w-4 h-4 text-purple-500" /> From {lessons.batchesCompared} earlier batch(es) of this breed</p>
      {lessons.repeatIssues.length > 0 && (
        <div className="mb-3">
          <p className="text-[11px] font-semibold text-red-600 mb-1">Avoid repeating</p>
          {lessons.repeatIssues.map((i: any) => (
            <p key={i.metric} className="text-[11px] text-gray-600 dark:text-gray-300 mb-1">
              <strong>{i.label}</strong> {statusLabel(i.direction)} in {i.batches.join(', ')}{i.weeks ? ` (weeks ${i.weeks})` : ''}. {i.implication}
            </p>
          ))}
        </div>
      )}
      {lessons.strengths.length > 0 && (
        <div className="mb-3">
          <p className="text-[11px] font-semibold text-green-600 mb-1">Repeat what worked</p>
          {lessons.strengths.map((s: any) => (
            <p key={s.metric} className="text-[11px] text-gray-600 dark:text-gray-300"><strong>{s.label}</strong>: {s.inBandPct}% on standard in {s.batchCode}</p>
          ))}
        </div>
      )}
      {lessons.practices.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 mb-1">Practices tried before</p>
          {lessons.practices.map((p: any, i: number) => (
            <p key={i} className="text-[11px] text-gray-500">{p.batchCode} — {p.label}: {p.practice}{p.outcomeInBandPct != null ? ` → ${p.outcomeInBandPct}% on standard` : ''}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Compare ───────────────────────────────────────────────────────────────

function useBreeds() {
  return useQuery<any[]>({ queryKey: ['breed-standards', 'breeds'], queryFn: () => api.get('/breed-standards/breeds').then(r => r.data) });
}

function CompareTab() {
  const { data: breeds = [] } = useBreeds();
  const { data: catalog = [] } = useCatalog();
  const [breedId, setBreedId] = useState('');
  const [metric, setMetric] = useState('HEN_DAY_PCT');
  useEffect(() => { if (!breedId && breeds.length) setBreedId(breeds[0].id); }, [breeds, breedId]);
  const { data, isLoading } = useQuery<any>({
    queryKey: ['breed-standards', 'compare', breedId, metric],
    queryFn: () => api.get(`/breed-standards/breeds/${breedId}/compare`, { params: { metric } }).then(r => r.data),
    enabled: !!breedId,
  });
  const weeks = useMemo(() => {
    if (!data) return [] as number[];
    return [...new Set<number>(data.batches.flatMap((b: any) => b.points.filter((p: any) => p.ageUnit === 'WEEK').map((p: any) => p.ageIndex)))].sort((a, b) => a - b);
  }, [data]);
  const guideAt = (w: number) => data?.guide?.points.find((p: any) => w >= p.ageFrom && w <= p.ageTo);

  return (
    <div className={cardCls}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
        <select value={breedId} onChange={e => setBreedId(e.target.value)} className={iCls}>
          {breeds.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select value={metric} onChange={e => setMetric(e.target.value)} className={iCls}>
          {catalog.filter(m => m.capture === 'SYSTEM' || m.capture === 'DECLARED').map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
      </div>
      {isLoading ? <p className="text-sm text-gray-400">Loading…</p> : !data || data.batches.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No evaluated batches of this breed for this parameter yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-[11px]">
            <thead>
              <tr className="text-gray-400">
                <th className="text-left pr-3 py-1 sticky left-0 bg-white dark:bg-dark-card">Week</th>
                <th className="px-2 text-right">Guide{data.guide ? ` (${data.guide.versionLabel})` : ''}</th>
                <th className="px-2 text-right">Farm best</th>
                {data.batches.map((b: any) => <th key={b.batchId} className="px-2 text-right">{b.batchCode}</th>)}
              </tr>
            </thead>
            <tbody>
              {weeks.map(w => {
                const g = guideAt(w);
                const farm = data.farm.find((f: any) => f.ageIndex === w);
                return (
                  <tr key={w} className="border-t border-gray-50 dark:border-dark-border/50">
                    <td className="pr-3 py-1 font-semibold sticky left-0 bg-white dark:bg-dark-card">{w}</td>
                    <td className="px-2 text-right text-gray-500">{g ? band(g) : '—'}</td>
                    <td className="px-2 text-right text-purple-600">{farm && farm.batches > 1 ? fmt(farm.best) : '—'}</td>
                    {data.batches.map((b: any) => {
                      const p = b.points.find((x: any) => x.ageUnit === 'WEEK' && x.ageIndex === w);
                      return <td key={b.batchId} className="px-1 text-right">{p ? <span className={`px-1.5 py-0.5 rounded ${statusCls(p.status)}`}>{fmt(p.actual)}</span> : ''}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Guides ────────────────────────────────────────────────────────────────

function GuidesTab() {
  const qc = useQueryClient();
  const { data: breeds = [] } = useBreeds();
  const [form, setForm] = useState({ breedId: '', breedName: '', aliases: '', versionLabel: '', versionYear: String(new Date().getFullYear()), variety: '', title: '', notes: '' });
  const [file, setFile] = useState<File | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['breed-standards'] });
  const upload = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      if (!file) throw new Error('Choose a file');
      fd.append('file', file);
      Object.entries(form).forEach(([k, v]) => { if (v) fd.append(k, v); });
      return api.post('/breed-standards/guides/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 600_000 }).then(r => r.data);
    },
    onSuccess: () => { setFile(null); invalidate(); },
  });
  const downloadTemplate = async () => {
    const r = await api.get('/breed-standards/guides/template', { responseType: 'blob' });
    const url = URL.createObjectURL(r.data);
    const a = document.createElement('a'); a.href = url; a.download = 'breed-guide-template.csv'; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {breeds.map(b => (
        <div key={b.id} className={cardCls}>
          <p className="text-sm font-bold text-gray-800 dark:text-gray-100">{b.name} <span className="text-xs font-normal text-gray-400">· {b._count?.batches ?? 0} batch(es) · matches: {b.aliases.join(', ')}</span></p>
          <div className="mt-2 space-y-2">
            {b.guides.map((g: any) => (
              <div key={g.id} className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 border border-gray-100 dark:border-dark-border rounded-xl p-2.5">
                <div>
                  <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                    {g.versionLabel}{g.variety ? ` · ${g.variety} only` : ' · all varieties'}
                    <span className={`ml-2 text-[10px] px-2 py-0.5 rounded-full ${g.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : g.status === 'DRAFT' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{g.status.toLowerCase()}</span>
                  </p>
                  <p className="text-[11px] text-gray-500">{g.title} · {g._count.points} data points · {g.sourceKind === 'AI' ? 'read by AI — check before activating' : g.sourceKind === 'SEED' ? 'built in' : 'from template'}
                    {g.supersededAt ? ` · superseded ${dayjs(g.supersededAt).format('D MMM YYYY')}` : ''}</p>
                </div>
                {g.status === 'DRAFT' && <span className="text-[11px] text-blue-600 dark:text-blue-400 self-start">Waiting for the Director to approve</span>}
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className={cardCls}>
        <p className={hCls}><UploadCloud className="w-4 h-4 text-brand-green" /> Add a guide (new breed or newer edition)</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <select value={form.breedId} onChange={e => setForm({ ...form, breedId: e.target.value })} className={iCls}>
            <option value="">New breed…</option>
            {breeds.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          {!form.breedId && <input value={form.breedName} onChange={e => setForm({ ...form, breedName: e.target.value })} className={iCls} placeholder="Breed name, e.g. Lohmann Brown" />}
          {!form.breedId && <input value={form.aliases} onChange={e => setForm({ ...form, aliases: e.target.value })} className={iCls} placeholder="Other spellings, comma-separated" />}
          <input value={form.versionLabel} onChange={e => setForm({ ...form, versionLabel: e.target.value })} className={iCls} placeholder="Edition, e.g. January 2026" />
          <input type="number" value={form.versionYear} onChange={e => setForm({ ...form, versionYear: e.target.value })} className={iCls} placeholder="Year" />
          <input value={form.variety} onChange={e => setForm({ ...form, variety: e.target.value })} className={iCls} placeholder="Only for variety (blank = all varieties)" />
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className={iCls} placeholder="Guide title (optional)" />
          <input type="file" accept=".pdf,.csv,.xlsx,.xls,.json,.png,.jpg,.jpeg,.webp" onChange={e => setFile(e.target.files?.[0] ?? null)} className={`${iCls} md:col-span-2`} />
          <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className={`${iCls} md:col-span-2`} placeholder="Notes for the reader (optional), e.g. use the cage table" />
        </div>
        <p className="text-[11px] text-gray-400 mt-2">A PDF or photo is read by AI into a draft; the template (CSV/Excel) is read exactly. Nothing is used until the Director activates the edition — the previous edition is then archived.</p>
        {upload.error && <p className="text-xs text-red-500 mt-2">{errMsg(upload.error)}</p>}
        {upload.data && (
          <div className="text-xs mt-2 text-green-700 dark:text-green-400">
            Draft saved with {upload.data.points} data points.{upload.data.aiInterpretation ? ` AI reading: ${upload.data.aiInterpretation}` : ''}
            {upload.data.warnings?.length > 0 && <ul className="text-amber-600 mt-1">{upload.data.warnings.map((w: string) => <li key={w}>{w}</li>)}</ul>}
          </div>
        )}
        <div className="flex flex-col md:flex-row gap-2 mt-3">
          <button onClick={() => upload.mutate()} disabled={!file || !form.versionLabel || upload.isPending}
            className="flex-1 bg-brand-green text-white rounded-xl py-2 text-sm font-bold disabled:opacity-50">{upload.isPending ? 'Reading guide…' : 'Upload as draft'}</button>
          <button onClick={downloadTemplate} className="flex items-center justify-center gap-2 bg-gray-100 dark:bg-dark-bg rounded-xl px-4 py-2 text-sm"><Download className="w-4 h-4" /> Template</button>
        </div>
      </div>
    </div>
  );
}

// ── Farm standards ────────────────────────────────────────────────────────

function FarmTab() {
  const qc = useQueryClient();
  const { data: breeds = [] } = useBreeds();
  const { data: catalog = [] } = useCatalog();
  const [breedId, setBreedId] = useState('');
  useEffect(() => { if (!breedId && breeds.length) setBreedId(breeds[0].id); }, [breeds, breedId]);
  const { data: list = [] } = useQuery<any[]>({
    queryKey: ['breed-standards', 'farm', breedId],
    queryFn: () => api.get(`/breed-standards/breeds/${breedId}/farm-standards`).then(r => r.data),
    enabled: !!breedId,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['breed-standards', 'farm', breedId] });
  const suggest = useMutation({ mutationFn: () => api.post(`/breed-standards/breeds/${breedId}/farm-standards/suggest`).then(r => r.data), onSuccess: invalidate });
  const [form, setForm] = useState({ metric: 'HEN_DAY_PCT', from: '', to: '', min: '', target: '', max: '', reason: '' });
  const create = useMutation({
    mutationFn: () => api.post('/breed-standards/farm-standards', {
      breedId, metric: form.metric, reason: form.reason,
      points: [{ ageFrom: Number(form.from), ageTo: Number(form.to || form.from), min: form.min === '' ? null : Number(form.min), target: form.target === '' ? null : Number(form.target), max: form.max === '' ? null : Number(form.max) }],
    }),
    onSuccess: () => { setForm(f => ({ ...f, from: '', to: '', min: '', target: '', max: '', reason: '' })); invalidate(); },
  });
  const label = (k: string) => catalog.find(m => m.key === k)?.label ?? k;

  return (
    <div className="space-y-4">
      <div className={cardCls}>
        <div className="flex flex-col md:flex-row gap-2">
          <select value={breedId} onChange={e => setBreedId(e.target.value)} className={iCls}>
            {breeds.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button onClick={() => suggest.mutate()} disabled={!breedId || suggest.isPending}
            className="bg-brand-green text-white rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-50 whitespace-nowrap">Find where the farm beats the guide</button>
        </div>
        {suggest.data && <p className="text-xs text-gray-500 mt-2">{suggest.data.proposed ? `${suggest.data.proposed} proposal(s) created for the Director.` : 'Not enough same-breed batches beat the guide yet (needs 3+ batches with results for the same weeks).'}</p>}
        {suggest.error && <p className="text-xs text-red-500 mt-2">{errMsg(suggest.error)}</p>}
        <p className="text-[11px] text-gray-400 mt-2">An approved farm standard replaces the guide band for flags (the guide figure is still shown). Use it when the farm consistently does better than the guide, or for a deliberate practice the Director accepts.</p>
      </div>

      {list.map(fs => (
        <div key={fs.id} className={cardCls}>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{label(fs.metric)} <span className={`ml-1 text-[10px] px-2 py-0.5 rounded-full ${fs.status === 'APPROVED' ? 'bg-green-100 text-green-700' : fs.status === 'PROPOSED' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{fs.status.toLowerCase()}</span></p>
              <p className="text-[11px] text-gray-500">{fs.reason}</p>
              <p className="text-[11px] text-gray-400">{(fs.points as any[]).slice(0, 12).map(p => `wk ${p.ageFrom}${p.ageTo !== p.ageFrom ? `–${p.ageTo}` : ''}: ${band(p)}`).join(' · ')}{fs.points.length > 12 ? ' …' : ''}</p>
            </div>
            {fs.status === 'PROPOSED' && <span className="text-[11px] text-blue-600 dark:text-blue-400 self-start">Waiting for the Director</span>}
          </div>
        </div>
      ))}

      <div className={cardCls}>
        <p className={hCls}><Plus className="w-4 h-4 text-brand-green" /> Propose a farm standard</p>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <select value={form.metric} onChange={e => setForm({ ...form, metric: e.target.value })} className={`${iCls} col-span-2`}>
            {catalog.filter(m => m.capture === 'SYSTEM' || m.capture === 'DECLARED').map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <input value={form.from} onChange={e => setForm({ ...form, from: e.target.value })} className={iCls} placeholder="From wk" type="number" />
          <input value={form.to} onChange={e => setForm({ ...form, to: e.target.value })} className={iCls} placeholder="To wk" type="number" />
          <input value={form.min} onChange={e => setForm({ ...form, min: e.target.value })} className={iCls} placeholder="Min" type="number" />
          <input value={form.max} onChange={e => setForm({ ...form, max: e.target.value })} className={iCls} placeholder="Max" type="number" />
          <input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} className={`${iCls} col-span-2 md:col-span-6`} placeholder="Why the farm standard differs from the guide" />
        </div>
        {create.error && <p className="text-xs text-red-500 mt-2">{errMsg(create.error)}</p>}
        <button onClick={() => create.mutate()} disabled={!breedId || !form.from || !form.reason.trim() || create.isPending}
          className="mt-3 w-full bg-brand-green text-white rounded-xl py-2 text-sm font-bold disabled:opacity-50">Send to Director</button>
      </div>
    </div>
  );
}

// ── Director: overview ────────────────────────────────────────────────────

function OverviewTab({ data, onOpen }: { data: any; onOpen: (batchId: string) => void }) {
  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;
  const pendingGuides = data.decisions.draftGuides.length;
  const pendingStandards = data.decisions.farmStandards.filter((f: any) => f.status === 'PROPOSED').length;
  return (
    <div className="space-y-4">
      {(pendingGuides > 0 || pendingStandards > 0) && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-2xl p-3 text-xs text-blue-800 dark:text-blue-300">
          <strong>Waiting for your decision:</strong>{' '}
          {[pendingGuides ? `${pendingGuides} guide edition(s) to approve` : null, pendingStandards ? `${pendingStandards} farm standard(s) proposed` : null].filter(Boolean).join(' · ')} — see the Decisions tab.
        </div>
      )}
      {data.batches.length === 0 && <div className={cardCls}><p className="text-sm text-gray-400 italic">No active batches with a breed guide.</p></div>}
      {data.batches.map((b: any) => (
        <div key={b.batchId} className={cardCls}>
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2 mb-2">
            <div>
              <p className="text-sm font-bold text-gray-800 dark:text-gray-100">{b.batchCode} · {b.breed?.name}{b.breed?.variety ? ` (${b.breed.variety})` : ''} · week {b.ageWeeks}</p>
              <p className="text-[11px] text-gray-500">Measured against the {b.guide.versionLabel} guide · {b.onStandard} parameter(s) on standard</p>
            </div>
            <button onClick={() => onOpen(b.batchId)} className="text-xs text-brand-green font-semibold underline self-start">Open batch</button>
          </div>

          {b.openDeviations.length === 0 ? (
            <p className="text-sm text-green-600 flex items-center gap-2"><CheckCircle className="w-4 h-4" /> Nothing off standard right now.</p>
          ) : (
            <div className="space-y-2">
              {b.openDeviations.map((d: any) => (
                <div key={d.key} className="border-l-4 border-amber-400 pl-3">
                  <p className="text-xs text-gray-800 dark:text-gray-100">
                    <strong>{d.label}</strong> {statusLabel(d.status)}
                    {d.actual != null ? <> — {fmt(d.actual)} vs {d.basis === 'FARM' ? 'farm standard' : 'guide'} {band(d)}</> : d.actualText ? <> — {d.actualText}</> : null}
                    <span className="text-gray-400"> · {d.runLength > 1 ? `${d.runLength} periods running` : period(d.ageUnit, d.ageIndex)}</span>
                  </p>
                  {d.implication && <p className="text-[11px] text-gray-500">{d.implication}</p>}
                </div>
              ))}
            </div>
          )}

          {b.practiceNotes.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 mb-1">Done differently from the guide</p>
              {b.practiceNotes.map((n: any, i: number) => (
                <p key={i} className="text-[11px] text-gray-500 mb-0.5">
                  <strong>{n.label}:</strong> {n.practice}{n.guideRecommendation ? ` (guide: ${n.guideRecommendation})` : ''}{n.reason ? ` — ${n.reason}` : ''}.
                  {n.implication && <span className="text-amber-700 dark:text-amber-400"> {n.implication}</span>}
                </p>
              ))}
            </div>
          )}

          {(b.notRecordedByChoice.length > 0 || b.feedsWithoutLabTest?.length > 0) && (
            <details className="mt-3">
              <summary className="text-[11px] text-gray-500 cursor-pointer">
                Blind spots: {[...b.notRecordedByChoice.map((p: any) => p.label), ...(b.feedsWithoutLabTest?.length ? ['feeds without a lab test'] : [])].join(', ')}
              </summary>
              <div className="mt-1 space-y-0.5">
                {b.notRecordedByChoice.map((p: any) => <p key={p.label} className="text-[11px] text-gray-500"><strong>{p.label}</strong> not recorded: {p.implication}</p>)}
                {b.feedsWithoutLabTest?.length > 0 && (
                  <p className="text-[11px] text-gray-500"><strong>No lab test</strong> for {b.feedsWithoutLabTest.map((f: any) => f.name).join(', ')} — nutrient intake on those days can’t be checked.</p>
                )}
              </div>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Director: decisions ───────────────────────────────────────────────────

function DecisionsTab({ data }: { data: any }) {
  const qc = useQueryClient();
  const { data: breeds = [] } = useBreeds();
  const { data: catalog = [] } = useCatalog();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['breed-standards'] });
  const activate = useMutation({ mutationFn: (id: string) => api.post(`/breed-standards/guides/${id}/activate`), onSuccess: invalidate });
  const discard = useMutation({ mutationFn: (id: string) => api.post(`/breed-standards/guides/${id}/archive`), onSuccess: invalidate });
  const decide = useMutation({ mutationFn: (v: { id: string; approve: boolean }) => api.post(`/breed-standards/farm-standards/${v.id}/decide`, { approve: v.approve }), onSuccess: invalidate });
  const retire = useMutation({ mutationFn: (id: string) => api.post(`/breed-standards/farm-standards/${id}/retire`), onSuccess: invalidate });
  const [breedId, setBreedId] = useState('');
  useEffect(() => { if (!breedId && breeds.length) setBreedId(breeds[0].id); }, [breeds, breedId]);
  const suggest = useMutation({ mutationFn: () => api.post(`/breed-standards/breeds/${breedId}/farm-standards/suggest`).then(r => r.data), onSuccess: invalidate });
  const [form, setForm] = useState({ metric: 'HEN_DAY_PCT', from: '', to: '', min: '', max: '', reason: '' });
  const setStandard = useMutation({
    mutationFn: () => api.post('/breed-standards/farm-standards', {
      breedId, metric: form.metric, reason: form.reason,
      points: [{ ageFrom: Number(form.from), ageTo: Number(form.to || form.from), min: form.min === '' ? null : Number(form.min), max: form.max === '' ? null : Number(form.max) }],
    }),
    onSuccess: () => { setForm(f => ({ ...f, from: '', to: '', min: '', max: '', reason: '' })); invalidate(); },
  });
  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;
  const proposed = data.decisions.farmStandards.filter((f: any) => f.status === 'PROPOSED');
  const approved = data.decisions.farmStandards.filter((f: any) => f.status === 'APPROVED');
  const err = activate.error || discard.error || decide.error || retire.error;

  return (
    <div className="space-y-4">
      {err && <p className="text-xs text-red-500">{errMsg(err)}</p>}

      <div className={cardCls}>
        <p className={hCls}><BookOpen className="w-4 h-4 text-blue-500" /> Guide editions to approve</p>
        {data.decisions.draftGuides.length === 0 ? <p className="text-xs text-gray-400 italic">None waiting.</p> : data.decisions.draftGuides.map((g: any) => (
          <div key={g.id} className="border border-gray-100 dark:border-dark-border rounded-xl p-3 mb-2">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{g.breed} — {g.versionLabel}{g.variety ? ` (${g.variety} only)` : ''}</p>
            <p className="text-[11px] text-gray-500">{g.title} · {g.points} figures · uploaded {dayjs(g.createdAt).format('D MMM YYYY')}</p>
            <p className="text-xs text-gray-700 dark:text-gray-300 mt-1.5">{g.implication}</p>
            {g.aiInterpretation && <p className="text-[11px] text-blue-600 dark:text-blue-400 mt-1 italic">AI reading: {g.aiInterpretation}</p>}
            <div className="flex gap-2 mt-2">
              <button onClick={() => activate.mutate(g.id)} className="text-xs bg-brand-green text-white rounded-lg px-3 py-1.5 font-semibold">Use this edition</button>
              <button onClick={() => discard.mutate(g.id)} className="text-xs bg-gray-100 dark:bg-dark-bg rounded-lg px-3 py-1.5">Discard</button>
            </div>
          </div>
        ))}
      </div>

      <div className={cardCls}>
        <p className={hCls}><Award className="w-4 h-4 text-purple-500" /> Farm standards proposed</p>
        {proposed.length === 0 ? <p className="text-xs text-gray-400 italic">None waiting.</p> : proposed.map((f: any) => (
          <div key={f.id} className="border border-gray-100 dark:border-dark-border rounded-xl p-3 mb-2">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{f.breed} — {f.label}</p>
            <p className="text-[11px] text-gray-500">Proposed by {f.proposedBy}. {f.reason}</p>
            {f.summary && <p className="text-xs text-gray-700 dark:text-gray-300 mt-1.5">{f.summary}</p>}
            {f.weeks?.length > 0 && (
              <details className="mt-1">
                <summary className="text-[11px] text-gray-500 cursor-pointer">Week by week ({f.weeks.length})</summary>
                <p className="text-[11px] text-gray-500 mt-1">{f.weeks.map((w: any) => `wk ${w.ageFrom}${w.ageTo !== w.ageFrom ? `–${w.ageTo}` : ''}: guide ${w.guide} → farm ${w.farm}`).join(' · ')}</p>
              </details>
            )}
            <div className="flex gap-2 mt-2">
              <button onClick={() => decide.mutate({ id: f.id, approve: true })} className="text-xs bg-brand-green text-white rounded-lg px-3 py-1.5 font-semibold">Approve</button>
              <button onClick={() => decide.mutate({ id: f.id, approve: false })} className="text-xs bg-gray-100 dark:bg-dark-bg rounded-lg px-3 py-1.5">Reject</button>
            </div>
          </div>
        ))}
      </div>

      <div className={cardCls}>
        <p className={hCls}>Farm standards in use</p>
        {approved.length === 0 ? <p className="text-xs text-gray-400 italic">None — every batch is measured against its guide.</p> : approved.map((f: any) => (
          <div key={f.id} className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 border border-gray-100 dark:border-dark-border rounded-xl p-3 mb-2">
            <div>
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{f.breed} — {f.label}</p>
              <p className="text-[11px] text-gray-500">{f.reason}{f.approvedAt ? ` · since ${dayjs(f.approvedAt).format('D MMM YYYY')}` : ''}</p>
            </div>
            <button onClick={() => retire.mutate(f.id)} className="text-xs bg-gray-100 dark:bg-dark-bg rounded-lg px-3 py-1.5 self-start">Go back to the guide</button>
          </div>
        ))}
      </div>

      <div className={cardCls}>
        <p className={hCls}><Plus className="w-4 h-4 text-brand-green" /> Set a farm standard</p>
        <p className="text-[11px] text-gray-500 mb-2">Use when the farm should be held to its own figure instead of the guide. It applies from the next check.</p>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <select value={breedId} onChange={e => setBreedId(e.target.value)} className={`${iCls} col-span-2`}>
            {breeds.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select value={form.metric} onChange={e => setForm({ ...form, metric: e.target.value })} className={`${iCls} col-span-2 md:col-span-4`}>
            {catalog.filter(m => (m.capture === 'SYSTEM' || m.capture === 'DECLARED') && !m.planKey).map(m => <option key={m.key} value={m.key}>{m.label}{m.unit ? ` (${m.unit})` : ''}</option>)}
          </select>
          <input value={form.from} onChange={e => setForm({ ...form, from: e.target.value })} className={iCls} placeholder="From week" type="number" />
          <input value={form.to} onChange={e => setForm({ ...form, to: e.target.value })} className={iCls} placeholder="To week" type="number" />
          <input value={form.min} onChange={e => setForm({ ...form, min: e.target.value })} className={iCls} placeholder="At least" type="number" />
          <input value={form.max} onChange={e => setForm({ ...form, max: e.target.value })} className={iCls} placeholder="At most" type="number" />
          <input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} className={`${iCls} col-span-2`} placeholder="Why" />
        </div>
        {setStandard.error && <p className="text-xs text-red-500 mt-2">{errMsg(setStandard.error)}</p>}
        <div className="flex flex-col md:flex-row gap-2 mt-3">
          <button onClick={() => setStandard.mutate()} disabled={!breedId || !form.from || (!form.min && !form.max) || !form.reason.trim() || setStandard.isPending}
            className="flex-1 bg-brand-green text-white rounded-xl py-2 text-sm font-bold disabled:opacity-50">Set farm standard</button>
          <button onClick={() => suggest.mutate()} disabled={!breedId || suggest.isPending}
            className="bg-gray-100 dark:bg-dark-bg rounded-xl px-4 py-2 text-sm">Check where farm results beat the guide</button>
        </div>
        {suggest.data && <p className="text-xs text-gray-500 mt-2">{suggest.data.proposed ? `${suggest.data.proposed} suggestion(s) added above for you to approve or reject.` : 'No week yet where 3+ batches of this breed beat the guide.'}</p>}
      </div>
    </div>
  );
}
