import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Bird, Calendar, Home, Info, ChevronRight, Plus, CheckCircle, Clock, XCircle, TrendingUp, Hash, Layers, X } from 'lucide-react';
import { useBatches } from '../../hooks/useFlock';
import { api } from '../../lib/api/client';
import dayjs from 'dayjs';

// ── Tooltip ───────────────────────────────────────────────────────────────────
function Tooltip({ children, tip }: { children: React.ReactNode; tip: string }) {
  return (
    <span className="relative group inline-flex items-center">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50
        bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg px-2.5 py-1.5 w-48 text-center leading-relaxed
        opacity-0 group-hover:opacity-100 transition-opacity duration-150 shadow-lg
        after:content-[''] after:absolute after:top-full after:left-1/2 after:-translate-x-1/2
        after:border-4 after:border-transparent after:border-t-gray-900 dark:after:border-t-gray-700">
        {tip}
      </span>
    </span>
  );
}

// ── Stage config ──────────────────────────────────────────────────────────────
const STAGE_CONFIG = {
  BROODING: {
    label: 'Brooding',
    color: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
    dot: 'bg-yellow-400',
    tip: 'Brooding stage (0–6 weeks): chicks require supplemental heat, close monitoring and high-protein starter feed.',
  },
  GROWER: {
    label: 'Grower',
    color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
    dot: 'bg-blue-400',
    tip: 'Grower stage (6–18 weeks): birds are developing bone structure and muscle. Feed transitions to grower mash.',
  },
  PRODUCTION: {
    label: 'In Production',
    color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
    dot: 'bg-green-500',
    tip: 'Production stage (18+ weeks): hens are actively laying eggs. Primary revenue-generating phase.',
  },
  CLOSED: {
    label: 'Closed',
    color: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
    dot: 'bg-gray-400',
    tip: 'Batch is closed — all birds have been culled or sold. Historical data is preserved.',
  },
};

// ── Bird type config ──────────────────────────────────────────────────────────
const BIRD_TYPE_LABELS: Record<string, { label: string; tip: string }> = {
  LAYER_COMMERCIAL:  { label: 'Layer (Commercial)',  tip: 'Commercial laying hens bred for high egg output — typically 280–320 eggs/year.' },
  LAYER_KIENYEJI:    { label: 'Layer (Kienyeji)',    tip: 'Indigenous/free-range hens. Lower egg output but higher market price and lower input cost.' },
  BROILER:           { label: 'Broiler',             tip: 'Meat birds bred for rapid weight gain. Typically ready for market in 6–8 weeks.' },
  KIENYEJI:          { label: 'Kienyeji',            tip: 'Indigenous dual-purpose bird for both eggs and meat. Hardy and disease-resistant.' },
  CHICK:             { label: 'Day-old Chick',       tip: 'Newly hatched chicks in the brooding phase.' },
};

// ── Batch card ────────────────────────────────────────────────────────────────

