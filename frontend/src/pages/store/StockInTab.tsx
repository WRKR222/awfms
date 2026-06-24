import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { Plus, Info, Search, CheckCircle, Pencil } from 'lucide-react';
import dayjs from '../../lib/dayjs';
import { api } from '../../lib/api/client';
import { fmtKES, useStoreItems } from './_shared';

type FormData = {
  storeItemId: string;
  receivedDate: string;
  quantityIn: number;
  unitCostKes: number;
  supplierName?: string;
  invoiceRef?: string;
  notes?: string;
  expiryDate?: string;
};

export function StockInTab() {
  const qc = useQueryClient();
  // fetch ALL active items — staleTime:0 ensures freshness on every tab switch
  const { data: items = [], isLoading: itemsLoading } = useStoreItems(true);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [reviewData, setReviewData] = useState<FormData | null>(null);

  const { register, handleSubmit, reset, control, setValue } = useForm<FormData>({
    defaultValues: { receivedDate: dayjs().format('YYYY-MM-DD') },
  });

  const watchedItemId = useWatch({ control, name: 'storeItemId' });
  const watchedQtyIn  = useWatch({ control, name: 'quantityIn' });
  const selectedItem  = items.find(i => i.id === watchedItemId);

  const { data: list = [], isLoading } = useQuery({
    queryKey: ['store-stock-in'],
    queryFn: async () => (await api.get('/store/inventory/stock-in')).data as any[],
  });

  const create = useMutation({
    mutationFn: (data: FormData) =>
      api.post('/store/inventory/stock-in', {
        ...data,
        quantityIn:  Number(data.quantityIn),
        unitCostKes: Number(data.unitCostKes),
      }),
    onSuccess: () => {
      // Invalidate all store-items cache variants (prefix match covers 'active' and 'all' keys)
      qc.invalidateQueries({ queryKey: ['store-items'] });
      qc.invalidateQueries({ queryKey: ['store-items-low'] });
      qc.invalidateQueries({ queryKey: ['store-stock-in'] });
      reset({ receivedDate: dayjs().format('YYYY-MM-DD') });
      setItemSearch('');
      setReviewData(null);
      setShowForm(false);
    },
  });

  // Projected balance after this stock-in
  const projectedBalance = selectedItem
    ? Number(selectedItem.currentStock) + Number(watchedQtyIn || 0)
    : null;

  // Filter items by search string for the dropdown-replacement list
  const filteredItems = items.filter(i =>
    !itemSearch ||
    `${i.sku} ${i.name}`.toLowerCase().includes(itemSearch.toLowerCase()),
  );

  // Called on form submit — shows review modal instead of sending directly
  const onReview = (data: FormData) => {
    setReviewData(data);
  };

  // Called from review modal confirm button
  const onConfirmSubmit = () => {
    if (reviewData) create.mutate(reviewData);
  };

  // The item for the review modal (may differ from currently watched)
  const reviewItem = reviewData ? items.find(i => i.id === reviewData.storeItemId) : null;

  return (
    <div className="space-y-4">
      <button
        onClick={() => setShowForm(v => !v)}
        className="flex items-center gap-2 bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold"
      >
        <Plus className="w-4 h-4" /> {showForm ? 'Cancel' : 'Record Stock In'}
      </button>

      {showForm && (
        <form
          onSubmit={handleSubmit(onReview)}
          className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border space-y-3"
        >
          <h3 className="font-semibold text-gray-700 dark:text-gray-200 text-sm">Record Stock Receipt</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

            {/* ── Item picker with search ── */}
            <div className="md:col-span-2 space-y-1">
              <label className="text-xs text-gray-500">Item *</label>

              {/* hidden real select — keeps react-hook-form registration */}
              <input type="hidden" {...register('storeItemId', { required: true })} />

              {/* Search box */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  value={itemSearch}
                  onChange={e => setItemSearch(e.target.value)}
                  placeholder={
                    itemsLoading
                      ? 'Loading items…'
                      : `Search among ${items.length} item${items.length !== 1 ? 's' : ''}…`
                  }
                  className="input pl-9"
                />
              </div>

              {/* Scrollable item list */}
              {(itemSearch || !watchedItemId) && (
                <div className="border border-gray-200 dark:border-dark-border rounded-xl overflow-hidden max-h-48 overflow-y-auto bg-white dark:bg-gray-800">
                  {filteredItems.length === 0 ? (
                    <p className="text-xs text-gray-400 px-3 py-2">No items match your search.</p>
                  ) : (
                    filteredItems.map(i => (
                      <button
                        key={i.id}
                        type="button"
                        onClick={() => {
                          setValue('storeItemId', i.id, { shouldValidate: true });
                          // Pre-fill last known unit cost
                          setValue('unitCostKes', Number(i.unitCostKes));
                          setItemSearch('');
                        }}
                        className={`w-full text-left px-3 py-2 text-sm flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 last:border-0 ${
                          watchedItemId === i.id ? 'bg-brand-green/10 font-semibold' : ''
                        }`}
                      >
                        <span>
                          <span className="font-mono text-xs text-gray-500 mr-2">{i.sku}</span>
                          {i.name}
                        </span>
                        <span className="text-xs text-gray-400 ml-2 whitespace-nowrap">
                          {Number(i.currentStock)} {i.unit}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}

              {/* Selected item chip */}
              {watchedItemId && !itemSearch && selectedItem && (
                <div className="flex items-center justify-between bg-brand-green/10 border border-brand-green/30 rounded-xl px-3 py-2 text-sm">
                  <span>
                    <span className="font-mono text-xs text-gray-500 mr-2">{selectedItem.sku}</span>
                    <span className="font-semibold">{selectedItem.name}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setValue('storeItemId', '');
                      setItemSearch('');
                    }}
                    className="text-xs text-gray-400 hover:text-red-500 ml-2"
                  >
                    ✕ Change
                  </button>
                </div>
              )}
            </div>

            {/* b/d balance shown inline when item selected */}
            {selectedItem && (
              <div className="md:col-span-2 flex items-center gap-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl px-3 py-2">
                <Info className="w-4 h-4 text-blue-500 flex-shrink-0" />
                <div className="text-xs text-blue-700 dark:text-blue-300">
                  <span className="font-semibold">Current stock (b/d):</span>{' '}
                  {Number(selectedItem.currentStock)} {selectedItem.unit}
                  {projectedBalance !== null && Number(watchedQtyIn) > 0 && (
                    <span className="ml-2 text-blue-500">
                      → {projectedBalance} {selectedItem.unit} after this receipt
                    </span>
                  )}
                </div>
              </div>
            )}

            <Field label="Received Date *">
              <input type="date" {...register('receivedDate', { required: true })} className="input" />
            </Field>
            <Field label="Quantity *">
              <input
                type="number" step="any" min="0.001"
                {...register('quantityIn', { required: true, min: 0.001 })}
                className="input"
              />
            </Field>
            <Field label="Unit Cost (KES) *">
              <input
                type="number" step="any" min="0"
                {...register('unitCostKes', { required: true })}
                className="input"
              />
            </Field>
            <Field label="Expiry Date (if applicable)">
              <input type="date" {...register('expiryDate')} className="input" />
            </Field>
            <Field label="Supplier Name">
              <input
                {...register('supplierName')} className="input"
                placeholder="Enter supplier name"
              />
            </Field>
            <Field label="Invoice / Delivery Note Reference">
              <input {...register('invoiceRef')} className="input" />
            </Field>
            <div className="md:col-span-2">
              <Field label="Notes">
                <textarea rows={2} {...register('notes')} className="input" />
              </Field>
            </div>
          </div>

          <button
            type="submit"
            disabled={create.isPending}
            className="bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60"
          >
            Review &amp; Confirm
          </button>
          {create.isError && (
            <p className="text-xs text-red-600">
              {(create.error as any)?.response?.data?.message ?? 'Failed to record. Check all fields and try again.'}
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
              <h3 className="font-bold text-sm">Review Stock Receipt</h3>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Please confirm the details below are correct before recording.
            </p>

            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 space-y-2 text-sm">
              <ReviewRow label="Item" value={`${reviewItem.name} (${reviewItem.sku})`} />
              <ReviewRow label="Received Date" value={dayjs(reviewData.receivedDate).format('DD/MM/YYYY')} />
              <ReviewRow label="Quantity In" value={`${Number(reviewData.quantityIn)} ${reviewItem.unit}`} />
              <ReviewRow label="Unit Cost" value={fmtKES(reviewData.unitCostKes)} />
              <ReviewRow label="Total Cost" value={fmtKES(Number(reviewData.quantityIn) * Number(reviewData.unitCostKes))} strong />
              <ReviewRow label="Balance After" value={`${Number(reviewItem.currentStock) + Number(reviewData.quantityIn)} ${reviewItem.unit}`} />
              {reviewData.supplierName && <ReviewRow label="Supplier" value={reviewData.supplierName} />}
              {reviewData.invoiceRef && <ReviewRow label="Invoice Ref" value={reviewData.invoiceRef} />}
              {reviewData.expiryDate && <ReviewRow label="Expiry Date" value={dayjs(reviewData.expiryDate).format('DD/MM/YYYY')} />}
              {reviewData.notes && <ReviewRow label="Notes" value={reviewData.notes} />}
            </div>

            {create.isError && (
              <p className="text-xs text-red-600">
                {(create.error as any)?.response?.data?.message ?? 'Failed to record. Please try again.'}
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={onConfirmSubmit}
                disabled={create.isPending}
                className="bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60"
              >
                {create.isPending ? 'Recording…' : 'Confirm & Record'}
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

      {/* ── History table ── */}
      <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-center text-gray-500 text-sm">Loading…</div>
        ) : list.length === 0 ? (
          <div className="p-6 text-center text-gray-500 text-sm">No stock-in records yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <div className="px-4 pt-3 pb-2">
              <div className="relative max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Filter records…"
                  className="input pl-9 text-xs"
                />
              </div>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Date</th>
                  <th className="text-left px-4 py-2">Item</th>
                  <th className="text-right px-4 py-2">Qty In</th>
                  <th className="text-right px-4 py-2">Unit Cost</th>
                  <th className="text-right px-4 py-2">Total</th>
                  <th className="text-left px-4 py-2">Supplier</th>
                  <th className="text-left px-4 py-2">Invoice Ref</th>
                  <th className="text-left px-4 py-2">Receiving Officer</th>
                </tr>
              </thead>
              <tbody>
                {list
                  .filter((r: any) =>
                    !search ||
                    `${r.storeItem?.name} ${r.storeItem?.sku} ${r.supplierName ?? ''}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((r: any) => (
                    <tr
                      key={r.id}
                      className="border-t border-gray-100 dark:border-dark-border hover:bg-gray-50 dark:hover:bg-gray-800/50"
                    >
                      <td className="px-4 py-2 whitespace-nowrap">{dayjs(r.receivedDate).format('DD/MM/YYYY')}</td>
                      <td className="px-4 py-2 font-medium">
                        {r.storeItem?.name}{' '}
                        <span className="text-gray-400 text-xs">{r.storeItem?.sku}</span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        {Number(r.quantityIn)} {r.storeItem?.unit}
                      </td>
                      <td className="px-4 py-2 text-right">{fmtKES(r.unitCostKes)}</td>
                      <td className="px-4 py-2 text-right font-semibold">{fmtKES(r.totalCostKes)}</td>
                      <td className="px-4 py-2 text-gray-600">{r.supplierName ?? '—'}</td>
                      <td className="px-4 py-2 text-gray-600 font-mono text-xs">{r.invoiceRef ?? '—'}</td>
                      <td className="px-4 py-2 text-gray-600">{r.receivedBy?.fullName ?? '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <style>{`
        .input { width:100%; border-radius:0.75rem; border:1px solid rgb(229 231 235); background:white; font-size:0.875rem; padding:0.5rem 0.75rem; }
        .dark .input { background:rgb(31 41 55); border-color:rgb(55 65 81); color:white; }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-gray-500 mb-1 block">{label}</label>
      {children}
    </div>
  );
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
