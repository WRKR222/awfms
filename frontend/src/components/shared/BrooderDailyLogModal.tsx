// src/components/shared/BrooderDailyLogModal.tsx
//
// Unified Brooder daily record — combines what used to be five separate
// modals (Session Log, Daily Entry, Treatment, General Record feed tab,
// General/per-cage Mortality) into ONE form that is submitted once.
//
//   • Session (environmental) readings  — temp / humidity / light. Morning,
//     Midday, and Evening are all entered and submitted TOGETHER in one
//     sitting (rather than requiring the attendant to return to the app at
//     three different times of day) — each is still its own independent
//     write, so filling in only Morning + Evening (say) is fine.
//   • Daily Entry                       — water, vaccines, supplements
//     (logged once per day).
//   • Treatment                         — optional; only submitted if at
//     least one drug entry is filled in.
//   • Feed                              — always logged for the WHOLE
//     unit (batch), never per row/level/cage.
//   • Mortality                         — optional; the attendant chooses
//     whether to log it against the whole batch ("General") or against a
//     specific Row → Level → Cage, depending on how the farm tracks it.
//   • Cage Reassignment                 — optional; describe the batch's
//     new cage layout as a handful of patterns (e.g. "42 cages × 20 birds
//     across 3 levels") instead of moving birds cage-by-cage. See the
//     "Cage Reassignment" section below for the format.
//   • Stock Count                       — opening/closing stock for the
//     whole batch.
//
// Every section above submits INDEPENDENTLY of the others — one section
// erroring (e.g. a duplicate daily-entry on a backdated date) never blocks
// the rest from saving. This matters most for Stock Count and Mortality,
// which should always go through even when a backdated Session or Daily
// Entry submission fails or is rejected as a duplicate.
//
// On submit, one request per non-empty/included section fires (all
// against endpoints that already existed, plus the new bulk-reassign one):
//   POST /flock/brooder-logs                   (x1 per included session, x1 for daily entry)
//   POST /flock/brooder-treatment-logs          (only if a treatment was filled in)
//   POST /brooder/general-feed-logs             (only if a feed quantity was entered)
//   POST /brooder/general-mortality-logs  OR  POST /brooder/mortality-logs
//     (only if mortality/culling counts were entered; endpoint depends on
//     the chosen scope)
//   POST /brooder/batches/:batchId/reassign-bulk  (only if a reassignment
//     block was added)
//   POST /brooder/stock-counts                  (only if an opening stock was entered)
//
// This replaces:
//   • BrooderPage's inline SessionLogModal / DailyEntryModal / TreatmentModal
//   • BrooderGeneralRecordModal (feed + mortality tabs)
//   • BrooderMortalityLogModal (per-cage mortality, now folded in as the
//     "Row / Level / Cage" mortality scope)
//   • The cage map's old "Reassign" action — tapping a level's action
//     button now opens THIS form (pre-scoped to that row/level) instead,
//     and the Cage Reassignment section replaces tedious per-cage moves
//     with pattern-based bulk placement.

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import {
  X, Calendar, AlertTriangle, Plus, Droplets, Thermometer, Gauge, Sun,
  Syringe, FlaskConical, Stethoscope, Pill, Wheat, HeartCrack, Info, ChevronDown, ChevronUp, Scale,
  Grid3x3,
} from 'lucide-react';
import { api } from '../../lib/api';
import dayjs from '../../lib/dayjs';
import { useBrooderRowsAndLevels } from '../../hooks/useBrooderCageMap';
import { useIssuableStoreItems, FEED_CATEGORIES, MEDICATION_CATEGORIES } from '../../hooks/useIssuableStoreItems';

// ── Constants ─────────────────────────────────────────────────────────────────

