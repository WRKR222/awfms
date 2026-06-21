// frontend/src/pages/accountant/AccountantFinancePage.tsx
// Fixes applied:
//   GAP-06: ExpensesTab — const cats:any[] replaced with useQuery fetching categories
//   GAP-07: InvoicesTab — shows all statuses (UNPAID/PARTIAL/OVERDUE/PAID) + AR summary
//   GAP-09: InvoicesTab — payment logging form added
//   GAP-11: Expense category management section added (create new categories)
//   GAP-12: Expense form — batch selector added
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api } from '../../lib/api/client';
import {
  Plus, FileText, DollarSign, CheckCircle, AlertCircle, AlertTriangle,
  Upload, FileUp, X, CreditCard, Settings2, ChevronDown, ChevronRight,
  TrendingUp, BarChart2, ShoppingCart,
} from 'lucide-react';
import dayjs from '../../lib/dayjs';

// ── Shared helpers ────────────────────────────────────────────────────────────

const inp = 'w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2';
const lbl = 'text-xs text-gray-500 mb-1 block';

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className={lbl}>{label}</label>{children}</div>;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useExpenses(from?: string, to?: string) {
  return useQuery({
    queryKey: ['expenses', from, to],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (from) p.set('from', from);
      if (to)   p.set('to', to);
      return (await api.get(`/finance/expenses?${p}`)).data as any[];
    },
  });
}

// GAP-06 FIX: actually fetch categories instead of empty array
function useExpenseCategories() {
  return useQuery({
    queryKey: ['expense-categories'],
    queryFn: async () =>
      (await api.get('/finance/expense-categories')).data as Array<{ id: string; name: string; description?: string }>,
    staleTime: 5 * 60_000,
  });
}

function useInvoices(status?: string) {
  return useQuery({
    queryKey: ['finance-invoices', status],
    queryFn: async () => {
      const p = status ? `?status=${status}` : '';
      return (await api.get(`/finance/invoices${p}`)).data as any[];
    },
    staleTime: 30_000,
  });
}

function useArSummary() {
  return useQuery({
    queryKey: ['ar-summary'],
    queryFn: async () => (await api.get('/finance/ar/summary')).data as any,
    staleTime: 60_000,
  });
}

function useBatches() {
  return useQuery({
    queryKey: ['batches-active'],
    queryFn: async () =>
      (await api.get('/flock/batches?isActive=true')).data as Array<{ id: string; batchCode: string }>,
    staleTime: 5 * 60_000,
  });
}

// ── Expense Category Management ──────────────────────────────────────────────
// GAP-11 FIX: Previously a placeholder comment — now a real component

