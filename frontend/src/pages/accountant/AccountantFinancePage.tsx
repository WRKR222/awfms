// src/pages/accountant/AccountantFinancePage.tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api } from '../../lib/api/client';
import {
  Plus, FileText, DollarSign, Trash2, ChevronDown, CheckCircle, Clock, Upload, FileUp, X,
} from 'lucide-react';
import dayjs from 'dayjs';

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useExpenses(from?: string, to?: string) {
  return useQuery({
    queryKey: ['expenses', from, to],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to)   params.set('to', to);
      const res = await api.get(`/finance/expenses?${params}`);
      return res.data as Array<{
        id: string; category: string; description: string;
        amount: string; expenseDate: string; vendorName?: string; receiptRef?: string;
      }>;
    },
  });
}

function useInvoices(status?: string) {
  return useQuery({
    queryKey: ['invoices', status],
    queryFn: async () => {
      const params = status ? `?status=${status}` : '';
      const res = await api.get(`/finance/invoices${params}`);
      return res.data as any[];
    },
    staleTime: 30_000,
  });
}

// ── Tab: Expense Categories ───────────────────────────────────────────────────


// ── Tab: Expenses ─────────────────────────────────────────────────────────────

function ExpensesTab() {
  const qc = useQueryClient();
  const cats: any[] = [];
  const today = dayjs().format('YYYY-MM-DD');
  const monthStart = dayjs().startOf('month').format('YYYY-MM-DD');
  const [from, setFrom] = useState(monthStart);
  const [to, setTo]     = useState(today);
  const { data: expenses = [], isLoading } = useExpenses(from, to);
  const { register, handleSubmit, reset } = useForm<any>();
  const [showForm, setShowForm] = useState(false);

  const create = useMutation({
    mutationFn: (data: any) => api.post('/finance/expenses', { ...data, amount: Number(data.amount) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); reset(); setShowForm(false); },
  });

  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-end">
        <button onClick={() => setShowForm(v => !v)} className="flex items-center gap-2 bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold">
          <Plus className="w-4 h-4" /> Log Expense
        </button>
        <div className="flex gap-2 items-center ml-auto">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-xs px-3 py-2" />
          <span className="text-xs text-gray-400">to</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-xs px-3 py-2" />
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit(d => create.mutate(d))} className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Category</label>
              <select {...register('category', { required: true })} className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2">
                <option value="">Select category</option>
                {cats.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Date</label>
              <input type="date" {...register('expenseDate', { required: true })} defaultValue={today} className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-500 mb-1 block">Description</label>
              <input {...register('description', { required: true })} placeholder="What was this expense for?" className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Amount (KES)</label>
              <input type="number" step="0.01" {...register('amount', { required: true, min: 0 })} className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Vendor Name</label>
              <input {...register('vendorName')} placeholder="Optional" className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Receipt Ref</label>
              <input {...register('receiptRef')} placeholder="Optional" className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={create.isPending} className="bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50">{create.isPending ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl text-sm text-gray-500 border border-gray-200 dark:border-dark-border">Cancel</button>
          </div>
        </form>
      )}

      {expenses.length > 0 && (
        <div className="bg-brand-green/10 dark:bg-brand-green/5 rounded-2xl px-4 py-3 flex justify-between items-center">
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
          {expenses.map(e => (
            <div key={e.id} className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border flex items-center gap-3">
              <DollarSign className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">{e.description}</p>
                  <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full flex-shrink-0">{e.category}</span>
                </div>
                <p className="text-xs text-gray-400">{dayjs(e.expenseDate).format('D MMM YYYY')} {e.vendorName ? `· ${e.vendorName}` : ''} {e.receiptRef ? `· Ref: ${e.receiptRef}` : ''}</p>
              </div>
              <p className="text-sm font-bold text-gray-700 dark:text-gray-300 flex-shrink-0">KES {Number(e.amount).toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tab: Invoices & AR ─────────────────────────────────────────────────────────

// Only PAID invoices are tracked — farm does not extend credit
const STATUS_PAID = { label: 'Paid', color: 'bg-green-100 text-green-700', icon: CheckCircle };

function InvoicesTab() {
  const { data: invoices = [], isLoading } = useInvoices('PAID');

  return (
    <div className="space-y-4">
      {/* Summary cards — paid only */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border">
          <p className="text-xs text-gray-500 mb-1">Total Invoices</p>
          <p className="text-xl font-bold text-gray-800 dark:text-gray-100">{invoices.length}</p>
        </div>
        <div className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border">
          <p className="text-xs text-gray-500 mb-1">Invoice Register</p>
          <p className="text-xl font-bold text-brand-green">Paid</p>
        </div>
      </div>

      {/* Invoice list */}
      {isLoading ? (
        <p className="text-sm text-gray-400 text-center py-4">Loading invoices…</p>
      ) : invoices.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">No invoices found</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {invoices.map((inv: any) => (
            <div key={inv.id} className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border shadow-sm p-4">
              <div className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-green-500" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-800 dark:text-gray-200 text-sm">{inv.customer?.name}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_PAID.color}`}>{STATUS_PAID.label}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{inv.invoiceNumber} · {dayjs(inv.dueDate).format('D MMM YYYY')}</p>
                  <p className="text-sm font-bold text-gray-800 dark:text-gray-200 mt-2">
                    KES {Number(inv.totalAmount).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'invoices',  label: 'Invoices & AR', icon: FileText },
  { id: 'expenses',  label: 'Expenses',      icon: DollarSign },
  { id: 'export',    label: 'Export',        icon: CheckCircle },
  { id: 'import',    label: 'Import',        icon: FileUp },
] as const;

type TabId = typeof TABS[number]['id'];


// ── Tab: Import Excel ──────────────────────────────────────────────────────────

function ImportTab() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [importType, setImportType] = useState('expenses');
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ success?: string; error?: string } | null>(null);

  const IMPORT_TYPES = [
    { id: 'expenses',   label: 'Expenses',     desc: 'Import expense records (.xlsx)' },
    { id: 'invoices',   label: 'Invoices',     desc: 'Import invoice data (.xlsx)' },
    { id: 'payments',   label: 'Payments',     desc: 'Import payment records (.xlsx)' },
  ];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      if (!f.name.endsWith('.xlsx') && !f.name.endsWith('.xls') && !f.name.endsWith('.csv')) {
        setResult({ error: 'Please upload an Excel (.xlsx, .xls) or CSV file.' });
        return;
      }
      setFile(f);
      setResult(null);
    }
  };

  const handleImport = async () => {
    if (!file) return;
    setUploading(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', importType);
      await api.post('/finance/import', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      setResult({ success: `Successfully imported ${importType} data from ${file.name}` });
      setFile(null);
    } catch (err: any) {
      setResult({ error: err?.response?.data?.message ?? 'Import failed. Please check your file format and try again.' });
    }
    setUploading(false);
  };

  return (
    <div className="space-y-5 max-w-xl">
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-2xl p-4">
        <p className="text-sm font-semibold text-blue-700 dark:text-blue-400 mb-1 flex items-center gap-2">
          <FileUp className="w-4 h-4" /> Import Excel / CSV
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Upload .xlsx, .xls, or .csv files to bulk-import financial data. Download the template first to ensure correct column format.
        </p>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-2 font-medium">Data Type to Import</label>
        <div className="space-y-2">
          {IMPORT_TYPES.map(it => (
            <label key={it.id} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${importType === it.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-dark-border hover:border-blue-300'}`}>
              <input type="radio" name="importType" value={it.id} checked={importType === it.id} onChange={() => setImportType(it.id)} className="mt-0.5 accent-blue-600" />
              <div><p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{it.label}</p><p className="text-xs text-gray-500">{it.desc}</p></div>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-2 font-medium">Upload File</label>
        <label className={`flex flex-col items-center justify-center border-2 border-dashed rounded-2xl p-8 cursor-pointer transition-colors ${file ? 'border-brand-green bg-brand-green/5' : 'border-gray-200 dark:border-dark-border hover:border-brand-green/50'}`}>
          <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={handleFileChange} />
          {file ? (
            <>
              <CheckCircle className="w-8 h-8 text-brand-green mb-2" />
              <p className="text-sm font-semibold text-brand-green">{file.name}</p>
              <p className="text-xs text-gray-500 mt-1">{(file.size / 1024).toFixed(1)} KB — Click to change</p>
            </>
          ) : (
            <>
              <Upload className="w-8 h-8 text-gray-300 dark:text-gray-600 mb-2" />
              <p className="text-sm font-semibold text-gray-600 dark:text-gray-400">Click to select file</p>
              <p className="text-xs text-gray-400 mt-1">Supports .xlsx, .xls, .csv</p>
            </>
          )}
        </label>
      </div>

      {result?.success && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl p-3 flex items-center gap-2 text-green-700 dark:text-green-400 text-sm">
          <CheckCircle className="w-4 h-4 shrink-0" /> {result.success}
        </div>
      )}
      {result?.error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl p-3 text-red-600 dark:text-red-400 text-sm">
          {result.error}
        </div>
      )}

      <button
        onClick={handleImport}
        disabled={!file || uploading}
        className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {uploading ? <><span className="animate-spin">⟳</span> Importing…</> : <><FileUp className="w-4 h-4" /> Import File</>}
      </button>

      <div className="border-t border-gray-200 dark:border-dark-border pt-4">
        <p className="text-xs text-gray-400 mb-2 font-medium">Download Template</p>
        <a
          href="/templates/finance-import-template.xlsx"
          className="inline-flex items-center gap-2 text-xs text-brand-green hover:underline font-medium"
        >
          <FileText className="w-3.5 h-3.5" /> finance-import-template.xlsx
        </a>
      </div>
    </div>
  );
}

// ── Tab: Export ───────────────────────────────────────────────────────────────

function ExportTab() {
  const today     = dayjs().format('YYYY-MM-DD');
  const monthStart = dayjs().startOf('month').format('YYYY-MM-DD');
  const [from, setFrom] = useState(monthStart);
  const [to,   setTo]   = useState(today);
  const [type, setType] = useState<'all' | 'production' | 'poultry' | 'revenue' | 'summary'>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const handleExport = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to, type });
      const res = await api.get(`/finance/export/excel?${params}`, { responseType: 'blob' });
      const url  = URL.createObjectURL(new Blob([res.data]));
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `AWFMS_Finance_${from}_${to}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Export failed. Please try again.');
    }
    setLoading(false);
  };

  const REPORT_TYPES = [
    { id: 'all',        label: 'All Reports',          desc: 'Production Cost + Poultry + Revenue + Summary' },
    { id: 'production', label: 'Production Cost Only',  desc: 'Expenses and cost records' },
    { id: 'poultry',    label: 'Poultry Report Only',   desc: 'Egg counts, mortality, HDP' },
    { id: 'revenue',    label: 'Revenue & AR Only',     desc: 'Invoices, payments, outstanding' },
    { id: 'summary',    label: 'Summary Only',          desc: 'Executive KPI summary sheet' },
  ] as const;

  return (
    <div className="space-y-5 max-w-xl">
      <div className="bg-brand-green/5 border border-brand-green/20 rounded-2xl p-4">
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Excel Export</p>
        <p className="text-xs text-gray-500">
          Generates a formatted .xlsx file with production costs, poultry performance, revenue, and AR — ready for QuickBooks or direct review.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1 font-medium">From Date</label>
          <input
            type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1 font-medium">To Date</label>
          <input
            type="date" value={to} onChange={e => setTo(e.target.value)}
            className="w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-2 font-medium">Report Type</label>
        <div className="space-y-2">
          {REPORT_TYPES.map(rt => (
            <label key={rt.id} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${type === rt.id ? 'border-brand-green bg-brand-green/5' : 'border-gray-200 dark:border-dark-border hover:border-brand-green/50'}`}>
              <input
                type="radio" name="reportType" value={rt.id}
                checked={type === rt.id}
                onChange={() => setType(rt.id as typeof type)}
                className="mt-0.5 accent-green-600"
              />
              <div>
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{rt.label}</p>
                <p className="text-xs text-gray-500">{rt.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <button
        onClick={handleExport}
        disabled={loading}
        className="w-full bg-brand-green text-white py-3 rounded-xl font-semibold text-sm hover:bg-brand-green/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {loading ? (
          <><span className="animate-spin">⟳</span> Generating…</>
        ) : (
          <><FileText className="w-4 h-4" /> Download Excel Report</>
        )}
      </button>
    </div>
  );
}

export function AccountantFinancePage() {
  const [activeTab, setActiveTab] = useState<TabId>('invoices');

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-5xl mx-auto">
      <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">Finance</h1>

      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-2xl p-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-colors ${
              activeTab === id
                ? 'bg-white dark:bg-dark-card text-brand-green shadow-sm'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {activeTab === 'invoices'  && <InvoicesTab />}
      {activeTab === 'expenses'  && <ExpensesTab />}
      {activeTab === 'export'    && <ExportTab />}
      {activeTab === 'import'    && <ImportTab />}
    </div>
  );
}
