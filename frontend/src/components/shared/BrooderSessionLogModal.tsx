// src/components/shared/BrooderSessionLogModal.tsx
//
// Attendant brooder daily log — 3 SEPARATE time-gated popups instead of one
// combined form (see BrooderDailyLogModal.tsx, now retired, for the old
// design). This ONE component renders whichever popup `session` names —
// MORNING, MIDDAY or EVENING — each with its own field set and its own
// server-enforced time window (see brooder-session-window.util.ts on the
// backend / useBrooderSessionStatus on the frontend):
//
//   MORNING  (open until  9:00am) — 3am AND 6am environmental readings,
//            water, vaccines/supplements/treatment, feed, mortalities.
//   MIDDAY   (11:00am–1:00pm)     — one environmental reading, water,
//            vaccines/supplements, mortalities. No feed, no treatment.
//   EVENING  (3:00pm–5:00pm)      — one environmental reading, water,
//            vaccines/supplements, feed, mortalities. No treatment.
//
// No field is mandatory to submit — an attendant can save a popup with only
// some of it filled in. Layout is a plain top-to-bottom FORM (labelled
// textboxes in fixed positions) rather than the old collapsible/checkbox
// panels, per spec.
//
// On Save, one request per non-empty piece fires (partial-failure tolerant,
// same pattern the old combined modal used — one section's error never
// blocks the others):
//   POST /flock/brooder-logs            (environmental + water + vaccines/supplements)
//   POST /flock/brooder-treatment-logs  (MORNING only, one per filled row)
//   POST /brooder/general-feed-logs     (MORNING/EVENING only)
//   POST /brooder/general-mortality-logs  OR  POST /brooder/mortality-logs

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X, AlertTriangle, Plus, Trash2, Droplets, Thermometer, Gauge, Sun,
  Syringe, FlaskConical, Stethoscope, Wheat, HeartCrack, Clock, Sunrise, CloudSun, Sunset,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useBrooderRowsAndLevels } from '../../hooks/useBrooderCageMap';
import { useBrooderSessionStatus, BrooderSessionKey } from '../../hooks/useBrooderSessionStatus';
import {
  useIssuableStoreItems, FEED_CATEGORIES,
  VACCINE_CATEGORIES, SUPPLEMENT_CATEGORIES, TREATMENT_CATEGORIES,
} from '../../hooks/useIssuableStoreItems';

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

const CAUSE_OPTIONS = [
  { value: 'DISEASE',                 label: 'Disease' },
  { value: 'INJURY',                  label: 'Injury' },
  { value: 'HEAT_STRESS',             label: 'Heat Stress' },
  { value: 'PREDATOR',                label: 'Predator' },
  { value: 'CULLED_SICK',             label: 'Culled — Sick' },
  { value: 'CULLED_LOW_PRODUCTIVITY', label: 'Culled — Low Productivity' },
  { value: 'CULLED_OVERPOPULATION',   label: 'Culled — Overpopulation' },
  { value: 'UNKNOWN',                 label: 'Unknown' },
] as const;

type FeedTypeValue =
  | 'CHICK_MASH' | 'GROWER_MASH' | 'LAYER_MASH'
  | 'KIENYEJI_STARTER' | 'KIENYEJI_GROWER' | 'KIENYEJI_FINISHER';

function deriveFeedType(item: { sku: string; name: string }): FeedTypeValue | null {
  const haystack = `${item.sku} ${item.name}`.toUpperCase();
  if (haystack.includes('KIENYEJI')) {
    if (haystack.includes('STARTER'))  return 'KIENYEJI_STARTER';
    if (haystack.includes('GROWER'))   return 'KIENYEJI_GROWER';
    if (haystack.includes('FINISHER')) return 'KIENYEJI_FINISHER';
  }
  if (haystack.includes('CHICK'))  return 'CHICK_MASH';
  if (haystack.includes('GROWER')) return 'GROWER_MASH';
  if (haystack.includes('LAYER'))  return 'LAYER_MASH';
  return null;
}

const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-500';
const lCls = 'block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide';

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className={lCls}>{children}</label>;
}

// ── Session presentation ─────────────────────────────────────────────────

const SESSION_META: Record<BrooderSessionKey, { title: string; icon: React.ElementType; accent: string }> = {
  MORNING: { title: 'Morning Log',      icon: Sunrise, accent: 'bg-orange-500' },
  MIDDAY:  { title: '11am Check-in',    icon: CloudSun, accent: 'bg-sky-500'   },
  EVENING: { title: '3pm Check-in',     icon: Sunset,  accent: 'bg-indigo-500' },
};

