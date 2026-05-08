// src/pages/sales/SalesBreakagePage.tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Plus, Eye, X, AlertTriangle, Trash2 } from 'lucide-react';
import dayjs from 'dayjs';
import { api } from '../../lib/api/client';

type Status = 'PENDING' | 'APPROVED' | 'REJECTED';
type Grade  = 'SMALL' | 'MEDIUM' | 'LARGE' | 'EXTRA_LARGE' | 'REJECT';
type Reason = 'TRANSIT_DAMAGE' | 'CUSTOMER_RETURN' | 'STORAGE_DAMAGE' | 'HANDLING' | 'OTHER';

type Adjustment = {
  id: string;
  adjustmentRef: string;
  adjustmentDate: string;
  status: Status;
  grade: Grade;
  reason: Reason;
  quantityTrays: number;
  quantityEggs: number;
  unitPriceKes: number;
  totalValueKes: number;
  notes?: string | null;
  reviewNotes?: string | null;
  salesOrder?: { orderNumber: string } | null;
  customer?: { name: string } | null;
  reportedBy?: { fullName: string };
  reviewedBy?: { fullName: string } | null;
};

type FormData = {
  adjustmentDate: string;
  salesOrderId?: string;
  customerId?: string;
  grade: Grade;
  reason: Reason;
  quantityTrays?: number;
  quantityEggs?: number;
  unitPriceKes: number;
  notes?: string;
};

const GRADES: Grade[]   = ['SMALL', 'MEDIUM', 'LARGE', 'EXTRA_LARGE', 'REJECT'];
const REASONS: Reason[] = ['TRANSIT_DAMAGE', 'CUSTOMER_RETURN', 'STORAGE_DAMAGE', 'HANDLING', 'OTHER'];