const SESSION_OPTIONS = [
  { value: 'MORNING', label: 'Morning', icon: '🌅' },
  { value: 'MIDDAY',  label: 'Midday',  icon: '☀️'  },
  { value: 'EVENING', label: 'Evening', icon: '🌙' },
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

function SectionHeader({
  icon: Icon, title, subtitle, badge, open, onToggle, accent = 'text-amber-500',
}: {
  icon: React.ElementType; title: string; subtitle?: string; badge?: string;
  open: boolean; onToggle: () => void; accent?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center justify-between gap-2 px-1 py-1 text-left"
    >
      <span className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${accent}`} />
        <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{title}</span>
        {badge && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500">
            {badge}
          </span>
        )}
        {subtitle && <span className="text-[11px] text-gray-400">{subtitle}</span>}
      </span>
      {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
    </button>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BrooderBatchLite {
  id: string;
  batchCode: string;
  currentBirdCount: number;
  quantityReceived: number;
  dateOfHatch: string;
}

/** Pre-scopes the form to a specific row/level (and, optionally, its cages)
 *  — used when opened from the cage map, where "Reassign" used to live. */
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
  quantityUsed: string; route: string; durationDays: string; rowId: string; levelId: string; notes: string;
}

function emptyTreatment(preset?: BrooderLogPresetScope): TreatmentEntry {
  return {
    storeItemId: '', drugName: '', dose: '', doseUnit: 'ml', quantityUsed: '',
    route: 'DRINKING_WATER', durationDays: '',
    rowId: preset?.rowId ?? '', levelId: preset?.levelId ?? '', notes: '',
  };
}

interface Props {
  batch: BrooderBatchLite;
  presetScope?: BrooderLogPresetScope;
  onClose: () => void;
}

export function BrooderDailyLogModal({ batch, presetScope, onClose }: Props) {
  const qc    = useQueryClient();
  const today = dayjs().format('YYYY-MM-DD');
  const min   = dayjs(batch.dateOfHatch).format('YYYY-MM-DD');

  const { data: rowsAndLevels = [] } = useBrooderRowsAndLevels(true);
  const { data: medItemsRaw,  isLoading: medItemsLoading  } = useIssuableStoreItems(MEDICATION_CATEGORIES);
  const { data: feedItemsRaw, isLoading: feedItemsLoading } = useIssuableStoreItems(FEED_CATEGORIES);
  const medItems  = medItemsRaw ?? [];
  const feedItems = (feedItemsRaw ?? []).filter(i => deriveFeedType(i) !== null);

  // ── Shared date ──────────────────────────────────────────────────────────
  const { register: registerDate, watch: watchDate } = useForm({ defaultValues: { logDate: today } });
  const logDate     = watchDate('logDate') || today;
  const isBackdated = logDate < today;
  const daysBack     = dayjs(today).diff(dayjs(logDate), 'day');

  // ── Section open/closed state ───────────────────────────────────────────
  const [openSection, setOpenSection] = useState({
    session: true, daily: true, treatment: !!presetScope, feed: true, mortality: !!presetScope,
    reassign: false, stock: true,
  });
  const toggle = (k: keyof typeof openSection) => setOpenSection(s => ({ ...s, [k]: !s[k] }));

  // ── Session (environmental) — Morning / Midday / Evening, all entered
  // and submitted together in one sitting. Each session is independent:
  // ticking "include" turns its fields on; unticked sessions are simply
  // skipped on submit (no request fires for them), and a failure on one
  // session never affects the others.
  type SessionKey = typeof SESSION_OPTIONS[number]['value'];
  interface SessionEntry {
    include: boolean;
    temperature: string;
    humidityPercent: string;
    lightIntensityLux: string;
    lightingOk: boolean;
    notes: string;
  }
  const emptySessionEntry = (): SessionEntry => ({
    include: false, temperature: '', humidityPercent: '', lightIntensityLux: '', lightingOk: true, notes: '',
  });
  const [sessions, setSessions] = useState<Record<SessionKey, SessionEntry>>({
    MORNING: emptySessionEntry(), MIDDAY: emptySessionEntry(), EVENING: emptySessionEntry(),
  });
  function updateSession<K extends keyof SessionEntry>(key: SessionKey, field: K, val: SessionEntry[K]) {
    setSessions(s => ({ ...s, [key]: { ...s[key], [field]: val } }));
  }
  const includedSessionKeys = (Object.keys(sessions) as SessionKey[]).filter(k => sessions[k].include);

  // ── Daily entry ──────────────────────────────────────────────────────────
  const [waterConsumptionL, setWaterConsumptionL] = useState('');
  const [dailyNotes,        setDailyNotes]        = useState('');
  const [vaccines,    setVaccines]    = useState<VaccineItem[]>([]);
  const [supplements, setSupplements] = useState<SupplementItem[]>([]);

  function addVaccine()    { setVaccines(v => [...v, { storeItemId: '', name: '', dose: '', route: 'DRINKING_WATER', quantityUsed: '' }]); }
  function removeVaccine(i: number) { setVaccines(v => v.filter((_, j) => j !== i)); }
  function updateVaccine(i: number, field: keyof VaccineItem, val: string) {
    setVaccines(v => v.map((item, j) => {
      if (j !== i) return item;
      const next = { ...item, [field]: val };
      if (field === 'storeItemId') next.name = medItems.find(m => m.id === val)?.name ?? '';
      return next;
    }));
  }

  function addSupplement()    { setSupplements(s => [...s, { storeItemId: '', name: '', dose: '', quantityUsed: '' }]); }
  function removeSupplement(i: number) { setSupplements(s => s.filter((_, j) => j !== i)); }
  function updateSupplement(i: number, field: keyof SupplementItem, val: string) {
    setSupplements(s => s.map((item, j) => {
      if (j !== i) return item;
      const next = { ...item, [field]: val };
      if (field === 'storeItemId') next.name = medItems.find(m => m.id === val)?.name ?? '';
      return next;
    }));
  }

  // ── Treatment (optional) ────────────────────────────────────────────────
  const [treatments, setTreatments] = useState<TreatmentEntry[]>([emptyTreatment(presetScope)]);
  function addTreatment()    { setTreatments(t => [...t, emptyTreatment(presetScope)]); }
  function removeTreatment(i: number) { setTreatments(t => t.filter((_, j) => j !== i)); }
  function updateTreatment(i: number, field: keyof TreatmentEntry, val: string) {
    setTreatments(t => t.map((item, j) => {
      if (j !== i) return item;
      const next = { ...item, [field]: val };
      if (field === 'storeItemId') next.drugName = medItems.find(m => m.id === val)?.name ?? '';
      if (field === 'rowId') next.levelId = ''; // level depends on row
      return next;
    }));
  }

  // ── Feed — always for the whole unit (batch), never per row/level ──────
  const [feedStoreItemId,     setFeedStoreItemId]     = useState('');
  const [feedQuantityKg,      setFeedQuantityKg]      = useState('');
  const [feedNotes,           setFeedNotes]           = useState('');
  const selectedFeedItem = feedItems.find(i => i.id === feedStoreItemId) ?? null;

  // ── Mortality — General (whole batch) or Row/Level/Cage, farm's choice ──
  const [mortalityScope, setMortalityScope] = useState<'GENERAL' | 'ROW_LEVEL'>(presetScope ? 'ROW_LEVEL' : 'GENERAL');
  const [mortRowId,   setMortRowId]   = useState(presetScope?.rowId ?? '');
  const [mortLevelId, setMortLevelId] = useState(presetScope?.levelId ?? '');
  const [mortCageId,  setMortCageId]  = useState(presetScope?.cages[0]?.cageId ?? '');
  const [mortalityCount, setMortalityCount] = useState('0');
  const [cullingCount,   setCullingCount]   = useState('0');
  const [cause,           setCause]         = useState('');
  const [mortalityNotes,  setMortalityNotes] = useState('');
  const totalLost = (Number(mortalityCount) || 0) + (Number(cullingCount) || 0);

  const mortLevelsForRow = rowsAndLevels.find(r => r.rowId === mortRowId)?.levels ?? [];
  const mortCagesForLevel = presetScope && presetScope.levelId === mortLevelId
    ? presetScope.cages
    : (mortLevelsForRow.find(l => l.levelId === mortLevelId)?.cages ?? []).filter(c => c.isOccupied)
        .map(c => ({ cageId: c.cageId, label: c.label, birdCount: c.currentBirdCount }));
  const selectedMortCage = mortCagesForLevel.find(c => c.cageId === mortCageId) ?? null;

  // ── Cage Reassignment (optional) — describe the batch's new cage layout
  // as a handful of patterns instead of moving birds cage-by-cage. Each
  // block fills a number of consecutive cages (from a start cage number)
  // with a fixed number of birds, replicated across every level chosen for
  // that block — e.g. "Row C: 42 cages × 20 birds across Levels 4/3/2" is
  // one block; "cage 43 × 20 birds on Level 4" is a second block.
  interface ReassignBlock {
    id: string;
    rowId: string;
    levelIds: string[];
    startCageNumber: string;
    cageCount: string;
    birdsPerCage: string;
    isIsolation: boolean;
    isolationReason: string;
  }
  const emptyReassignBlock = (): ReassignBlock => ({
    id: Math.random().toString(36).slice(2), rowId: '', levelIds: [], startCageNumber: '1', cageCount: '', birdsPerCage: '',
    isIsolation: false, isolationReason: '',
  });
  const [reassignBlocks, setReassignBlocks] = useState<ReassignBlock[]>([]);
  const [reassignNotes,  setReassignNotes]  = useState('');
  function addReassignBlock()    { setReassignBlocks(b => [...b, emptyReassignBlock()]); }
  function removeReassignBlock(id: string) { setReassignBlocks(b => b.filter(x => x.id !== id)); }
  function updateReassignBlock(id: string, field: keyof ReassignBlock, val: string | boolean) {
    setReassignBlocks(b => b.map(x => {
      if (x.id !== id) return x;
      const next = { ...x, [field]: val } as ReassignBlock;
      if (field === 'rowId') next.levelIds = []; // levels depend on row
      return next;
    }));
  }
  function toggleReassignLevel(id: string, levelId: string) {
    setReassignBlocks(b => b.map(x => x.id !== id ? x : {
      ...x, levelIds: x.levelIds.includes(levelId) ? x.levelIds.filter(l => l !== levelId) : [...x.levelIds, levelId],
    }));
  }
  const reassignTotalBirds = reassignBlocks.reduce(
    (sum, b) => sum + b.levelIds.length * (Number(b.cageCount) || 0) * (Number(b.birdsPerCage) || 0), 0,
  );
  const reassignIsolationBirds = reassignBlocks
    .filter(b => b.isIsolation)
    .reduce((sum, b) => sum + b.levelIds.length * (Number(b.cageCount) || 0) * (Number(b.birdsPerCage) || 0), 0);

  // ── Stock count — opening/closing stock reconciliation ─────────────────
  // Opening stock normally just carries forward as the previous day's
  // closing stock (fetched below). The farm sometimes does a physical bird
  // count that finds fewer birds than expected — when the attendant's
  // entered opening stock doesn't match, we flag it and ask why.
  const { data: expectedOpeningData } = useQuery({
    queryKey: ['brooder-expected-opening-stock', batch.id],
    queryFn:  () => api.get(`/brooder/batches/${batch.id}/expected-opening-stock`).then(r => r.data),
    staleTime: 30_000,
  });
  const expectedOpeningStock: number | null = expectedOpeningData?.expectedOpeningStock ?? null;
  const expectedAsOfDate:     string | null = expectedOpeningData?.asOfDate ?? null;

  const [openingStock,        setOpeningStock]        = useState('');
  const [openingStockTouched, setOpeningStockTouched] = useState(false);
  const [closingStock,        setClosingStock]        = useState('');
  const [closingStockTouched, setClosingStockTouched] = useState(false);
  const [varianceReason,      setVarianceReason]      = useState('');
  const [stockNotes,          setStockNotes]          = useState('');

  // Prefill opening stock from the expected value once it loads, as long as
  // the attendant hasn't already typed something themselves.
  useEffect(() => {
    if (expectedOpeningStock !== null && !openingStockTouched) {
      setOpeningStock(String(expectedOpeningStock));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expectedOpeningStock]);

  // Keep closing stock following opening stock minus today's total lost,
  // unless the attendant has manually overridden it (e.g. an end-of-day
  // recount too).
  useEffect(() => {
    if (!closingStockTouched) {
      const opening = Number(openingStock) || 0;
      setClosingStock(String(Math.max(0, opening - totalLost)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openingStock, totalLost]);

  const openingStockNum = Number(openingStock) || 0;
  const stockVariance    = expectedOpeningStock !== null ? openingStockNum - expectedOpeningStock : 0;
  const hasStockMismatch = expectedOpeningStock !== null && openingStock !== '' && stockVariance !== 0;

  const [submitError, setSubmitError] = useState<string | null>(null);

  function errMsg(err: any): string {
    const m = err?.response?.data?.message ?? err?.message ?? 'Failed to save.';
    return Array.isArray(m) ? m.join(', ') : String(m);
  }

  const submit = useMutation({
    mutationFn: async () => {
      // Every section below is wrapped in its own try/catch and collects
      // into `errors` rather than throwing — so one section's failure
      // (e.g. a duplicate Session or Daily Entry on a backdated date)
      // never prevents Mortality, Stock Count, or Cage Reassignment from
      // being submitted. All attempted sections run regardless of what
      // came before.
      const errors: string[] = [];

      // 1) Session (environmental) readings — one independent request per
      // INCLUDED session (Morning / Midday / Evening), all fired in this
      // one submission rather than requiring three separate visits.
      for (const key of includedSessionKeys) {
        const s = sessions[key];
        try {
          await api.post('/flock/brooder-logs', {
            batchId:           batch.id,
            logDate,
            logSession:        key,
            temperature:       s.temperature       ? Number(s.temperature)       : undefined,
            humidityPercent:   s.humidityPercent   ? Number(s.humidityPercent)   : undefined,
            lightIntensityLux: s.lightIntensityLux ? Number(s.lightIntensityLux) : undefined,
            lightingOk:        s.lightingOk,
            notes:             s.notes || undefined,
          });
        } catch (err: any) {
          const label = SESSION_OPTIONS.find(o => o.value === key)?.label ?? key;
          errors.push(`${label} session: ${errMsg(err)}`);
        }
      }

      // 2) Daily entry — water / vaccines / supplements, once per day.
      // Only fired when there's actually something to save — an empty
      // call has nothing to record and would just collide with any
      // existing once-daily entry on a backdated date for no reason.
      const cleanVaccines    = vaccines.filter(v => v.storeItemId && v.name.trim());
      const cleanSupplements = supplements.filter(s => s.storeItemId && s.name.trim());
      const hasDailyEntry = waterConsumptionL !== '' || cleanVaccines.length > 0 || cleanSupplements.length > 0 || dailyNotes.trim() !== '';
      if (hasDailyEntry) {
        try {
          await api.post('/flock/brooder-logs', {
            batchId:           batch.id,
            logDate,
            logSession:        undefined,
            waterConsumptionL: waterConsumptionL ? Number(waterConsumptionL) : undefined,
            vaccines:          cleanVaccines.map(v => ({
              name: v.name.trim(), dose: v.dose.trim(), route: v.route,
              storeItemId: v.storeItemId, quantityUsed: v.quantityUsed ? Number(v.quantityUsed) : undefined,
            })),
            supplements:       cleanSupplements.map(s => ({
              name: s.name.trim(), dose: s.dose.trim(),
              storeItemId: s.storeItemId, quantityUsed: s.quantityUsed ? Number(s.quantityUsed) : undefined,
            })),
            notes:             dailyNotes || undefined,
          });
        } catch (err: any) {
          errors.push(`Daily entry: ${errMsg(err)}`);
        }
      }

      // 3) Treatment — optional, only if at least one drug was picked.
      // Each treatment entry is independent of the others.
      const cleanTreatments = treatments.filter(t => t.storeItemId && t.drugName.trim());
      for (const t of cleanTreatments) {
        try {
          await api.post('/flock/brooder-treatment-logs', {
            batchId:      batch.id,
            treatmentDate: logDate,
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
          });
        } catch (err: any) {
          errors.push(`Treatment (${t.drugName.trim()}): ${errMsg(err)}`);
        }
      }

      // 4) Feed — optional, always for the whole unit.
      if (feedStoreItemId && Number(feedQuantityKg) > 0) {
        try {
          const item = feedItems.find(i => i.id === feedStoreItemId);
          await api.post('/brooder/general-feed-logs', {
            batchId:             batch.id,
            entryDate:           logDate,
            feedType:            item ? deriveFeedType(item) ?? undefined : undefined,
            storeItemId:         feedStoreItemId,
            quantityDispensedKg: Number(feedQuantityKg),
            notes:               feedNotes || undefined,
          });
        } catch (err: any) {
          errors.push(`Feed: ${errMsg(err)}`);
        }
      }

      // 5) Mortality — optional, General (whole batch) or Row/Level/Cage.
      // Independent of every section above and below — a Session or Daily
      // Entry failure never stops today's mortality from being recorded.
      let mortalityResult: any = null;
      if (totalLost > 0) {
        try {
          if (mortalityScope === 'GENERAL') {
            const res = await api.post('/brooder/general-mortality-logs', {
              batchId:        batch.id,
              logDate,
              mortalityCount: Number(mortalityCount) || 0,
              cullingCount:   Number(cullingCount)   || 0,
              cause:          cause || undefined,
              notes:          mortalityNotes || undefined,
            });
            mortalityResult = res.data;
          } else {
            const res = await api.post('/brooder/mortality-logs', {
              levelId:        mortLevelId,
              cageId:         mortCageId,
              batchId:        batch.id,
              logDate,
              mortalityCount: Number(mortalityCount) || 0,
              cullingCount:   Number(cullingCount)   || 0,
              cause:          cause || undefined,
              notes:          mortalityNotes || undefined,
            });
            mortalityResult = res.data;
          }
        } catch (err: any) {
          errors.push(`Mortality: ${errMsg(err)}`);
        }
      }

      // 6) Cage Reassignment — optional, pattern-based bulk placement.
      // Independent of every other section.
      let reassignResult: any = null;
      if (reassignBlocks.length > 0) {
        try {
          const res = await api.post(`/brooder/batches/${batch.id}/reassign-bulk`, {
            blocks: reassignBlocks.map(b => ({
              rowId:           b.rowId,
              levelIds:        b.levelIds,
              cageCount:       Number(b.cageCount),
              birdsPerCage:    Number(b.birdsPerCage),
              startCageNumber: b.startCageNumber ? Number(b.startCageNumber) : undefined,
              isIsolation:     b.isIsolation,
              isolationReason: b.isIsolation ? b.isolationReason.trim() : undefined,
            })),
            placedDate: logDate,
            notes:      reassignNotes || undefined,
          });
          reassignResult = res.data;
        } catch (err: any) {
          errors.push(`Cage reassignment: ${errMsg(err)}`);
        }
      }

      // 7) Stock count — opening/closing stock for the whole batch. Always
      // submitted once the attendant has an opening stock value, since
      // it's a core daily record — flags a variance server-side if it
      // doesn't match the previous day's closing stock. Runs independently
      // of every section above, so a backdated Session/Daily Entry/
      // Treatment failure never blocks it.
      let stockResult: any = null;
      if (openingStock !== '') {
        try {
          const res = await api.post('/brooder/stock-counts', {
            batchId:        batch.id,
            logDate,
            openingStock:   openingStockNum,
            mortalityCount: Number(mortalityCount) || 0,
            cullingCount:   Number(cullingCount)   || 0,
            closingStock:   Number(closingStock)   || 0,
            varianceReason: varianceReason || undefined,
            notes:          stockNotes || undefined,
          });
          stockResult = res.data;
        } catch (err: any) {
          errors.push(`Stock count: ${errMsg(err)}`);
        }
      }

      return { errors, mortalityResult, stockResult, reassignResult };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['brooder-logs',     batch.id] });
      qc.invalidateQueries({ queryKey: ['brooder-last-log', batch.id] });
      qc.invalidateQueries({ queryKey: ['brooder-treatments', batch.id] });
      qc.invalidateQueries({ queryKey: ['brooder-population-record-sheet', batch.id] });
      qc.invalidateQueries({ queryKey: ['brooder-stock-counts', batch.id] });
      qc.invalidateQueries({ queryKey: ['brooder-expected-opening-stock', batch.id] });
      qc.invalidateQueries({ queryKey: ['brooder-cage-map'] });
      qc.invalidateQueries({ queryKey: ['brooder-rows-and-levels'] });
      qc.invalidateQueries({ queryKey: ['brooder-feed-summary'] });
      qc.invalidateQueries({ queryKey: ['store-issuable-items'] });
      qc.invalidateQueries({ queryKey: ['batches'] });

      if (result.errors.length > 0) {
        // Partial success — whatever DID go through is already saved and
        // the queries above are invalidated to reflect it. Keep the form
        // open so the attendant can see what failed and retry just those
        // fields, instead of pretending everything worked.
        setSubmitError(`Saved, but some sections failed:\n• ${result.errors.join('\n• ')}`);
      } else {
        onClose();
      }
    },
    onError: (err: any) => {
      setSubmitError(errMsg(err));
    },
  });

  function handleSubmit() {
    setSubmitError(null);
    const cleanVaccines    = vaccines.filter(v => v.storeItemId && v.name.trim());
    const cleanSupplements = supplements.filter(s => s.storeItemId && s.name.trim());
    if (cleanVaccines.some(v => !v.dose.trim()))       { setSubmitError('Each vaccine entry must have a dose.'); return; }
    if (cleanSupplements.some(s => !s.dose.trim()))    { setSubmitError('Each supplement entry must have a dose.'); return; }

    const cleanTreatments = treatments.filter(t => t.storeItemId && t.drugName.trim());
    if (cleanTreatments.some(t => !t.dose.trim()))     { setSubmitError('Each treatment entry must have a dose.'); return; }

    if (feedStoreItemId && !(Number(feedQuantityKg) > 0)) {
      setSubmitError('Enter a feed quantity greater than 0, or clear the feed type.'); return;
    }

    if (totalLost > 0) {
      if (mortalityScope === 'ROW_LEVEL' && (!mortLevelId || !mortCageId)) {
        setSubmitError('Select a row, level, and cage for the mortality entry, or switch to General.'); return;
      }
      if (mortalityScope === 'GENERAL' && totalLost > batch.currentBirdCount) {
        setSubmitError(`Total lost (${totalLost}) exceeds live birds in the batch (${batch.currentBirdCount}).`); return;
      }
    }

    if (reassignBlocks.length > 0) {
      const incomplete = reassignBlocks.some(b =>
        !b.rowId || b.levelIds.length === 0 || !(Number(b.cageCount) > 0) || b.birdsPerCage === '' || Number(b.birdsPerCage) < 0,
      );
      if (incomplete) {
        setSubmitError('Complete every cage reassignment block (row, at least one level, cage count, and birds per cage) or remove incomplete ones.');
        return;
      }
      const missingIsolationReason = reassignBlocks.some(b => b.isIsolation && b.isolationReason.trim().length < 3);
      if (missingIsolationReason) {
        setSubmitError('Give a reason (at least 3 characters) for each block marked as an isolation cage.');
        return;
      }
    }

    if (openingStock === '') {
      setSubmitError('Enter an opening stock count for the day.'); return;
    }
    if (Number(closingStock) > openingStockNum) {
      setSubmitError('Closing stock cannot exceed opening stock.'); return;
    }
    if (hasStockMismatch && !varianceReason.trim()) {
      setSubmitError(`Opening stock (${openingStockNum.toLocaleString()}) doesn't match the expected ${expectedOpeningStock!.toLocaleString()} — give a reason (e.g. physical bird count).`);
      return;
    }

    submit.mutate();
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white dark:bg-dark-card w-full md:max-w-2xl rounded-t-3xl md:rounded-2xl shadow-2xl overflow-y-auto max-h-[95vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-dark-border sticky top-0 bg-white dark:bg-dark-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-500 rounded-xl flex items-center justify-center">
              <Thermometer className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-bold text-gray-800 dark:text-gray-100">Daily Log</p>
              <p className="text-xs text-gray-400">
                {batch.batchCode}
                {presetScope ? ` · ${presetScope.rowLabel} · ${presetScope.levelLabel}` : ' · whole batch'}
                {' '}· session (AM/mid/PM), daily entry, treatment, feed, mortality &amp; reassignment — one submission
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-bg">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* ── Shared date ── */}
          <div>
            <label className={lCls}><Calendar className="w-3 h-3 inline mr-1" />Date</label>
            <input {...registerDate('logDate', { required: true })} type="date" min={min} max={today} className={iCls} />
            {isBackdated && daysBack > 0 && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Backdated {daysBack}d — every section below will record against {dayjs(logDate).format('D MMM')}
              </p>
            )}
          </div>

          {/* ── Session (environmental) — Morning / Midday / Evening together ── */}
          <div className="rounded-xl border border-orange-100 dark:border-orange-900/30 bg-orange-50/40 dark:bg-orange-900/10 p-3 space-y-3">
            <SectionHeader icon={Thermometer} title="Session Environmental Readings"
              subtitle="tick each session you're recording — all submit together" accent="text-orange-500"
              open={openSection.session} onToggle={() => toggle('session')} />
            {openSection.session && (
              <div className="space-y-3">
                {SESSION_OPTIONS.map(opt => {
                  const s = sessions[opt.value];
                  return (
                    <div key={opt.value} className={`rounded-xl border p-3 space-y-3 transition-colors ${
                      s.include
                        ? 'border-orange-300 dark:border-orange-700 bg-white dark:bg-dark-bg'
                        : 'border-gray-200 dark:border-dark-border bg-gray-50/60 dark:bg-dark-card'
                    }`}>
                      <label className="flex items-center justify-between cursor-pointer">
                        <span className="flex items-center gap-2">
                          <span className="text-lg">{opt.icon}</span>
                          <span className="text-sm font-bold text-gray-700 dark:text-gray-200">{opt.label}</span>
                        </span>
                        <input type="checkbox" checked={s.include}
                          onChange={e => updateSession(opt.value, 'include', e.target.checked)}
                          className="w-4 h-4 accent-orange-500" />
                      </label>

                      {s.include && (
                        <>
                          <div className="grid grid-cols-3 gap-3">
                            <div>
                              <label className={lCls}><Thermometer className="w-3 h-3 inline mr-1 text-orange-400" />Temp (°C)</label>
                              <input value={s.temperature} onChange={e => updateSession(opt.value, 'temperature', e.target.value)}
                                type="number" step="0.1" className={iCls} placeholder="e.g. 32" />
                            </div>
                            <div>
                              <label className={lCls}><Gauge className="w-3 h-3 inline mr-1 text-blue-400" />Humidity (%)</label>
                              <input value={s.humidityPercent} onChange={e => updateSession(opt.value, 'humidityPercent', e.target.value)}
                                type="number" step="1" min="0" max="100" className={iCls} placeholder="e.g. 60" />
                            </div>
                            <div>
                              <label className={lCls}><Sun className="w-3 h-3 inline mr-1 text-amber-400" />Light (lux)</label>
                              <input value={s.lightIntensityLux} onChange={e => updateSession(opt.value, 'lightIntensityLux', e.target.value)}
                                type="number" min="0" className={iCls} placeholder="e.g. 20" />
                            </div>
                          </div>
                          <label className="flex items-center gap-2 cursor-pointer p-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/20">
                            <input type="checkbox" checked={s.lightingOk}
                              onChange={e => updateSession(opt.value, 'lightingOk', e.target.checked)}
                              className="w-4 h-4 accent-amber-500" />
                            <Sun className="w-4 h-4 text-amber-500" />
                            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Lighting adequate</span>
                          </label>
                          <textarea value={s.notes} onChange={e => updateSession(opt.value, 'notes', e.target.value)} rows={2}
                            className={`${iCls} resize-none`} placeholder={`${opt.label} session notes (optional)...`} />
                        </>
                      )}
                    </div>
                  );
                })}
                {includedSessionKeys.length === 0 && (
                  <p className="text-[11px] text-gray-400 italic">No sessions ticked — none will be recorded.</p>
                )}
              </div>
            )}
          </div>

          {/* ── Daily entry ── */}
          <div className="rounded-xl border border-sky-100 dark:border-sky-900/30 bg-sky-50/40 dark:bg-sky-900/10 p-3 space-y-3">
            <SectionHeader icon={Droplets} title="Daily Entry" subtitle="water / vaccines / supplements · once per day" accent="text-sky-500"
              open={openSection.daily} onToggle={() => toggle('daily')} />
            {openSection.daily && (
              <>
                <div>
                  <label className={lCls}><Droplets className="w-3 h-3 inline mr-1 text-sky-400" />Water Consumed (L)</label>
                  <input value={waterConsumptionL} onChange={e => setWaterConsumptionL(e.target.value)} type="number" step="0.1" min="0" className={iCls} placeholder="e.g. 25" />
                </div>

                {/* Vaccines */}
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
                    <p className="text-[11px] text-gray-400 italic">No vaccines added.</p>
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
                            type="number" step="any" min="0" className={iCls}
                            placeholder={picked ? `Residual: ${picked.residual.toFixed(2)} ${picked.unit.toLowerCase()}` : 'Select a vaccine first'} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Supplements */}
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
                    <p className="text-[11px] text-gray-400 italic">No supplements added.</p>
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
                            type="number" step="any" min="0" className={iCls}
                            placeholder={picked ? `Residual: ${picked.residual.toFixed(2)} ${picked.unit.toLowerCase()}` : 'Select a supplement first'} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <textarea value={dailyNotes} onChange={e => setDailyNotes(e.target.value)} rows={2}
                  className={`${iCls} resize-none`} placeholder="Daily entry notes (optional)..." />
              </>
            )}
          </div>

          {/* ── Treatment (optional) ── */}
          <div className="rounded-xl border border-red-100 dark:border-red-900/30 bg-red-50/40 dark:bg-red-900/10 p-3 space-y-3">
            <SectionHeader icon={Stethoscope} title="Treatment" badge="optional — fill if any" accent="text-red-500"
              open={openSection.treatment} onToggle={() => toggle('treatment')} />
            {openSection.treatment && (
              <>
                {treatments.map((t, i) => {
                  const levelsForRow = rowsAndLevels.find(r => r.rowId === t.rowId)?.levels ?? [];
                  return (
                    <div key={i} className="rounded-xl border border-red-100 dark:border-red-900/30 bg-white dark:bg-dark-bg p-3 space-y-3">
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
                        <label className={lCls}><Pill className="w-3 h-3 inline mr-1 text-red-400" />Drug / Product</label>
                        <select value={t.storeItemId} onChange={e => updateTreatment(i, 'storeItemId', e.target.value)}
                          className={iCls} disabled={medItemsLoading}>
                          <option value="">{medItemsLoading ? 'Loading…' : 'Select drug (leave blank to skip)…'}</option>
                          {medItems.map(m => (
                            <option key={m.id} value={m.id}>{m.name} — residual {m.residual.toFixed(2)} {m.unit.toLowerCase()}</option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className={lCls}>Dose</label>
                          <input value={t.dose} onChange={e => updateTreatment(i, 'dose', e.target.value)}
                            className={iCls} placeholder="e.g. 1" />
                        </div>
                        <div>
                          <label className={lCls}>Unit</label>
                          <select value={t.doseUnit} onChange={e => updateTreatment(i, 'doseUnit', e.target.value)} className={iCls}>
                            {DOSE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                        </div>
                        <div>
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
                                type="number" step="any" min="0" className={iCls}
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
                      <div className="rounded-xl border border-gray-100 dark:border-dark-border bg-gray-50 dark:bg-dark-card p-3 space-y-2">
                        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Target Row &amp; Level (optional)</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className={lCls}>Row</label>
                            <select value={t.rowId} onChange={e => updateTreatment(i, 'rowId', e.target.value)} className={iCls}>
                              <option value="">All rows</option>
                              {rowsAndLevels.map(r => <option key={r.rowId} value={r.rowId}>{r.label}</option>)}
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
              </>
            )}
          </div>

          {/* ── Feed — whole unit ── */}
          <div className="rounded-xl border border-amber-100 dark:border-amber-900/30 bg-amber-50/40 dark:bg-amber-900/10 p-3 space-y-3">
            <SectionHeader icon={Wheat} title="Feed" subtitle="whole unit — not per row/level" badge="optional" accent="text-amber-500"
              open={openSection.feed} onToggle={() => toggle('feed')} />
            {openSection.feed && (
              <>
                <div>
                  <label className={lCls}>Feed type</label>
                  <select value={feedStoreItemId} onChange={e => setFeedStoreItemId(e.target.value)} className={iCls} disabled={feedItemsLoading}>
                    <option value="">{feedItemsLoading ? 'Loading issued feed…' : 'Select feed type (leave blank to skip)…'}</option>
                    {feedItems.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
                  </select>
                  {!feedItemsLoading && feedItems.length === 0 && (
                    <p className="text-amber-600 dark:text-amber-400 text-xs mt-1 flex items-start gap-1">
                      <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                      No feed has been issued from the store this week yet.
                    </p>
                  )}
                </div>
                {selectedFeedItem && (
                  <div className="rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-bg p-3 grid grid-cols-3 gap-3">
                    <div>
                      <p className={lCls}>Issued</p>
                      <p className="text-sm font-bold text-gray-800 dark:text-gray-100">{selectedFeedItem.issuedThisWeek.toFixed(2)} {selectedFeedItem.unit}</p>
                    </div>
                    <div>
                      <p className={lCls}>Dispensed</p>
                      <p className="text-sm font-bold text-gray-800 dark:text-gray-100">{selectedFeedItem.dispensedThisWeek.toFixed(2)} {selectedFeedItem.unit}</p>
                    </div>
                    <div>
                      <p className={lCls}>Remaining</p>
                      <p className="text-sm font-bold text-amber-600 dark:text-amber-400">{selectedFeedItem.residual.toFixed(2)} {selectedFeedItem.unit}</p>
                    </div>
                  </div>
                )}
                <div>
                  <label className={lCls}>Quantity dispensed (kg)</label>
                  <input value={feedQuantityKg} onChange={e => setFeedQuantityKg(e.target.value)} type="number" step="0.01" min="0"
                    className={`${iCls} text-center font-bold text-amber-600 dark:text-amber-400`} placeholder="0.00" />
                </div>
                <textarea value={feedNotes} onChange={e => setFeedNotes(e.target.value)} rows={2}
                  className={`${iCls} resize-none`} placeholder="Feed notes (optional)..." />
              </>
            )}
          </div>

          {/* ── Mortality ── */}
          <div className="rounded-xl border border-rose-100 dark:border-rose-900/30 bg-rose-50/40 dark:bg-rose-900/10 p-3 space-y-3">
            <SectionHeader icon={HeartCrack} title="Mortality" badge="optional" accent="text-rose-500"
              open={openSection.mortality} onToggle={() => toggle('mortality')} />
            {openSection.mortality && (
              <>
                <div className="flex items-center gap-2 bg-white dark:bg-dark-bg rounded-xl p-3 text-sm">
                  <Info className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span className="text-gray-600 dark:text-gray-300">
                    Live birds in batch: <strong className="text-gray-800 dark:text-gray-100">{batch.currentBirdCount.toLocaleString()}</strong>
                  </span>
                </div>

                <div>
                  <p className={lCls}>How does the farm track this?</p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className={`flex items-center justify-center gap-1.5 p-2.5 rounded-xl border cursor-pointer text-xs font-semibold transition-colors ${
                      mortalityScope === 'GENERAL' ? 'border-rose-500 bg-rose-50 dark:bg-rose-900/20 text-rose-600' : 'border-gray-200 dark:border-dark-border text-gray-500'
                    }`}>
                      <input type="radio" className="sr-only" checked={mortalityScope === 'GENERAL'} onChange={() => setMortalityScope('GENERAL')} />
                      Whole batch (General)
                    </label>
                    <label className={`flex items-center justify-center gap-1.5 p-2.5 rounded-xl border cursor-pointer text-xs font-semibold transition-colors ${
                      mortalityScope === 'ROW_LEVEL' ? 'border-rose-500 bg-rose-50 dark:bg-rose-900/20 text-rose-600' : 'border-gray-200 dark:border-dark-border text-gray-500'
                    }`}>
                      <input type="radio" className="sr-only" checked={mortalityScope === 'ROW_LEVEL'} onChange={() => setMortalityScope('ROW_LEVEL')} />
                      Per Row / Level / Cage
                    </label>
                  </div>
                </div>

                {mortalityScope === 'ROW_LEVEL' && (
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className={lCls}>Row</label>
                      <select value={mortRowId} disabled={!!presetScope}
                        onChange={e => { setMortRowId(e.target.value); setMortLevelId(''); setMortCageId(''); }} className={iCls}>
                        <option value="">Select row…</option>
                        {rowsAndLevels.map(r => <option key={r.rowId} value={r.rowId}>{r.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={lCls}>Level</label>
                      <select value={mortLevelId} disabled={!!presetScope || !mortRowId}
                        onChange={e => { setMortLevelId(e.target.value); setMortCageId(''); }} className={iCls}>
                        <option value="">Select level…</option>
                        {mortLevelsForRow.filter(l => l.isOccupied).map(l => (
                          <option key={l.levelId} value={l.levelId}>{l.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={lCls}>Cage</label>
                      <select value={mortCageId} onChange={e => setMortCageId(e.target.value)} className={iCls} disabled={!mortLevelId}>
                        <option value="">Select cage…</option>
                        {mortCagesForLevel.map(c => (
                          <option key={c.cageId} value={c.cageId}>{c.label} — {c.birdCount.toLocaleString()} birds</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lCls}>Deaths (mortality)</label>
                    <input value={mortalityCount} onChange={e => setMortalityCount(e.target.value)} type="number" min="0"
                      className={`${iCls} text-center font-bold text-red-600 dark:text-red-400`} placeholder="0" />
                  </div>
                  <div>
                    <label className={lCls}>Culled birds</label>
                    <input value={cullingCount} onChange={e => setCullingCount(e.target.value)} type="number" min="0"
                      className={`${iCls} text-center font-bold text-orange-600 dark:text-orange-400`} placeholder="0" />
                  </div>
                </div>

                {totalLost > 0 && (
                  <div className={`rounded-xl p-3 text-sm font-semibold flex items-center gap-2 ${
                    mortalityScope === 'GENERAL' && totalLost > batch.currentBirdCount
                      ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
                      : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
                  }`}>
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    {totalLost} bird{totalLost !== 1 ? 's' : ''} will be recorded as lost
                    {mortalityScope === 'ROW_LEVEL' && selectedMortCage ? ` from ${selectedMortCage.label}` : ' from the batch'}
                  </div>
                )}

                <div>
                  <label className={lCls}>Cause</label>
                  <select value={cause} onChange={e => setCause(e.target.value)} className={iCls}>
                    <option value="">Select cause (optional)</option>
                    {CAUSE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <textarea value={mortalityNotes} onChange={e => setMortalityNotes(e.target.value)} rows={2}
                  className={`${iCls} resize-none`} placeholder="Mortality notes (optional)..." />
              </>
            )}
          </div>

          {/* ── Cage Reassignment (optional) ── */}
          <div className="rounded-xl border border-emerald-100 dark:border-emerald-900/30 bg-emerald-50/40 dark:bg-emerald-900/10 p-3 space-y-3">
            <SectionHeader icon={Grid3x3} title="Cage Reassignment" subtitle="pattern-based — replaces per-cage moves" accent="text-emerald-500"
              open={openSection.reassign} onToggle={() => toggle('reassign')} />
            {openSection.reassign && (
              <>
                <div className="flex items-start gap-2 bg-white dark:bg-dark-bg rounded-xl p-3 text-sm">
                  <Info className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                  <span className="text-gray-600 dark:text-gray-300">
                    Describe the new layout as patterns instead of moving birds cage-by-cage — e.g. "42 cages × 20 birds"
                    across a few levels, plus "1 more cage × 20 birds" on another. This <strong>replaces the batch's entire
                    cage layout</strong> with what you define below. Tick <strong>isolation</strong> on a block if the
                    birds it places are being set apart (sick, injured, under observation).
                  </span>
                </div>

                {reassignBlocks.map((b, i) => {
                  const levelsForRow = rowsAndLevels.find(r => r.rowId === b.rowId)?.levels ?? [];
                  const blockBirds = b.levelIds.length * (Number(b.cageCount) || 0) * (Number(b.birdsPerCage) || 0);
                  return (
                    <div key={b.id} className="rounded-xl border border-emerald-100 dark:border-emerald-800 bg-white dark:bg-dark-bg p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">Block {i + 1}</span>
                        <button type="button" onClick={() => removeReassignBlock(b.id)} className="text-gray-400 hover:text-red-500">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div>
                        <label className={lCls}>Row</label>
                        <select value={b.rowId} onChange={e => updateReassignBlock(b.id, 'rowId', e.target.value)} className={iCls}>
                          <option value="">Select row…</option>
                          {rowsAndLevels.map(r => <option key={r.rowId} value={r.rowId}>{r.label}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className={lCls}>Levels — pattern applies to each one you pick</label>
                        <div className="flex flex-wrap gap-1.5">
                          {!b.rowId && <span className="text-[11px] text-gray-400 italic">Select a row first</span>}
                          {levelsForRow.map(l => (
                            <button key={l.levelId} type="button" onClick={() => toggleReassignLevel(b.id, l.levelId)}
                              className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                                b.levelIds.includes(l.levelId)
                                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                                  : 'border-gray-200 dark:border-dark-border text-gray-500 dark:text-gray-400'
                              }`}>
                              {l.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className={lCls}>Start cage #</label>
                          <input value={b.startCageNumber} onChange={e => updateReassignBlock(b.id, 'startCageNumber', e.target.value)}
                            type="number" min="1" className={iCls} />
                        </div>
                        <div>
                          <label className={lCls}># of cages</label>
                          <input value={b.cageCount} onChange={e => updateReassignBlock(b.id, 'cageCount', e.target.value)}
                            type="number" min="1" className={iCls} placeholder="e.g. 42" />
                        </div>
                        <div>
                          <label className={lCls}>Birds / cage</label>
                          <input value={b.birdsPerCage} onChange={e => updateReassignBlock(b.id, 'birdsPerCage', e.target.value)}
                            type="number" min="0" className={iCls} placeholder="e.g. 20" />
                        </div>
                      </div>

                      {blockBirds > 0 && (
                        <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                          = {blockBirds.toLocaleString()} birds across {b.levelIds.length} level{b.levelIds.length !== 1 ? 's' : ''}
                          {' '}({b.cageCount || 0} cages × {b.birdsPerCage || 0} birds, from cage {b.startCageNumber || 1})
                        </p>
                      )}

                      <label className={`flex items-center gap-2 cursor-pointer p-2.5 rounded-xl ${
                        b.isIsolation ? 'bg-red-50 dark:bg-red-900/20' : 'bg-gray-50 dark:bg-dark-card'
                      }`}>
                        <input type="checkbox" checked={b.isIsolation}
                          onChange={e => updateReassignBlock(b.id, 'isIsolation', e.target.checked)}
                          className="w-4 h-4 accent-red-500" />
                        <AlertTriangle className={`w-4 h-4 ${b.isIsolation ? 'text-red-500' : 'text-gray-400'}`} />
                        <span className={`text-sm font-semibold ${b.isIsolation ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
                          Mark this block as isolation cage{b.levelIds.length * (Number(b.cageCount) || 0) !== 1 ? 's' : ''}
                        </span>
                      </label>
                      {b.isIsolation && (
                        <div>
                          <label className={lCls}>Isolation reason</label>
                          <textarea value={b.isolationReason} onChange={e => updateReassignBlock(b.id, 'isolationReason', e.target.value)}
                            rows={2} className={`${iCls} resize-none`} placeholder="e.g. sick birds separated for observation..." />
                        </div>
                      )}
                    </div>
                  );
                })}

                <button type="button" onClick={addReassignBlock}
                  className="w-full border border-dashed border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400 rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-1.5 hover:bg-emerald-50 dark:hover:bg-emerald-900/10 transition-colors">
                  <Plus className="w-3.5 h-3.5" /> Add block
                </button>

                {reassignBlocks.length > 0 && (
                  <>
                    <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 p-3 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                      Total: {reassignTotalBirds.toLocaleString()} birds across {reassignBlocks.length} block{reassignBlocks.length !== 1 ? 's' : ''}
                      {reassignIsolationBirds > 0 && (
                        <span className="block text-red-600 dark:text-red-400 font-normal mt-1">
                          Includes {reassignIsolationBirds.toLocaleString()} birds marked as isolation.
                        </span>
                      )}
                      {reassignTotalBirds > batch.currentBirdCount && (
                        <span className="block text-red-600 dark:text-red-400 font-normal mt-1">
                          Exceeds the {batch.currentBirdCount.toLocaleString()} live birds this batch currently has.
                        </span>
                      )}
                    </div>
                    <textarea value={reassignNotes} onChange={e => setReassignNotes(e.target.value)} rows={2}
                      className={`${iCls} resize-none`} placeholder="Reassignment notes (optional)..." />
                  </>
                )}
              </>
            )}
          </div>

          {/* ── Stock Count — opening/closing stock reconciliation ── */}
          <div className="rounded-xl border border-indigo-100 dark:border-indigo-900/30 bg-indigo-50/40 dark:bg-indigo-900/10 p-3 space-y-3">
            <SectionHeader icon={Scale} title="Stock Count" subtitle="whole unit — opening &amp; closing" accent="text-indigo-500"
              open={openSection.stock} onToggle={() => toggle('stock')} />
            {openSection.stock && (
              <>
                <div className="flex items-center gap-2 bg-white dark:bg-dark-bg rounded-xl p-3 text-sm">
                  <Info className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span className="text-gray-600 dark:text-gray-300">
                    {expectedOpeningStock !== null ? (
                      <>Expected opening stock: <strong className="text-gray-800 dark:text-gray-100">{expectedOpeningStock.toLocaleString()}</strong>
                        {expectedAsOfDate
                          ? <> — closing stock from {dayjs(expectedAsOfDate).format('D MMM')}</>
                          : <> — batch's current live count (no prior stock count yet)</>}
                      </>
                    ) : 'Loading expected opening stock…'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lCls}>Opening Stock</label>
                    <input
                      value={openingStock}
                      onChange={e => { setOpeningStock(e.target.value); setOpeningStockTouched(true); }}
                      type="number" min="0"
                      className={`${iCls} text-center font-bold ${hasStockMismatch ? 'text-red-600 dark:text-red-400 border-red-300 dark:border-red-700' : 'text-indigo-600 dark:text-indigo-400'}`}
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className={lCls}>Closing Stock</label>
                    <input
                      value={closingStock}
                      onChange={e => { setClosingStock(e.target.value); setClosingStockTouched(true); }}
                      type="number" min="0"
                      className={`${iCls} text-center font-bold text-indigo-600 dark:text-indigo-400`}
                      placeholder="0"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-gray-400 -mt-1">
                  Closing stock defaults to Opening Stock − today's mortality/culling ({totalLost}), but can be overridden if you did an end-of-day recount too.
                </p>

                {hasStockMismatch && (
                  <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 space-y-2">
                    <p className="text-sm font-semibold text-red-700 dark:text-red-400 flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                      {stockVariance < 0
                        ? `${Math.abs(stockVariance).toLocaleString()} fewer birds than expected`
                        : `${stockVariance.toLocaleString()} more birds than expected`}
                    </p>
                    <p className="text-xs text-red-600 dark:text-red-400">
                      A bird count found a different number than the previous day's closing stock ({expectedOpeningStock!.toLocaleString()}).
                      This is flagged for the Manager and Owner to review — give a reason below (e.g. physical bird count, missed mortality entry).
                    </p>
                    <div>
                      <label className={lCls}>Reason *</label>
                      <input value={varianceReason} onChange={e => setVarianceReason(e.target.value)}
                        className={iCls} placeholder="e.g. Physical bird count on 25/7 found fewer birds" />
                    </div>
                  </div>
                )}

                <textarea value={stockNotes} onChange={e => setStockNotes(e.target.value)} rows={2}
                  className={`${iCls} resize-none`} placeholder="Stock count notes (optional)..." />
              </>
            )}
          </div>

          {(submit.isError || submitError) && (
            <p className="text-red-500 text-sm bg-red-50 dark:bg-red-900/20 rounded-xl p-3 whitespace-pre-line">
              {submitError ?? 'Failed to save. Please try again.'}
            </p>
          )}

          <div className="flex gap-3 pt-1 sticky bottom-0 bg-white dark:bg-dark-card pb-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 rounded-xl py-3 font-semibold text-sm">
              Cancel
            </button>
            <button type="button" onClick={handleSubmit} disabled={submit.isPending}
              className="flex-1 bg-amber-500 text-white rounded-xl py-3 font-semibold text-sm disabled:opacity-60">
              {submit.isPending ? 'Saving…' : isBackdated ? `Save for ${dayjs(logDate).format('D MMM')}` : 'Save Daily Log'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
