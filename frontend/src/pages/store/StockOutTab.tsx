// frontend/src/pages/store/StockOutTab.tsx
// Fixes GAP-04 (add issuedToName field) + GAP-09 (show balance after / c/d)
//
// IMPORTANT — DB migration required for issuedToName persistence:
//   Run store_role_improvements.sql first (adds issued_to_name column).
//   Until migration runs, issuedToName is sent but silently ignored by backend.
//   Update StockOutDto in store-inventory.service.ts to accept issuedToName.
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { Plus, AlertTriangle } from 'lucide-react';
import dayjs from 'dayjs';
import { api } from '../../lib/api/client';
import { fmtKES, useStoreItems, useHouses, useBatches } from './_shared';

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
  storeItemId:     string;
  issuedDate:      string;
  quantityOut:     number;
  recipientRole:   string;
  otherRecipient?: string;
  issuedToHouseId?: string;
  issuedToBatchId?: string;
  purpose?:        string;
  notes?:          string;
};

export function StockOutTab() {
  const qc = useQueryClient();
  const { data: items   = [] } = useStoreItems(true);
  const { data: houses  = [] } = useHouses();
  const { data: batches = [] } = useBatches();
  const [showForm, setShowForm] = useState(false);

  const { register, handleSubmit, reset, control, watch } = useForm<FormData>({
    defaultValues: { issuedDate: dayjs().format('YYYY-MM-DD') },
  });

  const watchedItemId  = useWatch({ control, name: 'storeItemId' });
  const watchedQtyOut  = useWatch({ control, name: 'quantityOut' });
  const watchedHouseId = useWatch({ control, name: 'issuedToHouseId' });
  const selectedItem   = items.find(i => i.id === watchedItemId);
  const filteredBatches = watchedHouseId
    ? batches.filter(b => b.houseId === watchedHouseId)
    : batches;

  // Balance after issuance (c/d preview)
  const balanceAfter = selectedItem
    ? Math.max(0, Number(selectedItem.currentStock) - Number(watchedQtyOut || 0))
    : null;
  const willGoLow = selectedItem && balanceAfter !== null
    ? balanceAfter <= Number(selectedItem.reorderLevel)
    : false;

  const { data: list = [], isLoading } = useQuery({
    queryKey: ['store-stock-out'],
    queryFn: async () => (await api.get('/store/inventory/stock-out')).data as any[],
  });

  const create = useMutation({
    mutationFn: (data: FormData) => api.post('/store/inventory/stock-out', {
      ...data,
      quantityOut:     Number(data.quantityOut),
      issuedToHouseId: data.issuedToHouseId  || undefined,
      issuedToBatchId: data.issuedToBatchId  || undefined,
      recipientRole:   data.recipientRole    || undefined,
      otherRecipient:  data.otherRecipient  || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['store-stock-out'] });
      qc.invalidateQueries({ queryKey: ['store-items'] });
      qc.invalidateQueries({ queryKey: ['store-items-low'] });
      reset({ issuedDate: dayjs().format('YYYY-MM-DD') });
      setShowForm(false);
    },
  });

  return (
    <div className="space-y-4">
      <button onClick={() => setShowForm(v => !v)}
        className="flex items-center gap-2 bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold">
        <Plus className="w-4 h-4" /> {showForm ? 'Cancel' : 'Issue Stock Out'}
      </button>

      {showForm && (
        <form onSubmit={handleSubmit(d => create.mutate(d))}
          className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border space-y-3">

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Item *">
              <select {...register('storeItemId', { required: true })} className="input">
                <option value="">Select item…</option>
                {items.map(i => (
                  <option key={i.id} value={i.id}>
                    {i.sku} — {i.name} (stock: {Number(i.currentStock)} {i.unit})
                  </option>
                ))}
              </select>
            </Field>

            {/* c/d preview panel — shows balance after issuance */}
            {selectedItem && (
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
                      Consider raising a Purchase Request after issuing.
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
            <Field label="Purpose">
              <input
                {...register('purpose')}
                className="input"
                placeholder="Name of person receiving stock"
              />
            </Field>

            <Field label="Department / Project">
              <input {...register('purpose')} placeholder="e.g. Production House, Block 2 Construction" className="input" />
            </Field>
            <Field label="Recipient (House)">
              <select {...register('issuedToHouseId')} className="input">
                <option value="">— None —</option>
                {houses.map(h => <option key={h.id} value={h.id}>{h.name} ({h.code})</option>)}
              </select>
            </Field>
            <Field label="Recipient (Batch)">
              <select {...register('issuedToBatchId')} className="input">
                <option value="">— None —</option>
                {filteredBatches.map(b => <option key={b.id} value={b.id}>{b.batchCode}</option>)}
              </select>
            </Field>
            <div className="md:col-span-2">
              <Field label="Notes">
                <textarea rows={2} {...register('notes')} className="input" />
              </Field>
            </div>
          </div>

          <button type="submit" disabled={create.isPending}
            className="bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60">
            Issue Stock Out
          </button>
          {create.isError && <p className="text-xs text-red-600">Failed to issue. Check stock levels and required fields.</p>}
        </form>
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
                  <th className="text-left px-4 py-2">Dept / Project</th>
                  <th className="text-left px-4 py-2">Issuing Officer</th>
                </tr>
              </thead>
              <tbody>
                {list.map(r => (
                  <tr key={r.id} className="border-t border-gray-100 dark:border-dark-border hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-4 py-2 whitespace-nowrap">{dayjs(r.issuedDate).format('DD/MM/YYYY')}</td>
                    <td className="px-4 py-2 font-medium">
                      {r.storeItem?.name} <span className="text-gray-400 text-xs">{r.storeItem?.sku}</span>
                    </td>
                    <td className="px-4 py-2 text-right">{Number(r.quantityOut)} {r.storeItem?.unit}</td>
                    <td className="px-4 py-2 text-right">{fmtKES(r.totalCostKes)}</td>
                    <td className="px-4 py-2 text-gray-600">{r.issuedToName ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-600">{r.purpose ?? '—'}</td>
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
