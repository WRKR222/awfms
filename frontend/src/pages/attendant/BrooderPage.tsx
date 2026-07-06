// src/pages/attendant/BrooderPage.tsx
//
// Redesigned brooder control — cage map and daily logs are unified on one page.
// No tabs. The cage map is always visible. Daily log panels open as context
// drawers anchored to the batch/level being recorded.
//
// Changes from v1:
//   • Daily logs record 3 sessions per day: MORNING / MIDDAY / EVENING, each
//     timestamped. Water, temperature, humidity, and light intensity per session.
//   • Feed and feed-type removed — handled exclusively via cage map feed logs.
//   • Mortality removed from daily log form — strictly via cage map mortality
//     button (now shown prominently as a red action on occupied cells).
//   • Vaccines include dose + route → auto-creates VaccinationRecord.
//   • Supplements include dose.
//   • New Treatment section: drug name, dose, dose unit, row, level.
//   • Log history grouped by date with sessions shown as a compact timeline.

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api } from '../../lib/api';
import dayjs from '../../lib/dayjs';
import {
  Bird, Thermometer, Droplets, Sun, Plus, X, AlertTriangle,
  ChevronDown, ChevronUp, Flame, Calendar, Clock, HeartCrack,
  Syringe, Pill, FlaskConical, Stethoscope, CheckCircle2,
  Gauge, Wind, ChevronRight, ClipboardList,
} from 'lucide-react';
import { BrooderCageMapGrid }        from '../../components/shared/BrooderCageMapGrid';
import { BrooderFeedRequirement }    from '../../components/shared/BrooderFeedRequirement';
import { BrooderLevelAssignModal }   from '../../components/shared/BrooderLevelAssignModal';
import { BrooderReassignModal }      from '../../components/shared/BrooderReassignModal';
import { BrooderHeatLogModal }       from '../../components/shared/BrooderHeatLogModal';
import { BrooderLevelFeedLogModal }  from '../../components/shared/BrooderLevelFeedLogModal';
import { BrooderMortalityLogModal }  from '../../components/shared/BrooderMortalityLogModal';
import { BrooderGeneralRecordModal } from '../../components/shared/BrooderGeneralRecordModal';
import { BrooderWeightLogModal }     from '../../components/shared/BrooderWeightLogModal';
import { BrooderControlStandardPanel } from '../../components/shared/BrooderControlStandardPanel';
import { useBrooderCageMap, useBrooderRowsAndLevels } from '../../hooks/useBrooderCageMap';
import type { BrooderLevelData, BrooderRowData } from '../../hooks/useBrooderCageMap';
import { useIssuableStoreItems, MEDICATION_CATEGORIES } from '../../hooks/useIssuableStoreItems';

// ── Constants ─────────────────────────────────────────────────────────────────

const SESSION_OPTIONS = [
  { value: 'MORNING', label: 'Morning',  icon: '🌅', color: 'text-orange-500' },
  { value: 'MIDDAY',  label: 'Midday',   icon: '☀️',  color: 'text-amber-500'  },
  { value: 'EVENING', label: 'Evening',  icon: '🌙',  color: 'text-indigo-500' },
] as const;

const VACCINE_ROUTES = [
  { value: 'DRINKING_WATER', label: 'Drinking Water' },
  { value: 'EYE_DROP',       label: 'Eye Drop'       },
  { value: 'INJECTION',      label: 'Injection'      },
  { value: 'SPRAY',          label: 'Spray'          },
  { value: 'WING_WEB',       label: 'Wing Web'       },
  { value: 'OTHER',          label: 'Other'          },
];

const TREATMENT_ROUTES = [
  { value: 'DRINKING_WATER', label: 'Drinking Water' },
  { value: 'INJECTION',      label: 'Injection'      },
  { value: 'ORAL',           label: 'Oral (direct)'  },
  { value: 'TOPICAL',        label: 'Topical'        },
  { value: 'OTHER',          label: 'Other'          },
];

const DOSE_UNITS = ['ml', 'mg', 'g', 'L', 'IU', 'drops', 'sachets'];

// ── Shared input styles ───────────────────────────────────────────────────────

const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-500';
const lCls = 'block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BrooderBatch {
  id:               string;
  batchCode:        string;
  currentBirdCount: number;
  quantityReceived: number;
  dateOfHatch:      string;
  stage:            string;
  location:         string;
  supplierName?:    string;
  supplier?:        { name: string };
  isActive:         boolean;
}

interface VaccineEntry    { name: string; dose: string; route?: string; }
interface SupplementEntry { name: string; dose: string; }

interface BrooderLog {
  id:                string;
  batchId:           string;
  logDate:           string;
  logSession?:       'MORNING' | 'MIDDAY' | 'EVENING' | null;
  waterConsumptionL?: number;
  temperature?:      number;
  humidityPercent?:  number;
  lightIntensityLux?: number;
  lightingOk:        boolean;
  // Legacy single-entry fields (still populated for backward compat)
  vaccineGiven?:     string;
  vaccineGivenDose?: string;
  supplement?:       string;
  supplementDose?:   string;
  // Preferred multi-entry JSON arrays
  vaccinesJson?:     VaccineEntry[]    | null;
  supplementsJson?:  SupplementEntry[] | null;
  notes?:            string;
  createdAt?:        string;
  loggedBy?:         { fullName: string };
  row?:              { label: string } | null;
  level?:            { label: string } | null;
}

// Per-day feed/mortality rollup from GET /brooder/batches/:id/population-record-sheet.
// `source` tells you which method covered that date — GENERAL means the Lead
// Attendant used General Record (whole batch, no row/level breakdown);
// ROW_LEVEL means it came from the per-row/level feed & mortality logs. The
// backend enforces these are mutually exclusive per (batch, date), so a date
// only ever has one source.
interface PopulationRecordDay {
  date:           string;
  source:         'GENERAL' | 'ROW_LEVEL' | null;
  feedKg:         number;
  mortalityCount: number;
  cullingCount:   number;
}

interface TreatmentLog {
  id:            string;
  batchId:       string;
  treatmentDate: string;
  drugName:      string;
  dose:          string;
  doseUnit:      string;
  route:         string;
  durationDays?: number;
  notes?:        string;
  createdAt?:    string;
  loggedBy?:     { fullName: string };
  row?:          { label: string } | null;
  level?:        { label: string } | null;
}

// ── Session timeline (grouped log history display) ────────────────────────────

function sessionMeta(s?: string | null) {
  // NOTE: a null/missing logSession means this is a Daily Entry (environmental
  // readings logged once for the day rather than per MORNING/MIDDAY/EVENING
  // session) — NOT a "General Record". General Records are a separate concept
  // (batch-wide feed/mortality logged when birds can't be tracked per row/
  // level) rendered by <PopulationRecordSummary>, so the label here must stay
  // distinct from that term or the two get confused in the timeline.
  return SESSION_OPTIONS.find(o => o.value === s) ?? { icon: '📋', label: 'Daily', color: 'text-gray-500' };
}

