// src/pages/accountant/AccountantLpoPage.tsx
//
// Phase 4 — Accountant LPO + Invoicing.
// Two tabs:
//   1. Purchase Requests : Accountant reviews SUBMITTED requests
//      (approve → REVIEWED, or REJECTED with notes), then generates LPOs
//      from REVIEWED requests.
//   2. LPOs              : list / view / submit drafts. Manual create is
//      available, but the primary flow is "Generate LPO from PR".
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import {
  ClipboardList, FileText, Eye, X, CheckCircle2, XCircle, Send, Plus, Trash2,
} from 'lucide-react';
import dayjs from 'dayjs';
import { api } from '../../lib/api/client';
import {
  fmtKES, STATUS_BADGE, URGENCY_BADGE,
  type PurchaseRequest, type LPO,
} from '../store/_shared';

type Tab = 'requests' | 'lpos';

export function AccountantLpoPage() {
  const [tab, setTab] = useState<Tab>('requests');

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">
          Local Purchase Orders
        </h1>
        <p className="text-sm text-gray-500">
          Review purchase requests from the Store and raise LPOs for approval.
        </p>
      </div>

      <div className="flex gap-2">
        <TabBtn active={tab === 'requests'} onClick={() => setTab('requests')}
          icon={<ClipboardList className="w-4 h-4" />} label="Purchase Requests" />
        <TabBtn active={tab === 'lpos'} onClick={() => setTab('lpos')}
          icon={<FileText className="w-4 h-4" />} label="LPOs" />
      </div>

      {tab === 'requests' ? <ReviewRequestsTab /> : <LposTab />}
    </div>
  );
}

