// src/pages/store/StoreIssuancePage.tsx
// Phase 7 Addendum B — Stores Issuance Form (digitises the Anza manual Excel template)

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api } from '../../lib/api/client';
import {
  Plus, Trash2, ChevronDown, ChevronUp, FileText,
  Package, BarChart2, Search, Download,
} from 'lucide-react';
import dayjs from 'dayjs';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Issuance {
  id: string;
  issuanceDate: string;
  particulars: string;
  balanceBroughtDown: string;
  quantitiesIn: string;
  unitMeasure: string | null;
  total: string;
  receivedByName: string | null;
  supplierName: string | null;
  quantityIssued: string;
  issuedToName: string | null;
  department: string | null;
  issuedByName: string | null;
  balanceCarriedDown: string;
  notes: string | null;
  createdAt: string;
}

type FormData = {
  issuanceDate: string;
  particulars: string;
  balanceBroughtDown: number;
  quantitiesIn: number;
  unitMeasure: string;
  receivedByName: string;
  supplierName: string;
  quantityIssued: number;
  issuedToName: string;
  department: string;
  issuedByName: string;
  notes: string;
};

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useIssuances(from?: string, to?: string, particulars?: string) {
  return useQuery<Issuance[]>({
    queryKey: ['store-issuances', from, to, particulars],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (from) p.set('from', from);
      if (to)   p.set('to', to);
      if (particulars) p.set('particulars', particulars);
      const res = await api.get(`/store/issuance?${p}`);
      return res.data;
    },
    staleTime: 30_000,
  });
}

function useSummary(from?: string, to?: string) {
  return useQuery({
    queryKey: ['store-issuance-summary', from, to],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (from) p.set('from', from);
      if (to)   p.set('to', to);
      const res = await api.get(`/store/issuance/summary?${p}`);
      return res.data as {
        totalRecords: number;
        totalQuantitiesIn: number;
        totalQuantityIssued: number;
        byDepartment: Record<string, number>;
      };
    },
    staleTime: 60_000,
  });
}

// ── Form ──────────────────────────────────────────────────────────────────────

function IssuanceForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, watch, reset, formState: { errors } } = useForm<FormData>({
    defaultValues: {
      issuanceDate: dayjs().format('YYYY-MM-DD'),
      balanceBroughtDown: 0,
      quantitiesIn: 0,
      quantityIssued: 0,
    },
  });

  const bbd    = Number(watch('balanceBroughtDown') ?? 0);
  const qtyIn  = Number(watch('quantitiesIn') ?? 0);
  const qtyIss = Number(watch('quantityIssued') ?? 0);
  const total  = bbd + qtyIn;
  const bcd    = total - qtyIss;

  const create = useMutation({
    mutationFn: (data: FormData) =>
      api.post('/store/issuance', {
        ...data,
        balanceBroughtDown: Number(data.balanceBroughtDown),
        quantitiesIn:       Number(data.quantitiesIn),
        quantityIssued:     Number(data.quantityIssued),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['store-issuances'] });
      qc.invalidateQueries({ queryKey: ['store-issuance-summary'] });
      reset();
      onClose();
    },
  });

  const inputCls = 'w-full rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green/50';
  const labelCls = 'block text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium';

  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-5 shadow-sm">
      {/* Header matches the physical form title */}
      <div className="mb-5 pb-4 border-b border-gray-100 dark:border-dark-border">
        <div className="text-center">
          <p className="text-xs font-bold text-brand-green tracking-widest uppercase">Anza Whole Foods</p>
          <h3 className="text-base font-bold text-gray-800 dark:text-gray-100 mt-0.5">Stores Issuance Form</h3>
        </div>
      </div>

      <form onSubmit={handleSubmit(d => create.mutate(d))} className="space-y-5">

        {/* Row 1: Date + Particulars */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Date *</label>
            <input type="date" {...register('issuanceDate', { required: true })} className={inputCls} />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Particulars (Item Description) *</label>
            <input
              {...register('particulars', { required: true })}
              placeholder="e.g. Layer Mash, Medication, Equipment…"
              className={inputCls}
            />
            {errors.particulars && <p className="text-xs text-red-500 mt-1">Required</p>}
          </div>
        </div>

        {/* Row 2: Receipts section */}
        <div className="bg-gray-50 dark:bg-gray-900/30 rounded-xl p-4">
          <p className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-widest mb-3">
            Receipts / Stock In
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className={labelCls}>Balance B/d</label>
              <input
                type="number" step="0.001" min="0"
                {...register('balanceBroughtDown')}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Quantities In</label>
              <input
                type="number" step="0.001" min="0"
                {...register('quantitiesIn')}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Unit Measure</label>
              <input
                {...register('unitMeasure')}
                placeholder="kg / bags / litres…"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Total (auto-calculated)</label>
              <div className="w-full rounded-xl border border-brand-green/30 bg-brand-green/5 text-sm px-3 py-2 font-bold text-brand-green">
                {total.toLocaleString(undefined, { maximumFractionDigits: 3 })}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <div>
              <label className={labelCls}>Received By (Name)</label>
              <input {...register('receivedByName')} placeholder="Name of person receiving stock" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Supplier Name</label>
              <input {...register('supplierName')} placeholder="e.g. Jumuia Farm Feeds" className={inputCls} />
            </div>
          </div>
        </div>

        {/* Row 3: Issuance section */}
        <div className="bg-blue-50 dark:bg-blue-900/10 rounded-xl p-4">
          <p className="text-xs font-bold text-blue-700 dark:text-blue-400 uppercase tracking-widest mb-3">
            Issuance / Stock Out
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className={labelCls}>Quantity Issued</label>
              <input
                type="number" step="0.001" min="0"
                {...register('quantityIssued')}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Issued To (Name)</label>
              <input {...register('issuedToName')} placeholder="Recipient name" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Department / Project</label>
              <input {...register('department')} placeholder="e.g. Block 1, Brooding…" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Issued By (Name)</label>
              <input {...register('issuedByName')} placeholder="Store keeper name" className={inputCls} />
            </div>
          </div>
        </div>

        {/* Row 4: Balance C/d + Notes */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Balance C/d (auto-calculated)</label>
            <div className={`w-full rounded-xl border text-sm px-3 py-2 font-bold ${bcd < 0 ? 'border-red-300 bg-red-50 text-red-600' : 'border-brand-green/30 bg-brand-green/5 text-brand-green'}`}>
              {bcd.toLocaleString(undefined, { maximumFractionDigits: 3 })}
              {bcd < 0 && <span className="text-xs font-normal ml-1">(deficit)</span>}
            </div>
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Notes</label>
            <input {...register('notes')} placeholder="Optional notes or batch reference" className={inputCls} />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            disabled={create.isPending}
            className="flex-1 bg-brand-green text-white py-2.5 rounded-xl font-semibold text-sm disabled:opacity-50 hover:bg-brand-green/90 transition-colors"
          >
            {create.isPending ? 'Saving…' : '✓ Save Issuance Record'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-sm text-gray-500 border border-gray-200 dark:border-dark-border hover:bg-gray-50 dark:hover:bg-dark-border transition-colors"
          >
            Cancel
          </button>
        </div>

        {create.isError && (
          <p className="text-xs text-red-500">Failed to save. Please try again.</p>
        )}
      </form>
    </div>
  );
}

// ── Summary Cards ─────────────────────────────────────────────────────────────

function SummaryCards({ from, to }: { from?: string; to?: string }) {
  const { data: summary } = useSummary(from, to);
  if (!summary) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Total Records</p>
        <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{summary.totalRecords}</p>
      </div>
      <div className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Total Received</p>
        <p className="text-2xl font-bold text-brand-green">
          {summary.totalQuantitiesIn.toLocaleString(undefined, { maximumFractionDigits: 1 })}
        </p>
      </div>
      <div className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Total Issued</p>
        <p className="text-2xl font-bold text-blue-600">
          {summary.totalQuantityIssued.toLocaleString(undefined, { maximumFractionDigits: 1 })}
        </p>
      </div>
      <div className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Balance (net)</p>
        <p className="text-2xl font-bold text-amber-600">
          {(summary.totalQuantitiesIn - summary.totalQuantityIssued).toLocaleString(undefined, { maximumFractionDigits: 1 })}
        </p>
      </div>
    </div>
  );
}

// ── Record Row ────────────────────────────────────────────────────────────────

