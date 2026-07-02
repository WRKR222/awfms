// frontend/src/pages/store/StockOutTab.tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { Plus, AlertTriangle, ShieldX, CheckCircle, Pencil } from 'lucide-react';
import dayjs from '../../lib/dayjs';
import { api } from '../../lib/api/client';
import { fmtKES, useStoreItems, useBatches } from './_shared';

const RECIPIENT_ROLES = [
  { value: 'MANAGER',    label: 'Production Manager' },
  { value: 'ATTENDANT',  label: 'Lead Attendant' },
  { value: 'SALES',      label: 'Sales' },
  { value: 'ACCOUNTANT', label: 'Accountant' },
  { value: 'SECURITY1',  label: 'Security (Main Gate)' },
  { value: 'SECURITY2',  label: 'Security (Farm Gate)' },
  { value: 'OTHER',      label: 'Other (specify)' },
];

type FormData = {
  storeItemId:      string;
  issuedDate:       string;
  quantityOut:      number;
  recipientRole:    string;
  otherRecipient?:  string;
  issuedToBatchId?: string;
  purpose?:         string;
  notes?:           string;
};

const DAY_KEYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

type EligibilityInfo = {
  eligible: boolean;
  remaining: number;      // how much can still be issued today under this authorisation
  source: 'WEEKLY' | 'EMERGENCY' | null;
  reason?: string;        // human-readable explanation when NOT eligible
};

/**
 * Mirrors the backend's `IssuancePlanService.validateStockOut` gate as closely
 * as possible so the UI doesn't show a false "approved" green light for items
 * that were approved on a DIFFERENT week's plan (or a different day's
 * emergency plan) than the one the user is actually issuing against.
 *
 * The backend remains the source of truth — this is a best-effort preview so
 * users aren't misled by stale/irrelevant approvals. Any discrepancy is still
 * caught (and now clearly reported, see `create.error` below) on submit.
 */
function useIssuanceEligibility(issuedDate: string, stockOutHistory: any[]) {
  return useQuery({
    queryKey: ['approved-plan-items', issuedDate],
    enabled: !!issuedDate,
    queryFn: async () => {
      const res = await api.get('/store/issuance-plans');
      const allPlans: any[] = res.data ?? [];

      const today = dayjs(issuedDate).startOf('day');
      const dayKey = DAY_KEYS[today.isoWeekday() - 1];

      const byItem = new Map<string, EligibilityInfo>();

      const consider = (info: EligibilityInfo, storeItemId: string) => {
        const existing = byItem.get(storeItemId);
        // Prefer whichever authorisation actually leaves remaining quantity
        if (!existing || (!existing.eligible && info.eligible) || (existing.eligible && info.eligible && info.remaining > existing.remaining)) {
          byItem.set(storeItemId, info);
        }
      };

      allPlans.forEach((plan: any) => {
        const planStart = dayjs(plan.weekStartDate).startOf('day');
        const planEnd = dayjs(plan.weekEndDate).endOf('day');
        const coversToday = !today.isBefore(planStart) && !today.isAfter(planEnd);
        if (!coversToday) return;

        (plan.items ?? []).forEach((item: any) => {
          if (item.status !== 'APPROVED') return;

          if (plan.type === 'WEEKLY') {
            const breakdown = (item.dailyBreakdown as Record<string, number> | null) ?? null;
            const dailyAllowed = breakdown ? Number(breakdown[dayKey] ?? 0) : 0;
            const alreadyToday = stockOutHistory
              .filter((so: any) => so.issuancePlanItemId === item.id
                && dayjs(so.issuedDate).isSame(today, 'day'))
              .reduce((sum: number, so: any) => sum + Number(so.quantityOut ?? 0), 0);
            const remaining = Math.max(0, dailyAllowed - alreadyToday);

            consider({
              eligible: remaining > 0,
              remaining,
              source: 'WEEKLY',
              reason: remaining > 0 ? undefined
                : `Today's (${dayKey}) approved allowance is ${dailyAllowed}, already issued ${alreadyToday}.`,
            }, item.storeItemId);
          }

          if (plan.type === 'EMERGENCY') {
            const remaining = Math.max(0, Number(item.quantityPlanned ?? 0) - Number(item.quantityIssued ?? 0));
            consider({
              eligible: remaining > 0,
              remaining,
              source: 'EMERGENCY',
              reason: remaining > 0 ? undefined : 'Approved emergency quantity has already been fully issued.',
            }, item.storeItemId);
          }
        });
      });

      return byItem;
    },
    staleTime: 15_000,
  });
}

