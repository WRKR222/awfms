import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Bird, Calendar, Home, Info, ChevronRight, Plus, CheckCircle, Clock, XCircle, TrendingUp, Hash, Layers, X, AlertTriangle } from 'lucide-react';
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
  SOLD: {
    label: 'Sold',
    color: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400',
    dot: 'bg-emerald-500',
    tip: 'Batch sold. Historical egg + feed data preserved for analytics comparison.',
  },
  DISCARDED: {
    label: 'Discarded',
    color: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
    dot: 'bg-red-400',
    tip: 'Batch discarded (culled for non-commercial reasons). Historical data preserved.',
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

function BatchCard({ batch }: { batch: any }) {
  // Log Culling removed — culling is a Farm Event handled in Farm Events page (/manager/culling)
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
          onClick={() => navigate('/manager/culling')}
          className="w-full mt-1 border border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400 rounded-xl py-2 text-xs font-semibold hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors flex items-center justify-center gap-1.5"
        >
          <AlertTriangle className="w-3.5 h-3.5" /> Log Farm Event
        </button>
      )}
      {/* Culling, BATCH_SOLD, BATCH_DISCARDED and all farm events are managed on the Farm Events page */}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

// ── New Batch Modal ─────────────────────────────────────────────────────────
//
// Per `changes.pdf` (Production Manager) + Anza Whole Foods Summary:
//   • All fields are typed (free text) EXCEPT:
//       - "Assign To" (Brooder vs Production House)  — select
//       - "Vaccinated on arrival"                    — checkbox
//   • If assigned to the Production House, the manager must record the number
//     of birds placed in each row of each unit (Unit A: A1/A2, B: B1/B2, C: C1/C2).
//     Block 2 is under construction and is not selectable.
//   • Required typed fields: batchCode, batchAge, supplierName, birdType,
//     birdBreed, quantityReceived, dayOfHatch, houseId, weight (kg).
//   • `vaccinesGiven` is required only when "Vaccinated on arrival" is ticked.
//   • Notes are optional.

const BATCH_LOCATIONS = [
  { value: 'BROODER',          label: 'Brooder' },
  { value: 'PRODUCTION_HOUSE', label: 'Production House (Block 1)' },
];

// Production-house unit/row layout — Block 1 only. Block 2 is under construction.
const PRODUCTION_HOUSE_UNITS: { unit: 'A' | 'B' | 'C'; rows: string[] }[] = [
  { unit: 'A', rows: ['A1', 'A2'] },
  { unit: 'B', rows: ['B1', 'B2'] },
  { unit: 'C', rows: ['C1', 'C2'] },
];

type RowPlacementMap = Record<string, string>; // rowCode -> bird count (kept as string for input handling)

function emptyRowPlacements(): RowPlacementMap {
  return PRODUCTION_HOUSE_UNITS.flatMap(u => u.rows).reduce((acc, r) => {
    acc[r] = '';
    return acc;
  }, {} as RowPlacementMap);
}

function NewBatchModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, watch, formState: { errors } } = useForm({
    defaultValues: {
      batchCode: '',
      batchAge: '',
      supplierName: '',
      birdType: '',
      birdBreed: '',
      location: 'BROODER',
      quantityReceived: '',
      dayOfHatch: dayjs().format('YYYY-MM-DD'),
      houseId: '',
      weightKg: '',
      vaccinatedOnArrival: false,
      vaccinesGiven: '',
      notes: '',
    },
  });

  const location           = watch('location');
  const vaccinatedOnArrival = watch('vaccinatedOnArrival');
  const quantityReceived   = Number(watch('quantityReceived') || 0);

  // Per-row bird placements (only used when Assign To = Production House)
  const [rowPlacements, setRowPlacements] = useState<RowPlacementMap>(emptyRowPlacements);
  const [placementError, setPlacementError] = useState<string | null>(null);

  const placedTotal = Object.values(rowPlacements)
    .reduce((sum, v) => sum + (Number(v) || 0), 0);

  const create = useMutation({
    mutationFn: (data: any) => {
      const payload: any = {
        batchCode: data.batchCode,
        batchAge: data.batchAge,
        supplierName: data.supplierName,
        birdType: data.birdType,
        birdBreed: data.birdBreed,
        location: data.location,
        quantityReceived: Number(data.quantityReceived),
        dateOfHatch: data.dayOfHatch,
        houseId: data.houseId,
        arrivalWeightKg: Number(data.weightKg),
        vaccinatedOnArrival: !!data.vaccinatedOnArrival,
        vaccinesGiven: data.vaccinatedOnArrival ? data.vaccinesGiven : undefined,
        notes: data.notes || undefined,
        isActive: true,
      };
      if (data.location === 'PRODUCTION_HOUSE') {
        payload.rowPlacements = Object.entries(rowPlacements)
          .map(([rowCode, count]) => ({ rowCode, birdCount: Number(count) || 0 }));
      }
      return api.post('/flock/batches', payload).then(r => r.data);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['batches'] }); onClose(); },
  });

  const onSubmit = (data: any) => {
    setPlacementError(null);
    if (data.location === 'PRODUCTION_HOUSE') {
      if (placedTotal !== Number(data.quantityReceived)) {
        setPlacementError(
          `Birds placed across rows (${placedTotal}) must equal Quantity Received (${data.quantityReceived || 0}).`,
        );
        return;
      }
    }
    create.mutate(data);
  };

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

        <form onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-4">

          {/* Identification ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={lCls}>Batch Code *</label>
              <input {...register('batchCode', { required: 'Required' })} className={iCls} placeholder="e.g. BLK1-2024-A" />
              {errors.batchCode && <p className="text-red-500 text-xs mt-1">{(errors.batchCode as any).message}</p>}
            </div>
            <div>
              <label className={lCls}>Batch Age *</label>
              <input {...register('batchAge', { required: 'Required' })} className={iCls} placeholder="e.g. 1 day, 4 weeks" />
              {errors.batchAge && <p className="text-red-500 text-xs mt-1">{(errors.batchAge as any).message}</p>}
            </div>
            <div>
              <label className={lCls}>Supplier Name *</label>
              <input {...register('supplierName', { required: 'Required' })} className={iCls} placeholder="e.g. Kenchic Limited" />
              {errors.supplierName && <p className="text-red-500 text-xs mt-1">{(errors.supplierName as any).message}</p>}
            </div>
            <div>
              <label className={lCls}>Bird Type *</label>
              {/* FIX: was free-text input — now dropdown with valid DB enum values */}
              <select {...register('birdType', { required: 'Required' })} className={iCls}>
                <option value="">Select bird type…</option>
                <option value="LAYER_COMMERCIAL">Layer (Commercial) — high egg output</option>
                <option value="KIENYEJI">Kienyeji — indigenous / dual-purpose</option>
              </select>
              {errors.birdType && <p className="text-red-500 text-xs mt-1">{(errors.birdType as any).message}</p>}
            </div>
            <div>
              <label className={lCls}>Bird Breed *</label>
              <input {...register('birdBreed', { required: 'Required' })} className={iCls} placeholder="e.g. Isa Brown, Lohmann, Kuroiler" />
              {errors.birdBreed && <p className="text-red-500 text-xs mt-1">{(errors.birdBreed as any).message}</p>}
            </div>
            <div>
              <label className={lCls}>Assign To *</label>
              <select {...register('location', { required: true })} className={iCls}>
                {BATCH_LOCATIONS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
              <p className="text-[10px] text-gray-400 mt-1">Block 2 is under construction.</p>
            </div>
            <div>
              <label className={lCls}>Quantity Received *</label>
              <input {...register('quantityReceived', { required: 'Required', min: 1 })} type="number" min="1" className={iCls} placeholder="e.g. 5000" />
              {errors.quantityReceived && <p className="text-red-500 text-xs mt-1">{(errors.quantityReceived as any).message}</p>}
            </div>
            <div>
              <label className={lCls}>Day of Hatch *</label>
              <input {...register('dayOfHatch', { required: true })} type="date" className={iCls} />
            </div>
            <div>
              <label className={lCls}>House ID *</label>
              <input {...register('houseId', { required: 'Required' })} className={iCls} placeholder="e.g. BROODER-01 or BLK1-A" />
              {errors.houseId && <p className="text-red-500 text-xs mt-1">{(errors.houseId as any).message}</p>}
            </div>
            <div>
              <label className={lCls}>Weight on Arrival (kg / bird) *</label>
              <input {...register('weightKg', { required: 'Required', min: 0 })} type="number" step="0.001" min="0" className={iCls} placeholder="e.g. 0.045" />
              {errors.weightKg && <p className="text-red-500 text-xs mt-1">{(errors.weightKg as any).message}</p>}
            </div>
          </div>

          {/* Vaccination on arrival ───────────────────────────────────────── */}
          <div className="bg-gray-50 dark:bg-dark-bg rounded-xl p-3 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input {...register('vaccinatedOnArrival')} type="checkbox" className="w-4 h-4 accent-brand-green" />
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Vaccinated on arrival</span>
            </label>
            {vaccinatedOnArrival && (
              <div>
                <label className={lCls}>Vaccines Given *</label>
                <input
                  {...register('vaccinesGiven', { required: vaccinatedOnArrival ? 'List the vaccines given' : false })}
                  className={iCls}
                  placeholder="e.g. Marek’s Disease, Newcastle ND1, IB…"
                />
                {errors.vaccinesGiven && <p className="text-red-500 text-xs mt-1">{(errors.vaccinesGiven as any).message}</p>}
              </div>
            )}
          </div>

          {/* Production-house row placements ──────────────────────────────── */}
          {location === 'PRODUCTION_HOUSE' && (
            <div className="bg-brand-green/5 dark:bg-brand-green/10 border border-brand-green/30 rounded-xl p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                  Birds Placed Per Row (Block 1)
                </p>
                <p className={`text-xs font-semibold ${
                  placedTotal === quantityReceived && quantityReceived > 0
                    ? 'text-brand-green'
                    : 'text-gray-500'
                }`}>
                  {placedTotal} / {quantityReceived || 0}
                </p>
              </div>
              {PRODUCTION_HOUSE_UNITS.map(({ unit, rows }) => (
                <div key={unit}>
                  <p className="text-[11px] uppercase tracking-wide font-bold text-gray-500 dark:text-gray-400 mb-1.5">
                    Unit {unit}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {rows.map(rowCode => (
                      <div key={rowCode}>
                        <label className={lCls}>Row {rowCode}</label>
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={rowPlacements[rowCode]}
                          onChange={e => setRowPlacements(p => ({ ...p, [rowCode]: e.target.value }))}
                          className={iCls}
                          placeholder="0"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {placementError && (
                <p className="text-red-500 text-xs">{placementError}</p>
              )}
              <p className="text-[10px] text-gray-400">
                The sum of birds placed across all rows must equal the Quantity Received.
              </p>
            </div>
          )}

          {/* Notes ─────────────────────────────────────────────────────── */}
          <div>
            <label className={lCls}>Notes (optional)</label>
            <textarea {...register('notes')} rows={2} className={iCls} placeholder="Optional notes…" />
          </div>

          {create.isError && <p className="text-red-500 text-sm">Failed to create batch. Please try again.</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 rounded-xl py-3 font-semibold">Cancel</button>
            <button type="submit" disabled={create.isPending} className="flex-1 bg-brand-green text-white rounded-xl py-3 font-semibold disabled:opacity-60">
              {create.isPending ? 'Creating…' : 'Create Batch'}
            </button>
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