function CategoryManager() {
  const qc = useQueryClient();
  const { data: cats = [], isLoading } = useExpenseCategories();
  const [show, setShow] = useState(false);
  const { register, handleSubmit, reset } = useForm<{ name: string; description?: string }>();

  const create = useMutation({
    mutationFn: (d: any) => api.post('/finance/expense-categories', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expense-categories'] }); reset(); setShow(false); },
  });

  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border overflow-hidden">
      <button
        onClick={() => setShow(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50"
      >
        <span className="flex items-center gap-2"><Settings2 className="w-4 h-4 text-gray-400" /> Manage Expense Categories</span>
        {show ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
      </button>

      {show && (
        <div className="border-t border-gray-100 dark:border-dark-border p-4 space-y-3">
          <form onSubmit={handleSubmit(d => create.mutate(d))} className="flex gap-2">
            <input
              {...register('name', { required: true })}
              placeholder="New category name (e.g. Feed, Medication, Labour)"
              className={`${inp} flex-1`}
            />
            <button type="submit" disabled={create.isPending}
              className="bg-brand-green text-white px-3 py-2 rounded-xl text-sm font-semibold whitespace-nowrap disabled:opacity-50 flex items-center gap-1">
              <Plus className="w-4 h-4" /> Add
            </button>
          </form>
          {isLoading ? (
            <p className="text-xs text-gray-400">Loading…</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {cats.map(c => (
                <span key={c.id} className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs px-3 py-1 rounded-full font-medium">
                  {c.name}
                </span>
              ))}
              {cats.length === 0 && <p className="text-xs text-gray-400">No categories yet — add one above.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Expenses Tab ──────────────────────────────────────────────────────────────

function ExpensesTab() {
  const qc = useQueryClient();
  const today      = dayjs().format('YYYY-MM-DD');
  const monthStart = dayjs().startOf('month').format('YYYY-MM-DD');
  const [from, setFrom] = useState(monthStart);
  const [to, setTo]     = useState(today);
  const [showForm, setShowForm] = useState(false);

  const { data: expenses = [], isLoading } = useExpenses(from, to);
  const { data: cats = [] } = useExpenseCategories(); // GAP-06 FIX
  const { data: batches = [] } = useBatches();        // GAP-12 FIX
  const { register, handleSubmit, reset } = useForm<any>();

  const create = useMutation({
    mutationFn: (data: any) => api.post('/finance/expenses', { ...data, amount: Number(data.amount) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); reset(); setShowForm(false); },
  });

  const total = expenses.reduce((s: number, e: any) => s + Number(e.amount), 0);

  return (
    <div className="space-y-4">
      {/* GAP-11 FIX: Category manager */}
      <CategoryManager />

      <div className="flex flex-wrap gap-2 items-end">
        <button onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold">
          <Plus className="w-4 h-4" /> Log Expense
        </button>
        <div className="flex gap-2 items-center ml-auto">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-xs px-3 py-2" />
          <span className="text-xs text-gray-400">to</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-xs px-3 py-2" />
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit(d => create.mutate(d))}
          className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {/* GAP-06 FIX: categories fetched, not empty */}
            <Fld label="Category *">
              <select {...register('category', { required: true })} className={inp}>
                <option value="">Select category</option>
                {cats.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </Fld>
            <Fld label="Date *">
              <input type="date" {...register('expenseDate', { required: true })} defaultValue={today} className={inp} />
            </Fld>
            <div className="col-span-2">
              <Fld label="Description *">
                <input {...register('description', { required: true })} placeholder="What was this expense for?" className={inp} />
              </Fld>
            </div>
            <Fld label="Amount (KES) *">
              <input type="number" step="0.01" {...register('amount', { required: true, min: 0 })} className={inp} />
            </Fld>
            {/* GAP-12 FIX: batch selector */}
            <Fld label="Batch (optional)">
              <select {...register('batchId')} className={inp}>
                <option value="">— No batch —</option>
                {batches.map(b => <option key={b.id} value={b.id}>{b.batchCode}</option>)}
              </select>
            </Fld>
            <Fld label="Vendor Name">
              <input {...register('vendorName')} placeholder="Optional" className={inp} />
            </Fld>
            <Fld label="Receipt Ref">
              <input {...register('receiptRef')} placeholder="Optional" className={inp} />
            </Fld>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={create.isPending || cats.length === 0}
              className="bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50">
              {create.isPending ? 'Saving…' : 'Save Expense'}
            </button>
            <button type="button" onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-xl text-sm text-gray-500 border border-gray-200 dark:border-dark-border">
              Cancel
            </button>
          </div>
          {cats.length === 0 && (
            <p className="text-xs text-amber-600">Add an expense category above before logging an expense.</p>
          )}
          {create.isError && <p className="text-xs text-red-600">Failed to save. Check all fields.</p>}
        </form>
      )}

      {expenses.length > 0 && (
        <div className="bg-brand-green/10 dark:bg-brand-green/5 rounded-2xl px-4 py-3 flex justify-between">
          <p className="text-sm text-gray-700 dark:text-gray-300">{expenses.length} expense{expenses.length !== 1 ? 's' : ''}</p>
          <p className="text-sm font-bold text-brand-green">Total: KES {total.toLocaleString()}</p>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-400 text-center py-4">Loading…</p>
      ) : expenses.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">No expenses in this period</p>
      ) : (
        <div className="space-y-2">
          {expenses.map((e: any) => (
            <div key={e.id} className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border flex items-center gap-3">
              <DollarSign className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">{e.description}</p>
                  <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full flex-shrink-0">
                    {e.expenseCategory?.name ?? e.category}
                  </span>
                </div>
                <p className="text-xs text-gray-400">{dayjs(e.expenseDate).format('D MMM YYYY')}{e.vendorName ? ` · ${e.vendorName}` : ''}</p>
              </div>
              <p className="text-sm font-bold text-gray-700 dark:text-gray-300 flex-shrink-0">KES {Number(e.amount).toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Invoices & AR Tab ─────────────────────────────────────────────────────────
// GAP-07 FIX: shows all statuses, AR summary, payment logging

const STATUS_COLOR: Record<string, string> = {
  PAID:    'bg-green-100 text-green-700',
  OVERDUE: 'bg-red-100 text-red-700',
  UNPAID:  'bg-amber-100 text-amber-700',
  PARTIAL: 'bg-blue-100 text-blue-700',
};
const STATUS_ICON: Record<string, React.ElementType> = {
  PAID: CheckCircle, OVERDUE: AlertCircle, UNPAID: AlertTriangle, PARTIAL: AlertCircle,
};

function PaymentForm({ invoiceId, balanceDue, onClose }: { invoiceId: string; balanceDue: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm<any>({
    defaultValues: { amount: balanceDue, paymentDate: dayjs().format('YYYY-MM-DD'), paymentMethod: 'CASH' },
  });

  const log = useMutation({
    mutationFn: (d: any) => api.post('/finance/invoices/payments', { ...d, invoiceId, amount: Number(d.amount) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['finance-invoices'] }); qc.invalidateQueries({ queryKey: ['ar-summary'] }); onClose(); },
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-dark-card rounded-2xl p-5 w-full max-w-sm space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-800 dark:text-gray-100">Log Payment</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <form onSubmit={handleSubmit(d => log.mutate(d))} className="space-y-3">
          <Fld label="Amount (KES) *">
            <input type="number" step="0.01" min="0.01" {...register('amount', { required: true })} className={inp} />
          </Fld>
          <Fld label="Payment Date *">
            <input type="date" {...register('paymentDate', { required: true })} className={inp} />
          </Fld>
          <Fld label="Payment Method *">
            <select {...register('paymentMethod', { required: true })} className={inp}>
              <option value="CASH">Cash</option>
              <option value="MPESA">M-Pesa</option>
              <option value="BANK_TRANSFER">Bank Transfer</option>
            </select>
          </Fld>
          <Fld label="Reference (optional)">
            <input {...register('reference')} className={inp} placeholder="Transaction ID, cheque no." />
          </Fld>
          <Fld label="Notes">
            <input {...register('notes')} className={inp} />
          </Fld>
          <button type="submit" disabled={log.isPending}
            className="w-full bg-brand-green text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2">
            <CreditCard className="w-4 h-4" />
            {log.isPending ? 'Logging…' : 'Log Payment'}
          </button>
          {log.isError && <p className="text-xs text-red-600">Failed to log payment. Please try again.</p>}
        </form>
      </div>
    </div>
  );
}

function InvoicesTab() {
  const [statusFilter, setStatusFilter] = useState('');
  const [payingInvoice, setPayingInvoice] = useState<any>(null);
  const { data: invoices = [], isLoading } = useInvoices(statusFilter || undefined);
  const { data: ar } = useArSummary();

  return (
    <div className="space-y-4">
      {/* GAP-07 FIX: AR summary */}
      {ar && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border">
            <p className="text-xs text-gray-500 mb-1">Total Outstanding</p>
            <p className="text-xl font-bold text-amber-600">KES {Number(ar.totalOutstanding).toLocaleString()}</p>
          </div>
          <div className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border">
            <p className="text-xs text-gray-500 mb-1">Overdue Invoices</p>
            <p className={`text-xl font-bold ${ar.overdueCount > 0 ? 'text-red-500' : 'text-gray-800 dark:text-gray-100'}`}>
              {ar.overdueCount}
            </p>
          </div>
          <div className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border">
            <p className="text-xs text-gray-500 mb-1">Overdue Amount</p>
            <p className="text-xl font-bold text-red-500">KES {Number(ar.overdueAmount).toLocaleString()}</p>
          </div>
          <div className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border">
            <p className="text-xs text-gray-500 mb-1">Paid This Month</p>
            <p className="text-xl font-bold text-brand-green">KES {Number(ar.paidThisMonth).toLocaleString()}</p>
          </div>
        </div>
      )}

      {/* GAP-07 FIX: status filter */}
      <div className="flex gap-2 flex-wrap items-center">
        <p className="text-xs font-medium text-gray-500">Filter:</p>
        {['', 'UNPAID', 'PARTIAL', 'OVERDUE', 'PAID'].map(s => (
          <button key={s}
            onClick={() => setStatusFilter(s)}
            className={`text-xs px-3 py-1.5 rounded-xl font-semibold transition-colors ${statusFilter === s ? 'bg-brand-green text-white' : 'bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border text-gray-600'}`}>
            {s || 'All'}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400 text-center py-4">Loading invoices…</p>
      ) : invoices.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">No invoices found</p>
      ) : (
        <div className="space-y-2">
          {invoices.map((inv: any) => {
            const StatusIcon = STATUS_ICON[inv.status] ?? AlertTriangle;
            const color = STATUS_COLOR[inv.status] ?? 'bg-gray-100 text-gray-600';
            const canPay = ['UNPAID', 'PARTIAL', 'OVERDUE'].includes(inv.status);
            return (
              <div key={inv.id} className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-4 flex items-center gap-3">
                <StatusIcon className={`w-5 h-5 flex-shrink-0 ${
                  inv.status === 'PAID'    ? 'text-green-500' :
                  inv.status === 'OVERDUE' ? 'text-red-500'   :
                  inv.status === 'PARTIAL' ? 'text-blue-500'  : 'text-amber-500'
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-gray-800 dark:text-gray-200 text-sm">{inv.customer?.name}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${color}`}>{inv.status}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {inv.invoiceNumber} · Due {dayjs(inv.dueDate).format('D MMM YYYY')}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold">KES {Number(inv.totalAmount).toLocaleString()}</p>
                  {Number(inv.balanceDue) > 0 && (
                    <p className="text-xs text-red-500">Bal: KES {Number(inv.balanceDue).toLocaleString()}</p>
                  )}
                </div>
                {/* GAP-09 FIX: payment logging button */}
                {canPay && (
                  <button
                    onClick={() => setPayingInvoice(inv)}
                    className="flex-shrink-0 bg-brand-green text-white text-xs px-3 py-1.5 rounded-lg font-semibold hover:bg-green-700 flex items-center gap-1">
                    <CreditCard className="w-3 h-3" /> Pay
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Payment modal */}
      {payingInvoice && (
        <PaymentForm
          invoiceId={payingInvoice.id}
          balanceDue={Number(payingInvoice.balanceDue)}
          onClose={() => setPayingInvoice(null)}
        />
      )}
    </div>
  );
}

// ── Import Tab (unchanged from original) ──────────────────────────────────────

function ImportTab() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [importType, setImportType] = useState('expenses');
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ success?: string; error?: string } | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.match(/\.(xlsx|xls|csv)$/)) { setResult({ error: 'Please upload .xlsx, .xls, or .csv' }); return; }
    setFile(f); setResult(null);
  };

  const handleImport = async () => {
    if (!file) return;
    setUploading(true); setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file); fd.append('type', importType);
      await api.post('/finance/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      qc.invalidateQueries({ queryKey: ['expenses'] });
      setResult({ success: `Imported ${importType} data from ${file.name}` });
      setFile(null);
    } catch (err: any) {
      setResult({ error: err?.response?.data?.message ?? 'Import failed. Check your file format.' });
    }
    setUploading(false);
  };

  return (
    <div className="space-y-5 max-w-xl">
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-2xl p-4">
        <p className="text-sm font-semibold text-blue-700 dark:text-blue-400 mb-1 flex items-center gap-2">
          <FileUp className="w-4 h-4" /> Import Excel / CSV
        </p>
        <p className="text-xs text-gray-500">Upload .xlsx, .xls, or .csv files to bulk-import financial data.</p>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-2 font-medium">Data Type</label>
        <div className="space-y-2">
          {[
            { id: 'expenses', label: 'Expenses', desc: 'Expense records (.xlsx)' },
            { id: 'invoices', label: 'Invoices', desc: 'Invoice data (.xlsx)' },
            { id: 'payments', label: 'Payments', desc: 'Payment records (.xlsx)' },
          ].map(it => (
            <label key={it.id} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${importType === it.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-dark-border'}`}>
              <input type="radio" name="importType" value={it.id} checked={importType === it.id} onChange={() => setImportType(it.id)} className="mt-0.5" />
              <div><p className="text-sm font-semibold">{it.label}</p><p className="text-xs text-gray-500">{it.desc}</p></div>
            </label>
          ))}
        </div>
      </div>
      <label className={`flex flex-col items-center justify-center border-2 border-dashed rounded-2xl p-8 cursor-pointer ${file ? 'border-brand-green bg-brand-green/5' : 'border-gray-200 dark:border-dark-border'}`}>
        <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={handleFileChange} />
        {file ? (
          <><CheckCircle className="w-8 h-8 text-brand-green mb-2" /><p className="text-sm font-semibold text-brand-green">{file.name}</p></>
        ) : (
          <><Upload className="w-8 h-8 text-gray-300 mb-2" /><p className="text-sm font-semibold text-gray-600">Click to select file</p></>
        )}
      </label>
      {result?.success && <div className="bg-green-50 rounded-xl p-3 text-green-700 text-sm flex items-center gap-2"><CheckCircle className="w-4 h-4" /> {result.success}</div>}
      {result?.error   && <div className="bg-red-50 rounded-xl p-3 text-red-600 text-sm">{result.error}</div>}
      <button onClick={handleImport} disabled={!file || uploading}
        className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
        <FileUp className="w-4 h-4" /> {uploading ? 'Importing…' : 'Import File'}
      </button>
    </div>
  );
}

// ── PnL Tab ───────────────────────────────────────────────────────────────────

function PnLTab() {
  const today      = dayjs().format('YYYY-MM-DD');
  const monthStart = dayjs().startOf('month').format('YYYY-MM-DD');
  const [from, setFrom] = useState(monthStart);
  const [to,   setTo]   = useState(today);
  const [period, setPeriod] = useState<'custom' | 'daily' | 'weekly' | 'monthly' | 'yearly'>('monthly');

  const periodFrom = period === 'daily'   ? dayjs().format('YYYY-MM-DD')
    : period === 'weekly'  ? dayjs().startOf('week').format('YYYY-MM-DD')
    : period === 'monthly' ? dayjs().startOf('month').format('YYYY-MM-DD')
    : period === 'yearly'  ? dayjs().startOf('year').format('YYYY-MM-DD')
    : from;
  const periodTo = period === 'custom' ? to : dayjs().format('YYYY-MM-DD');

  const { data: revenue, isLoading: revLoading } = useQuery({
    queryKey: ['pnl-revenue', periodFrom, periodTo],
    queryFn: async () => {
      // Sum payments in period
      const inv = (await api.get(`/finance/invoices`)).data as any[];
      return inv
        .flatMap((i: any) => (i.payments ?? []))
        .filter((p: any) => {
          const pd = dayjs(p.paymentDate);
          return pd.isAfter(dayjs(periodFrom).subtract(1, 'day')) && pd.isBefore(dayjs(periodTo).add(1, 'day'));
        })
        .reduce((s: number, p: any) => s + Number(p.amount), 0);
    },
    staleTime: 30_000,
  });

  const { data: expenses, isLoading: expLoading } = useQuery({
    queryKey: ['pnl-expenses', periodFrom, periodTo],
    queryFn: async () => (await api.get(`/finance/expenses?from=${periodFrom}&to=${periodTo}`)).data as any[],
    staleTime: 30_000,
  });

  const totalExpenses = (expenses ?? []).reduce((s: number, e: any) => s + Number(e.amount), 0);
  const totalRevenue  = revenue ?? 0;
  const grossProfit   = totalRevenue - totalExpenses;
  const margin        = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

  // Group expenses by category
  const byCategory: Record<string, number> = {};
  for (const e of (expenses ?? [])) {
    const k = e.expenseCategory?.name ?? 'Uncategorized';
    byCategory[k] = (byCategory[k] ?? 0) + Number(e.amount);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
          {(['daily','weekly','monthly','yearly','custom'] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors capitalize ${period === p ? 'bg-white dark:bg-dark-card text-brand-green shadow-sm' : 'text-gray-500'}`}>
              {p}
            </button>
          ))}
        </div>
        {period === 'custom' && (
          <div className="flex gap-2 items-center">
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-xs px-3 py-2" />
            <span className="text-xs text-gray-400">to</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-xs px-3 py-2" />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border">
          <p className="text-xs text-gray-500 mb-1">Revenue (Payments Received)</p>
          <p className="text-xl font-bold text-brand-green">KES {totalRevenue.toLocaleString()}</p>
        </div>
        <div className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border">
          <p className="text-xs text-gray-500 mb-1">Total Expenses</p>
          <p className="text-xl font-bold text-red-500">KES {totalExpenses.toLocaleString()}</p>
        </div>
        <div className={`rounded-2xl p-4 border ${grossProfit >= 0 ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800'}`}>
          <p className="text-xs text-gray-500 mb-1">Net Profit / Loss</p>
          <p className={`text-xl font-bold ${grossProfit >= 0 ? 'text-green-700' : 'text-red-600'}`}>
            {grossProfit >= 0 ? '+' : ''}KES {grossProfit.toLocaleString()}
          </p>
        </div>
        <div className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border">
          <p className="text-xs text-gray-500 mb-1">Gross Margin</p>
          <p className={`text-xl font-bold ${margin >= 0 ? 'text-brand-green' : 'text-red-500'}`}>
            {margin.toFixed(1)}%
          </p>
        </div>
      </div>

      {(revLoading || expLoading) && <p className="text-sm text-gray-400 text-center py-4">Loading P&L data…</p>}

      {Object.keys(byCategory).length > 0 && (
        <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-4">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Expenses by Category</p>
          <div className="space-y-2">
            {Object.entries(byCategory)
              .sort((a, b) => b[1] - a[1])
              .map(([cat, amt]) => (
                <div key={cat} className="flex items-center gap-3">
                  <p className="text-sm text-gray-600 dark:text-gray-300 flex-1">{cat}</p>
                  <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-2">
                    <div className="bg-red-400 rounded-full h-2" style={{ width: `${totalExpenses > 0 ? (amt / totalExpenses) * 100 : 0}%` }} />
                  </div>
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 w-28 text-right">KES {amt.toLocaleString()}</p>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sales Report Tab ──────────────────────────────────────────────────────────

function SalesReportTab() {
  const today      = dayjs().format('YYYY-MM-DD');
  const monthStart = dayjs().startOf('month').format('YYYY-MM-DD');
  const [from, setFrom] = useState(monthStart);
  const [to,   setTo]   = useState(today);

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['sales-report-invoices', from, to],
    queryFn: async () => (await api.get('/finance/invoices')).data as any[],
    staleTime: 30_000,
  });

  // Filter by date range
  const filtered = invoices.filter((inv: any) => {
    const d = dayjs(inv.invoiceDate);
    return d.isAfter(dayjs(from).subtract(1, 'day')) && d.isBefore(dayjs(to).add(1, 'day'));
  });

  // Aggregate items by egg type
  const itemTotals: Record<string, { qty: number; revenue: number }> = {};
  for (const inv of filtered) {
    for (const item of (inv.salesOrder?.items ?? [])) {
      const k = item.itemType ?? 'UNKNOWN';
      if (!itemTotals[k]) itemTotals[k] = { qty: 0, revenue: 0 };
      itemTotals[k].qty     += item.quantityEggs ?? 0;
      itemTotals[k].revenue += Number(item.subtotal ?? 0);
    }
  }

  const EGG_LABEL: Record<string, string> = {
    STANDARD_EGGS: 'Standard Eggs',
    STARTER_EGGS: 'Starter Eggs',
    CONSUMABLE_BROKEN_EGGS: 'Consumable Broken (Sellable)',
  };

  const totalRevenue = filtered.reduce((s: number, i: any) => s + Number(i.totalAmount ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center flex-wrap">
        <div className="flex gap-2 items-center ml-auto">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-xs px-3 py-2" />
          <span className="text-xs text-gray-400">to</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-xs px-3 py-2" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border">
          <p className="text-xs text-gray-500 mb-1">Invoices Issued</p>
          <p className="text-xl font-bold text-gray-800 dark:text-gray-100">{filtered.length}</p>
        </div>
        <div className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border">
          <p className="text-xs text-gray-500 mb-1">Total Invoiced Revenue</p>
          <p className="text-xl font-bold text-brand-green">KES {totalRevenue.toLocaleString()}</p>
        </div>
      </div>

      {/* Sales by Item */}
      {Object.keys(itemTotals).length > 0 && (
        <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-4">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Sales by Item Type</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-gray-400 border-b border-gray-100 dark:border-dark-border">
                <th className="text-left pb-2">Item</th>
                <th className="text-right pb-2">Qty (Eggs)</th>
                <th className="text-right pb-2">Trays</th>
                <th className="text-right pb-2">Revenue (KES)</th>
              </tr></thead>
              <tbody>
                {Object.entries(itemTotals).map(([type, data]) => (
                  <tr key={type} className="border-b border-gray-50 dark:border-gray-800">
                    <td className="py-2 text-gray-700 dark:text-gray-300">{EGG_LABEL[type] ?? type}</td>
                    <td className="py-2 text-right text-gray-600 dark:text-gray-400">{data.qty.toLocaleString()}</td>
                    <td className="py-2 text-right text-gray-600 dark:text-gray-400">{Math.floor(data.qty / 30)}</td>
                    <td className="py-2 text-right font-semibold text-gray-800 dark:text-gray-200">{data.revenue.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Invoice list with quantities */}
      {isLoading ? (
        <p className="text-sm text-gray-400 text-center py-4">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">No invoices in this period</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((inv: any) => (
            <div key={inv.id} className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{inv.customer?.name}</p>
                  <p className="text-xs text-gray-400">{inv.invoiceNumber} · {dayjs(inv.invoiceDate).format('D MMM YYYY')}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-brand-green">KES {Number(inv.totalAmount).toLocaleString()}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    inv.status === 'PAID' ? 'bg-green-100 text-green-700' :
                    inv.status === 'OVERDUE' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                    {inv.status}
                  </span>
                </div>
              </div>
              {(inv.salesOrder?.items ?? []).length > 0 && (
                <div className="grid grid-cols-3 gap-1 mt-2">
                  {(inv.salesOrder.items as any[]).map((item: any) => (
                    <div key={item.id} className="bg-gray-50 dark:bg-gray-800 rounded-lg px-2 py-1 text-xs">
                      <span className="text-gray-500">{EGG_LABEL[item.itemType] ?? item.itemType}</span>
                      <span className="font-semibold text-gray-700 dark:text-gray-300 ml-1">{item.quantityEggs ?? 0} eggs</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Export Tab (unchanged from original) ─────────────────────────────────────

function ExportTab() {
  const today      = dayjs().format('YYYY-MM-DD');
  const monthStart = dayjs().startOf('month').format('YYYY-MM-DD');
  const [from, setFrom] = useState(monthStart);
  const [to,   setTo]   = useState(today);
  const [type, setType] = useState<'all' | 'production' | 'poultry' | 'revenue' | 'summary'>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const handleExport = async () => {
    setLoading(true); setError(null);
    try {
      const p   = new URLSearchParams({ from, to, type });
      const res = await api.get(`/finance/export/excel?${p}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a   = document.createElement('a');
      a.href = url; a.download = `AWFMS_Finance_${from}_${to}.xlsx`; a.click();
      URL.revokeObjectURL(url);
    } catch { setError('Export failed. Please try again.'); }
    setLoading(false);
  };

  return (
    <div className="space-y-5 max-w-xl">
      <div className="bg-brand-green/5 border border-brand-green/20 rounded-2xl p-4">
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Excel Export</p>
        <p className="text-xs text-gray-500">Generates a formatted .xlsx — ready for QuickBooks or direct review.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Fld label="From Date">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inp} />
        </Fld>
        <Fld label="To Date">
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inp} />
        </Fld>
      </div>
      <div className="space-y-2">
        {([
          { id: 'all',        label: 'All Reports',          desc: 'Production + Poultry + Revenue + Summary' },
          { id: 'production', label: 'Production Cost Only', desc: 'Expenses and cost records' },
          { id: 'poultry',    label: 'Poultry Report Only',  desc: 'Egg counts, mortality, HDP' },
          { id: 'revenue',    label: 'Revenue & AR Only',    desc: 'Invoices, payments, outstanding' },
          { id: 'summary',    label: 'Summary Only',         desc: 'Executive KPI summary' },
        ] as const).map(rt => (
          <label key={rt.id} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${type === rt.id ? 'border-brand-green bg-brand-green/5' : 'border-gray-200 dark:border-dark-border'}`}>
            <input type="radio" name="reportType" value={rt.id} checked={type === rt.id} onChange={() => setType(rt.id as typeof type)} className="mt-0.5" />
            <div><p className="text-sm font-semibold">{rt.label}</p><p className="text-xs text-gray-500">{rt.desc}</p></div>
          </label>
        ))}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <button onClick={handleExport} disabled={loading}
        className="w-full bg-brand-green text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
        <FileText className="w-4 h-4" /> {loading ? 'Generating…' : 'Download Excel Report'}
      </button>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'expenses',     label: 'Expenses',      icon: DollarSign },
  { id: 'invoices',     label: 'Invoices',       icon: ShoppingCart },
  { id: 'pnl',          label: 'P&L',            icon: TrendingUp },
  { id: 'sales-report', label: 'Sales Report',   icon: BarChart2 },
  { id: 'export',       label: 'Export',         icon: FileText },
  { id: 'import',       label: 'Import',         icon: FileUp },
] as const;

type TabId = typeof TABS[number]['id'];

export function AccountantFinancePage() {
  const [activeTab, setActiveTab] = useState<TabId>('expenses');
  return (
    <div className="p-4 md:p-8 space-y-5 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Finance</h1>
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-2xl p-1 overflow-x-auto">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`flex-shrink-0 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-semibold transition-colors ${
              activeTab === id ? 'bg-white dark:bg-dark-card text-brand-green shadow-sm' : 'text-gray-500 dark:text-gray-400'
            }`}>
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>
      {activeTab === 'expenses'     && <ExpensesTab />}
      {activeTab === 'invoices'     && <InvoicesTab />}
      {activeTab === 'pnl'          && <PnLTab />}
      {activeTab === 'sales-report' && <SalesReportTab />}
      {activeTab === 'export'       && <ExportTab />}
      {activeTab === 'import'       && <ImportTab />}
    </div>
  );
}
