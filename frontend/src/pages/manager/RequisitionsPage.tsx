// src/pages/manager/RequisitionsPage.tsx
//
// PM's weekly requisition form — "items needed for the coming week" — sent
// to Store so it can be folded into that week's Issuance Plan. PM should
// submit by Thursday, two clear days ahead of Store's own Saturday
// issuance-plan deadline (a banner reminds them of this as the week goes on).
//
// A week is NOT limited to one submission — the PM can send a routine list,
// then come back later the same week and send another (e.g. a top-up when
// something extra comes up). Each submission gets its own reference and its
// own line items, each independently deletable, cascading down to whichever
// issuance plan draft it was folded into.
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import dayjs from '../../lib/dayjs';
import {
  Plus, Send, Trash2, AlertTriangle, CheckCircle,
  Clock, Package, History, PackagePlus, ListPlus, CalendarDays, X,
} from 'lucide-react';

const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';
const lCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1';

const DAY_KEYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
type DayKey = (typeof DAY_KEYS)[number];
const emptyBreakdown = (): Record<DayKey, number> => ({ MON: 0, TUE: 0, WED: 0, THU: 0, FRI: 0, SAT: 0, SUN: 0 });

/** Monday of the coming week — matches the Saturday Issuance Plan cadence. */
function nextMondayDate() {
  const today = dayjs();
  const daysUntilMon = (8 - today.day()) % 7 || 7;
  return today.add(daysUntilMon, 'day').startOf('day');
}

/** Monday of the current (in-progress) week. */
function thisMondayDate() {
  const today = dayjs();
  const daysSinceMon = (today.day() + 6) % 7; // Mon=0 .. Sun=6
  return today.subtract(daysSinceMon, 'day').startOf('day');
}

type WeekOption = 'CURRENT' | 'NEXT';

type DraftItem = {
  key: string;
  isCustom: boolean;
  storeItemId: string;
  customItemName: string;
  customItemUnit: string;
  quantityNeeded: string;
  notes: string;
  useDailyBreakdown: boolean;
  dailyBreakdown: Record<DayKey, number>;
};

function emptyItem(): DraftItem {
  return {
    key: Math.random().toString(36).slice(2),
    isCustom: false,
    storeItemId: '',
    customItemName: '',
    customItemUnit: '',
    quantityNeeded: '',
    notes: '',
    useDailyBreakdown: false,
    dailyBreakdown: emptyBreakdown(),
  };
}

function breakdownTotal(b: Record<DayKey, number>) {
  return DAY_KEYS.reduce((s, k) => s + (Number(b[k]) || 0), 0);
}