export interface BrooderBatchLite {
  id: string;
  batchCode: string;
  currentBirdCount: number;
  quantityReceived: number;
  dateOfHatch: string;
}

/** Pre-scopes Treatment/Mortality to a specific row/level (opened from the cage map). */
export interface BrooderLogPresetScope {
  rowId: string;
  rowLabel: string;
  levelId: string;
  levelLabel: string;
  cages: { cageId: string; label: string; birdCount: number }[];
}

interface VaccineItem    { storeItemId: string; name: string; dose: string; route: string; quantityUsed: string; }
interface SupplementItem { storeItemId: string; name: string; dose: string; quantityUsed: string; }
interface TreatmentEntry {
  storeItemId: string; drugName: string; dose: string; doseUnit: string;
  quantityUsed: string; route: string; durationDays: string; notes: string;
}

interface Props {
  batch: BrooderBatchLite;
  session: BrooderSessionKey;
  presetScope?: BrooderLogPresetScope;
  onClose: () => void;
}

export function BrooderSessionLogModal({ batch, session, presetScope, onClose }: Props) {
  const qc = useQueryClient();
  const meta = SESSION_META[session];
  const Icon = meta.icon;

  const { data: rowsAndLevels = [] } = useBrooderRowsAndLevels(true);
  const { data: statusData } = useBrooderSessionStatus();
  const sessionInfo = statusData?.sessions.find(s => s.key === session);
  const isOpen = sessionInfo ? sessionInfo.open : true; // default open while status is loading
  // Server-authoritative farm-local date (never the device's own clock/
  // timezone — same value the backend's assertIsToday() checks against).
  // Required by /brooder/general-feed-logs, /brooder/general-mortality-logs
  // and /brooder/mortality-logs (entryDate/logDate); the browser-local
  // fallback only applies in the brief window before statusData loads.
  const todayStr = statusData?.farmDate ?? new Date().toISOString().slice(0, 10);

  const { data: vaccineItemsRaw }    = useIssuableStoreItems(VACCINE_CATEGORIES, { allItems: true });
  const { data: supplementItemsRaw } = useIssuableStoreItems(SUPPLEMENT_CATEGORIES, { allItems: true });
  const { data: treatmentItemsRaw }  = useIssuableStoreItems(TREATMENT_CATEGORIES, { allItems: true });
  const { data: feedItemsRaw }       = useIssuableStoreItems(FEED_CATEGORIES, { allItems: true });
  const vaccineItems    = vaccineItemsRaw ?? [];
  const supplementItems = supplementItemsRaw ?? [];
  const treatmentItems  = treatmentItemsRaw ?? [];
  const feedItems = (feedItemsRaw ?? []).filter(i => deriveFeedType(i) !== null);

  const showFeed      = session === 'MORNING' || session === 'EVENING';
  const showTreatment = session === 'MORNING';
  const showDualReadings = session === 'MORNING';

  // ── Environmental readings ─────────────────────────────────────────────
  const [temperature,       setTemperature]       = useState('');
  const [humidityPercent,   setHumidityPercent]   = useState('');
  const [lightIntensityLux, setLightIntensityLux] = useState('');
  const [lightingOk,        setLightingOk]        = useState(true);

  const [t3am,  setT3am]  = useState({ temperature: '', humidityPercent: '', lightIntensityLux: '', lightingOk: true });
  const [t6am,  setT6am]  = useState({ temperature: '', humidityPercent: '', lightIntensityLux: '', lightingOk: true });

  // ── Water + notes ────────────────────────────────────────────────────────
  const [waterConsumptionL, setWaterConsumptionL] = useState('');
  const [notes, setNotes] = useState('');

  // ── Vaccines / Supplements (every session) ──────────────────────────────
  const [vaccines,    setVaccines]    = useState<VaccineItem[]>([]);
  const [supplements, setSupplements] = useState<SupplementItem[]>([]);
  function addVaccine()    { setVaccines(v => [...v, { storeItemId: '', name: '', dose: '', route: 'DRINKING_WATER', quantityUsed: '' }]); }
  function removeVaccine(i: number) { setVaccines(v => v.filter((_, j) => j !== i)); }
  function updateVaccine(i: number, field: keyof VaccineItem, val: string) {
    setVaccines(v => v.map((item, j) => {
      if (j !== i) return item;
      const next = { ...item, [field]: val };
      if (field === 'storeItemId') next.name = vaccineItems.find(m => m.id === val)?.name ?? '';
      return next;
    }));
  }
  function addSupplement()    { setSupplements(s => [...s, { storeItemId: '', name: '', dose: '', quantityUsed: '' }]); }
  function removeSupplement(i: number) { setSupplements(s => s.filter((_, j) => j !== i)); }
  function updateSupplement(i: number, field: keyof SupplementItem, val: string) {
    setSupplements(s => s.map((item, j) => {
      if (j !== i) return item;
      const next = { ...item, [field]: val };
      if (field === 'storeItemId') next.name = supplementItems.find(m => m.id === val)?.name ?? '';
      return next;
    }));
  }

  // ── Treatment (MORNING only) ─────────────────────────────────────────────
  const emptyTreatment = (): TreatmentEntry => ({
    storeItemId: '', drugName: '', dose: '', doseUnit: 'ml', quantityUsed: '',
    route: 'DRINKING_WATER', durationDays: '', notes: '',
  });
  const [treatments, setTreatments] = useState<TreatmentEntry[]>([]);
  function addTreatment()    { setTreatments(t => [...t, emptyTreatment()]); }
  function removeTreatment(i: number) { setTreatments(t => t.filter((_, j) => j !== i)); }
  function updateTreatment(i: number, field: keyof TreatmentEntry, val: string) {
    setTreatments(t => t.map((item, j) => {
      if (j !== i) return item;
      const next = { ...item, [field]: val };
      if (field === 'storeItemId') next.drugName = treatmentItems.find(m => m.id === val)?.name ?? '';
      return next;
    }));
  }

  // ── Feed (MORNING/EVENING only) ──────────────────────────────────────────
  // Quantity is in whatever unit the selected feed item is stocked in
  // (kg for feed items, per the store item's own `unit` field).
  const [feedStoreItemId, setFeedStoreItemId] = useState('');
  const [feedQuantityKg,  setFeedQuantityKg]  = useState('');
  const selectedFeedItem = feedItems.find(i => i.id === feedStoreItemId) ?? null;

  // ── Mortality (every session) ────────────────────────────────────────────
  const [mortalityScope, setMortalityScope] = useState<'GENERAL' | 'ROW_LEVEL'>(presetScope ? 'ROW_LEVEL' : 'GENERAL');
  const [mortRowId,   setMortRowId]   = useState(presetScope?.rowId ?? '');
  const [mortLevelId, setMortLevelId] = useState(presetScope?.levelId ?? '');
  const [mortCageId,  setMortCageId]  = useState(presetScope?.cages[0]?.cageId ?? '');
  const [mortalityCount, setMortalityCount] = useState('0');
  const [cullingCount,   setCullingCount]   = useState('0');
  const [cause,           setCause]         = useState('');
  // Optional feed-wastage-credit capture — never required to submit a
  // mortality entry. '' = not captured (no assumption made). 'NO' = hadn't
  // received today's feed yet. 'PARTIAL' = ate some, feedAlreadyEatenKg
  // holds how much.
  const [fedBeforeDeath, setFedBeforeDeath] = useState<'' | 'NO' | 'PARTIAL'>('');
  const [feedAlreadyEatenKg, setFeedAlreadyEatenKg] = useState('');
  const totalLost = (Number(mortalityCount) || 0) + (Number(cullingCount) || 0);

  const mortLevelsForRow = rowsAndLevels.find(r => r.rowId === mortRowId)?.levels ?? [];
  const mortCagesForLevel = presetScope && presetScope.levelId === mortLevelId
    ? presetScope.cages
    : (mortLevelsForRow.find(l => l.levelId === mortLevelId)?.cages ?? []).filter(c => c.isOccupied)
        .map(c => ({ cageId: c.cageId, label: c.label, birdCount: c.currentBirdCount }));

  const [submitError, setSubmitError] = useState<string | null>(null);
  function errMsg(err: any): string {
    const m = err?.response?.data?.message ?? err?.message ?? 'Failed to save.';
    return Array.isArray(m) ? m.join(', ') : String(m);
  }

  const submit = useMutation({
    mutationFn: async () => {
      const errors: string[] = [];

      // 1) Environmental / water / vaccines / supplements — always fires;
      // the attendant opened this specific popup to record it, and no
      // field within it is mandatory (a mostly-empty save still records
      // "checked in, nothing unusual").
      const cleanVaccines    = vaccines.filter(v => v.storeItemId && v.name.trim());
      const cleanSupplements = supplements.filter(s => s.storeItemId && s.name.trim());
      try {
        await api.post('/flock/brooder-logs', {
          batchId: batch.id,
          logSession: session,
          ...(showDualReadings ? {
            reading3amTemperature:       t3am.temperature       ? Number(t3am.temperature)       : undefined,
            reading3amHumidityPercent:   t3am.humidityPercent   ? Number(t3am.humidityPercent)   : undefined,
            reading3amLightIntensityLux: t3am.lightIntensityLux ? Number(t3am.lightIntensityLux) : undefined,
            reading3amLightingOk:        t3am.lightingOk,
            reading6amTemperature:       t6am.temperature       ? Number(t6am.temperature)       : undefined,
            reading6amHumidityPercent:   t6am.humidityPercent   ? Number(t6am.humidityPercent)   : undefined,
            reading6amLightIntensityLux: t6am.lightIntensityLux ? Number(t6am.lightIntensityLux) : undefined,
            reading6amLightingOk:        t6am.lightingOk,
          } : {
            temperature:       temperature       ? Number(temperature)       : undefined,
            humidityPercent:   humidityPercent   ? Number(humidityPercent)   : undefined,
            lightIntensityLux: lightIntensityLux ? Number(lightIntensityLux) : undefined,
            lightingOk,
          }),
          waterConsumptionL: waterConsumptionL ? Number(waterConsumptionL) : undefined,
          vaccines: cleanVaccines.map(v => ({
            name: v.name.trim(), dose: v.dose.trim(), route: v.route,
            storeItemId: v.storeItemId, quantityUsed: v.quantityUsed ? Number(v.quantityUsed) : undefined,
          })),
          supplements: cleanSupplements.map(s => ({
            name: s.name.trim(), dose: s.dose.trim(),
            storeItemId: s.storeItemId, quantityUsed: s.quantityUsed ? Number(s.quantityUsed) : undefined,
          })),
          notes: notes || undefined,
          rowId:   presetScope?.rowId   || undefined,
          levelId: presetScope?.levelId || undefined,
        });
      } catch (err: any) {
        errors.push(`${meta.title}: ${errMsg(err)}`);
      }

      // 2) Treatment — MORNING only, one request per filled row.
      if (showTreatment) {
        const cleanTreatments = treatments.filter(t => t.storeItemId && t.drugName.trim());
        for (const t of cleanTreatments) {
          try {
            await api.post('/flock/brooder-treatment-logs', {
              batchId: batch.id,
              logSession: session,
              drugName: t.drugName.trim(),
              storeItemId: t.storeItemId,
              dose: t.dose.trim(),
              doseUnit: t.doseUnit,
              quantityUsed: t.quantityUsed ? Number(t.quantityUsed) : undefined,
              route: t.route,
              durationDays: t.durationDays ? Number(t.durationDays) : undefined,
              rowId:   presetScope?.rowId   || undefined,
              levelId: presetScope?.levelId || undefined,
              notes: t.notes || undefined,
            });
          } catch (err: any) {
            errors.push(`Treatment (${t.drugName.trim()}): ${errMsg(err)}`);
          }
        }
      }

      // 3) Feed — MORNING/EVENING only.
      if (showFeed && feedStoreItemId && Number(feedQuantityKg) > 0) {
        try {
          const item = feedItems.find(i => i.id === feedStoreItemId);
          await api.post('/brooder/general-feed-logs', {
            batchId: batch.id,
            entryDate: todayStr,
            logSession: session,
            feedType: item ? deriveFeedType(item) ?? undefined : undefined,
            storeItemId: feedStoreItemId,
            quantityDispensedKg: Number(feedQuantityKg),
          });
        } catch (err: any) {
          errors.push(`Feed: ${errMsg(err)}`);
        }
      }

      // 4) Mortality — every session, General or Row/Level/Cage.
      if (totalLost > 0) {
        try {
          // Optional feed-wastage-credit fields — omitted entirely (not
          // sent as null/false) when the attendant didn't touch the
          // toggle, so the backend makes no assumption either way.
          const feedCreditFields = fedBeforeDeath === 'NO'
            ? { fedBeforeDeath: false }
            : fedBeforeDeath === 'PARTIAL'
              ? { fedBeforeDeath: true, feedAlreadyEatenKg: feedAlreadyEatenKg ? Number(feedAlreadyEatenKg) : 0 }
              : {};
          if (mortalityScope === 'GENERAL') {
            await api.post('/brooder/general-mortality-logs', {
              batchId: batch.id,
              logDate: todayStr,
              logSession: session,
              mortalityCount: Number(mortalityCount) || 0,
              cullingCount: Number(cullingCount) || 0,
              cause: cause || undefined,
              ...feedCreditFields,
            });
          } else {
            await api.post('/brooder/mortality-logs', {
              levelId: mortLevelId,
              cageId: mortCageId,
              batchId: batch.id,
              logDate: todayStr,
              logSession: session,
              mortalityCount: Number(mortalityCount) || 0,
              cullingCount: Number(cullingCount) || 0,
              cause: cause || undefined,
              ...feedCreditFields,
            });
          }
        } catch (err: any) {
          errors.push(`Mortality: ${errMsg(err)}`);
        }
      }

      return { errors };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['brooder-logs', batch.id] });
      qc.invalidateQueries({ queryKey: ['brooder-last-log', batch.id] });
      qc.invalidateQueries({ queryKey: ['brooder-treatments', batch.id] });
      qc.invalidateQueries({ queryKey: ['brooder-population-record-sheet', batch.id] });
      qc.invalidateQueries({ queryKey: ['brooder-cage-map'] });
      qc.invalidateQueries({ queryKey: ['brooder-rows-and-levels'] });
      qc.invalidateQueries({ queryKey: ['brooder-feed-summary'] });
      qc.invalidateQueries({ queryKey: ['store-issuable-items'] });
      qc.invalidateQueries({ queryKey: ['batches'] });

      if (result.errors.length > 0) {
        setSubmitError(`Saved, but some sections failed:\n• ${result.errors.join('\n• ')}`);
      } else {
        onClose();
      }
    },
    onError: (err: any) => setSubmitError(errMsg(err)),
  });

  function handleSubmit() {
    setSubmitError(null);
    const cleanVaccines    = vaccines.filter(v => v.storeItemId && v.name.trim());
    const cleanSupplements = supplements.filter(s => s.storeItemId && s.name.trim());
    if (cleanVaccines.some(v => !v.dose.trim()))    { setSubmitError('Each vaccine entry must have a dose (or remove it).'); return; }
    if (cleanSupplements.some(s => !s.dose.trim())) { setSubmitError('Each supplement entry must have a dose (or remove it).'); return; }
    if (showTreatment) {
      const cleanTreatments = treatments.filter(t => t.storeItemId && t.drugName.trim());
      if (cleanTreatments.some(t => !t.dose.trim())) { setSubmitError('Each treatment entry must have a dose (or remove it).'); return; }
    }
    if (showFeed && feedStoreItemId && !(Number(feedQuantityKg) > 0)) {
      setSubmitError('Enter a feed quantity greater than 0, or clear the feed item.'); return;
    }
    if (totalLost > 0) {
      if (mortalityScope === 'ROW_LEVEL' && (!mortLevelId || !mortCageId)) {
        setSubmitError('Select a row, level, and cage for the mortality entry, or switch to General.'); return;
      }
      if (mortalityScope === 'GENERAL' && totalLost > batch.currentBirdCount) {
        setSubmitError(`Total lost (${totalLost}) exceeds live birds in the batch (${batch.currentBirdCount}).`); return;
      }
    }
    submit.mutate();
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white dark:bg-dark-card w-full md:max-w-xl rounded-t-3xl md:rounded-2xl shadow-2xl overflow-y-auto max-h-[95vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-dark-border sticky top-0 bg-white dark:bg-dark-card z-10">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 ${meta.accent} rounded-xl flex items-center justify-center`}>
              <Icon className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-bold text-gray-800 dark:text-gray-100">{meta.title}</p>
              <p className="text-xs text-gray-400">
                {batch.batchCode}{presetScope ? ` · ${presetScope.rowLabel} · ${presetScope.levelLabel}` : ' · whole batch'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-bg">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {sessionInfo && (
          <div className={`mx-5 mt-4 flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium ${
            isOpen ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                   : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
          }`}>
            <Clock className="w-3.5 h-3.5" />
            {isOpen
              ? <span>Open now — closes {sessionInfo.closesLabel}</span>
              : <span>Closed — opens {sessionInfo.opensLabel}, locks {sessionInfo.closesLabel}. Farm time: {statusData?.farmTime}</span>}
          </div>
        )}

        {/* ── Form body — plain top-to-bottom fields, not collapsible panels ── */}
        <div className="p-5 space-y-6">

          {/* Environmental readings */}
          {showDualReadings ? (
            <div className="space-y-4">
              <p className="text-sm font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <Thermometer className="w-4 h-4 text-orange-500" /> Environmental Readings
              </p>
              {[{ label: '3:00am Reading', state: t3am, set: setT3am }, { label: '6:00am Reading', state: t6am, set: setT6am }].map(({ label, state, set }) => (
                <div key={label} className="rounded-xl border border-orange-100 dark:border-orange-900/30 bg-orange-50/40 dark:bg-orange-900/10 p-3 space-y-3">
                  <p className="text-xs font-bold text-orange-700 dark:text-orange-400">{label}</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <FieldLabel>Temp (°C)</FieldLabel>
                      <input value={state.temperature} onChange={e => set(s => ({ ...s, temperature: e.target.value }))}
                        type="number" step="0.1" className={iCls} placeholder="e.g. 32" />
                    </div>
                    <div>
                      <FieldLabel>Humidity (%)</FieldLabel>
                      <input value={state.humidityPercent} onChange={e => set(s => ({ ...s, humidityPercent: e.target.value }))}
                        type="number" step="1" min="0" max="100" className={iCls} placeholder="e.g. 60" />
                    </div>
                    <div>
                      <FieldLabel>Light (lux)</FieldLabel>
                      <input value={state.lightIntensityLux} onChange={e => set(s => ({ ...s, lightIntensityLux: e.target.value }))}
                        type="number" min="0" className={iCls} placeholder="e.g. 20" />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={state.lightingOk}
                      onChange={e => set(s => ({ ...s, lightingOk: e.target.checked }))}
                      className="w-4 h-4 accent-amber-500" />
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Lighting adequate</span>
                  </label>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <Thermometer className="w-4 h-4 text-orange-500" /> Environmental Reading
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <FieldLabel>Temp (°C)</FieldLabel>
                  <input value={temperature} onChange={e => setTemperature(e.target.value)}
                    type="number" step="0.1" className={iCls} placeholder="e.g. 32" />
                </div>
                <div>
                  <FieldLabel>Humidity (%)</FieldLabel>
                  <input value={humidityPercent} onChange={e => setHumidityPercent(e.target.value)}
                    type="number" step="1" min="0" max="100" className={iCls} placeholder="e.g. 60" />
                </div>
                <div>
                  <FieldLabel>Light (lux)</FieldLabel>
                  <input value={lightIntensityLux} onChange={e => setLightIntensityLux(e.target.value)}
                    type="number" min="0" className={iCls} placeholder="e.g. 20" />
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={lightingOk} onChange={e => setLightingOk(e.target.checked)}
                  className="w-4 h-4 accent-amber-500" />
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Lighting adequate</span>
              </label>
            </div>
          )}

          {/* Water */}
          <div>
            <FieldLabel><Droplets className="w-3 h-3 inline mr-1 text-sky-500" />Water Consumed (L)</FieldLabel>
            <input value={waterConsumptionL} onChange={e => setWaterConsumptionL(e.target.value)}
              type="number" step="0.1" min="0" className={iCls} placeholder="e.g. 45" />
          </div>

          {/* Vaccines */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <Syringe className="w-4 h-4 text-pink-500" /> Vaccines
              </p>
              <button type="button" onClick={addVaccine} className="flex items-center gap-1 text-xs font-semibold text-pink-600 dark:text-pink-400">
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>
            {vaccines.map((v, i) => (
              <div key={i} className="rounded-xl border border-gray-200 dark:border-dark-border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <select value={v.storeItemId} onChange={e => updateVaccine(i, 'storeItemId', e.target.value)} className={`${iCls} flex-1`}>
                    <option value="">Select vaccine…</option>
                    {vaccineItems.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                  <button type="button" onClick={() => removeVaccine(i)} className="p-2 text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input value={v.dose} onChange={e => updateVaccine(i, 'dose', e.target.value)} className={iCls} placeholder="Dose" />
                  <select value={v.route} onChange={e => updateVaccine(i, 'route', e.target.value)} className={iCls}>
                    {VACCINE_ROUTES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <input value={v.quantityUsed} onChange={e => updateVaccine(i, 'quantityUsed', e.target.value)}
                    type="number" step="0.01" className={iCls} placeholder="Qty used" />
                </div>
              </div>
            ))}
          </div>

          {/* Supplements */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <FlaskConical className="w-4 h-4 text-purple-500" /> Supplements
              </p>
              <button type="button" onClick={addSupplement} className="flex items-center gap-1 text-xs font-semibold text-purple-600 dark:text-purple-400">
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>
            {supplements.map((s, i) => (
              <div key={i} className="rounded-xl border border-gray-200 dark:border-dark-border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <select value={s.storeItemId} onChange={e => updateSupplement(i, 'storeItemId', e.target.value)} className={`${iCls} flex-1`}>
                    <option value="">Select supplement…</option>
                    {supplementItems.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                  <button type="button" onClick={() => removeSupplement(i)} className="p-2 text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input value={s.dose} onChange={e => updateSupplement(i, 'dose', e.target.value)} className={iCls} placeholder="Dose" />
                  <input value={s.quantityUsed} onChange={e => updateSupplement(i, 'quantityUsed', e.target.value)}
                    type="number" step="0.01" className={iCls} placeholder="Qty used" />
                </div>
              </div>
            ))}
          </div>

          {/* Treatment — MORNING only */}
          {showTreatment && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                  <Stethoscope className="w-4 h-4 text-red-500" /> Treatment
                </p>
                <button type="button" onClick={addTreatment} className="flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400">
                  <Plus className="w-3.5 h-3.5" /> Add
                </button>
              </div>
              {treatments.map((t, i) => (
                <div key={i} className="rounded-xl border border-gray-200 dark:border-dark-border p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <select value={t.storeItemId} onChange={e => updateTreatment(i, 'storeItemId', e.target.value)} className={`${iCls} flex-1`}>
                      <option value="">Select drug…</option>
                      {treatmentItems.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                    <button type="button" onClick={() => removeTreatment(i)} className="p-2 text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <input value={t.dose} onChange={e => updateTreatment(i, 'dose', e.target.value)} className={iCls} placeholder="Dose" />
                    <select value={t.doseUnit} onChange={e => updateTreatment(i, 'doseUnit', e.target.value)} className={iCls}>
                      {DOSE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                    <select value={t.route} onChange={e => updateTreatment(i, 'route', e.target.value)} className={iCls}>
                      {TREATMENT_ROUTES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input value={t.quantityUsed} onChange={e => updateTreatment(i, 'quantityUsed', e.target.value)}
                      type="number" step="0.01" className={iCls} placeholder="Qty used" />
                    <input value={t.durationDays} onChange={e => updateTreatment(i, 'durationDays', e.target.value)}
                      type="number" min="0" className={iCls} placeholder="Duration (days)" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Feed — MORNING/EVENING only */}
          {showFeed && (
            <div className="space-y-2">
              <p className="text-sm font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <Wheat className="w-4 h-4 text-yellow-600" /> Feed Given
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Feed Item</FieldLabel>
                  <select value={feedStoreItemId} onChange={e => setFeedStoreItemId(e.target.value)} className={iCls}>
                    <option value="">None</option>
                    {feedItems.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </div>
                <div>
                  <FieldLabel>Quantity{selectedFeedItem ? ` (${selectedFeedItem.unit})` : ''}</FieldLabel>
                  <input value={feedQuantityKg} onChange={e => setFeedQuantityKg(e.target.value)}
                    type="number" step="0.1" min="0" className={iCls}
                    placeholder={selectedFeedItem?.unit === 'g' ? 'e.g. 25000' : 'e.g. 25'} />
                </div>
              </div>
            </div>
          )}

          {/* Mortality — every session */}
          <div className="space-y-3">
            <p className="text-sm font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
              <HeartCrack className="w-4 h-4 text-gray-500" /> Mortalities (if any)
            </p>
            <div className="flex rounded-xl border border-gray-200 dark:border-dark-border overflow-hidden text-xs font-semibold">
              <button type="button" onClick={() => setMortalityScope('GENERAL')}
                className={`flex-1 py-2 ${mortalityScope === 'GENERAL' ? 'bg-gray-800 text-white' : 'bg-white dark:bg-dark-bg text-gray-500'}`}>
                General (whole batch)
              </button>
              <button type="button" onClick={() => setMortalityScope('ROW_LEVEL')}
                className={`flex-1 py-2 ${mortalityScope === 'ROW_LEVEL' ? 'bg-gray-800 text-white' : 'bg-white dark:bg-dark-bg text-gray-500'}`}>
                Row / Level / Cage
              </button>
            </div>
            {mortalityScope === 'ROW_LEVEL' && (
              <div className="grid grid-cols-3 gap-2">
                <select value={mortRowId} onChange={e => { setMortRowId(e.target.value); setMortLevelId(''); setMortCageId(''); }} className={iCls}>
                  <option value="">Row…</option>
                  {rowsAndLevels.map(r => <option key={r.rowId} value={r.rowId}>{r.label}</option>)}
                </select>
                <select value={mortLevelId} onChange={e => { setMortLevelId(e.target.value); setMortCageId(''); }} className={iCls} disabled={!mortRowId}>
                  <option value="">Level…</option>
                  {mortLevelsForRow.map(l => <option key={l.levelId} value={l.levelId}>{l.label}</option>)}
                </select>
                <select value={mortCageId} onChange={e => setMortCageId(e.target.value)} className={iCls} disabled={!mortLevelId}>
                  <option value="">Cage…</option>
                  {mortCagesForLevel.map(c => <option key={c.cageId} value={c.cageId}>{c.label}</option>)}
                </select>
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <FieldLabel>Deaths</FieldLabel>
                <input value={mortalityCount} onChange={e => setMortalityCount(e.target.value)} type="number" min="0" className={iCls} />
              </div>
              <div>
                <FieldLabel>Culled</FieldLabel>
                <input value={cullingCount} onChange={e => setCullingCount(e.target.value)} type="number" min="0" className={iCls} />
              </div>
              <div>
                <FieldLabel>Cause</FieldLabel>
                <select value={cause} onChange={e => setCause(e.target.value)} className={iCls}>
                  <option value="">—</option>
                  {CAUSE_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>
            {totalLost > 0 && (
              <div className="rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/50 p-3 space-y-2">
                <FieldLabel>Had these birds eaten today's feed already? (optional)</FieldLabel>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 -mt-1">
                  Helps Store know how much less feed to expect being needed today — skip if unsure.
                </p>
                <div className="flex rounded-lg border border-gray-200 dark:border-dark-border overflow-hidden text-xs font-semibold">
                  <button type="button" onClick={() => setFedBeforeDeath('')}
                    className={`flex-1 py-1.5 ${fedBeforeDeath === '' ? 'bg-gray-800 text-white' : 'bg-white dark:bg-dark-bg text-gray-500'}`}>
                    Not sure
                  </button>
                  <button type="button" onClick={() => setFedBeforeDeath('NO')}
                    className={`flex-1 py-1.5 ${fedBeforeDeath === 'NO' ? 'bg-gray-800 text-white' : 'bg-white dark:bg-dark-bg text-gray-500'}`}>
                    No, not yet
                  </button>
                  <button type="button" onClick={() => setFedBeforeDeath('PARTIAL')}
                    className={`flex-1 py-1.5 ${fedBeforeDeath === 'PARTIAL' ? 'bg-gray-800 text-white' : 'bg-white dark:bg-dark-bg text-gray-500'}`}>
                    Yes, partly
                  </button>
                </div>
                {fedBeforeDeath === 'PARTIAL' && (
                  <div>
                    <FieldLabel>Roughly how much feed (kg) had they already eaten?</FieldLabel>
                    <input value={feedAlreadyEatenKg} onChange={e => setFeedAlreadyEatenKg(e.target.value)}
                      type="number" step="0.01" min="0" className={iCls} placeholder="e.g. 0.05" />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <FieldLabel>Notes</FieldLabel>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className={`${iCls} resize-none`} placeholder={`${meta.title} notes (optional)...`} />
          </div>

          {submitError && (
            <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 dark:text-red-400 whitespace-pre-line">{submitError}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-gray-100 dark:border-dark-border sticky bottom-0 bg-white dark:bg-dark-card flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-gray-200 dark:border-dark-border text-sm font-semibold text-gray-600 dark:text-gray-300">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submit.isPending || !isOpen}
            className={`flex-1 py-3 rounded-xl text-sm font-semibold text-white ${meta.accent} disabled:opacity-50`}
            title={!isOpen ? `${meta.title} is not open right now` : undefined}
          >
            {submit.isPending ? 'Saving…' : isOpen ? 'Save' : 'Closed'}
          </button>
        </div>
      </div>
    </div>
  );
}
