// src/pages/owner/DataUploadPage.tsx
// Phase 7 Addendum B — Flexible multi-template historical data upload for Director

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import {
  Upload, FileText, ChevronRight, CheckCircle, AlertCircle,
  Trash2, Clock, Database, ArrowLeft, Save,
} from 'lucide-react';
import dayjs from 'dayjs';

// ── Types ─────────────────────────────────────────────────────────────────────

type Category = 'PRODUCTION' | 'SALES' | 'COSTS';

interface NamedTemplate {
  id: string;
  name: string;
  category: Category;
  columnMapping: Record<string, string | null>;
  createdAt: string;
}

interface UploadLog {
  id: string;
  uploadType: string;
  fileName: string;
  recordsImported: number;
  dateFrom: string | null;
  dateTo: string | null;
  uploadedAt: string;
  template: { name: string } | null;
}

// Target fields per category
const TARGET_FIELDS: Record<Category, { field: string; label: string; required: boolean }[]> = {
  PRODUCTION: [
    { field: 'date',        label: 'Date',          required: true  },
    { field: 'good_eggs',   label: 'Good Eggs',     required: true  },
    { field: 'bird_count',  label: 'Bird Count',    required: true  },
    { field: 'broken_eggs', label: 'Broken Eggs',   required: false },
    { field: 'mortality',   label: 'Mortality',     required: false },
    { field: 'batch_code',  label: 'Batch Code',    required: false },
    { field: 'notes',       label: 'Notes',         required: false },
  ],
  SALES: [
    { field: 'invoice_date',      label: 'Invoice Date',     required: true  },
    { field: 'invoice_number',    label: 'Invoice Number',   required: true  },
    { field: 'customer_name',     label: 'Customer Name',    required: true  },
    { field: 'quantity_trays',    label: 'Quantity (Trays)', required: true  },
    { field: 'total_kes',         label: 'Total (KES)',      required: true  },
    { field: 'unit_price_kes',    label: 'Unit Price (KES)', required: false },
    { field: 'payment_method',    label: 'Payment Method',   required: false },
    { field: 'payment_date',      label: 'Payment Date',     required: false },
    { field: 'payment_reference', label: 'Payment Reference',required: false },
  ],
  COSTS: [
    { field: 'date',           label: 'Date',             required: true  },
    { field: 'category',       label: 'Category',         required: true  },
    { field: 'description',    label: 'Description',      required: true  },
    { field: 'total_cost_kes', label: 'Total Cost (KES)', required: true  },
    { field: 'quantity',       label: 'Quantity',         required: false },
    { field: 'unit',           label: 'Unit',             required: false },
    { field: 'unit_cost_kes',  label: 'Unit Cost (KES)',  required: false },
    { field: 'supplier',       label: 'Supplier',         required: false },
    { field: 'batch_code',     label: 'Batch Code',       required: false },
  ],
};

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useTemplates(category?: Category) {
  return useQuery<NamedTemplate[]>({
    queryKey: ['upload-templates', category],
    queryFn: async () => {
      const p = category ? `?category=${category}` : '';
      const res = await api.get(`/data-upload/templates${p}`);
      return res.data;
    },
    staleTime: 60_000,
  });
}