function TabBtn({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition
        ${active
          ? 'bg-brand-green text-white border-brand-green'
          : 'bg-white dark:bg-dark-card text-gray-700 dark:text-gray-200 border-gray-200 dark:border-dark-border hover:border-brand-green'}`}>
      {icon}{label}
    </button>
  );
}

// ── Tab 1: Review Purchase Requests ───────────────────────────────────────────

function ReviewRequestsTab() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('SUBMITTED');
  const [viewing, setViewing] = useState<PurchaseRequest | null>(null);
  const [reviewing, setReviewing] = useState<PurchaseRequest | null>(null);
  const [generatingFor, setGeneratingFor] = useState<PurchaseRequest | null>(null);

  const { data: list = [], isLoading } = useQuery({
    queryKey: ['acc-purchase-requests', statusFilter],
    queryFn: async () => (await api.get('/store/inventory/purchase-requests', {
      params: statusFilter ? { status: statusFilter } : {},
    })).data as PurchaseRequest[],
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="rounded-xl text-sm border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 px-3 py-2">
          <option value="">All statuses</option>
          {['SUBMITTED','REVIEWED','REJECTED','LPO_RAISED','DRAFT'].map(s =>
            <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border overflow-hidden">
        {isLoading ? <Empty msg="Loading…" />
        : list.length === 0 ? <Empty msg="No purchase requests in this status." />
        : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Ref</th>
                  <th className="text-left px-4 py-2">Date</th>
                  <th className="text-left px-4 py-2">Created By</th>
                  <th className="text-center px-4 py-2">Items</th>
                  <th className="text-right px-4 py-2">Est. Total</th>
                  <th className="text-center px-4 py-2">Urgency</th>
                  <th className="text-center px-4 py-2">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {list.map(pr => {
                  const total = pr.items.reduce(
                    (s, i) => s + Number(i.quantityRequested) * Number(i.estimatedUnitCost ?? 0), 0);
                  return (
                    <tr key={pr.id} className="border-t border-gray-100 dark:border-dark-border">
                      <td className="px-4 py-2 font-mono text-xs">{pr.requestRef}</td>
                      <td className="px-4 py-2">{dayjs(pr.requestDate).format('YYYY-MM-DD')}</td>
                      <td className="px-4 py-2">{pr.createdBy?.fullName ?? '—'}</td>
                      <td className="px-4 py-2 text-center">{pr.items.length}</td>
                      <td className="px-4 py-2 text-right">{fmtKES(total)}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${URGENCY_BADGE[pr.urgency]}`}>{pr.urgency}</span>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[pr.status] ?? ''}`}>{pr.status}</span>
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        <button onClick={() => setViewing(pr)}
                          className="text-brand-green hover:underline text-xs inline-flex items-center gap-1 mr-3">
                          <Eye className="w-3 h-3" /> View
                        </button>
                        {pr.status === 'SUBMITTED' && (
                          <button onClick={() => setReviewing(pr)}
                            className="text-blue-600 hover:underline text-xs inline-flex items-center gap-1 mr-3">
                            <CheckCircle2 className="w-3 h-3" /> Review
                          </button>
                        )}
                        {pr.status === 'REVIEWED' && !pr.lpo && (
                          <button onClick={() => setGeneratingFor(pr)}
                            className="text-emerald-700 hover:underline text-xs inline-flex items-center gap-1">
                            <FileText className="w-3 h-3" /> Generate LPO
                          </button>
                        )}
                        {pr.lpo && (
                          <span className="text-xs text-gray-500">LPO {pr.lpo.lpoNumber}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {viewing && <PRDetail pr={viewing} onClose={() => setViewing(null)} />}
      {reviewing && (
        <ReviewModal
          pr={reviewing}
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null);
            qc.invalidateQueries({ queryKey: ['acc-purchase-requests'] });
          }}
        />
      )}
      {generatingFor && (
        <GenerateLpoModal
          pr={generatingFor}
          onClose={() => setGeneratingFor(null)}
          onDone={() => {
            setGeneratingFor(null);
            qc.invalidateQueries({ queryKey: ['acc-purchase-requests'] });
            qc.invalidateQueries({ queryKey: ['acc-lpos'] });
          }}
        />
      )}
    </div>
  );
}

function ReviewModal({ pr, onClose, onDone }: {
  pr: PurchaseRequest; onClose: () => void; onDone: () => void;
}) {
  const [reviewNotes, setReviewNotes] = useState('');
  const reviewMut = useMutation({
    mutationFn: (status: 'REVIEWED' | 'REJECTED') =>
      api.patch(`/store/inventory/purchase-requests/${pr.id}/review`, { status, reviewNotes }),
    onSuccess: onDone,
  });

  const total = pr.items.reduce(
    (s, i) => s + Number(i.quantityRequested) * Number(i.estimatedUnitCost ?? 0), 0);

  return (
    <Modal title={`Review ${pr.requestRef}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div className="text-xs text-gray-500">
          By {pr.createdBy?.fullName} · {dayjs(pr.requestDate).format('YYYY-MM-DD')} · {pr.urgency}
        </div>
        {pr.notes && <p className="text-sm"><span className="text-gray-500">Notes: </span>{pr.notes}</p>}
        <ItemsTable items={pr.items} totalLabel="Estimated Total" total={total} kind="pr" />
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Review notes (optional)</label>
          <textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)}
            rows={3} className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 px-3 py-2 text-sm" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={() => reviewMut.mutate('REJECTED')}
            disabled={reviewMut.isPending}
            className="px-4 py-2 rounded-xl text-sm font-semibold border border-red-200 text-red-700 hover:bg-red-50">
            <XCircle className="w-4 h-4 inline mr-1" /> Reject
          </button>
          <button onClick={() => reviewMut.mutate('REVIEWED')}
            disabled={reviewMut.isPending}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-brand-green text-white">
            <CheckCircle2 className="w-4 h-4 inline mr-1" /> Approve
          </button>
        </div>
        {reviewMut.isError && <p className="text-xs text-red-600">Action failed.</p>}
      </div>
    </Modal>
  );
}