// ── Culling Modal ─────────────────────────────────────────────────────────────
function CullingModal({ batch, onClose }: { batch: any; onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: { cullingCount: '', cullingReason: '', cullingDate: dayjs().format('YYYY-MM-DD'), notes: '' }
  });
  const submit = useMutation({
    mutationFn: (data: any) => api.post('/flock/culling', { ...data, batchId: batch.id, cullingCount: Number(data.cullingCount) }).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['batches'] }); onClose(); }
  });
  const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500';
  const lCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1';
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white dark:bg-dark-card w-full md:max-w-md rounded-t-3xl md:rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-dark-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-red-500 rounded-xl flex items-center justify-center"><XCircle className="w-4 h-4 text-white" /></div>
            <div><p className="font-bold text-gray-800 dark:text-gray-100">Log Culling</p><p className="text-xs text-gray-400">{batch.batchCode} · A reason is required</p></div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-bg"><X className="w-5 h-5 text-gray-500" /></button>
        </div>
        <form onSubmit={handleSubmit(d => submit.mutate(d))} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lCls}>Birds Culled *</label>
              <input {...register('cullingCount', { required: 'Required', min: { value: 1, message: 'Must be at least 1' } })} type="number" min="1" className={`${iCls} text-center text-xl font-bold`} placeholder="0" />
              {errors.cullingCount && <p className="text-red-500 text-xs mt-1">{(errors.cullingCount as any).message}</p>}
            </div>
            <div>
              <label className={lCls}>Date *</label>
              <input {...register('cullingDate', { required: true })} type="date" className={iCls} />
            </div>
          </div>
          <div>
            <label className={lCls}>Reason for Culling * <span className="text-red-500">(mandatory)</span></label>
            <select {...register('cullingReason', { required: 'A reason must be provided' })} className={iCls}>
              <option value="">Select reason...</option>
              <option value="DISEASE">Disease / Illness</option>
              <option value="INJURY">Injury</option>
              <option value="POOR_PERFORMANCE">Poor Performance / Low Productivity</option>
              <option value="OLD_AGE">End of Productive Life</option>
              <option value="CANNIBALISM">Cannibalism / Aggression</option>
              <option value="DEFORMITY">Deformity / Abnormality</option>
              <option value="ECONOMIC">Economic Decision</option>
              <option value="OTHER">Other (specify in notes)</option>
            </select>
            {errors.cullingReason && <p className="text-red-500 text-xs mt-1">{(errors.cullingReason as any).message}</p>}
          </div>
          <div>
            <label className={lCls}>Additional Notes</label>
            <textarea {...register('notes')} rows={2} className={`${iCls} resize-none`} placeholder="Describe condition, symptoms, or any other details..." />
          </div>
          {submit.isError && <p className="text-red-500 text-sm">Failed to log culling. Please try again.</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 rounded-xl py-3 font-semibold text-sm">Cancel</button>
            <button type="submit" disabled={submit.isPending} className="flex-1 bg-red-500 text-white rounded-xl py-3 font-semibold text-sm disabled:opacity-60">{submit.isPending ? 'Logging...' : 'Log Culling'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BatchCard({ batch }: { batch: any }) {
  const [showCulling, setShowCulling] = useState(false);
  const stage = STAGE_CONFIG[batch.stage as keyof typeof STAGE_CONFIG] ?? STAGE_CONFIG.BROODING;
  const birdType = BIRD_TYPE_LABELS[batch.birdType] ?? { label: batch.birdType, tip: '' };
  const ageDays = dayjs().diff(dayjs(batch.dateOfHatch), 'day');
  const ageWeeks = Math.floor(ageDays / 7);
  const survivalRate = batch.quantityReceived > 0
    ? ((batch.currentBirdCount / batch.quantityReceived) * 100).toFixed(1)
    : '—';

  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border
      shadow-sm hover:shadow-md transition-all p-4 md:p-5 flex flex-col gap-4">

      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Tooltip tip="Unique batch identifier code assigned when batch was registered">
              <p className="font-bold text-gray-800 dark:text-gray-100 text-lg font-mono cursor-default">
                {batch.batchCode}
              </p>
            </Tooltip>
            <Tooltip tip={stage.tip}>
              <span className={`text-xs px-2.5 py-1 rounded-full font-semibold flex items-center gap-1.5 cursor-default ${stage.color}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${stage.dot} ${batch.stage === 'PRODUCTION' ? 'animate-pulse' : ''}`} />
                {stage.label}
                <Info className="w-2.5 h-2.5 opacity-50" />
              </span>
            </Tooltip>
          </div>
          <div className="flex items-center gap-1.5 mt-1 text-xs text-gray-400 dark:text-gray-500">
            <Home className="w-3 h-3" />
            <span>{batch.house?.name ?? batch.houseId}</span>
            <span className="text-gray-300 dark:text-gray-600">·</span>
            <Tooltip tip={birdType.tip}>
              <span className="cursor-default underline decoration-dotted">{birdType.label}</span>
            </Tooltip>
          </div>
        </div>
        {!batch.isActive && (
          <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-400 px-2 py-1 rounded-full font-medium">
            Inactive
          </span>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Tooltip tip="Current live bird count in this batch">
          <div className="rounded-xl bg-brand-green/5 dark:bg-brand-green/10 p-3 cursor-default">
            <div className="flex items-center gap-1 mb-0.5">
              <Bird className="w-3 h-3 text-brand-green" />
              <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide">Current Birds</p>
            </div>
            <p className="text-xl font-bold text-brand-green">{batch.currentBirdCount?.toLocaleString() ?? '—'}</p>
          </div>
        </Tooltip>

        <Tooltip tip={`Started with ${batch.quantityReceived} birds. Survival rate: ${survivalRate}%`}>
          <div className="rounded-xl bg-gray-50 dark:bg-dark-bg p-3 cursor-default">
            <div className="flex items-center gap-1 mb-0.5">
              <Layers className="w-3 h-3 text-gray-400" />
              <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide">Started</p>
            </div>
            <p className="text-xl font-bold text-gray-700 dark:text-gray-300">{batch.quantityReceived?.toLocaleString()}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{survivalRate}% survival</p>
          </div>
        </Tooltip>

        <Tooltip tip={`Batch is ${ageWeeks} weeks old (${ageDays} days) since hatch date`}>
          <div className="rounded-xl bg-gray-50 dark:bg-dark-bg p-3 cursor-default">
            <div className="flex items-center gap-1 mb-0.5">
              <Calendar className="w-3 h-3 text-gray-400" />
              <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide">Age</p>
            </div>
            <p className="text-xl font-bold text-gray-700 dark:text-gray-300">{ageWeeks}wk</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{ageDays} days</p>
          </div>
        </Tooltip>

        <Tooltip tip="Total number of daily entries logged for this batch">
          <div className="rounded-xl bg-gray-50 dark:bg-dark-bg p-3 cursor-default">
            <div className="flex items-center gap-1 mb-0.5">
              <TrendingUp className="w-3 h-3 text-gray-400" />
              <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide">Entries</p>
            </div>
            <p className="text-xl font-bold text-gray-700 dark:text-gray-300">
              {batch._count?.flockEntries ?? 0}
            </p>
          </div>
        </Tooltip>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-gray-400 dark:text-gray-500 pt-1
        border-t border-gray-50 dark:border-dark-border">
        <div className="flex items-center gap-3 flex-wrap">
          <Tooltip tip="Where this batch is currently housed">
            <span className="flex items-center gap-1">
              <Home className="w-3 h-3" />
              {batch.location === 'BROODER' ? 'Brooder' : batch.location === 'PRODUCTION_HOUSE' ? 'Production House' : '—'}
            </span>
          </Tooltip>
          <Tooltip tip="Bird supplier / hatchery">
            <span className="flex items-center gap-1">
              <Hash className="w-3 h-3" />
              {batch.supplier?.name ?? batch.supplierName ?? 'Unknown supplier'}
            </span>
          </Tooltip>
          <Tooltip tip="Date birds were received on farm">
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              Received {dayjs(batch.dateReceived).format('D MMM YYYY')}
            </span>
          </Tooltip>
        </div>
        {batch.vaccinationOnArrival && (
          <Tooltip tip="Birds were vaccinated upon arrival at the farm">
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400 cursor-default">
              <CheckCircle className="w-3 h-3" />
              Vaccinated
            </span>
          </Tooltip>
        )}
      </div>
      {batch.isActive && (
        <button
          onClick={() => setShowCulling(true)}
          className="w-full mt-1 border border-red-200 dark:border-red-800 text-red-500 dark:text-red-400 rounded-xl py-2 text-xs font-semibold hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center justify-center gap-1.5"
        >
          <XCircle className="w-3.5 h-3.5" /> Log Culling
        </button>
      )}
      {showCulling && <CullingModal batch={batch} onClose={() => setShowCulling(false)} />}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

// ── New Batch Modal ─────────────────────────────────────────────────────────
const BIRD_TYPES = ['LAYER_COMMERCIAL','LAYER_KIENYEJI','BROILER','KIENYEJI','CHICK'];
const STAGES = ['BROODING','GROWER','PRODUCTION'];
const BATCH_LOCATIONS = [
  { value: 'BROODER',          label: 'Brooder (0–18 weeks)' },
  { value: 'PRODUCTION_HOUSE', label: 'Production House (18+ weeks)' },
];

function NewBatchModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, watch, formState: { errors } } = useForm({
    defaultValues: {
      batchCode: '', birdType: 'LAYER_COMMERCIAL', stage: 'BROODING',
      location: 'BROODER', quantityReceived: '',
      dateOfHatch: dayjs().format('YYYY-MM-DD'),
      supplierName: '', vaccinatedOnArrival: false, vaccinesGiven: '',
      houseId: '', notes: '',
    }
  });

  const vaccinatedOnArrival = watch('vaccinatedOnArrival');

  const create = useMutation({
    mutationFn: (data: any) => api.post('/flock/batches', {
      ...data, quantityReceived: Number(data.quantityReceived), isActive: true,
    }).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['batches'] }); onClose(); }
  });

  const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';
  const lCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white dark:bg-dark-card w-full md:max-w-lg rounded-t-3xl md:rounded-2xl shadow-2xl overflow-y-auto max-h-[95vh]">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-dark-border sticky top-0 bg-white dark:bg-dark-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-brand-green rounded-xl flex items-center justify-center"><Bird className="w-4 h-4 text-white" /></div>
            <div><p className="font-bold text-gray-800 dark:text-gray-100">New Batch</p><p className="text-xs text-gray-400">Register a new flock batch</p></div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-bg transition-colors"><X className="w-5 h-5 text-gray-500" /></button>
        </div>
        <form onSubmit={handleSubmit(d => create.mutate(d))} className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className={lCls}>Batch Code *</label><input {...register('batchCode', { required: 'Required' })} className={iCls} placeholder="e.g. BLK1-2024-A" />{errors.batchCode && <p className="text-red-500 text-xs mt-1">{(errors.batchCode as any).message}</p>}</div>
            <div><label className={lCls}>Supplier Name</label><input {...register('supplierName')} className={iCls} placeholder="e.g. Kenchic Limited" /></div>
            <div><label className={lCls}>Bird Type *</label><select {...register('birdType', { required: true })} className={iCls}>{BIRD_TYPES.map(bt => <option key={bt} value={bt}>{bt.replace(/_/g,' ')}</option>)}</select></div>
            <div>
              <label className={lCls}>Assign To *</label>
              <select {...register('location', { required: true })} className={iCls}>
                {BATCH_LOCATIONS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>
            <div><label className={lCls}>Stage *</label><select {...register('stage', { required: true })} className={iCls}>{STAGES.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
            <div><label className={lCls}>Quantity Received *</label><input {...register('quantityReceived', { required: 'Required', min: 1 })} type="number" min="1" className={iCls} placeholder="e.g. 5000" />{errors.quantityReceived && <p className="text-red-500 text-xs mt-1">{(errors.quantityReceived as any).message}</p>}</div>
            <div><label className={lCls}>Date of Hatch *</label><input {...register('dateOfHatch', { required: true })} type="date" className={iCls} /></div>
            <div><label className={lCls}>House ID</label><input {...register('houseId')} className={iCls} placeholder="e.g. house_001" /></div>
          </div>
          <div className="bg-gray-50 dark:bg-dark-bg rounded-xl p-3 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input {...register('vaccinatedOnArrival')} type="checkbox" className="w-4 h-4 accent-brand-green" />
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Vaccinated on arrival</span>
            </label>
            {vaccinatedOnArrival && (
              <div>
                <label className={lCls}>Vaccines Given</label>
                <input {...register('vaccinesGiven')} className={iCls} placeholder="e.g. Marek’s Disease, Newcastle ND1, IB..." />
              </div>
            )}
          </div>
          <div><label className={lCls}>Notes</label><textarea {...register('notes')} rows={2} className={iCls} placeholder="Optional notes..." /></div>
          {create.isError && <p className="text-red-500 text-sm">Failed to create batch. Please try again.</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 rounded-xl py-3 font-semibold">Cancel</button>
            <button type="submit" disabled={create.isPending} className="flex-1 bg-brand-green text-white rounded-xl py-3 font-semibold disabled:opacity-60">{create.isPending ? 'Creating...' : 'Create Batch'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ManagerBatches() {
  const [showNewBatch, setShowNewBatch] = useState(false);
  const [stageFilter, setStageFilter] = useState<string | undefined>(undefined);
  const [showInactive, setShowInactive] = useState(false);

  const { data: batches = [], isLoading } = useBatches({ isActive: showInactive ? undefined : true });

  const filtered = stageFilter
    ? batches.filter((b: any) => b.stage === stageFilter)
    : batches;

  const stageCounts = batches.reduce((acc: Record<string, number>, b: any) => {
    acc[b.stage] = (acc[b.stage] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const totalBirds = batches.reduce((sum: number, b: any) => sum + (b.currentBirdCount ?? 0), 0);

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Flock Batches</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {batches.length} batch{batches.length !== 1 ? 'es' : ''} ·{' '}
            <Tooltip tip="Total live birds currently on farm across all active batches">
              <span className="font-semibold text-brand-green cursor-default underline decoration-dotted">
                {totalBirds.toLocaleString()} birds
              </span>
            </Tooltip>
          </p>
        </div>
        <button
          onClick={() => setShowNewBatch(true)}
          className="flex items-center gap-2 bg-brand-green text-white px-4 py-2.5 rounded-xl
            font-semibold text-sm hover:bg-brand-mid transition-colors shadow-sm active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" />
          New Batch
        </button>
      </div>

      {/* Stage summary pills */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setStageFilter(undefined)}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors
            ${!stageFilter
              ? 'bg-brand-green text-white'
              : 'bg-gray-100 dark:bg-dark-card text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-dark-border'
            }`}
        >
          All ({batches.length})
        </button>
        {Object.entries(STAGE_CONFIG).map(([stage, cfg]) => {
          const count = stageCounts[stage] ?? 0;
          if (count === 0) return null;
          return (
            <Tooltip key={stage} tip={cfg.tip}>
              <button
                onClick={() => setStageFilter(stageFilter === stage ? undefined : stage)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors
                  ${stageFilter === stage
                    ? 'bg-brand-teal text-white'
                    : 'bg-gray-100 dark:bg-dark-card text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-dark-border'
                  }`}
              >
                {cfg.label} ({count})
              </button>
            </Tooltip>
          );
        })}
        <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 ml-auto cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={e => setShowInactive(e.target.checked)}
            className="w-3.5 h-3.5 accent-brand-green"
          />
          Show closed batches
        </label>
      </div>

      {/* Batch grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-gray-100 dark:bg-dark-card rounded-2xl h-48 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <Bird className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-semibold">No batches found</p>
          <p className="text-sm mt-1">
            {stageFilter ? `No ${STAGE_CONFIG[stageFilter as keyof typeof STAGE_CONFIG]?.label} batches` : 'Register your first batch to get started'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((batch: any) => (
            <BatchCard key={batch.id} batch={batch} />
          ))}
        </div>
      )}

      {/* New Batch Modal */}
      {showNewBatch && (
        <NewBatchModal onClose={() => setShowNewBatch(false)} />
      )}

      {/* Jargon reference */}
      <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-4">
        <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5" /> Farm Terminology
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1 text-xs text-gray-500 dark:text-gray-400">
          {[
            { term: 'HDP %', def: 'Hen-Day Production — eggs/hens/day × 100. Healthy: 70–85%.' },
            { term: 'FCR',   def: 'Feed Conversion Ratio — kg feed ÷ kg output. Lower = better.' },
            { term: 'Brooding', def: '0–6 weeks. Chicks need heat lamps and starter feed.' },
            { term: 'Point of Lay', def: 'Age when pullets begin laying (typically ~18–20 weeks).' },
          ].map(({ term, def }) => (
            <div key={term} className="flex gap-2 p-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-dark-bg transition-colors">
              <span className="font-bold text-brand-green w-20 flex-shrink-0">{term}</span>
              <span>{def}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
