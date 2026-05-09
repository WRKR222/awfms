// src/pages/store/inventory/PurchaseRequestsTab.tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { Plus, Trash2, Send, Eye, X } from 'lucide-react';
import dayjs from 'dayjs';
import { api } from '../../lib/api/client';
import { fmtKES, useStoreItems, STATUS_BADGE, URGENCY_BADGE, type PurchaseRequest } from './_shared';

type FormData = {
  requestDate: string;
  urgency: 'LOW' | 'NORMAL' | 'URGENT';
  notes?: string;
  items: Array<{ storeItemId: string; quantityRequested: number; estimatedUnitCost?: number; reason?: string }>;
};

export function PurchaseRequestsTab() {
  const qc = useQueryClient();
  const { data: items = [] } = useStoreItems(true);
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [viewing, setViewing] = useState<PurchaseRequest | null>(null);

  const { register, control, handleSubmit, reset } = useForm<FormData>({
    defaultValues: {
      requestDate: dayjs().format('YYYY-MM-DD'),
      urgency: 'NORMAL',
      items: [{ storeItemId: '', quantityRequested: 1 }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'items' });

  const { data: list = [], isLoading } = useQuery({
    queryKey: ['purchase-requests', statusFilter],
    queryFn: async () => (await api.get('/store/inventory/purchase-requests', { params: statusFilter ? { status: statusFilter } : {} })).data as PurchaseRequest[],
  });

  const createMut = useMutation({
    mutationFn: (data: FormData) => api.post('/store/inventory/purchase-requests', {
      ...data,
      items: data.items.map(i => ({
        storeItemId: i.storeItemId,
        quantityRequested: Number(i.quantityRequested),
        estimatedUnitCost: i.estimatedUnitCost ? Number(i.estimatedUnitCost) : undefined,
        reason: i.reason || undefined,
      })),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-requests'] });
      reset({ requestDate: dayjs().format('YYYY-MM-DD'), urgency: 'NORMAL', items: [{ storeItemId: '', quantityRequested: 1 }] });
      setShowForm(false);
    },
  });

  const submitMut = useMutation({
    mutationFn: (id: string) => api.patch(`/store/inventory/purchase-requests/${id}/submit`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['purchase-requests'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold">
          <Plus className="w-4 h-4" /> {showForm ? 'Cancel' : 'New Purchase Request'}
        </button>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="rounded-xl text-sm border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 px-3 py-2">
          <option value="">All statuses</option>
          {['DRAFT','SUBMITTED','REVIEWED','REJECTED','LPO_RAISED'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit(d => createMut.mutate(d))}
          className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Request Date *">
              <input type="date" {...register('requestDate', { required: true })} className="input" />
            </Field>
            <Field label="Urgency">
              <select {...register('urgency')} className="input">
                <option value="LOW">Low</option>
                <option value="NORMAL">Normal</option>
                <option value="URGENT">Urgent</option>
              </select>
            </Field>
            <Field label="Notes">
              <input {...register('notes')} className="input" />
            </Field>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Items</h4>
              <button type="button" onClick={() => append({ storeItemId: '', quantityRequested: 1 })}
                className="text-xs flex items-center gap-1 text-brand-green hover:underline">
                <Plus className="w-3 h-3" /> Add line
              </button>
            </div>
            <div className="space-y-2">
              {fields.map((f, idx) => (
                <div key={f.id} className="grid grid-cols-12 gap-2 items-start">
                  <div className="col-span-12 md:col-span-5">
                    <select {...register(`items.${idx}.storeItemId` as const, { required: true })} className="input">
                      <option value="">Select item…</option>
                      {items.map(i => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}
                    </select>
                  </div>
                  <div className="col-span-4 md:col-span-2">
                    <input type="number" step="any" placeholder="Qty"
                      {...register(`items.${idx}.quantityRequested` as const, { required: true })} className="input" />
                  </div>
                  <div className="col-span-4 md:col-span-2">
                    <input type="number" step="any" placeholder="Est. Unit"
                      {...register(`items.${idx}.estimatedUnitCost` as const)} className="input" />
                  </div>
                  <div className="col-span-3 md:col-span-2">
                    <input placeholder="Reason" {...register(`items.${idx}.reason` as const)} className="input" />
                  </div>
                  <div className="col-span-1 flex items-center justify-center pt-2">
                    {fields.length > 1 && (
                      <button type="button" onClick={() => remove(idx)} className="text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button type="submit" disabled={createMut.isPending}
            className="bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60">
            Save as Draft
          </button>
          {createMut.isError && <p className="text-xs text-red-600">Failed to create.</p>}
        </form>
      )}

      <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border overflow-hidden">
        {isLoading ? <div className="p-6 text-center text-gray-500 text-sm">Loading…</div>
        : list.length === 0 ? <div className="p-6 text-center text-gray-500 text-sm">No purchase requests.</div>
        : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Ref</th>
                  <th className="text-left px-4 py-2">Date</th>
                  <th className="text-left px-4 py-2">Created By</th>
                  <th className="text-center px-4 py-2">Items</th>
                  <th className="text-center px-4 py-2">Urgency</th>
                  <th className="text-center px-4 py-2">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {list.map(pr => (
                  <tr key={pr.id} className="border-t border-gray-100 dark:border-dark-border">
                    <td className="px-4 py-2 font-mono text-xs">{pr.requestRef}</td>
                    <td className="px-4 py-2">{dayjs(pr.requestDate).format('YYYY-MM-DD')}</td>
                    <td className="px-4 py-2">{pr.createdBy?.fullName ?? '—'}</td>
                    <td className="px-4 py-2 text-center">{pr.items.length}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${URGENCY_BADGE[pr.urgency]}`}>{pr.urgency}</span>
                    </td>
                    <td className="px-4 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[pr.status] ?? ''}`}>{pr.status}</span>
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button onClick={() => setViewing(pr)} className="text-brand-green hover:underline text-xs inline-flex items-center gap-1 mr-3">
                        <Eye className="w-3 h-3" /> View
                      </button>
                      {pr.status === 'DRAFT' && (
                        <button disabled={submitMut.isPending}
                          onClick={() => submitMut.mutate(pr.id)}
                          className="text-blue-600 hover:underline text-xs inline-flex items-center gap-1">
                          <Send className="w-3 h-3" /> Submit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {viewing && <PRDetail pr={viewing} onClose={() => setViewing(null)} />}

      <style>{`.input{width:100%;border-radius:.75rem;border:1px solid rgb(229 231 235);background:white;font-size:.875rem;padding:.5rem .75rem}.dark .input{background:rgb(31 41 55);border-color:rgb(55 65 81);color:white}`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-xs text-gray-500 mb-1 block">{label}</label>{children}</div>;
}

function PRDetail({ pr, onClose }: { pr: PurchaseRequest; onClose: () => void }) {
  const total = pr.items.reduce((s, i) => s + Number(i.quantityRequested) * Number(i.estimatedUnitCost ?? 0), 0);
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-dark-card rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-dark-border">
          <div>
            <h3 className="font-bold text-gray-800 dark:text-gray-100">{pr.requestRef}</h3>
            <p className="text-xs text-gray-500">{dayjs(pr.requestDate).format('YYYY-MM-DD')} — {pr.urgency}</p>
          </div>
          <button onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Status:</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[pr.status] ?? ''}`}>{pr.status}</span>
          </div>
          {pr.notes && <div><span className="text-gray-500">Notes:</span> {pr.notes}</div>}
          {pr.reviewNotes && <div><span className="text-gray-500">Review notes:</span> {pr.reviewNotes}</div>}
          {pr.lpo && <div><span className="text-gray-500">LPO:</span> <span className="font-mono">{pr.lpo.lpoNumber}</span> ({pr.lpo.status})</div>}

          <div>
            <h4 className="font-semibold mb-2">Items</h4>
            <table className="w-full text-xs">
              <thead className="text-gray-500">
                <tr><th className="text-left">Item</th><th className="text-right">Qty</th><th className="text-right">Est. Unit</th><th className="text-right">Subtotal</th></tr>
              </thead>
              <tbody>
                {pr.items.map(i => (
                  <tr key={i.id} className="border-t border-gray-100 dark:border-dark-border">
                    <td className="py-1">{i.storeItem?.name}</td>
                    <td className="text-right">{Number(i.quantityRequested)} {i.storeItem?.unit}</td>
                    <td className="text-right">{fmtKES(i.estimatedUnitCost)}</td>
                    <td className="text-right">{fmtKES(Number(i.quantityRequested) * Number(i.estimatedUnitCost ?? 0))}</td>
                  </tr>
                ))}
                <tr className="border-t border-gray-200 dark:border-dark-border font-semibold">
                  <td colSpan={3} className="text-right py-2">Estimated Total</td>
                  <td className="text-right py-2">{fmtKES(total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