function GenerateLpoModal({ pr, onClose, onDone }: {
  pr: PurchaseRequest; onClose: () => void; onDone: () => void;
}) {
  type Form = {
    supplierName: string;
    lpoDate: string;
    expectedDelivery?: string;
    vatPercent: number;
    notes?: string;
    items: Array<{ storeItemId?: string; description?: string; quantity: number; unitPrice: number }>;
  };
  const { register, control, handleSubmit, watch } = useForm<Form>({
    defaultValues: {
      supplierName: '',
      lpoDate: dayjs().format('YYYY-MM-DD'),
      vatPercent: 16,
      notes: pr.notes ?? '',
      items: pr.items.map(i => ({
        storeItemId: i.storeItemId,
        description: i.storeItem?.name,
        quantity: Number(i.quantityRequested),
        unitPrice: Number(i.estimatedUnitCost ?? 0),
      })),
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const watchItems = watch('items');
  const watchVat = Number(watch('vatPercent') ?? 0);
  const subtotal = useMemo(
    () => (watchItems ?? []).reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unitPrice || 0), 0),
    [watchItems],
  );
  const vat = subtotal * (watchVat / 100);
  const total = subtotal + vat;

  const createMut = useMutation({
    mutationFn: (data: Form) => api.post('/store/inventory/lpos', {
      purchaseRequestId: pr.id,
      supplierName: data.supplierName,
      lpoDate: data.lpoDate,
      expectedDelivery: data.expectedDelivery || undefined,
      vatPercent: Number(data.vatPercent ?? 0),
      notes: data.notes || undefined,
      items: data.items.map(i => ({
        storeItemId: i.storeItemId,
        description: i.description || undefined,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
      })),
    }),
    onSuccess: onDone,
  });

  return (
    <Modal title={`Generate LPO from ${pr.requestRef}`} onClose={onClose} wide>
      <form onSubmit={handleSubmit(d => createMut.mutate(d))} className="space-y-4 text-sm">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Field label="Supplier *">
            <input {...register('supplierName', { required: true })} className="input" />
          </Field>
          <Field label="LPO Date *">
            <input type="date" {...register('lpoDate', { required: true })} className="input" />
          </Field>
          <Field label="Expected Delivery">
            <input type="date" {...register('expectedDelivery')} className="input" />
          </Field>
          <Field label="VAT %">
            <input type="number" step="any" {...register('vatPercent')} className="input" />
          </Field>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Items</h4>
            <button type="button"
              onClick={() => append({ description: '', quantity: 1, unitPrice: 0 })}
              className="text-xs flex items-center gap-1 text-brand-green hover:underline">
              <Plus className="w-3 h-3" /> Add line
            </button>
          </div>
          <div className="space-y-2">
            {/* Column labels (consistent with Supplier/Date field labels above) */}
            <div className="grid grid-cols-12 gap-2 text-xs text-gray-500 px-1">
              <div className="col-span-12 md:col-span-5">Item *</div>
              <div className="col-span-4 md:col-span-2">Quantity *</div>
              <div className="col-span-4 md:col-span-2">Unit Price (KES) *</div>
              <div className="col-span-3 md:col-span-2 text-right">Subtotal</div>
              <div className="col-span-1" />
            </div>
            {fields.map((f, idx) => (
              <div key={f.id} className="grid grid-cols-12 gap-2 items-start">
                <input type="hidden" {...register(`items.${idx}.storeItemId` as const)} />
                <div className="col-span-12 md:col-span-5">
                  <input placeholder="Description"
                    {...register(`items.${idx}.description` as const)} className="input" />
                </div>
                <div className="col-span-4 md:col-span-2">
                  <input type="number" step="any" placeholder="e.g. 10"
                    {...register(`items.${idx}.quantity` as const, { required: true })} className="input" />
                </div>
                <div className="col-span-4 md:col-span-2">
                  <input type="number" step="any" placeholder="e.g. 1500.00"
                    {...register(`items.${idx}.unitPrice` as const, { required: true })} className="input" />
                </div>
                <div className="col-span-3 md:col-span-2 text-right pt-2 text-xs text-gray-500">
                  {fmtKES(Number(watchItems?.[idx]?.quantity || 0) * Number(watchItems?.[idx]?.unitPrice || 0))}
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

        <Field label="Notes">
          <textarea rows={2} {...register('notes')} className="input" />
        </Field>

        <div className="flex justify-end gap-6 text-sm">
          <span className="text-gray-500">Subtotal <strong className="ml-2 text-gray-800 dark:text-gray-100">{fmtKES(subtotal)}</strong></span>
          <span className="text-gray-500">VAT <strong className="ml-2 text-gray-800 dark:text-gray-100">{fmtKES(vat)}</strong></span>
          <span className="text-gray-500">Total <strong className="ml-2 text-emerald-700">{fmtKES(total)}</strong></span>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-semibold border border-gray-200 text-gray-700">
            Cancel
          </button>
          <button type="submit" disabled={createMut.isPending}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-brand-green text-white disabled:opacity-60">
            Create LPO (Draft)
          </button>
        </div>
        {createMut.isError && <p className="text-xs text-red-600">Failed to create LPO.</p>}
      </form>
    </Modal>
  );
}

// ── Tab 2: LPOs ───────────────────────────────────────────────────────────────

function LposTab() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [viewing, setViewing] = useState<LPO | null>(null);
  const [creatingManual, setCreatingManual] = useState(false);

  const { data: list = [], isLoading } = useQuery({
    queryKey: ['acc-lpos', statusFilter],
    queryFn: async () => (await api.get('/store/inventory/lpos', {
      params: statusFilter ? { status: statusFilter } : {},
    })).data as LPO[],
  });

  const submitMut = useMutation({
    mutationFn: (id: string) => api.patch(`/store/inventory/lpos/${id}/submit`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['acc-lpos'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setCreatingManual(true)}
          className="flex items-center gap-2 bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold">
          <Plus className="w-4 h-4" /> Manual LPO
        </button>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="ml-auto rounded-xl text-sm border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 px-3 py-2">
          <option value="">All statuses</option>
          {['DRAFT','SUBMITTED','APPROVED','PARTIALLY_RECEIVED','FULLY_RECEIVED','CANCELLED'].map(s =>
            <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border overflow-hidden">
        {isLoading ? <Empty msg="Loading…" />
        : list.length === 0 ? <Empty msg="No LPOs yet." />
        : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">LPO #</th>
                  <th className="text-left px-4 py-2">Date</th>
                  <th className="text-left px-4 py-2">Supplier</th>
                  <th className="text-left px-4 py-2">PR Ref</th>
                  <th className="text-right px-4 py-2">Total</th>
                  <th className="text-center px-4 py-2">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {list.map(l => (
                  <tr key={l.id} className="border-t border-gray-100 dark:border-dark-border">
                    <td className="px-4 py-2 font-mono text-xs">{l.lpoNumber}</td>
                    <td className="px-4 py-2">{dayjs(l.lpoDate).format('YYYY-MM-DD')}</td>
                    <td className="px-4 py-2">{l.supplierName}</td>
                    <td className="px-4 py-2 text-xs font-mono text-gray-500">{l.purchaseRequest?.requestRef ?? '—'}</td>
                    <td className="px-4 py-2 text-right font-semibold">{fmtKES(l.totalKes)}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[l.status] ?? ''}`}>{l.status}</span>
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button onClick={() => setViewing(l)}
                        className="text-brand-green hover:underline text-xs inline-flex items-center gap-1 mr-3">
                        <Eye className="w-3 h-3" /> View
                      </button>
                      {l.status === 'DRAFT' && (
                        <button disabled={submitMut.isPending}
                          onClick={() => submitMut.mutate(l.id)}
                          className="text-blue-600 hover:underline text-xs inline-flex items-center gap-1">
                          <Send className="w-3 h-3" /> Submit for approval
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

      {viewing && <LPODetail lpo={viewing} onClose={() => setViewing(null)} />}
      {creatingManual && (
        <ManualLpoModal
          onClose={() => setCreatingManual(false)}
          onDone={() => {
            setCreatingManual(false);
            qc.invalidateQueries({ queryKey: ['acc-lpos'] });
          }}
        />
      )}

      <style>{`.input{width:100%;border-radius:.75rem;border:1px solid rgb(229 231 235);background:white;font-size:.875rem;padding:.5rem .75rem}.dark .input{background:rgb(31 41 55);border-color:rgb(55 65 81);color:white}`}</style>
    </div>
  );
}

function ManualLpoModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  type Form = {
    supplierName: string;
    lpoDate: string;
    expectedDelivery?: string;
    vatPercent: number;
    notes?: string;
    items: Array<{ itemName: string; quantity: number; unitPrice: number }>;
  };
  const { register, control, handleSubmit, watch } = useForm<Form>({
    defaultValues: {
      supplierName: '',
      lpoDate: dayjs().format('YYYY-MM-DD'),
      vatPercent: 16,
      items: [{ itemName: '', quantity: 1, unitPrice: 0 }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const watchItems = watch('items');
  const watchVat = Number(watch('vatPercent') ?? 0);
  const subtotal = useMemo(
    () => (watchItems ?? []).reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unitPrice || 0), 0),
    [watchItems],
  );
  const vat = subtotal * (watchVat / 100);
  const total = subtotal + vat;

  const createMut = useMutation({
    mutationFn: (data: Form) => api.post('/store/inventory/lpos', {
      supplierName: data.supplierName,
      lpoDate: data.lpoDate,
      expectedDelivery: data.expectedDelivery || undefined,
      vatPercent: Number(data.vatPercent ?? 0),
      notes: data.notes || undefined,
      items: data.items.map(i => ({
        // Manual LPO: free-typed item — backend stores name in `description`
        // and leaves storeItemId null (see prisma migration shipped with this pack).
        description: i.itemName,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
      })),
    }),
    onSuccess: onDone,
  });

  return (
    <Modal title="New Local Purchase Order" onClose={onClose} wide>
      <form onSubmit={handleSubmit(d => createMut.mutate(d))} className="space-y-4 text-sm">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Field label="Supplier *">
            <input {...register('supplierName', { required: true })} className="input" />
          </Field>
          <Field label="LPO Date *">
            <input type="date" {...register('lpoDate', { required: true })} className="input" />
          </Field>
          <Field label="Expected Delivery">
            <input type="date" {...register('expectedDelivery')} className="input" />
          </Field>
          <Field label="VAT %">
            <input type="number" step="any" {...register('vatPercent')} className="input" />
          </Field>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Items</h4>
            <button type="button"
              onClick={() => append({ itemName: '', quantity: 1, unitPrice: 0 })}
              className="text-xs flex items-center gap-1 text-brand-green hover:underline">
              <Plus className="w-3 h-3" /> Add line
            </button>
          </div>
          <div className="space-y-2">
            {/* Column labels — consistent with the Field labels (Supplier, LPO Date, …) above */}
            <div className="grid grid-cols-12 gap-2 text-xs text-gray-500 px-1">
              <div className="col-span-12 md:col-span-5">Item *</div>
              <div className="col-span-4 md:col-span-2">Quantity *</div>
              <div className="col-span-4 md:col-span-2">Unit Price (KES) *</div>
              <div className="col-span-3 md:col-span-2 text-right">Subtotal</div>
              <div className="col-span-1" />
            </div>
            {fields.map((f, idx) => (
              <div key={f.id} className="grid grid-cols-12 gap-2 items-start">
                <div className="col-span-12 md:col-span-5">
                  <input
                    type="text"
                    placeholder="Type item name (e.g. Layers Mash 70kg)"
                    {...register(`items.${idx}.itemName` as const, { required: true })}
                    className="input"
                  />
                </div>
                <div className="col-span-4 md:col-span-2">
                  <input type="number" step="any" placeholder="e.g. 10"
                    {...register(`items.${idx}.quantity` as const, { required: true })} className="input" />
                </div>
                <div className="col-span-4 md:col-span-2">
                  <input type="number" step="any" placeholder="e.g. 1500.00"
                    {...register(`items.${idx}.unitPrice` as const, { required: true })} className="input" />
                </div>
                <div className="col-span-3 md:col-span-2 text-right pt-2 text-xs text-gray-500">
                  {fmtKES(Number(watchItems?.[idx]?.quantity || 0) * Number(watchItems?.[idx]?.unitPrice || 0))}
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

        <Field label="Notes">
          <textarea rows={2} {...register('notes')} className="input" />
        </Field>

        <div className="flex justify-end gap-6 text-sm">
          <span className="text-gray-500">Subtotal <strong className="ml-2 text-gray-800 dark:text-gray-100">{fmtKES(subtotal)}</strong></span>
          <span className="text-gray-500">VAT <strong className="ml-2 text-gray-800 dark:text-gray-100">{fmtKES(vat)}</strong></span>
          <span className="text-gray-500">Total <strong className="ml-2 text-emerald-700">{fmtKES(total)}</strong></span>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-semibold border border-gray-200 text-gray-700">
            Cancel
          </button>
          <button type="submit" disabled={createMut.isPending}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-brand-green text-white disabled:opacity-60">
            Create LPO (Draft)
          </button>
        </div>
        {createMut.isError && <p className="text-xs text-red-600">Failed to create LPO.</p>}
      </form>
    </Modal>
  );
}

// ── Detail modals ─────────────────────────────────────────────────────────────

function PRDetail({ pr, onClose }: { pr: PurchaseRequest; onClose: () => void }) {
  const total = pr.items.reduce(
    (s, i) => s + Number(i.quantityRequested) * Number(i.estimatedUnitCost ?? 0), 0);
  return (
    <Modal title={pr.requestRef} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div className="text-xs text-gray-500">
          {dayjs(pr.requestDate).format('YYYY-MM-DD')} · {pr.urgency} ·{' '}
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[pr.status] ?? ''}`}>{pr.status}</span>
        </div>
        {pr.notes && <p><span className="text-gray-500">Notes: </span>{pr.notes}</p>}
        {pr.reviewNotes && <p><span className="text-gray-500">Review notes: </span>{pr.reviewNotes}</p>}
        {pr.lpo && <p><span className="text-gray-500">LPO: </span><span className="font-mono">{pr.lpo.lpoNumber}</span> ({pr.lpo.status})</p>}
        <ItemsTable items={pr.items} totalLabel="Estimated Total" total={total} kind="pr" />
      </div>
    </Modal>
  );
}

function LPODetail({ lpo, onClose }: { lpo: LPO; onClose: () => void }) {
  return (
    <Modal title={lpo.lpoNumber} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div className="text-xs text-gray-500">
          {lpo.supplierName} · {dayjs(lpo.lpoDate).format('YYYY-MM-DD')} ·{' '}
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[lpo.status] ?? ''}`}>{lpo.status}</span>
        </div>
        {lpo.expectedDelivery && <p><span className="text-gray-500">Expected: </span>{dayjs(lpo.expectedDelivery).format('YYYY-MM-DD')}</p>}
        {lpo.purchaseRequest && <p><span className="text-gray-500">PR: </span><span className="font-mono">{lpo.purchaseRequest.requestRef}</span></p>}
        {lpo.notes && <p><span className="text-gray-500">Notes: </span>{lpo.notes}</p>}
        <ItemsTable items={lpo.items as any} kind="lpo" total={Number(lpo.totalKes)}
          subtotal={Number(lpo.subtotalKes)} vat={Number(lpo.vatKes)} />
      </div>
    </Modal>
  );
}

function ItemsTable({ items, kind, total, totalLabel, subtotal, vat }: {
  items: any[]; kind: 'pr' | 'lpo'; total: number; totalLabel?: string;
  subtotal?: number; vat?: number;
}) {
  return (
    <div>
      <h4 className="font-semibold mb-2 text-gray-700 dark:text-gray-200">Items</h4>
      <table className="w-full text-xs">
        <thead className="text-gray-500">
          <tr>
            <th className="text-left">Item</th>
            <th className="text-right">Qty</th>
            <th className="text-right">{kind === 'pr' ? 'Est. Unit' : 'Unit Price'}</th>
            <th className="text-right">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i: any) => {
            const qty = Number(i.quantity ?? i.quantityRequested ?? 0);
            const price = Number(i.unitPrice ?? i.estimatedUnitCost ?? 0);
            return (
              <tr key={i.id} className="border-t border-gray-100 dark:border-dark-border">
                <td className="py-1">{i.storeItem?.name ?? i.description ?? '—'}</td>
                <td className="text-right">{qty} {i.storeItem?.unit}</td>
                <td className="text-right">{fmtKES(price)}</td>
                <td className="text-right">{fmtKES(i.subtotal ?? qty * price)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="text-right">
          {kind === 'lpo' && subtotal !== undefined && (
            <>
              <tr><td colSpan={3} className="pt-2 text-gray-500">Subtotal</td><td className="pt-2">{fmtKES(subtotal)}</td></tr>
              <tr><td colSpan={3} className="text-gray-500">VAT</td><td>{fmtKES(vat ?? 0)}</td></tr>
            </>
          )}
          <tr className="font-bold border-t border-gray-200 dark:border-dark-border">
            <td colSpan={3} className="pt-2">{totalLabel ?? 'Total'}</td>
            <td className="pt-2">{fmtKES(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Primitives ────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children, wide }: {
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className={`bg-white dark:bg-dark-card rounded-2xl ${wide ? 'max-w-4xl' : 'max-w-2xl'} w-full max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-dark-border sticky top-0 bg-white dark:bg-dark-card">
          <h3 className="font-bold text-gray-800 dark:text-gray-100">{title}</h3>
          <button onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
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

function Empty({ msg }: { msg: string }) {
  return <div className="p-6 text-center text-gray-500 text-sm">{msg}</div>;
}

export default AccountantLpoPage;