const STATUS_BADGE: Record<Status, string> = {
  PENDING:  'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  APPROVED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  REJECTED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

function fmt(n: number | string) {
  return `KES ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export default function SalesBreakagePage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [viewing, setViewing] = useState<Adjustment | null>(null);

  const { register, handleSubmit, reset, watch } = useForm<FormData>({
    defaultValues: {
      adjustmentDate: dayjs().format('YYYY-MM-DD'),
      grade: 'LARGE',
      reason: 'TRANSIT_DAMAGE',
      quantityTrays: 0,
      quantityEggs: 0,
      unitPriceKes: 0,
    },
  });

  const trays = Number(watch('quantityTrays') || 0);
  const eggs  = Number(watch('quantityEggs') || 0);
  const unit  = Number(watch('unitPriceKes') || 0);
  const previewValue = ((trays * 30 + eggs) / 30) * unit;

  const { data: list = [], isLoading } = useQuery({
    queryKey: ['breakage-list', statusFilter],
    queryFn: async () => (await api.get('/sales/breakage', {
      params: statusFilter ? { status: statusFilter } : {},
    })).data as Adjustment[],
  });

  const { data: summary } = useQuery({
    queryKey: ['breakage-summary'],
    queryFn: async () => (await api.get('/sales/breakage/summary')).data as {
      count: number; valueKes: number; trays: number; eggs: number;
      pending: number; approved: number; rejected: number;
    },
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['sales-customers'],
    queryFn: async () => (await api.get('/sales/customers')).data as Array<{ id: string; name: string }>,
    staleTime: 5 * 60_000,
  });

  const { data: orders = [] } = useQuery({
    queryKey: ['sales-orders-recent'],
    queryFn: async () => (await api.get('/sales/orders', { params: { days: 60 } })).data as Array<{ id: string; orderNumber: string; customerId?: string }>,
    staleTime: 5 * 60_000,
  });

  const create = useMutation({
    mutationFn: (data: FormData) => api.post('/sales/breakage', {
      ...data,
      salesOrderId: data.salesOrderId || undefined,
      customerId:   data.customerId   || undefined,
      quantityTrays: Number(data.quantityTrays ?? 0),
      quantityEggs:  Number(data.quantityEggs  ?? 0),
      unitPriceKes:  Number(data.unitPriceKes),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['breakage-list'] });
      qc.invalidateQueries({ queryKey: ['breakage-summary'] });
      reset({
        adjustmentDate: dayjs().format('YYYY-MM-DD'),
        grade: 'LARGE', reason: 'TRANSIT_DAMAGE',
        quantityTrays: 0, quantityEggs: 0, unitPriceKes: 0,
      });
      setShowForm(false);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/sales/breakage/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['breakage-list'] });
      qc.invalidateQueries({ queryKey: ['breakage-summary'] });
    },
  });

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      <header>
        <h1 className="text-xl md:text-2xl font-bold text-gray-800 dark:text-gray-100">Egg Breakage Adjustments</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Report transit damage, customer returns, and other egg losses for accountant review.
        </p>
      </header>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Total (30d)"  value={summary.count}    sub={`${summary.trays} trays + ${summary.eggs} eggs`} />
          <Stat label="Pending"      value={summary.pending}  tone="amber" />
          <Stat label="Approved"     value={summary.approved} tone="emerald" />
          <Stat label="Value at risk" value={fmt(summary.valueKes)} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold">
          <Plus className="w-4 h-4" /> {showForm ? 'Cancel' : 'Report Breakage'}
        </button>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="rounded-xl text-sm border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 px-3 py-2">
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit(d => create.mutate(d))}
          className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Date *">
              <input type="date" {...register('adjustmentDate', { required: true })} className="input" />
            </Field>
            <Field label="Reason *">
              <select {...register('reason', { required: true })} className="input">
                {REASONS.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
              </select>
            </Field>
            <Field label="Grade *">
              <select {...register('grade', { required: true })} className="input">
                {GRADES.map(g => <option key={g} value={g}>{g.replace(/_/g, ' ')}</option>)}
              </select>
            </Field>
            <Field label="Sales Order (optional)">
              <select {...register('salesOrderId')} className="input">
                <option value="">— None —</option>
                {orders.map(o => <option key={o.id} value={o.id}>{o.orderNumber}</option>)}
              </select>
            </Field>
            <Field label="Customer (optional)">
              <select {...register('customerId')} className="input">
                <option value="">— None —</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Unit Price (KES / tray) *">
              <input type="number" step="any" min="0" {...register('unitPriceKes', { required: true })} className="input" />
            </Field>
            <Field label="Quantity (trays)">
              <input type="number" min="0" {...register('quantityTrays')} className="input" />
            </Field>
            <Field label="Quantity (loose eggs)">
              <input type="number" min="0" {...register('quantityEggs')} className="input" />
            </Field>
            <div className="flex flex-col justify-end">
              <div className="text-xs text-gray-500 mb-1">Estimated value</div>
              <div className="px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 text-sm font-semibold">{fmt(previewValue)}</div>
            </div>
            <div className="md:col-span-3">
              <Field label="Notes">
                <textarea rows={2} {...register('notes')} className="input" placeholder="What was damaged, how, who confirmed it…" />
              </Field>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="submit" disabled={create.isPending}
              className="bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60">
              Submit for Review
            </button>
            {create.isError && (
              <span className="text-xs text-red-600 inline-flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Failed to submit. Check quantities.
              </span>
            )}
          </div>
        </form>
      )}

      <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border overflow-hidden">
        {isLoading ? <div className="p-6 text-center text-gray-500 text-sm">Loading…</div>
        : list.length === 0 ? <div className="p-6 text-center text-gray-500 text-sm">No breakage adjustments yet.</div>
        : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Ref</th>
                  <th className="text-left px-4 py-2">Date</th>
                  <th className="text-left px-4 py-2">Order / Customer</th>
                  <th className="text-left px-4 py-2">Grade</th>
                  <th className="text-left px-4 py-2">Reason</th>
                  <th className="text-right px-4 py-2">Qty</th>
                  <th className="text-right px-4 py-2">Value</th>
                  <th className="text-center px-4 py-2">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {list.map(a => (
                  <tr key={a.id} className="border-t border-gray-100 dark:border-dark-border">
                    <td className="px-4 py-2 font-mono text-xs">{a.adjustmentRef}</td>
                    <td className="px-4 py-2">{dayjs(a.adjustmentDate).format('YYYY-MM-DD')}</td>
                    <td className="px-4 py-2">
                      {a.salesOrder?.orderNumber && <div className="font-mono text-xs">{a.salesOrder.orderNumber}</div>}
                      {a.customer?.name && <div className="text-xs text-gray-500">{a.customer.name}</div>}
                      {!a.salesOrder && !a.customer && <span className="text-gray-400 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-2">{a.grade.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-2 text-xs">{a.reason.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-2 text-right text-xs">
                      {a.quantityTrays > 0 && <>{a.quantityTrays}t </>}
                      {a.quantityEggs  > 0 && <>{a.quantityEggs}e</>}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold">{fmt(a.totalValueKes)}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[a.status]}`}>{a.status}</span>
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button onClick={() => setViewing(a)} className="text-brand-green hover:underline text-xs inline-flex items-center gap-1 mr-3">
                        <Eye className="w-3 h-3" /> View
                      </button>
                      {a.status === 'PENDING' && (
                        <button onClick={() => { if (confirm(`Delete ${a.adjustmentRef}?`)) remove.mutate(a.id); }}
                          className="text-red-500 hover:underline text-xs inline-flex items-center gap-1">
                          <Trash2 className="w-3 h-3" /> Delete
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

      {viewing && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-dark-card rounded-2xl max-w-lg w-full">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-dark-border">
              <div>
                <h3 className="font-bold text-gray-800 dark:text-gray-100">{viewing.adjustmentRef}</h3>
                <p className="text-xs text-gray-500">{dayjs(viewing.adjustmentDate).format('YYYY-MM-DD')}</p>
              </div>
              <button onClick={() => setViewing(null)}><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-3 text-sm">
              <Row k="Status"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[viewing.status]}`}>{viewing.status}</span></Row>
              <Row k="Reason">{viewing.reason.replace(/_/g, ' ')}</Row>
              <Row k="Grade">{viewing.grade.replace(/_/g, ' ')}</Row>
              <Row k="Trays">{viewing.quantityTrays}</Row>
              <Row k="Loose eggs">{viewing.quantityEggs}</Row>
              <Row k="Unit price">{fmt(viewing.unitPriceKes)}</Row>
              <Row k="Total value"><span className="font-semibold">{fmt(viewing.totalValueKes)}</span></Row>
              {viewing.salesOrder && <Row k="Sales Order">{viewing.salesOrder.orderNumber}</Row>}
              {viewing.customer   && <Row k="Customer">{viewing.customer.name}</Row>}
              {viewing.notes      && <Row k="Notes">{viewing.notes}</Row>}
              {viewing.reviewedBy && <Row k="Reviewed by">{viewing.reviewedBy.fullName}</Row>}
              {viewing.reviewNotes && <Row k="Review notes">{viewing.reviewNotes}</Row>}
              <Row k="Reported by">{viewing.reportedBy?.fullName ?? '—'}</Row>
            </div>
          </div>
        </div>
      )}

      <style>{`.input{width:100%;border-radius:.75rem;border:1px solid rgb(229 231 235);background:white;font-size:.875rem;padding:.5rem .75rem}.dark .input{background:rgb(31 41 55);border-color:rgb(55 65 81);color:white}`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-xs text-gray-500 mb-1 block">{label}</label>{children}</div>;
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex items-start gap-3"><span className="text-gray-500 w-28 flex-shrink-0">{k}:</span><span>{children}</span></div>;
}

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: 'amber' | 'emerald' }) {
  const t = tone === 'amber'   ? 'text-amber-600'
          : tone === 'emerald' ? 'text-emerald-600'
          : 'text-gray-800 dark:text-gray-100';
  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl p-3 border border-gray-100 dark:border-dark-border">
      <div className="text-[11px] uppercase text-gray-500">{label}</div>
      <div className={`text-xl font-bold ${t}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}