// ── Deadline banner ─────────────────────────────────────────────────────────
// For NEXT week: Thursday is the PM's own deadline — two clear days before
// Store's Saturday issuance-plan submission. Tone escalates Tue -> Thu -> after.
// For CURRENT week: there's no fixed deadline — it's an ad-hoc top-up on a
// week already in progress, so the banner explains routing instead: it lands
// in this week's weekly draft if Store hasn't submitted it yet, otherwise
// it becomes (or joins) an emergency plan for this week.
function DeadlineBanner({ weekOption, submittedCount }: { weekOption: WeekOption; submittedCount: number }) {
  const week = weekOption === 'CURRENT' ? thisMondayDate() : nextMondayDate();
  const weekLabel = `${week.format('D MMM')} – ${week.add(6, 'day').format('D MMM YYYY')}`;

  if (submittedCount > 0) {
    return (
      <div className="flex items-center gap-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl px-4 py-3 text-sm text-green-700 dark:text-green-400">
        <CheckCircle className="w-4 h-4 flex-shrink-0" />
        {submittedCount} list{submittedCount > 1 ? 's' : ''} already sent to Store for the week of {weekLabel}.
        You can still send more — each one is folded into the week's issuance plan (or an emergency plan,
        if this week's was already submitted) on its own.
      </div>
    );
  }

  if (weekOption === 'CURRENT') {
    return (
      <div className="flex items-start gap-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl px-4 py-3 text-sm text-blue-700 dark:text-blue-400">
        <Clock className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold">Adding to the current week ({weekLabel})</p>
          <p className="text-xs opacity-90 mt-0.5">
            If this week's issuance plan is still a draft, these items join it. If Store already submitted it,
            these items go onto an emergency plan for this week instead.
          </p>
        </div>
      </div>
    );
  }

  const dow = dayjs().day();
  const isDueToday = dow === 4; // Thursday
  const isOverdue = dow === 5 || dow === 6; // Fri / Sat — past the PM deadline
  const tone = isOverdue
    ? { bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-200 dark:border-red-700', text: 'text-red-700 dark:text-red-400' }
    : isDueToday
    ? { bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-700', text: 'text-amber-700 dark:text-amber-400' }
    : { bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-700', text: 'text-blue-700 dark:text-blue-400' };

  return (
    <div className={`flex items-start gap-2 ${tone.bg} border ${tone.border} rounded-xl px-4 py-3 text-sm ${tone.text}`}>
      {isOverdue ? <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <Clock className="w-4 h-4 flex-shrink-0 mt-0.5" />}
      <div>
        <p className="font-semibold">
          {isOverdue
            ? "Overdue — send this week's item list to Store"
            : isDueToday
            ? "Due today — send this week's item list to Store"
            : 'Weekly item list due Thursday'}
        </p>
        <p className="text-xs opacity-90 mt-0.5">
          Send your list of items needed for the week of {weekLabel} by Thursday — two clear days before
          Store's own Saturday issuance-plan deadline — so Store has time to review quantities against
          shelf stock.
        </p>
      </div>
    </div>
  );
}

/** A day-by-day amount grid — reused for both the editable draft form and the
 * read-only view of an already-sent line. */
function DailyBreakdownGrid({
  value,
  onChange,
  unit,
  readOnly,
}: {
  value: Record<DayKey, number>;
  onChange?: (next: Record<DayKey, number>) => void;
  unit?: string;
  readOnly?: boolean;
}) {
  return (
    <div>
      <div className="grid grid-cols-7 gap-1">
        {DAY_KEYS.map((d) => (
          <div key={d} className="text-center">
            <label className="block text-[10px] font-semibold text-gray-400 mb-0.5">{d}</label>
            {readOnly ? (
              <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 py-1.5">
                {(value[d] || 0).toFixed(1)}
              </div>
            ) : (
              <input
                type="number" step="0.01" min="0" inputMode="decimal"
                value={value[d] || ''}
                onChange={(e) => onChange?.({ ...value, [d]: parseFloat(e.target.value) || 0 })}
                className="w-full border border-gray-200 dark:border-dark-border rounded-lg px-1 py-1.5 text-xs text-center bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-green"
              />
            )}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-gray-400 mt-1 text-right">
        Week total: {breakdownTotal(value).toFixed(2)} {unit ?? ''}
      </p>
    </div>
  );
}

export function RequisitionsPage() {
  const qc = useQueryClient();
  const [weekOption, setWeekOption] = useState<WeekOption>('NEXT');
  const weekStart = weekOption === 'CURRENT' ? thisMondayDate() : nextMondayDate();
  const weekStartStr = weekStart.format('YYYY-MM-DD');

  const { data: storeItems = [] } = useQuery<any[]>({
    queryKey: ['store-items', 'active'],
    queryFn: () => api.get('/store/inventory/items', { params: { isActive: true } }).then(r => r.data),
  });

  const { data: requisitions = [], refetch } = useQuery<any[]>({
    queryKey: ['pm-requisitions', weekStartStr],
    queryFn: () => api.get('/store/pm-requisitions', { params: { weekStartDate: weekStartStr } }).then(r => r.data),
  });

  const { data: history = [] } = useQuery<any[]>({
    queryKey: ['pm-requisitions', 'history'],
    queryFn: () => api.get('/store/pm-requisitions').then(r => r.data),
  });

  // A week can have any number of SUBMITTED lists, plus at most one DRAFT
  // still being assembled — they're shown separately rather than treating
  // "submitted" as a single terminal state that blocks the form.
  const submittedForWeek = requisitions.filter((r: any) => r.status === 'SUBMITTED');
  const currentDraft = requisitions.find((r: any) => r.status === 'DRAFT');

  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);
  const [notes, setNotes] = useState('');
  const [loadedFromId, setLoadedFromId] = useState<string | null>(null);

  // Load the existing DRAFT for the selected week into the form, or reset
  // back to a blank form if the selected week has no draft to load.
  useEffect(() => {
    if (currentDraft) {
      if (loadedFromId !== currentDraft.id) {
        setLoadedFromId(currentDraft.id);
        setNotes(currentDraft.notes ?? '');
        setItems(
          currentDraft.items.length > 0
            ? currentDraft.items.map((it: any) => {
                const bd = it.dailyBreakdown as Record<string, number> | null;
                return {
                  key: it.id,
                  isCustom: !it.storeItemId,
                  storeItemId: it.storeItemId ?? '',
                  customItemName: it.customItemName ?? '',
                  customItemUnit: it.customItemUnit ?? '',
                  quantityNeeded: String(it.quantityNeeded),
                  notes: it.notes ?? '',
                  useDailyBreakdown: !!bd,
                  dailyBreakdown: bd ? { ...emptyBreakdown(), ...bd } : emptyBreakdown(),
                };
              })
            : [emptyItem()],
        );
      }
    } else if (!currentDraft && loadedFromId !== null) {
      setLoadedFromId(null);
      setNotes('');
      setItems([emptyItem()]);
    }
  }, [currentDraft, loadedFromId, weekStartStr]);

  const [showHistory, setShowHistory] = useState(false);

  const itemsById = useMemo(() => new Map(storeItems.map((i: any) => [i.id, i])), [storeItems]);

  const validItems = items.filter(i => {
    const hasTarget = i.isCustom ? i.customItemName.trim().length > 0 : !!i.storeItemId;
    const qty = i.useDailyBreakdown ? breakdownTotal(i.dailyBreakdown) : Number(i.quantityNeeded);
    return hasTarget && qty > 0;
  });

  const saveDraft = useMutation({
    mutationFn: () =>
      api.post('/store/pm-requisitions/draft', {
        weekStartDate: weekStartStr,
        notes: notes || undefined,
        items: validItems.map(i => {
          const qty = i.useDailyBreakdown ? breakdownTotal(i.dailyBreakdown) : Number(i.quantityNeeded);
          const base = {
            quantityNeeded: qty,
            dailyBreakdown: i.useDailyBreakdown ? i.dailyBreakdown : undefined,
            notes: i.notes || undefined,
          };
          return i.isCustom
            ? {
                ...base,
                customItemName: i.customItemName.trim(),
                customItemUnit: i.customItemUnit.trim() || undefined,
              }
            : {
                ...base,
                storeItemId: i.storeItemId,
              };
        }),
      }).then(r => r.data),
    onSuccess: (data) => {
      setLoadedFromId(data.id);
      qc.invalidateQueries({ queryKey: ['pm-requisitions'] });
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      const draft = await saveDraft.mutateAsync();
      return api.patch(`/store/pm-requisitions/${draft.id}/submit`).then(r => r.data);
    },
    onSuccess: () => {
      // A fresh, blank draft is ready right away — nothing stops the PM
      // from keying in and sending another list for the same week.
      setLoadedFromId(null);
      setNotes('');
      setItems([emptyItem()]);
      qc.invalidateQueries({ queryKey: ['pm-requisitions'] });
      refetch();
    },
  });

  const deleteSentItem = useMutation({
    mutationFn: ({ requisitionId, itemId }: { requisitionId: string; itemId: string }) =>
      api.delete(`/store/pm-requisitions/${requisitionId}/items/${itemId}`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pm-requisitions'] });
      refetch();
    },
  });

  // Full removal of an already-SENT ("past") requisition — not just its
  // individual lines. Cascades to pull every line off whichever issuance
  // plan draft(s) they were folded into. See
  // PMRequisitionService.deleteRequisition for the details.
  const deleteRequisition = useMutation({
    mutationFn: (requisitionId: string) =>
      api.delete(`/store/pm-requisitions/${requisitionId}`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pm-requisitions'] });
      qc.invalidateQueries({ queryKey: ['issuance-plans'] });
      refetch();
    },
  });

  const updateItem = (key: string, patch: Partial<DraftItem>) =>
    setItems(prev => prev.map(i => (i.key === key ? { ...i, ...patch } : i)));

  const removeItem = (key: string) =>
    setItems(prev => (prev.length > 1 ? prev.filter(i => i.key !== key) : prev));

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Weekly Item Requisition</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Week of {weekStart.format('D MMM')} – {weekStart.add(6, 'day').format('D MMM YYYY')}
        </p>
      </div>

      <div className="flex bg-gray-100 dark:bg-dark-bg rounded-xl p-1 gap-1">
        {(['CURRENT', 'NEXT'] as WeekOption[]).map(opt => (
          <button
            key={opt}
            onClick={() => setWeekOption(opt)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
              weekOption === opt
                ? 'bg-white dark:bg-dark-card text-brand-green shadow-sm'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            {opt === 'CURRENT' ? 'This Week' : 'Next Week'}
          </button>
        ))}
      </div>

      <DeadlineBanner weekOption={weekOption} submittedCount={submittedForWeek.length} />

      {/* Already-sent lists for this week — each line can be deleted on its
          own; a deletion cascades to whichever issuance plan draft it landed
          on, visible to Store, the Director, and anyone else with plan access. */}
      {submittedForWeek.map((req: any) => (
        <div key={req.id} className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold text-gray-700 dark:text-gray-200">
              Sent — {req.requisitionRef}
            </p>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-400">
                {dayjs(req.submittedAt).format('D MMM, h:mm A')}
              </span>
              <button
                onClick={() => {
                  if (window.confirm(`Remove requisition ${req.requisitionRef} entirely? This also removes its lines from any issuance plan draft they were folded into. This cannot be undone.`)) {
                    deleteRequisition.mutate(req.id);
                  }
                }}
                disabled={deleteRequisition.isPending}
                className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 disabled:opacity-50"
                title="Remove this entire requisition"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {req.items.length === 0 ? (
            <p className="text-xs text-gray-400">All items on this list have been removed.</p>
          ) : (
            <div className="space-y-2">
              {req.items.map((it: any) => {
                const bd = it.dailyBreakdown as Record<string, number> | null;
                return (
                  <div key={it.id} className="border-b border-gray-50 dark:border-dark-border/50 pb-2 last:border-0 last:pb-0">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
                        {it.storeItem?.name ?? it.customItemName}
                        {!it.storeItemId && (
                          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                            Not in store
                          </span>
                        )}
                        {bd && (
                          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 flex items-center gap-0.5">
                            <CalendarDays className="w-2.5 h-2.5" /> By day
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 dark:text-gray-400">
                          {Number(it.quantityNeeded).toFixed(2)} {it.storeItem?.unit ?? it.customItemUnit ?? ''}
                        </span>
                        <button
                          onClick={() => deleteSentItem.mutate({ requisitionId: req.id, itemId: it.id })}
                          disabled={deleteSentItem.isPending}
                          className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 disabled:opacity-50"
                          title="Delete this item — removes it from the issuance plan draft too"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {bd && (
                      <div className="mt-1.5">
                        <DailyBreakdownGrid value={{ ...emptyBreakdown(), ...bd }} unit={it.storeItem?.unit ?? it.customItemUnit} readOnly />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {deleteSentItem.isError && (
            <p className="text-red-500 text-xs mt-2">
              {(deleteSentItem.error as any)?.response?.data?.message ?? 'Could not delete that item.'}
            </p>
          )}
          {req.notes && (
            <p className="text-[11px] text-gray-400 mt-2 italic">"{req.notes}"</p>
          )}
        </div>
      ))}

      {/* The active draft — always available, whether or not lists were
          already sent for this week, so the PM can key in and submit as
          many separate lists as the week needs. */}
      <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-gray-700 dark:text-gray-200">
            {submittedForWeek.length > 0 ? 'Send Another List' : 'Items Needed'}
          </p>
          <button
            onClick={() => setItems(prev => [...prev, emptyItem()])}
            className="flex items-center gap-1 text-xs font-semibold text-brand-green hover:underline"
          >
            <Plus className="w-3.5 h-3.5" /> Add item
          </button>
        </div>

        <div className="space-y-3">
          {items.map((item) => {
            const storeItem = itemsById.get(item.storeItemId);
            const unit = storeItem?.unit ?? item.customItemUnit;
            return (
              <div key={item.key} className="border border-gray-100 dark:border-dark-border rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex bg-gray-100 dark:bg-dark-bg rounded-lg p-0.5 gap-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => updateItem(item.key, { isCustom: false, customItemName: '', customItemUnit: '' })}
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md font-semibold transition-colors ${
                        !item.isCustom ? 'bg-white dark:bg-dark-card text-brand-green shadow-sm' : 'text-gray-500 dark:text-gray-400'
                      }`}
                    >
                      <Package className="w-3 h-3" /> From store
                    </button>
                    <button
                      type="button"
                      onClick={() => updateItem(item.key, { isCustom: true, storeItemId: '' })}
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md font-semibold transition-colors ${
                        item.isCustom ? 'bg-white dark:bg-dark-card text-brand-green shadow-sm' : 'text-gray-500 dark:text-gray-400'
                      }`}
                    >
                      <PackagePlus className="w-3 h-3" /> Not in store
                    </button>
                  </div>
                  <button
                    onClick={() => removeItem(item.key)}
                    className="p-2 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 flex-shrink-0"
                    title="Remove item"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {item.isCustom ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="col-span-2">
                      <label className={lCls}>Item Name</label>
                      <input
                        type="text"
                        value={item.customItemName}
                        onChange={e => updateItem(item.key, { customItemName: e.target.value })}
                        className={iCls}
                        placeholder="e.g. Cordless drill"
                      />
                    </div>
                    {!item.useDailyBreakdown && (
                      <div>
                        <label className={lCls}>Quantity Needed</label>
                        <input
                          type="number" step="0.01" min="0" inputMode="decimal"
                          value={item.quantityNeeded}
                          onChange={e => updateItem(item.key, { quantityNeeded: e.target.value })}
                          className={iCls}
                          placeholder="0"
                        />
                      </div>
                    )}
                    <div>
                      <label className={lCls}>Unit (optional)</label>
                      <input
                        type="text"
                        value={item.customItemUnit}
                        onChange={e => updateItem(item.key, { customItemUnit: e.target.value })}
                        className={iCls}
                        placeholder="e.g. pcs, bags"
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className={lCls}>Item</label>
                    <select
                      value={item.storeItemId}
                      onChange={e => updateItem(item.key, { storeItemId: e.target.value })}
                      className={iCls}
                    >
                      <option value="">— Select item —</option>
                      {storeItems.map((si: any) => (
                        <option key={si.id} value={si.id}>
                          {si.name} ({si.unit})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Straight off the weekly plan: PM can either give one total
                    for the week, or open the day grid and say exactly which
                    day(s) the amount is needed — for both catalog and
                    not-in-store items. */}
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => updateItem(item.key, { useDailyBreakdown: !item.useDailyBreakdown })}
                    className="flex items-center gap-1 text-[11px] font-semibold text-brand-green hover:underline"
                  >
                    <CalendarDays className="w-3 h-3" />
                    {item.useDailyBreakdown ? 'Use a single weekly total instead' : 'Split by day instead'}
                  </button>
                </div>

                {item.useDailyBreakdown ? (
                  <DailyBreakdownGrid
                    value={item.dailyBreakdown}
                    unit={unit}
                    onChange={(next) => updateItem(item.key, { dailyBreakdown: next })}
                  />
                ) : !item.isCustom ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={lCls}>Quantity Needed {storeItem ? `(${storeItem.unit})` : ''}</label>
                      <input
                        type="number" step="0.01" min="0" inputMode="decimal"
                        value={item.quantityNeeded}
                        onChange={e => updateItem(item.key, { quantityNeeded: e.target.value })}
                        className={iCls}
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <label className={lCls}>Note (optional)</label>
                      <input
                        type="text"
                        value={item.notes}
                        onChange={e => updateItem(item.key, { notes: e.target.value })}
                        className={iCls}
                        placeholder="e.g. for the brooder"
                      />
                    </div>
                  </div>
                ) : null}

                {(item.isCustom || item.useDailyBreakdown) && (
                  <div>
                    <label className={lCls}>Note (optional)</label>
                    <input
                      type="text"
                      value={item.notes}
                      onChange={e => updateItem(item.key, { notes: e.target.value })}
                      className={iCls}
                      placeholder={item.isCustom ? 'e.g. why you need it, where to source it' : 'e.g. for the brooder'}
                    />
                  </div>
                )}

                {storeItem && !item.isCustom && (
                  <p className="text-[11px] text-gray-400 flex items-center gap-1">
                    <Package className="w-3 h-3" /> Currently {Number(storeItem.currentStock).toFixed(2)} {storeItem.unit} on the shelf
                  </p>
                )}

                {item.isCustom && (
                  <p className="text-[11px] text-amber-500 flex items-center gap-1">
                    <ListPlus className="w-3 h-3" /> Not in the Store catalog — Store will review this manually rather than folding it into the issuance plan automatically.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div>
          <label className={lCls}>Notes for Store (optional)</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className={iCls}
            rows={2}
            placeholder="Anything Store should know about this list…"
          />
        </div>

        {submit.isError && (
          <p className="text-red-500 text-sm">
            {(submit.error as any)?.response?.data?.message ?? 'Failed to submit. Please try again.'}
          </p>
        )}
        {saveDraft.isError && (
          <p className="text-red-500 text-sm">
            {(saveDraft.error as any)?.response?.data?.message ?? 'Failed to save draft. Please try again.'}
          </p>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => saveDraft.mutate()}
            disabled={saveDraft.isPending || validItems.length === 0}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-dark-bg disabled:opacity-50"
          >
            Save Draft
          </button>
          <button
            onClick={() => submit.mutate()}
            disabled={submit.isPending || validItems.length === 0}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold bg-brand-green text-white hover:bg-brand-mid transition-colors disabled:opacity-50"
          >
            <Send className="w-4 h-4" /> Send to Store
          </button>
        </div>
        {validItems.length === 0 && (
          <p className="text-[11px] text-gray-400 text-center">Add at least one item with a quantity before sending.</p>
        )}
      </div>

      {/* History */}
      <button
        onClick={() => setShowHistory(s => !s)}
        className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-brand-green"
      >
        <History className="w-3.5 h-3.5" /> {showHistory ? 'Hide' : 'Show'} past requisitions
      </button>
      {showHistory && (
        <div className="space-y-2">
          {history.length === 0 && <p className="text-xs text-gray-400">No past requisitions yet.</p>}
          {history.map((r: any) => (
            <div key={r.id} className="bg-white dark:bg-dark-card rounded-xl border border-gray-100 dark:border-dark-border p-3 flex items-center justify-between text-xs">
              <div>
                <p className="font-semibold text-gray-700 dark:text-gray-200">{r.requisitionRef}</p>
                <p className="text-gray-400">
                  Week of {dayjs(r.weekStartDate).format('D MMM YYYY')} · {r.items.length} item{r.items.length !== 1 ? 's' : ''}
                </p>
              </div>
              <span className={`px-2 py-1 rounded-full font-semibold ${
                r.status === 'SUBMITTED'
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
              }`}>
                {r.status === 'SUBMITTED' ? 'Sent' : 'Draft'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