function useHistory() {
  return useQuery<UploadLog[]>({
    queryKey: ['upload-history'],
    queryFn: async () => {
      const res = await api.get('/data-upload/history');
      return res.data;
    },
    staleTime: 30_000,
  });
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepBar({ step }: { step: number }) {
  const steps = ['Select Category', 'Upload & Map Columns', 'Preview', 'Import'];
  return (
    <div className="flex items-center gap-1 mb-6 flex-wrap">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-1">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${
            i < step  ? 'bg-brand-green/20 text-brand-green' :
            i === step ? 'bg-brand-green text-white' :
                         'bg-gray-100 dark:bg-dark-border text-gray-400'
          }`}>
            {i < step ? <CheckCircle className="w-3 h-3" /> : <span>{i + 1}</span>}
            {s}
          </div>
          {i < steps.length - 1 && <ChevronRight className="w-3 h-3 text-gray-300" />}
        </div>
      ))}
    </div>
  );
}

// ── Step 0: Category select ───────────────────────────────────────────────────

function CategorySelect({ onSelect }: { onSelect: (c: Category) => void }) {
  const cats: { id: Category; label: string; desc: string; icon: string }[] = [
    { id: 'PRODUCTION', label: 'Production',   desc: 'Egg counts, bird counts, mortality records', icon: '🥚' },
    { id: 'SALES',      label: 'Sales',        desc: 'Invoice data, quantities sold, payments',    icon: '📋' },
    { id: 'COSTS',      label: 'Costs / Stores', desc: 'Feed, medication, labour, equipment costs', icon: '📦' },
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {cats.map(c => (
        <button
          key={c.id}
          onClick={() => onSelect(c.id)}
          className="bg-white dark:bg-dark-card rounded-2xl p-5 border border-gray-100 dark:border-dark-border hover:border-brand-green/50 hover:shadow-md text-left transition-all"
        >
          <div className="text-2xl mb-3">{c.icon}</div>
          <p className="font-bold text-gray-800 dark:text-gray-100 mb-1">{c.label}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{c.desc}</p>
        </button>
      ))}
    </div>
  );
}

// ── Step 1: Upload + Column Mapper ────────────────────────────────────────────

interface MapperProps {
  category: Category;
  onMapped: (mapping: Record<string, string | null>, headers: string[], file: File, totalRows: number, suggestedTemplate: NamedTemplate | null) => void;
}

function ColumnMapper({ category, onMapped }: MapperProps) {
  const qc = useQueryClient();
  const { data: templates = [] } = useTemplates(category);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [detecting, setDetecting] = useState(false);
  const [suggestedTemplate, setSuggestedTemplate] = useState<NamedTemplate | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);

  const saveTemplate = useMutation({
    mutationFn: (data: { name: string; category: Category; columnMapping: Record<string, string | null> }) =>
      api.post('/data-upload/templates', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['upload-templates'] });
      setShowSaveTemplate(false);
      setTemplateName('');
    },
  });

  const handleFile = async (f: File) => {
    setFile(f);
    setDetecting(true);
    try {
      const form = new FormData();
      form.append('file', f);
      form.append('category', category);
      const res = await api.post('/data-upload/detect-headers', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setHeaders(res.data.headers ?? []);
      setTotalRows(res.data.totalRows ?? 0);

      if (res.data.suggestedTemplate) {
        setSuggestedTemplate(res.data.suggestedTemplate);
        setMapping(res.data.suggestedTemplate.columnMapping ?? {});
      } else {
        setSuggestedTemplate(null);
        // Auto-match by common names
        const autoMap: Record<string, string | null> = {};
        TARGET_FIELDS[category].forEach(tf => {
          const match = res.data.headers.find((h: string) =>
            h.toLowerCase().replace(/[\s_\-]/g, '') ===
            tf.field.replace(/_/g, ''),
          );
          autoMap[tf.field] = match ?? null;
        });
        setMapping(autoMap);
      }
    } catch {
      // ignore
    }
    setDetecting(false);
  };

  const applyTemplate = (t: NamedTemplate) => {
    setMapping(t.columnMapping);
    setSuggestedTemplate(t);
  };

  const requiredMapped = TARGET_FIELDS[category]
    .filter(f => f.required)
    .every(f => !!mapping[f.field]);

  return (
    <div className="space-y-5">
      {/* Saved templates */}
      {templates.length > 0 && (
        <div className="bg-brand-green/5 rounded-2xl p-4 border border-brand-green/20">
          <p className="text-xs font-bold text-brand-green uppercase tracking-widest mb-3">Saved Templates</p>
          <div className="flex flex-wrap gap-2">
            {templates.map(t => (
              <button
                key={t.id}
                onClick={() => applyTemplate(t)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                  suggestedTemplate?.id === t.id
                    ? 'bg-brand-green text-white border-brand-green'
                    : 'bg-white dark:bg-dark-card text-gray-700 dark:text-gray-300 border-gray-200 dark:border-dark-border hover:border-brand-green'
                }`}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* File upload */}
      <div
        className="border-2 border-dashed border-gray-200 dark:border-dark-border rounded-2xl p-8 text-center cursor-pointer hover:border-brand-green/50 transition-colors"
        onClick={() => fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
      >
        <input
          ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        <Upload className="w-8 h-8 text-gray-400 mx-auto mb-3" />
        {file ? (
          <div>
            <p className="font-semibold text-gray-700 dark:text-gray-300">{file.name}</p>
            <p className="text-xs text-gray-500 mt-1">{totalRows} rows detected · Click to change</p>
          </div>
        ) : (
          <div>
            <p className="font-semibold text-gray-600 dark:text-gray-400">Drop your Excel or CSV file here</p>
            <p className="text-xs text-gray-400 mt-1">Supports .xlsx, .xls, .csv — any column layout</p>
          </div>
        )}
        {detecting && <p className="text-xs text-brand-green mt-2 animate-pulse">Detecting columns…</p>}
      </div>

      {/* Column mapper */}
      {headers.length > 0 && (
        <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-bold text-gray-800 dark:text-gray-100">Map Columns</p>
            {suggestedTemplate && (
              <span className="text-xs px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full font-medium">
                ✓ Template applied: {suggestedTemplate.name}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mb-4">
            For each AWFMS field, select the matching column from your uploaded file.
            Required fields are marked with *.
          </p>

          <div className="space-y-2">
            {TARGET_FIELDS[category].map(tf => (
              <div key={tf.field} className="flex items-center gap-3">
                <div className="w-40 flex-shrink-0">
                  <span className={`text-xs font-semibold ${tf.required ? 'text-gray-800 dark:text-gray-200' : 'text-gray-500'}`}>
                    {tf.label}{tf.required && <span className="text-red-500 ml-0.5">*</span>}
                  </span>
                </div>
                <select
                  value={mapping[tf.field] ?? ''}
                  onChange={e => setMapping(prev => ({ ...prev, [tf.field]: e.target.value || null }))}
                  className="flex-1 rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-1.5 text-gray-700 dark:text-gray-300"
                >
                  <option value="">— not mapped{tf.required ? ' (required)' : ' (optional)'} —</option>
                  {headers.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
                {mapping[tf.field] && (
                  <CheckCircle className="w-4 h-4 text-brand-green flex-shrink-0" />
                )}
                {!mapping[tf.field] && tf.required && (
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                )}
              </div>
            ))}
          </div>

          {/* Save template */}
          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-dark-border">
            {showSaveTemplate ? (
              <div className="flex gap-2">
                <input
                  value={templateName}
                  onChange={e => setTemplateName(e.target.value)}
                  placeholder="Template name (e.g. Emali Daily Sales 2025)"
                  className="flex-1 rounded-xl border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 text-sm px-3 py-1.5"
                />
                <button
                  onClick={() => saveTemplate.mutate({ name: templateName, category, columnMapping: mapping })}
                  disabled={!templateName || saveTemplate.isPending}
                  className="px-4 py-1.5 bg-brand-green text-white rounded-xl text-xs font-semibold disabled:opacity-50"
                >
                  {saveTemplate.isPending ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={() => setShowSaveTemplate(false)}
                  className="px-3 py-1.5 text-xs text-gray-500 border border-gray-200 dark:border-dark-border rounded-xl"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowSaveTemplate(true)}
                className="flex items-center gap-1.5 text-xs text-brand-green hover:underline"
              >
                <Save className="w-3 h-3" /> Save this column mapping as a template
              </button>
            )}
          </div>
        </div>
      )}

      {/* Proceed button */}
      {file && headers.length > 0 && (
        <button
          disabled={!requiredMapped}
          onClick={() => onMapped(mapping, headers, file, totalRows, suggestedTemplate)}
          className="w-full bg-brand-green text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-40 hover:bg-brand-green/90 transition-colors"
        >
          {requiredMapped ? 'Preview Data →' : 'Map all required fields to continue'}
        </button>
      )}
    </div>
  );
}

// ── Step 2: Preview ───────────────────────────────────────────────────────────

interface PreviewStepProps {
  category: Category;
  file: File;
  mapping: Record<string, string | null>;
  totalRows: number;
  onConfirm: () => void;
  onBack: () => void;
  isImporting: boolean;
}

function PreviewStep({ category, file, mapping, totalRows, onConfirm, onBack, isImporting }: PreviewStepProps) {
  const { data: preview, isLoading } = useQuery({
    queryKey: ['upload-preview', file.name, category],
    queryFn: async () => {
      const form = new FormData();
      form.append('file', file);
      form.append('category', category);
      form.append('columnMapping', JSON.stringify(mapping));
      const res = await api.post('/data-upload/preview', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data;
    },
    staleTime: Infinity,
  });

  const fields = TARGET_FIELDS[category].filter(f => mapping[f.field]);

  return (
    <div className="space-y-4">
      <div className="bg-brand-green/5 border border-brand-green/20 rounded-2xl p-4">
        <p className="text-sm font-bold text-brand-green mb-1">
          Ready to import {totalRows.toLocaleString()} rows from "{file.name}"
        </p>
        <p className="text-xs text-gray-500">Showing first 5 rows preview. Invalid rows will be skipped automatically.</p>
      </div>

      {isLoading ? (
        <div className="h-40 bg-gray-100 dark:bg-dark-border rounded-2xl animate-pulse" />
      ) : preview?.previewRows?.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border border-gray-100 dark:border-dark-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 dark:bg-dark-border">
                {fields.map(f => (
                  <th key={f.field} className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-400">
                    {f.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.previewRows.map((row: any, i: number) => (
                <tr key={i} className="border-t border-gray-50 dark:border-dark-border">
                  {fields.map(f => (
                    <td key={f.field} className="px-3 py-2 text-gray-700 dark:text-gray-300">
                      {String(row[f.field] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-8 text-gray-400 text-sm">No preview data available</div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-dark-border text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <button
          onClick={onConfirm}
          disabled={isImporting}
          className="flex-1 bg-brand-green text-white py-2.5 rounded-xl font-semibold text-sm disabled:opacity-50 hover:bg-brand-green/90 transition-colors"
        >
          {isImporting ? 'Importing…' : `✓ Confirm & Import ${totalRows.toLocaleString()} Rows`}
        </button>
      </div>
    </div>
  );
}

// ── Import Success ────────────────────────────────────────────────────────────

function ImportSuccess({ result, onNew }: { result: any; onNew: () => void }) {
  return (
    <div className="text-center py-12 space-y-4">
      <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
        <CheckCircle className="w-8 h-8 text-brand-green" />
      </div>
      <div>
        <p className="text-xl font-bold text-gray-800 dark:text-gray-100">Import Successful!</p>
        <p className="text-sm text-gray-500 mt-1">
          {result.recordsImported.toLocaleString()} records imported
          {result.dateFrom && ` · ${dayjs(result.dateFrom).format('D MMM YYYY')} – ${dayjs(result.dateTo).format('D MMM YYYY')}`}
        </p>
      </div>
      <button
        onClick={onNew}
        className="bg-brand-green text-white px-6 py-2.5 rounded-xl font-semibold text-sm hover:bg-brand-green/90 transition-colors"
      >
        Import Another File
      </button>
    </div>
  );
}

// ── History Tab ───────────────────────────────────────────────────────────────

function HistoryTab() {
  const { data: logs = [], isLoading } = useHistory();
  const CATEGORY_COLORS: Record<string, string> = {
    PRODUCTION: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    SALES:      'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    COSTS:      'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  };

  return (
    <div className="space-y-3">
      {isLoading ? (
        [1,2,3].map(i => <div key={i} className="h-16 bg-gray-100 dark:bg-dark-border rounded-2xl animate-pulse" />)
      ) : logs.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Database className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No uploads yet</p>
        </div>
      ) : logs.map(log => (
        <div key={log.id} className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-4 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${CATEGORY_COLORS[log.uploadType] ?? 'bg-gray-100 text-gray-600'}`}>
                {log.uploadType}
              </span>
              {log.template && (
                <span className="text-xs text-gray-400">· {log.template.name}</span>
              )}
            </div>
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">{log.fileName}</p>
            <p className="text-xs text-gray-500">
              {dayjs(log.uploadedAt).format('D MMM YYYY HH:mm')}
              {log.dateFrom && ` · Data: ${dayjs(log.dateFrom).format('D MMM YY')}–${dayjs(log.dateTo).format('D MMM YY')}`}
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-lg font-bold text-brand-green">{log.recordsImported.toLocaleString()}</p>
            <p className="text-xs text-gray-400">records</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function DataUploadPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'upload' | 'history'>('upload');
  const [step, setStep] = useState(0);
  const [category, setCategory] = useState<Category | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [file, setFile] = useState<File | null>(null);
  const [totalRows, setTotalRows] = useState(0);
  const [suggestedTemplate, setSuggestedTemplate] = useState<NamedTemplate | null>(null);
  const [importResult, setImportResult] = useState<any>(null);
  const [isImporting, setIsImporting] = useState(false);

  const reset = () => {
    setStep(0);
    setCategory(null);
    setMapping({});
    setFile(null);
    setTotalRows(0);
    setSuggestedTemplate(null);
    setImportResult(null);
  };

  const handleMapped = (m: Record<string, string | null>, _h: string[], f: File, rows: number, tmpl: NamedTemplate | null) => {
    setMapping(m);
    setFile(f);
    setTotalRows(rows);
    setSuggestedTemplate(tmpl);
    setStep(2);
  };

  const handleImport = async () => {
    if (!file || !category) return;
    setIsImporting(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('category', category);
      form.append('columnMapping', JSON.stringify(mapping));
      if (suggestedTemplate) form.append('templateId', suggestedTemplate.id);
      const res = await api.post('/data-upload/import', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportResult(res.data);
      qc.invalidateQueries({ queryKey: ['upload-history'] });
      setStep(3);
    } catch (err: any) {
      alert('Import failed: ' + (err?.response?.data?.message ?? 'Unknown error'));
    }
    setIsImporting(false);
  };

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Historical Data Upload</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Import historical production, sales, and cost records from any spreadsheet format
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-100 dark:bg-dark-border rounded-xl p-1 w-fit">
        {(['upload', 'history'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors capitalize ${
              tab === t
                ? 'bg-white dark:bg-dark-card text-gray-800 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {t === 'upload' ? (
              <span className="flex items-center gap-1.5"><Upload className="w-3.5 h-3.5" /> Upload</span>
            ) : (
              <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> History</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'history' ? (
        <HistoryTab />
      ) : (
        <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-5 shadow-sm">
          <StepBar step={step} />

          {step === 0 && (
            <CategorySelect onSelect={c => { setCategory(c); setStep(1); }} />
          )}

          {step === 1 && category && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <button onClick={() => setStep(0)} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                  <ArrowLeft className="w-3 h-3" /> Back
                </button>
                <span className="text-xs text-gray-400">·</span>
                <span className="text-xs font-semibold text-brand-green uppercase tracking-widest">{category}</span>
              </div>
              <ColumnMapper category={category} onMapped={handleMapped} />
            </div>
          )}

          {step === 2 && category && file && (
            <PreviewStep
              category={category}
              file={file}
              mapping={mapping}
              totalRows={totalRows}
              onConfirm={handleImport}
              onBack={() => setStep(1)}
              isImporting={isImporting}
            />
          )}

          {step === 3 && importResult && (
            <ImportSuccess result={importResult} onNew={reset} />
          )}
        </div>
      )}
    </div>
  );
}
