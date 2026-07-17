// src/pages/manager/RequisitionsPage.tsx
//
// PM's weekly requisition form — "items needed for the coming week" — sent
// to Store so it can be folded into that week's Issuance Plan. PM should
// submit by Thursday, two clear days ahead of Store's own Saturday
// issuance-plan deadline (a banner reminds them of this as the week goes on).
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import dayjs from '../../lib/dayjs';
import {
  Plus, Send, Trash2, AlertTriangle, CheckCircle,
  Clock, Package, History,
} from 'lucide-react';

const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';
const lCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1';

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
  storeItemId: string;
  quantityNeeded: string;
  notes: string;
};

function emptyItem(): DraftItem {
  return { key: Math.random().toString(36).slice(2), storeItemId: '', quantityNeeded: '', notes: '' };
}

// ── Deadline banner ─────────────────────────────────────────────────────────
// For NEXT week: Thursday is the PM's own deadline — two clear days before
// Store's Saturday issuance-plan submission. Tone escalates Tue -> Thu -> after.
// For CURRENT week: there's no fixed deadline — it's an ad-hoc top-up on a
// week already in progress, so the banner explains routing instead: it lands
// in this week's weekly draft if Store hasn't submitted it yet, otherwise
// it becomes (or joins) an emergency plan for this week.
function DeadlineBanner({ weekOption, alreadySubmitted }: { weekOption: WeekOption; alreadySubmitted: boolean }) {
  const week = weekOption === 'CURRENT' ? thisMondayDate() : nextMondayDate();
  const weekLabel = `${week.format('D MMM')} – ${week.add(6, 'day').format('D MMM YYYY')}`;

  if (alreadySubmitted) {
    return (
      <div className="flex items-center gap-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl px-4 py-3 text-sm text-green-700 dark:text-green-400">
        <CheckCircle className="w-4 h-4 flex-shrink-0" />
        Sent to Store for the week of {weekLabel}. Store will fold it into the {weekOption === 'CURRENT' ? "week's" : 'weekly'} issuance plan (or an emergency plan, if this week's was already submitted).
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

  const current = requisitions[0]; // at most one requisition per week
  const isSubmitted = current?.status === 'SUBMITTED';

  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);
  const [notes, setNotes] = useState('');
  const [loadedFromId, setLoadedFromId] = useState<string | null>(null);

  // Load the existing DRAFT for the selected week into the form, or reset
  // back to a blank form if the selected week has no draft to load.
  useEffect(() => {
    if (current && current.status === 'DRAFT') {
      if (loadedFromId !== current.id) {
        setLoadedFromId(current.id);
        setNotes(current.notes ?? '');
        setItems(
          current.items.length > 0
            ? current.items.map((it: any) => ({
                key: it.id,
                storeItemId: it.storeItemId,
                quantityNeeded: String(it.quantityNeeded),
                notes: it.notes ?? '',
              }))
            : [emptyItem()],
        );
      }
    } else if (!current && loadedFromId !== null) {
      setLoadedFromId(null);
      setNotes('');
      setItems([emptyItem()]);
    }
  }, [current, loadedFromId, weekStartStr]);

  const [showHistory, setShowHistory] = useState(false);

  const itemsById = useMemo(() => new Map(storeItems.map((i: any) => [i.id, i])), [storeItems]);

  const validItems = items.filter(i => i.storeItemId && Number(i.quantityNeeded) > 0);

  const saveDraft = useMutation({
    mutationFn: () =>
      api.post('/store/pm-requisitions/draft', {
        weekStartDate: weekStartStr,
        notes: notes || undefined,
        items: validItems.map(i => ({
          storeItemId: i.storeItemId,
          quantityNeeded: Number(i.quantityNeeded),
          notes: i.notes || undefined,
        })),
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
      qc.invalidateQueries({ queryKey: ['pm-requisitions'] });
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

      <DeadlineBanner weekOption={weekOption} alreadySubmitted={isSubmitted} />

      {!isSubmitted && (
        <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-gray-700 dark:text-gray-200">Items Needed</p>
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
              return (
                <div key={item.key} className="border border-gray-100 dark:border-dark-border rounded-xl p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
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
                    <button
                      onClick={() => removeItem(item.key)}
                      className="mt-6 p-2 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 flex-shrink-0"
                      title="Remove item"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

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

                  {storeItem && (
                    <p className="text-[11px] text-gray-400 flex items-center gap-1">
                      <Package className="w-3 h-3" /> Currently {Number(storeItem.currentStock).toFixed(2)} {storeItem.unit} on the shelf
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
              placeholder="Anything Store should know about this week's list…"
            />
          </div>

          {submit.isError && (
            <p className="text-red-500 text-sm">
              {(submit.error as any)?.response?.data?.message ?? 'Failed to submit. Please try again.'}
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
      )}

      {isSubmitted && current.items.length > 0 && (
        <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-4">
          <p className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-3">
            Sent — {current.requisitionRef}
          </p>
          <div className="space-y-2">
            {current.items.map((it: any) => (
              <div key={it.id} className="flex items-center justify-between text-sm border-b border-gray-50 dark:border-dark-border/50 pb-2 last:border-0 last:pb-0">
                <span className="text-gray-700 dark:text-gray-200">{it.storeItem?.name}</span>
                <span className="text-gray-500 dark:text-gray-400">{Number(it.quantityNeeded).toFixed(2)} {it.storeItem?.unit}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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