export function StockOutTab() {
  const qc = useQueryClient();
  const { data: items   = [] } = useStoreItems(true);
  const { data: batches = [] } = useBatches();
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [reviewData, setReviewData] = useState<FormData | null>(null);

  const { register, handleSubmit, reset, control, watch } = useForm<FormData>({
    defaultValues: { issuedDate: dayjs().format('YYYY-MM-DD') },
  });

  const watchedItemId    = useWatch({ control, name: 'storeItemId' });
  const watchedQtyOut    = useWatch({ control, name: 'quantityOut' });
  const watchedIssuedDate = useWatch({ control, name: 'issuedDate' }) || dayjs().format('YYYY-MM-DD');
  const selectedItem     = items.find(i => i.id === watchedItemId);

  const { data: list = [], isLoading } = useQuery({
    queryKey: ['store-stock-out'],
    queryFn: async () => (await api.get('/store/inventory/stock-out')).data as any[],
  });

  // Date-aware eligibility check — mirrors the backend gate for the
  // currently selected issued date, instead of "approved on any plan ever".
  const { data: eligibilityMap } = useIssuanceEligibility(watchedIssuedDate, list);
  const eligibility = watchedItemId ? eligibilityMap?.get(watchedItemId) : undefined;
  const isItemApproved = !watchedItemId
    ? null
    : eligibilityMap
    ? (eligibility?.eligible ?? false)
    : null; // null = still loading

  // Balance after issuance (c/d preview)
  const balanceAfter = selectedItem
    ? Math.max(0, Number(selectedItem.currentStock) - Number(watchedQtyOut || 0))
    : null;
  const willGoLow = selectedItem && balanceAfter !== null
    ? balanceAfter <= Number(selectedItem.reorderLevel)
    : false;

  const create = useMutation({
    mutationFn: (data: FormData) => api.post('/store/inventory/stock-out', {
      ...data,
      quantityOut:     Number(data.quantityOut),
      issuedToBatchId: data.issuedToBatchId || undefined,
      recipientRole:   data.recipientRole   || undefined,
      otherRecipient:  data.otherRecipient  || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['store-stock-out'] });
      // Prefix invalidation: covers ['store-items','active'] AND ['store-items','all']
      qc.invalidateQueries({ queryKey: ['store-items'] });
      qc.invalidateQueries({ queryKey: ['store-items-low'] });
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['approved-plan-items'] });
      // Powers the Lead Attendant's feed/vaccine/supplement/treatment dropdowns
      // (useIssuableStoreItems) — without this, a freshly stocked-out item
      // won't appear there until its 15s staleTime lapses and something
      // triggers a refetch.
      qc.invalidateQueries({ queryKey: ['store-issuable-items'] });
      reset({ issuedDate: dayjs().format('YYYY-MM-DD') });
      setReviewData(null);
      setShowForm(false);
    },
  });

  // Called on form submit — shows review modal instead of sending directly
  const onReview = (data: FormData) => {
    setReviewData(data);
  };

  // Called from review modal confirm button
  const onConfirmSubmit = () => {
    if (reviewData) create.mutate(reviewData);
  };

  // Helpers for the review modal
  const reviewItem   = reviewData ? items.find(i => i.id === reviewData.storeItemId) : null;
  const reviewBatch  = reviewData?.issuedToBatchId ? batches.find(b => b.id === reviewData.issuedToBatchId) : null;
  const reviewRole   = reviewData ? RECIPIENT_ROLES.find(r => r.value === reviewData.recipientRole)?.label ?? reviewData.recipientRole : null;

  return (
    <div className="space-y-4">
      <button onClick={() => setShowForm(v => !v)}
        className="flex items-center gap-2 bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold">
        <Plus className="w-4 h-4" /> {showForm ? 'Cancel' : 'Issue Stock Out'}
      </button>

      {showForm && (
        <form onSubmit={handleSubmit(onReview)}
          className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border space-y-3">

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Item *">
              <select {...register('storeItemId', { required: true })} className="input">
                <option value="">Select item…</option>
                {items.map(i => (
                  <option key={i.id} value={i.id}>
                    [{i.category === 'FEED_SUPPLEMENT' ? 'FEED/SUPP' : i.category}] {i.sku} — {i.name} (stock: {Number(i.currentStock)} {i.unit})
                  </option>
                ))}
              </select>
            </Field>

            {/* Approval gate warning */}
            {watchedItemId && isItemApproved === false && (
              <div className="flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-xl px-3 py-2 text-xs md:col-span-1">
                <ShieldX className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-red-700 dark:text-red-400">Item not approved for {dayjs(watchedIssuedDate).format('DD/MM/YYYY')}</p>
                  <p className="text-red-600 dark:text-red-400 mt-0.5">
                    {eligibility?.reason ??
                      'This item has no approved weekly or emergency issuance plan covering this date. Stock cannot be issued until it is approved.'}
                  </p>
                </div>
              </div>
            )}

            {/* c/d preview panel — shows balance after issuance */}
            {selectedItem && isItemApproved !== false && (
              <div className={`flex items-start gap-2 border rounded-xl px-3 py-2 text-xs ${
                willGoLow
                  ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700'
                  : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700'
              }`}>
                <AlertTriangle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${willGoLow ? 'text-amber-500' : 'text-blue-400'}`} />
                <div>
                  <p className={`font-semibold ${willGoLow ? 'text-amber-700 dark:text-amber-300' : 'text-blue-700 dark:text-blue-300'}`}>
                    Current: {Number(selectedItem.currentStock)} {selectedItem.unit}
                    {balanceAfter !== null && Number(watchedQtyOut) > 0 && (
                      <> → Balance c/d: <strong>{balanceAfter} {selectedItem.unit}</strong></>
                    )}
                  </p>
                  {willGoLow && (
                    <p className="text-amber-600 dark:text-amber-400 mt-0.5">
                      ⚠ This will bring stock below reorder level ({Number(selectedItem.reorderLevel)} {selectedItem.unit}).
                    </p>
                  )}
                </div>
              </div>
            )}

            <Field label="Issued Date *">
              <input type="date" {...register('issuedDate', { required: true })} className="input" />
            </Field>
            <Field label="Quantity *">
              <input type="number" step="any" min="0.001" {...register('quantityOut', { required: true })} className="input" />
            </Field>

            {/* Recipient Role */}
            <Field label="Issued To (Role) *">
              <select {...register('recipientRole', { required: true })} className="input">
                <option value="">Select recipient…</option>
                {RECIPIENT_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </Field>
            {watch('recipientRole') === 'OTHER' && (
              <Field label="Department / Project *">
                <input {...register('otherRecipient', { required: watch('recipientRole') === 'OTHER' })}
                  className="input" placeholder="e.g. Construction crew, Visitor catering" />
              </Field>
            )}

            <Field label="Purpose / Person Receiving">
              <input
                {...register('purpose')}
                className="input"
                placeholder="Name of person or purpose"
              />
            </Field>

            <Field label="Recipient (Batch)">
              <select {...register('issuedToBatchId')} className="input">
                <option value="">— None —</option>
                {batches.length === 0
                  ? <option disabled>No batches found in system</option>
                  : batches.map(b => <option key={b.id} value={b.id}>{b.batchCode}</option>)
                }
              </select>
            </Field>

            <div className="md:col-span-2">
              <Field label="Notes">
                <textarea rows={2} {...register('notes')} className="input" />
              </Field>
            </div>
          </div>

          <button
            type="submit"
            disabled={create.isPending || isItemApproved === false}
            title={isItemApproved === false ? 'Item must be approved on an issuance plan before stock can be issued' : ''}
            className="bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Review &amp; Confirm
          </button>
          {create.isError && (
            <p className="text-xs text-red-600">
              {(create.error as any)?.response?.data?.message ?? 'Failed to issue. Check stock levels and required fields.'}
            </p>
          )}
        </form>
      )}

      {/* ── Review / Confirm Modal ── */}
      {reviewData && reviewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white dark:bg-dark-card rounded-2xl p-5 max-w-md w-full shadow-xl space-y-4">
            <div className="flex items-center gap-2 text-brand-green">
              <CheckCircle className="w-5 h-5" />
              <h3 className="font-bold text-sm">Review Stock Issuance</h3>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Please confirm the details below are correct before issuing.
            </p>

            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 space-y-2 text-sm">
              <ReviewRow label="Item" value={`${reviewItem.name} (${reviewItem.sku})`} />
              <ReviewRow label="Issued Date" value={dayjs(reviewData.issuedDate).format('DD/MM/YYYY')} />
              <ReviewRow label="Quantity Out" value={`${Number(reviewData.quantityOut)} ${reviewItem.unit}`} />
              <ReviewRow label="Total Cost" value={fmtKES(Number(reviewData.quantityOut) * Number(reviewItem.unitCostKes))} strong />
              <ReviewRow label="Balance After" value={`${Math.max(0, Number(reviewItem.currentStock) - Number(reviewData.quantityOut))} ${reviewItem.unit}`} />
              {reviewRole && <ReviewRow label="Issued To (Role)" value={reviewRole} />}
              {reviewData.otherRecipient && <ReviewRow label="Dept / Project" value={reviewData.otherRecipient} />}
              {reviewData.purpose && <ReviewRow label="Purpose / Person" value={reviewData.purpose} />}
              {reviewBatch && <ReviewRow label="Batch" value={reviewBatch.batchCode} />}
              {reviewData.notes && <ReviewRow label="Notes" value={reviewData.notes} />}
            </div>

            {create.isError && (
              <p className="text-xs text-red-600">
                {(create.error as any)?.response?.data?.message ?? 'Failed to issue. Check stock levels and required fields.'}
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={onConfirmSubmit}
                disabled={create.isPending}
                className="bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60"
              >
                {create.isPending ? 'Issuing…' : 'Confirm & Issue'}
              </button>
              <button
                onClick={() => { setReviewData(null); create.reset(); }}
                disabled={create.isPending}
                className="flex items-center gap-1 px-4 py-2 rounded-xl text-sm font-semibold border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-300 disabled:opacity-50"
              >
                <Pencil className="w-3 h-3" /> Edit
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border overflow-hidden">
        {isLoading ? <div className="p-6 text-center text-gray-500 text-sm">Loading…</div>
        : list.length === 0 ? <div className="p-6 text-center text-gray-500 text-sm">No stock-out records yet.</div>
        : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Date</th>
                  <th className="text-left px-4 py-2">Item</th>
                  <th className="text-right px-4 py-2">Qty Out</th>
                  <th className="text-right px-4 py-2">Total Cost</th>
                  <th className="text-left px-4 py-2">Issued To</th>
                  <th className="text-left px-4 py-2">Batch</th>
                  <th className="text-left px-4 py-2">Issuing Officer</th>
                </tr>
              </thead>
              <tbody>
                {list.filter((r: any) => !search || (r.storeItem?.name + ' ' + r.storeItem?.sku + ' ' + (r.purpose ?? '')).toLowerCase().includes(search.toLowerCase())).map((r: any) => (
                  <tr key={r.id} className="border-t border-gray-100 dark:border-dark-border hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-4 py-2 whitespace-nowrap">{dayjs(r.issuedDate).format('DD/MM/YYYY')}</td>
                    <td className="px-4 py-2 font-medium">
                      {r.storeItem?.name} <span className="text-gray-400 text-xs">{r.storeItem?.sku}</span>
                    </td>
                    <td className="px-4 py-2 text-right">{Number(r.quantityOut)} {r.storeItem?.unit}</td>
                    <td className="px-4 py-2 text-right">{fmtKES(r.totalCostKes)}</td>
                    <td className="px-4 py-2 text-gray-600">{r.purpose ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-600">{r.batch?.batchCode ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-600">{r.issuedBy?.fullName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <style>{`.input{width:100%;border-radius:.75rem;border:1px solid rgb(229 231 235);background:white;font-size:.875rem;padding:.5rem .75rem}.dark .input{background:rgb(31 41 55);border-color:rgb(55 65 81);color:white}`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-xs text-gray-500 mb-1 block">{label}</label>{children}</div>;
}

function ReviewRow({ label, value, strong }: { label: string; value: string | number; strong?: boolean }) {
  return (
    <div className="flex justify-between items-start gap-4 py-0.5">
      <span className="text-xs text-gray-500 flex-shrink-0">{label}</span>
      <span className={`text-xs text-right ${strong ? 'font-bold text-gray-800 dark:text-gray-100' : 'text-gray-700 dark:text-gray-200'}`}>
        {String(value)}
      </span>
    </div>
  );
}