function RecordRow({ record, onDelete }: { record: Issuance; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);

  const bcd = Number(record.balanceCarriedDown);

  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border overflow-hidden">
      {/* Summary row */}
      <button
        className="w-full flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-dark-border transition-colors text-left"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-2 h-2 rounded-full bg-brand-green flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">{record.particulars}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {dayjs(record.issuanceDate).format('D MMM YYYY')}
              {record.department && ` · ${record.department}`}
              {record.unitMeasure && ` · ${record.unitMeasure}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 flex-shrink-0 ml-3">
          <div className="text-right">
            <p className="text-xs text-gray-400">Issued</p>
            <p className="text-sm font-bold text-blue-600">
              {Number(record.quantityIssued).toLocaleString(undefined, { maximumFractionDigits: 3 })}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">Balance C/d</p>
            <p className={`text-sm font-bold ${bcd < 0 ? 'text-red-500' : 'text-brand-green'}`}>
              {bcd.toLocaleString(undefined, { maximumFractionDigits: 3 })}
            </p>
          </div>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {/* Expanded detail — mirrors the printed form layout */}
      {expanded && (
        <div className="border-t border-gray-100 dark:border-dark-border p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mb-4">
            <div>
              <p className="text-gray-400 mb-0.5">Balance B/d</p>
              <p className="font-semibold text-gray-800 dark:text-gray-200">
                {Number(record.balanceBroughtDown).toLocaleString(undefined, { maximumFractionDigits: 3 })} {record.unitMeasure ?? ''}
              </p>
            </div>
            <div>
              <p className="text-gray-400 mb-0.5">Quantities In</p>
              <p className="font-semibold text-gray-800 dark:text-gray-200">
                {Number(record.quantitiesIn).toLocaleString(undefined, { maximumFractionDigits: 3 })} {record.unitMeasure ?? ''}
              </p>
            </div>
            <div>
              <p className="text-gray-400 mb-0.5">Total</p>
              <p className="font-semibold text-brand-green">
                {Number(record.total).toLocaleString(undefined, { maximumFractionDigits: 3 })} {record.unitMeasure ?? ''}
              </p>
            </div>
            <div>
              <p className="text-gray-400 mb-0.5">Received By</p>
              <p className="font-semibold text-gray-800 dark:text-gray-200">{record.receivedByName ?? '—'}</p>
            </div>
            <div>
              <p className="text-gray-400 mb-0.5">Supplier</p>
              <p className="font-semibold text-gray-800 dark:text-gray-200">{record.supplierName ?? '—'}</p>
            </div>
            <div>
              <p className="text-gray-400 mb-0.5">Quantity Issued</p>
              <p className="font-semibold text-blue-600">
                {Number(record.quantityIssued).toLocaleString(undefined, { maximumFractionDigits: 3 })} {record.unitMeasure ?? ''}
              </p>
            </div>
            <div>
              <p className="text-gray-400 mb-0.5">Issued To</p>
              <p className="font-semibold text-gray-800 dark:text-gray-200">{record.issuedToName ?? '—'}</p>
            </div>
            <div>
              <p className="text-gray-400 mb-0.5">Issued By</p>
              <p className="font-semibold text-gray-800 dark:text-gray-200">{record.issuedByName ?? '—'}</p>
            </div>
            <div>
              <p className="text-gray-400 mb-0.5">Department / Project</p>
              <p className="font-semibold text-gray-800 dark:text-gray-200">{record.department ?? '—'}</p>
            </div>
            <div>
              <p className="text-gray-400 mb-0.5">Balance C/d</p>
              <p className={`font-bold ${bcd < 0 ? 'text-red-500' : 'text-brand-green'}`}>
                {bcd.toLocaleString(undefined, { maximumFractionDigits: 3 })} {record.unitMeasure ?? ''}
              </p>
            </div>
            {record.notes && (
              <div className="col-span-2 md:col-span-4">
                <p className="text-gray-400 mb-0.5">Notes</p>
                <p className="text-gray-600 dark:text-gray-400 italic">{record.notes}</p>
              </div>
            )}
          </div>
          <div className="flex justify-end">
            <button
              onClick={onDelete}
              className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 px-3 py-1.5 rounded-lg border border-red-200 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="w-3 h-3" /> Delete Record
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function StoreIssuancePage() {
  const qc = useQueryClient();
  const [showForm, setShowForm]   = useState(false);
  const [search, setSearch]       = useState('');
  const [fromDate, setFromDate]   = useState(dayjs().startOf('month').format('YYYY-MM-DD'));
  const [toDate, setToDate]       = useState(dayjs().format('YYYY-MM-DD'));

  const { data: records = [], isLoading } = useIssuances(fromDate, toDate, search || undefined);

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/store/issuance/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['store-issuances'] });
      qc.invalidateQueries({ queryKey: ['store-issuance-summary'] });
    },
  });

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Stores Issuance</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Track all stock receipts and issuances</p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 bg-brand-green text-white px-4 py-2.5 rounded-xl font-semibold text-sm hover:bg-brand-green/90 transition-colors"
        >
          <Plus className="w-4 h-4" /> New Issuance
        </button>
      </div>

      {/* Form */}
      {showForm && <IssuanceForm onClose={() => setShowForm(false)} />}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex items-center gap-2 bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2">
          <Search className="w-3.5 h-3.5 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search particulars…"
            className="text-sm bg-transparent outline-none w-40 text-gray-700 dark:text-gray-300 placeholder-gray-400"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">From</label>
          <input
            type="date" value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            className="text-sm rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card px-3 py-2 text-gray-700 dark:text-gray-300"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">To</label>
          <input
            type="date" value={toDate}
            onChange={e => setToDate(e.target.value)}
            className="text-sm rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card px-3 py-2 text-gray-700 dark:text-gray-300"
          />
        </div>
      </div>

      {/* Summary Cards */}
      <SummaryCards from={fromDate} to={toDate} />

      {/* Records List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => (
            <div key={i} className="h-20 bg-gray-100 dark:bg-dark-border rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : records.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Package className="w-12 h-12 text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">No issuance records found</p>
          <p className="text-sm text-gray-400 mt-1">
            {search ? 'Try a different search term' : 'Create your first issuance record above'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {records.map(r => (
            <RecordRow
              key={r.id}
              record={r}
              onDelete={() => {
                if (window.confirm('Delete this issuance record?')) {
                  remove.mutate(r.id);
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
