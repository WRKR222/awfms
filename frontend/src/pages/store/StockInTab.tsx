// src/pages/store/inventory/StockInTab.tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Plus } from 'lucide-react';
import dayjs from 'dayjs';
import { api } from '../../lib/api/client';
import { fmtKES, useStoreItems } from './_shared';

type FormData = {
  storeItemId: string;
  receivedDate: string;
  quantityIn: number;
  unitCostKes: number;
  supplierName?: string;
  invoiceRef?: string;
  lpoId?: string;
  notes?: string;
};

export function StockInTab() {
  const qc = useQueryClient();
  const { data: items = [] } = useStoreItems(true);
  const [showForm, setShowForm] = useState(false);
  const { register, handleSubmit, reset } = useForm<FormData>({
    defaultValues: { receivedDate: dayjs().format('YYYY-MM-DD') },
  });

  const { data: list = [], isLoading } = useQuery({
    queryKey: ['store-stock-in'],
    queryFn: async () => (await api.get('/store/inventory/stock-in')).data as any[],
  });

  const create = useMutation({
    mutationFn: (data: FormData) => api.post('/store/inventory/stock-in', {
      ...data,
      quantityIn: Number(data.quantityIn),
      unitCostKes: Number(data.unitCostKes),
      lpoId: data.lpoId || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['store-stock-in'] });
      qc.invalidateQueries({ queryKey: ['store-items'] });
      reset({ receivedDate: dayjs().format('YYYY-MM-DD') });
      setShowForm(false);
    },
  });

  return (
    <div className="space-y-4">
      <button onClick={() => setShowForm(v => !v)}
        className="flex items-center gap-2 bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold">
        <Plus className="w-4 h-4" /> {showForm ? 'Cancel' : 'Record Stock In'}
      </button>

      {showForm && (
        <form onSubmit={handleSubmit(d => create.mutate(d))}
          className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Item *">
              <select {...register('storeItemId', { required: true })} className="input">
                <option value="">Select item…</option>
                {items.map(i => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}
              </select>
            </Field>
            <Field label="Received Date *">
              <input type="date" {...register('receivedDate', { required: true })} className="input" />
            </Field>
            <Field label="Quantity *">
              <input type="number" step="any" {...register('quantityIn', { required: true })} className="input" />
            </Field>
            <Field label="Unit Cost (KES) *">
              <input type="number" step="any" {...register('unitCostKes', { required: true })} className="input" />
            </Field>
            <Field label="Supplier Name">
              <input {...register('supplierName')} className="input" />
            </Field>
            <Field label="Invoice Reference">
              <input {...register('invoiceRef')} className="input" />
            </Field>
            <div className="md:col-span-2">
              <Field label="Notes">
                <textarea rows={2} {...register('notes')} className="input" />
              </Field>
            </div>
          </div>
          <button type="submit" disabled={create.isPending}
            className="bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60">
            Record Stock In
          </button>
          {create.isError && <p className="text-xs text-red-600">Failed to record stock in.</p>}
        </form>
      )}

      <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border overflow-hidden">
        {isLoading ? <div className="p-6 text-center text-gray-500 text-sm">Loading…</div>
        : list.length === 0 ? <div className="p-6 text-center text-gray-500 text-sm">No stock-in records yet.</div>
        : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Date</th>
                  <th className="text-left px-4 py-2">Item</th>
                  <th className="text-right px-4 py-2">Qty</th>
                  <th className="text-right px-4 py-2">Unit Cost</th>
                  <th className="text-right px-4 py-2">Total</th>
                  <th className="text-left px-4 py-2">Supplier</th>
                  <th className="text-left px-4 py-2">Invoice</th>
                  <th className="text-left px-4 py-2">Receiving Officer</th>
                </tr>
              </thead>
              <tbody>
                {list.map(r => (
                  <tr key={r.id} className="border-t border-gray-100 dark:border-dark-border">
                    <td className="px-4 py-2">{dayjs(r.receivedDate).format('YYYY-MM-DD')}</td>
                    <td className="px-4 py-2 font-medium">{r.storeItem?.name} <span className="text-gray-400 text-xs">{r.storeItem?.sku}</span></td>
                    <td className="px-4 py-2 text-right">{Number(r.quantityIn)} {r.storeItem?.unit}</td>
                    <td className="px-4 py-2 text-right">{fmtKES(r.unitCostKes)}</td>
                    <td className="px-4 py-2 text-right font-semibold">{fmtKES(r.totalCostKes)}</td>
                    <td className="px-4 py-2 text-gray-600">{r.supplierName ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-600">{r.invoiceRef ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-600">{r.receivedBy?.fullName ?? '—'}</td>
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