function SessionEntry({ log }: { log: BrooderLog }) {
  const meta = sessionMeta(log.logSession);
  return (
    <div className="flex gap-2 items-start">
      {/* Timeline dot */}
      <div className="flex flex-col items-center pt-0.5">
        <span className="text-base leading-none">{meta.icon}</span>
        <div className="w-px flex-1 bg-gray-200 dark:bg-gray-700 mt-1 min-h-[8px]" />
      </div>
      {/* Content */}
      <div className="pb-3 flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[11px] font-bold uppercase tracking-wide ${meta.color}`}>
            {meta.label}
          </span>
          {log.createdAt && (
            <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
              <Clock className="w-2.5 h-2.5" />
              {dayjs(log.createdAt).format('HH:mm')}
            </span>
          )}
          {log.loggedBy && (
            <span className="text-[10px] text-gray-400">· {log.loggedBy.fullName}</span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-600 dark:text-gray-300">
          {log.temperature    != null && <span className="flex items-center gap-1"><Thermometer className="w-3 h-3 text-orange-400" />{log.temperature}°C</span>}
          {log.humidityPercent != null && <span className="flex items-center gap-1"><Gauge className="w-3 h-3 text-blue-400" />{log.humidityPercent}%</span>}
          {log.waterConsumptionL != null && <span className="flex items-center gap-1"><Droplets className="w-3 h-3 text-sky-400" />{log.waterConsumptionL}L</span>}
          {log.lightIntensityLux != null && <span className="flex items-center gap-1"><Sun className="w-3 h-3 text-amber-400" />{log.lightIntensityLux} lux</span>}
          {!log.lightingOk && <span className="flex items-center gap-1 text-red-400"><AlertTriangle className="w-3 h-3" />Lighting issue</span>}
        </div>
        {(log.vaccineGiven || log.supplement || log.vaccinesJson?.length || log.supplementsJson?.length) && (
          <div className="mt-1 flex flex-col gap-1 text-[11px]">
            {/* Prefer JSON arrays; fall back to legacy single-entry fields */}
            {(log.vaccinesJson && log.vaccinesJson.length > 0
              ? log.vaccinesJson
              : log.vaccineGiven ? [{ name: log.vaccineGiven, dose: log.vaccineGivenDose ?? '' }] : []
            ).map((v, i) => (
              <span key={i} className="flex items-center gap-1 text-purple-600 dark:text-purple-400">
                <Syringe className="w-3 h-3 flex-shrink-0" />
                {v.name}{v.dose ? ` · ${v.dose}` : ''}
              </span>
            ))}
            {(log.supplementsJson && log.supplementsJson.length > 0
              ? log.supplementsJson
              : log.supplement ? [{ name: log.supplement, dose: log.supplementDose ?? '' }] : []
            ).map((s, i) => (
              <span key={i} className="flex items-center gap-1 text-teal-600 dark:text-teal-400">
                <FlaskConical className="w-3 h-3 flex-shrink-0" />
                {s.name}{s.dose ? ` · ${s.dose}` : ''}
              </span>
            ))}
          </div>
        )}
        {log.notes && <p className="mt-1 text-[10px] text-gray-400 italic">{log.notes}</p>}
      </div>
    </div>
  );
}

// ── Session Log Modal (temperature / humidity / light — 3× per day) ────────────────

function SessionLogModal({ batch, onClose }: { batch: BrooderBatch; onClose: () => void }) {
  const qc    = useQueryClient();
  const today = dayjs().format('YYYY-MM-DD');
  const min   = dayjs(batch.dateOfHatch).format('YYYY-MM-DD');

  const { register, handleSubmit, watch, formState: { errors } } = useForm({
    defaultValues: {
      logDate:          today,
      logSession:       'MORNING',
      temperature:      '',
      humidityPercent:  '',
      lightIntensityLux: '',
      lightingOk:       true,
      notes:            '',
    },
  });

  const logDate     = watch('logDate');
  const isBackdated = logDate < today;
  const daysBack    = logDate ? dayjs(today).diff(dayjs(logDate), 'day') : 0;

  const submit = useMutation({
    mutationFn: (data: any) => api.post('/flock/brooder-logs', {
      batchId:           batch.id,
      logDate:           data.logDate,
      logSession:        data.logSession,          // REQUIRED — MORNING | MIDDAY | EVENING
      temperature:       data.temperature        ? Number(data.temperature)        : undefined,
      humidityPercent:   data.humidityPercent    ? Number(data.humidityPercent)    : undefined,
      lightIntensityLux: data.lightIntensityLux  ? Number(data.lightIntensityLux)  : undefined,
      lightingOk:        data.lightingOk,
      notes:             data.notes || undefined,
    }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brooder-logs',     batch.id] });
      qc.invalidateQueries({ queryKey: ['brooder-last-log', batch.id] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white dark:bg-dark-card w-full md:max-w-lg rounded-t-3xl md:rounded-2xl shadow-2xl overflow-y-auto max-h-[95vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-dark-border sticky top-0 bg-white dark:bg-dark-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-orange-500 rounded-xl flex items-center justify-center">
              <Thermometer className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-bold text-gray-800 dark:text-gray-100">Session Environmental Log</p>
              <p className="text-xs text-gray-400">{batch.batchCode} · temperature / humidity / light · 3× per day</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-bg">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit(d => submit.mutate(d))} className="p-5 space-y-5">

          {/* ── Date + Session ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={lCls}><Calendar className="w-3 h-3 inline mr-1" />Date</label>
              <input {...register('logDate', { required: true })} type="date" min={min} max={today} className={iCls} />
              {isBackdated && daysBack > 0 && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Backdated {daysBack}d — will record against {dayjs(logDate).format('D MMM')}
                </p>
              )}
            </div>
            <div>
              <label className={lCls}><Clock className="w-3 h-3 inline mr-1" />Session</label>
              <div className="grid grid-cols-3 gap-1">
                {SESSION_OPTIONS.map(s => {
                  const val = watch('logSession');
                  return (
                    <label key={s.value} className={`flex flex-col items-center gap-0.5 p-2 rounded-xl border cursor-pointer text-center transition-colors ${
                      val === s.value
                        ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20'
                        : 'border-gray-200 dark:border-dark-border hover:bg-gray-50 dark:hover:bg-dark-bg'
                    }`}>
                      <input {...register('logSession')} type="radio" value={s.value} className="sr-only" />
                      <span className="text-lg">{s.icon}</span>
                      <span className={`text-[10px] font-bold ${val === s.value ? 'text-orange-600' : 'text-gray-500'}`}>{s.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Environmental readings ── */}
          <div>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">Environmental Readings</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={lCls}><Thermometer className="w-3 h-3 inline mr-1 text-orange-400" />Temp (°C)</label>
                <input {...register('temperature')} type="number" step="0.1" className={iCls} placeholder="e.g. 32" />
              </div>
              <div>
                <label className={lCls}><Gauge className="w-3 h-3 inline mr-1 text-blue-400" />Humidity (%)</label>
                <input {...register('humidityPercent')} type="number" step="1" min="0" max="100" className={iCls} placeholder="e.g. 60" />
              </div>
              <div>
                <label className={lCls}><Sun className="w-3 h-3 inline mr-1 text-amber-400" />Light (lux)</label>
                <input {...register('lightIntensityLux')} type="number" min="0" className={iCls} placeholder="e.g. 20" />
              </div>
            </div>
            <label className="mt-2 flex items-center gap-2 cursor-pointer p-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/20">
              <input {...register('lightingOk')} type="checkbox" className="w-4 h-4 accent-amber-500" />
              <Sun className="w-4 h-4 text-amber-500" />
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Lighting adequate</span>
            </label>
          </div>

          {/* ── Notes ── */}
          <div>
            <label className={lCls}>Notes (optional)</label>
            <textarea {...register('notes')} rows={2} className={`${iCls} resize-none`} placeholder="Observations, concerns..." />
          </div>

          {submit.isError && (
            <p className="text-red-500 text-sm bg-red-50 dark:bg-red-900/20 rounded-xl p-3">
              {(submit.error as any)?.response?.data?.message ?? 'Failed to save. Please try again.'}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 rounded-xl py-3 font-semibold text-sm">
              Cancel
            </button>
            <button type="submit" disabled={submit.isPending}
              className="flex-1 bg-orange-500 text-white rounded-xl py-3 font-semibold text-sm disabled:opacity-60">
              {submit.isPending ? 'Saving…' : isBackdated ? `Save for ${dayjs(logDate).format('D MMM')}` : 'Save Session'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Daily Entry Modal (water / vaccines / supplements — once per day) ────────────────

interface VaccineItem  { storeItemId: string; name: string; dose: string; route: string; quantityUsed: string; }
interface SupplementItem { storeItemId: string; name: string; dose: string; quantityUsed: string; }

function DailyEntryModal({ batch, onClose }: { batch: BrooderBatch; onClose: () => void }) {
  const qc    = useQueryClient();
  const today = dayjs().format('YYYY-MM-DD');
  const min   = dayjs(batch.dateOfHatch).format('YYYY-MM-DD');

  const { register, handleSubmit, watch } = useForm({
    defaultValues: {
      logDate:           today,
      waterConsumptionL: '',
      notes:             '',
    },
  });

  const [vaccines,    setVaccines]    = useState<VaccineItem[]>([]);
  const [supplements, setSupplements] = useState<SupplementItem[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Vaccines/supplements can only be logged against a medication item Store
  // has actually issued (stock-out) this week.
  const { data: medItemsRaw, isLoading: medItemsLoading } = useIssuableStoreItems(MEDICATION_CATEGORIES);
  const medItems = medItemsRaw ?? [];

  const logDate     = watch('logDate');
  const isBackdated = logDate < today;
  const daysBack    = logDate ? dayjs(today).diff(dayjs(logDate), 'day') : 0;

  function addVaccine()    { setVaccines(v => [...v, { storeItemId: '', name: '', dose: '', route: 'DRINKING_WATER', quantityUsed: '' }]); }
  function removeVaccine(i: number) { setVaccines(v => v.filter((_, j) => j !== i)); }
  function updateVaccine(i: number, field: keyof VaccineItem, val: string) {
    setVaccines(v => v.map((item, j) => {
      if (j !== i) return item;
      const next = { ...item, [field]: val };
      if (field === 'storeItemId') {
        const picked = medItems.find(m => m.id === val);
        next.name = picked?.name ?? '';
      }
      return next;
    }));
  }

  function addSupplement()    { setSupplements(s => [...s, { storeItemId: '', name: '', dose: '', quantityUsed: '' }]); }
  function removeSupplement(i: number) { setSupplements(s => s.filter((_, j) => j !== i)); }
  function updateSupplement(i: number, field: keyof SupplementItem, val: string) {
    setSupplements(s => s.map((item, j) => {
      if (j !== i) return item;
      const next = { ...item, [field]: val };
      if (field === 'storeItemId') {
        const picked = medItems.find(m => m.id === val);
        next.name = picked?.name ?? '';
      }
      return next;
    }));
  }

  const submit = useMutation({
    mutationFn: async (data: any) => {
      const cleanVaccines    = vaccines.filter(v => v.storeItemId && v.name.trim());
      const cleanSupplements = supplements.filter(s => s.storeItemId && s.name.trim());

      // Single POST — backend accepts vaccines[] and supplements[] arrays.
      // No more parallel requests that race against the once-daily uniqueness check.
      return api.post('/flock/brooder-logs', {
        batchId:           batch.id,
        logDate:           data.logDate,
        logSession:        undefined,   // null/absent = once-daily entry
        waterConsumptionL: data.waterConsumptionL ? Number(data.waterConsumptionL) : undefined,
        vaccines:          cleanVaccines.map(v => ({
          name:         v.name.trim(),
          dose:         v.dose.trim(),
          route:        v.route,
          storeItemId:  v.storeItemId,
          quantityUsed: v.quantityUsed ? Number(v.quantityUsed) : undefined,
        })),
        supplements:       cleanSupplements.map(s => ({
          name:         s.name.trim(),
          dose:         s.dose.trim(),
          storeItemId:  s.storeItemId,
          quantityUsed: s.quantityUsed ? Number(s.quantityUsed) : undefined,
        })),
        notes:             data.notes || undefined,
      }).then(r => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brooder-logs',     batch.id] });
      qc.invalidateQueries({ queryKey: ['brooder-last-log', batch.id] });
      qc.invalidateQueries({ queryKey: ['store-issuable-items'] });
      onClose();
    },
    onError: (err: any) => {
      setSubmitError(err?.response?.data?.message ?? err?.message ?? 'Failed to save. Please try again.');
    },
  });

  function onFormSubmit(data: any) {
    setSubmitError(null);
    const cleanVaccines    = vaccines.filter(v => v.storeItemId && v.name.trim());
    const cleanSupplements = supplements.filter(s => s.storeItemId && s.name.trim());
    if (cleanVaccines.some(v => !v.dose.trim())) { setSubmitError('Each vaccine entry must have a dose.'); return; }
    if (cleanSupplements.some(s => !s.dose.trim())) { setSubmitError('Each supplement entry must have a dose.'); return; }
    submit.mutate(data);
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white dark:bg-dark-card w-full md:max-w-lg rounded-t-3xl md:rounded-2xl shadow-2xl overflow-y-auto max-h-[95vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-dark-border sticky top-0 bg-white dark:bg-dark-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-500 rounded-xl flex items-center justify-center">
              <Flame className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-bold text-gray-800 dark:text-gray-100">Daily Entry</p>
              <p className="text-xs text-gray-400">{batch.batchCode} · water / vaccines / supplements · once per day</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-bg">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onFormSubmit)} className="p-5 space-y-5">

          {/* ── Date ── */}
          <div>
            <label className={lCls}><Calendar className="w-3 h-3 inline mr-1" />Date</label>
            <input {...register('logDate', { required: true })} type="date" min={min} max={today} className={iCls} />
            {isBackdated && daysBack > 0 && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Backdated {daysBack}d — will record against {dayjs(logDate).format('D MMM')}
              </p>
            )}
          </div>

          {/* Info callout */}
          <div className="rounded-xl bg-sky-50 dark:bg-sky-900/20 border border-sky-100 dark:border-sky-900/30 p-3 text-[11px] text-sky-700 dark:text-sky-300 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>This entry is recorded <strong>once per day</strong>. Temperature, humidity, and light intensity are logged separately per session (Morning / Midday / Evening).</span>
          </div>

          {/* ── Water ── */}
          <div>
            <label className={lCls}><Droplets className="w-3 h-3 inline mr-1 text-sky-400" />Water Consumed (L)</label>
            <input {...register('waterConsumptionL')} type="number" step="0.1" min="0" className={iCls} placeholder="e.g. 25" />
          </div>

          {/* ── Vaccines ── */}
          <div className="rounded-xl border border-purple-100 dark:border-purple-900/30 bg-purple-50/50 dark:bg-purple-900/10 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-widest flex items-center gap-1.5">
                <Syringe className="w-3 h-3" /> Vaccines
              </p>
              <button type="button" onClick={addVaccine}
                className="text-xs font-semibold text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add vaccine
              </button>
            </div>
            {vaccines.length === 0 && (
              <p className="text-[11px] text-gray-400 italic">No vaccines added. Tap 'Add vaccine' to log one.</p>
            )}
            {!medItemsLoading && medItems.length === 0 && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                No vaccines/medication issued from the store this week yet.
              </p>
            )}
            {vaccines.map((v, i) => {
              const picked = medItems.find(m => m.id === v.storeItemId);
              return (
              <div key={i} className="bg-white dark:bg-dark-bg rounded-xl border border-purple-100 dark:border-purple-800 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-purple-600 dark:text-purple-400">Vaccine {i + 1}</span>
                  <button type="button" onClick={() => removeVaccine(i)} className="text-gray-400 hover:text-red-500">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div>
                  <label className={lCls}>Vaccine *</label>
                  <select value={v.storeItemId} onChange={e => updateVaccine(i, 'storeItemId', e.target.value)}
                    className={iCls} disabled={medItemsLoading}>
                    <option value="">{medItemsLoading ? 'Loading…' : 'Select vaccine…'}</option>
                    {medItems.map(m => (
                      <option key={m.id} value={m.id}>{m.name} — residual {m.residual.toFixed(2)} {m.unit.toLowerCase()}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={lCls}>Dose *</label>
                    <input value={v.dose} onChange={e => updateVaccine(i, 'dose', e.target.value)}
                      className={iCls} placeholder="e.g. 1 drop/bird" />
                  </div>
                  <div>
                    <label className={lCls}>Route</label>
                    <select value={v.route} onChange={e => updateVaccine(i, 'route', e.target.value)} className={iCls}>
                      {VACCINE_ROUTES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className={lCls}>Quantity used{picked ? ` (${picked.unit.toLowerCase()})` : ''}</label>
                  <input value={v.quantityUsed} onChange={e => updateVaccine(i, 'quantityUsed', e.target.value)}
                    type="number" step="0.01" min="0" className={iCls}
                    placeholder={picked ? `Residual: ${picked.residual.toFixed(2)} ${picked.unit.toLowerCase()}` : 'Select a vaccine first'} />
                </div>
              </div>
              );
            })}
            <p className="text-[10px] text-purple-500 dark:text-purple-400">
              Vaccines auto-appear in Vaccination History under the Manager's Health page.
            </p>
          </div>

          {/* ── Supplements ── */}
          <div className="rounded-xl border border-teal-100 dark:border-teal-900/30 bg-teal-50/50 dark:bg-teal-900/10 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold text-teal-600 dark:text-teal-400 uppercase tracking-widest flex items-center gap-1.5">
                <FlaskConical className="w-3 h-3" /> Supplements
              </p>
              <button type="button" onClick={addSupplement}
                className="text-xs font-semibold text-teal-600 dark:text-teal-400 hover:underline flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add supplement
              </button>
            </div>
            {supplements.length === 0 && (
              <p className="text-[11px] text-gray-400 italic">No supplements added. Tap 'Add supplement' to log one.</p>
            )}
            {supplements.map((s, i) => {
              const picked = medItems.find(m => m.id === s.storeItemId);
              return (
              <div key={i} className="bg-white dark:bg-dark-bg rounded-xl border border-teal-100 dark:border-teal-800 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-teal-600 dark:text-teal-400">Supplement {i + 1}</span>
                  <button type="button" onClick={() => removeSupplement(i)} className="text-gray-400 hover:text-red-500">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div>
                  <label className={lCls}>Supplement *</label>
                  <select value={s.storeItemId} onChange={e => updateSupplement(i, 'storeItemId', e.target.value)}
                    className={iCls} disabled={medItemsLoading}>
                    <option value="">{medItemsLoading ? 'Loading…' : 'Select supplement…'}</option>
                    {medItems.map(m => (
                      <option key={m.id} value={m.id}>{m.name} — residual {m.residual.toFixed(2)} {m.unit.toLowerCase()}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={lCls}>Dose *</label>
                  <input value={s.dose} onChange={e => updateSupplement(i, 'dose', e.target.value)}
                    className={iCls} placeholder="e.g. 2g/L water" />
                </div>
                <div>
                  <label className={lCls}>Quantity used{picked ? ` (${picked.unit.toLowerCase()})` : ''}</label>
                  <input value={s.quantityUsed} onChange={e => updateSupplement(i, 'quantityUsed', e.target.value)}
                    type="number" step="0.01" min="0" className={iCls}
                    placeholder={picked ? `Residual: ${picked.residual.toFixed(2)} ${picked.unit.toLowerCase()}` : 'Select a supplement first'} />
                </div>
              </div>
              );
            })}
          </div>

          {/* ── Notes ── */}
          <div>
            <label className={lCls}>Notes (optional)</label>
            <textarea {...register('notes')} rows={2} className={`${iCls} resize-none`} placeholder="Observations, concerns..." />
          </div>

          {(submit.isError || submitError) && (
            <p className="text-red-500 text-sm bg-red-50 dark:bg-red-900/20 rounded-xl p-3">
              {submitError ?? (submit.error as any)?.response?.data?.message ?? 'Failed to save. Please try again.'}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 rounded-xl py-3 font-semibold text-sm">
              Cancel
            </button>
            <button type="submit" disabled={submit.isPending}
              className="flex-1 bg-amber-500 text-white rounded-xl py-3 font-semibold text-sm disabled:opacity-60">
              {submit.isPending ? 'Saving…' : isBackdated ? `Save for ${dayjs(logDate).format('D MMM')}` : 'Save Entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Treatment Log Modal ───────────────────────────────────────────────────────

interface TreatmentEntry {
  storeItemId:  string;
  drugName:     string;
  dose:         string;
  doseUnit:     string;
  quantityUsed: string;
  route:        string;
  durationDays: string;
  rowId:        string;
  levelId:      string;
  notes:        string;
}

function emptyTreatment(): TreatmentEntry {
  return { storeItemId: '', drugName: '', dose: '', doseUnit: 'ml', quantityUsed: '', route: 'DRINKING_WATER', durationDays: '', rowId: '', levelId: '', notes: '' };
}

function TreatmentModal({ batch, onClose }: { batch: BrooderBatch; onClose: () => void }) {
  const qc    = useQueryClient();
  const today = dayjs().format('YYYY-MM-DD');

  const { data: rowsAndLevels = [] } = useBrooderRowsAndLevels(true);

  // Treatments can only be logged against a medication item Store has
  // actually issued (stock-out) this week.
  const { data: medItemsRaw, isLoading: medItemsLoading } = useIssuableStoreItems(MEDICATION_CATEGORIES);
  const medItems = medItemsRaw ?? [];

  const { register, handleSubmit, watch } = useForm({
    defaultValues: { treatmentDate: today },
  });

  const [treatments,  setTreatments]  = useState<TreatmentEntry[]>([emptyTreatment()]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function addTreatment()    { setTreatments(t => [...t, emptyTreatment()]); }
  function removeTreatment(i: number) { setTreatments(t => t.filter((_, j) => j !== i)); }
  function updateTreatment(i: number, field: keyof TreatmentEntry, val: string) {
    setTreatments(t => t.map((item, j) => {
      if (j !== i) return item;
      const next = { ...item, [field]: val };
      if (field === 'storeItemId') {
        const picked = medItems.find(m => m.id === val);
        next.drugName = picked?.name ?? '';
      }
      return next;
    }));
  }

  const submit = useMutation({
    mutationFn: async (data: any) => {
      const clean = treatments.filter(t => t.storeItemId && t.drugName.trim());
      if (clean.some(t => !t.dose.trim())) throw new Error('Each treatment must have a dose.');
      return Promise.all(clean.map(t =>
        api.post('/flock/brooder-treatment-logs', {
          batchId:      batch.id,
          treatmentDate: data.treatmentDate,
          drugName:     t.drugName.trim(),
          storeItemId:  t.storeItemId,
          dose:         t.dose.trim(),
          doseUnit:     t.doseUnit,
          quantityUsed: t.quantityUsed ? Number(t.quantityUsed) : undefined,
          route:        t.route,
          durationDays: t.durationDays ? Number(t.durationDays) : undefined,
          rowId:        t.rowId   || undefined,
          levelId:      t.levelId || undefined,
          notes:        t.notes   || undefined,
        }).then(r => r.data)
      ));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brooder-treatments', batch.id] });
      qc.invalidateQueries({ queryKey: ['store-issuable-items'] });
      onClose();
    },
    onError: (err: any) => {
      setSubmitError(err?.message ?? err?.response?.data?.message ?? 'Failed to save treatment. Try again.');
    },
  });

  function onFormSubmit(data: any) {
    setSubmitError(null);
    const clean = treatments.filter(t => t.storeItemId && t.drugName.trim());
    if (clean.length === 0) { setSubmitError('Add at least one treatment drug.'); return; }
    if (clean.some(t => !t.dose.trim())) { setSubmitError('Each treatment must have a dose.'); return; }
    submit.mutate(data);
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white dark:bg-dark-card w-full md:max-w-lg rounded-t-3xl md:rounded-2xl shadow-2xl overflow-y-auto max-h-[95vh]">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-dark-border sticky top-0 bg-white dark:bg-dark-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-red-500 rounded-xl flex items-center justify-center">
              <Stethoscope className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-bold text-gray-800 dark:text-gray-100">Log Treatment</p>
              <p className="text-xs text-gray-400">{batch.batchCode}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-bg">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onFormSubmit)} className="p-5 space-y-4">
          {/* Shared date */}
          <div>
            <label className={lCls}><Calendar className="w-3 h-3 inline mr-1" />Treatment Date</label>
            <input {...register('treatmentDate', { required: true })} type="date" max={today} className={iCls} />
          </div>

          {/* Treatment entries */}
          {treatments.map((t, i) => {
            const levelsForRow = rowsAndLevels.find(r => r.rowId === t.rowId)?.levels ?? [];
            return (
              <div key={i} className="rounded-xl border border-red-100 dark:border-red-900/30 bg-red-50/40 dark:bg-red-900/10 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-red-600 dark:text-red-400 uppercase tracking-widest">
                    Treatment {i + 1}
                  </span>
                  {treatments.length > 1 && (
                    <button type="button" onClick={() => removeTreatment(i)} className="text-gray-400 hover:text-red-500">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div>
                  <label className={lCls}><Pill className="w-3 h-3 inline mr-1 text-red-400" />Drug / Product *</label>
                  <select value={t.storeItemId} onChange={e => updateTreatment(i, 'storeItemId', e.target.value)}
                    className={iCls} disabled={medItemsLoading}>
                    <option value="">{medItemsLoading ? 'Loading…' : 'Select drug…'}</option>
                    {medItems.map(m => (
                      <option key={m.id} value={m.id}>{m.name} — residual {m.residual.toFixed(2)} {m.unit.toLowerCase()}</option>
                    ))}
                  </select>
                  {!medItemsLoading && medItems.length === 0 && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 flex items-start gap-1">
                      <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                      No medication issued from the store this week yet.
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-1">
                    <label className={lCls}>Dose *</label>
                    <input value={t.dose} onChange={e => updateTreatment(i, 'dose', e.target.value)}
                      className={iCls} placeholder="e.g. 1" />
                  </div>
                  <div className="col-span-1">
                    <label className={lCls}>Unit</label>
                    <select value={t.doseUnit} onChange={e => updateTreatment(i, 'doseUnit', e.target.value)} className={iCls}>
                      {DOSE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  <div className="col-span-1">
                    <label className={lCls}>Duration (days)</label>
                    <input value={t.durationDays} onChange={e => updateTreatment(i, 'durationDays', e.target.value)}
                      type="number" min="1" className={iCls} placeholder="e.g. 5" />
                  </div>
                </div>

                <div>
                  {(() => {
                    const picked = medItems.find(m => m.id === t.storeItemId);
                    return (
                      <>
                        <label className={lCls}>Quantity used{picked ? ` (${picked.unit.toLowerCase()})` : ''}</label>
                        <input value={t.quantityUsed} onChange={e => updateTreatment(i, 'quantityUsed', e.target.value)}
                          type="number" step="0.01" min="0" className={iCls}
                          placeholder={picked ? `Residual: ${picked.residual.toFixed(2)} ${picked.unit.toLowerCase()}` : 'Select a drug first'} />
                      </>
                    );
                  })()}
                </div>

                <div>
                  <label className={lCls}>Route of Administration</label>
                  <select value={t.route} onChange={e => updateTreatment(i, 'route', e.target.value)} className={iCls}>
                    {TREATMENT_ROUTES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>

                {/* Row + Level */}
                <div className="rounded-xl border border-gray-100 dark:border-dark-border bg-white dark:bg-dark-bg p-3 space-y-2">
                  <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">
                    Target Row &amp; Level (optional)
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={lCls}>Row</label>
                      <select value={t.rowId} onChange={e => updateTreatment(i, 'rowId', e.target.value)} className={iCls}>
                        <option value="">All rows</option>
                        {rowsAndLevels.map(r => (
                          <option key={r.rowId} value={r.rowId}>{r.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={lCls}>Level</label>
                      <select value={t.levelId} onChange={e => updateTreatment(i, 'levelId', e.target.value)}
                        className={iCls} disabled={!t.rowId}>
                        <option value="">All levels</option>
                        {levelsForRow.filter(l => l.isOccupied).map(l => (
                          <option key={l.levelId} value={l.levelId}>{l.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div>
                  <label className={lCls}>Notes</label>
                  <textarea value={t.notes} onChange={e => updateTreatment(i, 'notes', e.target.value)}
                    rows={2} className={`${iCls} resize-none`} placeholder="Instructions, withdrawal period, etc." />
                </div>
              </div>
            );
          })}

          <button type="button" onClick={addTreatment}
            className="w-full border border-dashed border-red-300 dark:border-red-700 text-red-500 dark:text-red-400 rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-1.5 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Add another treatment
          </button>

          {(submit.isError || submitError) && (
            <p className="text-red-500 text-sm bg-red-50 dark:bg-red-900/20 rounded-xl p-3">
              {submitError ?? 'Failed to save treatment. Try again.'}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 rounded-xl py-3 font-semibold text-sm">
              Cancel
            </button>
            <button type="submit" disabled={submit.isPending}
              className="flex-1 bg-red-500 text-white rounded-xl py-3 font-semibold text-sm disabled:opacity-60">
              {submit.isPending ? 'Saving…' : `Save ${treatments.filter(t => t.drugName.trim()).length || 1} Treatment${treatments.filter(t => t.drugName.trim()).length > 1 ? 's' : ''}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PopulationRecordSummary({ record }: { record: PopulationRecordDay }) {
  const isGeneral = record.source === 'GENERAL';
  return (
    <div className="flex gap-2 items-start">
      <div className="flex flex-col items-center pt-0.5">
        <ClipboardList className="w-3.5 h-3.5 text-gray-500" />
        <div className="w-px flex-1 bg-gray-200 dark:bg-gray-700 mt-1 min-h-[8px]" />
      </div>
      <div className="pb-3 flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
            Feed &amp; Mortality
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
            isGeneral
              ? 'bg-gray-100 dark:bg-gray-700 text-gray-500'
              : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
          }`}>
            {isGeneral ? 'General Record — whole batch' : 'Row/Level breakdown'}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-600 dark:text-gray-300">
          {record.feedKg > 0 && <span>Feed: <strong>{record.feedKg.toFixed(2)}kg</strong></span>}
          {record.mortalityCount > 0 && <span>Deaths: <strong>{record.mortalityCount}</strong></span>}
          {record.cullingCount > 0 && <span>Culled: <strong>{record.cullingCount}</strong></span>}
          {record.feedKg === 0 && record.mortalityCount === 0 && record.cullingCount === 0 && (
            <span className="text-gray-400 italic">No feed/mortality recorded</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Batch panel — inline below the cage map ───────────────────────────────────

function BatchPanel({ batch }: { batch: BrooderBatch }) {
  const [showSessionLog,  setShowSessionLog]  = useState(false);
  const [showDailyEntry,  setShowDailyEntry]  = useState(false);
  const [showTreatment,   setShowTreatment]   = useState(false);
  const [showGeneralRecord, setShowGeneralRecord] = useState(false);
  const [historyOpen,   setHistoryOpen]   = useState(false);
  const [treatHistOpen, setTreatHistOpen] = useState(false);

  const ageDays   = dayjs().diff(dayjs(batch.dateOfHatch), 'day');
  // 1-indexed HyLine week (days 0-6 = week 1, 7-13 = week 2, ...). Must match
  // the canonical batchAgeWeeks() in backend/feed-standard.util.ts.
  const ageWeeks  = Math.max(1, Math.floor(Math.max(0, ageDays) / 7) + 1);
  const survival  = batch.quantityReceived > 0
    ? ((batch.currentBirdCount / batch.quantityReceived) * 100).toFixed(1)
    : '—';

  const { data: logs = [] } = useQuery<BrooderLog[]>({
    queryKey: ['brooder-logs', batch.id],
    queryFn:  () => api.get(`/flock/brooder-logs?batchId=${batch.id}&limit=30`).then(r => r.data).catch(() => []),
    enabled:  historyOpen,
    staleTime: 30_000,
  });

  const { data: treatments = [] } = useQuery<TreatmentLog[]>({
    queryKey: ['brooder-treatments', batch.id],
    queryFn:  () => api.get(`/flock/brooder-treatment-logs?batchId=${batch.id}`).then(r => r.data).catch(() => []),
    enabled:  treatHistOpen,
    staleTime: 30_000,
  });

  // Per-day feed/mortality rollup, merging General Record entries with
  // row/level entries and tagging which method covered each date. Using the
  // rollup endpoint (rather than fetching the two raw general-log lists
  // separately) means the "which days are covered, and how" logic lives in
  // one place on the backend instead of being re-derived in the UI.
  const { data: populationSheet = [] } = useQuery<PopulationRecordDay[]>({
    queryKey: ['brooder-population-record-sheet', batch.id],
    queryFn:  () => api.get(`/brooder/batches/${batch.id}/population-record-sheet?days=30`).then(r => r.data).catch(() => []),
    enabled:  historyOpen,
    staleTime: 30_000,
  });

  // Last log for header summary
  const { data: lastArr = [] } = useQuery<BrooderLog[]>({
    queryKey: ['brooder-last-log', batch.id],
    queryFn:  () => api.get(`/flock/brooder-logs?batchId=${batch.id}&limit=1`).then(r => r.data).catch(() => []),
    staleTime: 60_000,
  });
  const lastLog     = lastArr[0];
  const today       = dayjs().format('YYYY-MM-DD');
  const daysSince   = lastLog ? dayjs(today).diff(dayjs(lastLog.logDate).format('YYYY-MM-DD'), 'day') : null;
  const logOverdue  = daysSince === null || daysSince > 0;

  // Group logs by date
  const grouped = useMemo(() => {
    const map: Record<string, BrooderLog[]> = {};
    for (const log of logs) {
      const d = dayjs(log.logDate).format('YYYY-MM-DD');
      if (!map[d]) map[d] = [];
      map[d].push(log);
    }
    return Object.entries(map).sort(([a], [b]) => (a < b ? 1 : -1));
  }, [logs]);

  // Lookup by date for the feed/mortality rollup (population-record-sheet).
  // Kept separate from `grouped` since these aren't environmental readings —
  // a different data type entirely, and shouldn't count toward the
  // MORNING/MIDDAY/EVENING/Daily completeness tally above.
  const populationByDate = useMemo(() => {
    const map: Record<string, PopulationRecordDay> = {};
    for (const row of populationSheet) map[row.date] = row;
    return map;
  }, [populationSheet]);

  // Union of every date that has EITHER an environmental log OR a
  // feed/mortality rollup entry, so a day logged only via General Record
  // still shows up in History instead of being invisible.
  const allDates = useMemo(() => {
    const dates = new Set<string>([...grouped.map(([d]) => d), ...Object.keys(populationByDate)]);
    return Array.from(dates).sort((a, b) => (a < b ? 1 : -1));
  }, [grouped, populationByDate]);

  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border shadow-sm p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-gray-800 dark:text-gray-100 text-lg font-mono">{batch.batchCode}</p>
            <span className="text-xs px-2.5 py-1 rounded-full font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />Brooder
            </span>
            {logOverdue && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 font-semibold flex items-center gap-1">
                <AlertTriangle className="w-2.5 h-2.5" />
                {daysSince === null ? 'No logs yet' : `${daysSince}d overdue`}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {batch.supplier?.name ?? batch.supplierName ?? 'Unknown supplier'} · wk {ageWeeks} ({ageDays}d)
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-brand-green">{batch.currentBirdCount.toLocaleString()}</p>
          <p className="text-[10px] text-gray-400">live · {survival}% survival</p>
        </div>
      </div>

      {/* Last log summary strip */}
      {lastLog && (
        <div className="bg-gray-50 dark:bg-dark-bg rounded-xl px-3 py-2 flex items-center gap-3 flex-wrap text-[11px] text-gray-500">
          <span className="font-semibold text-gray-600 dark:text-gray-300">
            Last: {dayjs(lastLog.logDate).format('D MMM')}{' '}
            {lastLog.logSession ? `(${sessionMeta(lastLog.logSession).label})` : ''}
          </span>
          {lastLog.temperature    != null && <span><Thermometer className="w-3 h-3 inline text-orange-400" /> {lastLog.temperature}°C</span>}
          {lastLog.humidityPercent != null && <span><Gauge className="w-3 h-3 inline text-blue-400" /> {lastLog.humidityPercent}%</span>}
          {lastLog.waterConsumptionL != null && <span><Droplets className="w-3 h-3 inline text-sky-400" /> {lastLog.waterConsumptionL}L</span>}
          {lastLog.lightIntensityLux != null && <span><Sun className="w-3 h-3 inline text-amber-400" /> {lastLog.lightIntensityLux}lux</span>}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setShowSessionLog(true)}
          className="flex items-center gap-1.5 bg-orange-500 text-white rounded-xl px-4 py-2.5 text-xs font-semibold hover:bg-orange-600 transition-colors">
          <Thermometer className="w-3.5 h-3.5" />
          Session Log
        </button>
        <button onClick={() => setShowDailyEntry(true)}
          className="flex items-center gap-1.5 bg-amber-500 text-white rounded-xl px-4 py-2.5 text-xs font-semibold hover:bg-amber-600 transition-colors">
          <Plus className="w-3.5 h-3.5" />
          {logOverdue && daysSince !== null ? `Daily Entry (${daysSince}d missed)` : 'Daily Entry'}
        </button>
        <button onClick={() => setShowTreatment(true)}
          className="flex items-center gap-1.5 bg-red-500 text-white rounded-xl px-4 py-2.5 text-xs font-semibold hover:bg-red-600 transition-colors">
          <Stethoscope className="w-3.5 h-3.5" />
          Treatment
        </button>
        <button onClick={() => setShowGeneralRecord(true)}
          className="flex items-center gap-1.5 bg-gray-700 dark:bg-gray-600 text-white rounded-xl px-4 py-2.5 text-xs font-semibold hover:bg-gray-800 transition-colors"
          title="Log feed or mortality for the whole batch when you can't break it down by row/level">
          <ClipboardList className="w-3.5 h-3.5" />
          General Record
        </button>
        <button onClick={() => setHistoryOpen(o => !o)}
          className="flex items-center gap-1.5 border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 rounded-xl px-4 py-2.5 text-xs font-semibold hover:bg-gray-50 dark:hover:bg-dark-bg transition-colors">
          History
          {historyOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        <button onClick={() => setTreatHistOpen(o => !o)}
          className="flex items-center gap-1.5 border border-red-200 dark:border-red-900/30 text-red-600 dark:text-red-400 rounded-xl px-4 py-2.5 text-xs font-semibold hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors">
          Treatments
          {treatHistOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* ── Environment log history ── */}
      {historyOpen && (
        <div className="border-t border-gray-100 dark:border-dark-border pt-3 space-y-4">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Environment Log History</p>
          {allDates.length === 0
            ? <p className="text-xs text-gray-400 text-center py-4">No logs yet.</p>
            : allDates.map(date => {
                const dayLogs      = grouped.find(([d]) => d === date)?.[1] ?? [];
                const popRecord    = populationByDate[date];
                const isToday  = date === today;
                const daysAgo  = dayjs(today).diff(dayjs(date), 'day');
                const dateLabel = isToday ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo}d ago`;
                const sessionLogs = dayLogs.filter(l => l.logSession != null);
                const hasDailyLog = dayLogs.some(l => l.logSession == null);
                const totalLogged = sessionLogs.length + (hasDailyLog ? 1 : 0);
                const TOTAL_EXPECTED = 4; // MORNING + MIDDAY + EVENING + Daily — environmental readings only
                return (
                  <div key={date}>
                    {/* Day header */}
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="text-xs font-bold text-gray-700 dark:text-gray-200">
                        {dayjs(date).format('ddd D MMM YYYY')}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                        isToday ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                        : daysAgo === 1 ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-500'
                      }`}>{dateLabel}</span>
                      <span className="text-[10px] text-gray-400">
                        {totalLogged}/{TOTAL_EXPECTED} environmental
                        {totalLogged < TOTAL_EXPECTED && (
                          <span className="ml-1 text-amber-500">· {TOTAL_EXPECTED - totalLogged} pending</span>
                        )}
                        {totalLogged >= TOTAL_EXPECTED && (
                          <span className="ml-1 text-green-500 flex items-center gap-0.5 inline-flex">
                            <CheckCircle2 className="w-2.5 h-2.5" /> complete
                          </span>
                        )}
                      </span>
                      {popRecord && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                          popRecord.source === 'GENERAL'
                            ? 'bg-gray-100 dark:bg-gray-700 text-gray-500'
                            : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                        }`}>
                          {popRecord.source === 'GENERAL' ? 'General Record' : 'Row/Level'}
                        </span>
                      )}
                    </div>
                    {/* Sessions as timeline (environmental readings — Morning/Midday/Evening/Daily) */}
                    {dayLogs.length > 0 && (
                      <div className="pl-2">
                        {dayLogs
                          .sort((a, b) => {
                            const order = { MORNING: 0, MIDDAY: 1, EVENING: 2 };
                            return (order[a.logSession as keyof typeof order] ?? 3) -
                                   (order[b.logSession as keyof typeof order] ?? 3);
                          })
                          .map(log => <SessionEntry key={log.id} log={log} />)}
                      </div>
                    )}
                    {/* Feed & mortality rollup for the day (General Record or Row/Level) */}
                    {popRecord && (
                      <div className="pl-2 mt-1">
                        <PopulationRecordSummary record={popRecord} />
                      </div>
                    )}
                  </div>
                );
              })}
        </div>
      )}

      {/* ── Treatment history ── */}
      {treatHistOpen && (
        <div className="border-t border-gray-100 dark:border-dark-border pt-3 space-y-2">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Treatment History</p>
          {treatments.length === 0
            ? <p className="text-xs text-gray-400 text-center py-4">No treatments recorded.</p>
            : treatments.map(t => (
                <div key={t.id} className="bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-xl p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-bold text-red-700 dark:text-red-400 flex items-center gap-1.5">
                      <Pill className="w-3.5 h-3.5" />{t.drugName}
                    </span>
                    <span className="text-[10px] text-gray-400">{dayjs(t.treatmentDate).format('D MMM YYYY')}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-gray-600 dark:text-gray-300">
                    <span>Dose: <strong>{t.dose} {t.doseUnit}</strong></span>
                    <span>Route: {t.route.replace(/_/g, ' ')}</span>
                    {t.durationDays && <span>Duration: {t.durationDays} days</span>}
                    {t.row   && <span>Row: {t.row.label}</span>}
                    {t.level && <span>Level: {t.level.label}</span>}
                  </div>
                  {t.notes && <p className="text-gray-400 italic">{t.notes}</p>}
                  {t.loggedBy && <p className="text-[10px] text-gray-400">by {t.loggedBy.fullName}</p>}
                </div>
              ))}
        </div>
      )}

      {showSessionLog && <SessionLogModal batch={batch} onClose={() => setShowSessionLog(false)} />}
      {showDailyEntry && <DailyEntryModal batch={batch} onClose={() => setShowDailyEntry(false)} />}
      {showTreatment && <TreatmentModal batch={batch} onClose={() => setShowTreatment(false)} />}
      {showGeneralRecord && (
        <BrooderGeneralRecordModal batch={batch} onClose={() => setShowGeneralRecord(false)} />
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function BrooderPage() {
  const { data: allBatches = [], isLoading } = useQuery<BrooderBatch[]>({
    queryKey: ['batches'],
    queryFn:  () => api.get('/flock/batches').then(r => r.data),
    staleTime: 60_000,
  });

  const brooderBatches   = allBatches.filter(b => b.location === 'BROODER' && b.isActive);
  const totalBrooderBirds = brooderBatches.reduce((s, b) => s + (b.currentBirdCount ?? 0), 0);

  const { data: cageMapData }                  = useBrooderCageMap();
  const [assignTarget,   setAssignTarget]      = useState<{ level: BrooderLevelData; row: BrooderRowData } | null>(null);
  const [reassignTarget, setReassignTarget]    = useState<{ level: BrooderLevelData; row: BrooderRowData } | null>(null);
  const [feedTarget,     setFeedTarget]        = useState<{ level: BrooderLevelData; row: BrooderRowData } | null>(null);
  const [heatTarget,     setHeatTarget]        = useState<BrooderRowData | null>(null);
  const [mortalityTarget, setMortalityTarget]  = useState<{ level: BrooderLevelData; row: BrooderRowData } | null>(null);
  const [weightTarget,    setWeightTarget]     = useState<{ level: BrooderLevelData; row: BrooderRowData } | null>(null);

  const assignedCountByBatch: Record<string, number> = {};
  if (cageMapData) {
    for (const row of cageMapData.rows) {
      for (const level of row.levels) {
        if (level.assignment) {
          const { batchId, birdCount } = level.assignment;
          assignedCountByBatch[batchId] = (assignedCountByBatch[batchId] ?? 0) + birdCount;
        }
      }
    }
  }

  const handleSelectLevel = (level: BrooderLevelData, row: BrooderRowData) => {
    if (level.assignment) {
      setFeedTarget({ level, row });
    } else if (brooderBatches.length > 0) {
      setAssignTarget({ level, row });
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">

      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Brooder</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          {brooderBatches.length} active batch{brooderBatches.length !== 1 ? 'es' : ''} ·{' '}
          <span className="font-semibold text-amber-600 dark:text-amber-400">
            {totalBrooderBirds.toLocaleString()} chicks
          </span>{' '}in brooder
        </p>
      </div>

      {/* ── SECTION 1: Control Standard ── */}
      <BrooderControlStandardPanel />

      {/* ── SECTION 2: Feed requirement (daily/weekly toggle) ── */}
      <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border shadow-sm p-4">
        <BrooderFeedRequirement showResidual={false} />
      </div>

      {/* ── SECTION 3: Cage Map with mortality buttons prominent ── */}
      <div className="space-y-2">
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-3 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
          <HeartCrack className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-500" />
          <div>
            <p className="font-semibold">Cage Map — tap a cell to log feed · use <span className="text-red-500">Log Mortality</span> or <span className="text-indigo-500">Log Weight</span> for row &amp; level events</p>
            <p className="mt-0.5 text-amber-600 dark:text-amber-500">
              Mortality and weight samples are tracked per row and level only through the cage map — mortality appears in Farm Events, and weight outside the HyLine band is flagged to the Manager and Owner.
              Environmental readings (temperature, humidity, water, light) are logged per session using the batch panel below.
            </p>
          </div>
        </div>

        <BrooderCageMapGrid
          onSelectLevel={handleSelectLevel}
          onLogHeat={row => setHeatTarget(row)}
          onLogMortality={(level, row) => setMortalityTarget({ level, row })}
          onReassign={(level, row) => setReassignTarget({ level, row })}
          onLogWeight={(level, row) => setWeightTarget({ level, row })}
        />
      </div>

      {/* ── SECTION 4: Batch panels — daily log + treatment ── */}
      <div className="space-y-2">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
          Daily Logs &amp; Treatments — per batch
        </p>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map(i => <div key={i} className="h-40 rounded-2xl bg-gray-100 dark:bg-dark-card animate-pulse" />)}
          </div>
        ) : brooderBatches.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Flame className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="font-semibold">No active brooder batches</p>
            <p className="text-sm mt-1">Register a new batch and assign it to the Brooder from the Batches page.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {brooderBatches.map(b => <BatchPanel key={b.id} batch={b} />)}
          </div>
        )}
      </div>

      {/* Cage map modals */}
      {assignTarget && (
        <BrooderLevelAssignModal
          level={assignTarget.level}
          row={assignTarget.row}
          batches={brooderBatches.map(b => ({
            id: b.id,
            batchCode: b.batchCode,
            currentBirdCount: b.currentBirdCount,
            quantityReceived: b.quantityReceived,
            alreadyAssignedCount:
              (assignedCountByBatch[b.id] ?? 0) -
              (assignTarget.level.assignment?.batchId === b.id
                ? (assignTarget.level.assignment?.birdCount ?? 0)
                : 0),
          }))}
          allRows={cageMapData?.rows ?? []}
          onClose={() => setAssignTarget(null)}
        />
      )}
      {reassignTarget && (
        <BrooderReassignModal
          sourceLevel={reassignTarget.level}
          sourceRow={reassignTarget.row}
          allRows={cageMapData?.rows ?? []}
          onClose={() => setReassignTarget(null)}
        />
      )}
      {feedTarget     && <BrooderLevelFeedLogModal  level={feedTarget.level}     row={feedTarget.row}     onClose={() => setFeedTarget(null)} />}
      {heatTarget     && <BrooderHeatLogModal        row={heatTarget}                                      onClose={() => setHeatTarget(null)} />}
      {mortalityTarget && (
        <BrooderMortalityLogModal
          level={mortalityTarget.level}
          row={mortalityTarget.row}
          onClose={() => setMortalityTarget(null)}
        />
      )}
      {weightTarget && (
        <BrooderWeightLogModal
          level={weightTarget.level}
          row={weightTarget.row}
          onClose={() => setWeightTarget(null)}
        />
      )}
    </div>
  );
}
