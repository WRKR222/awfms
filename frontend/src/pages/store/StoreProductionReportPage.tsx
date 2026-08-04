// src/pages/store/StoreProductionReportPage.tsx
// Store uploads a day-by-day production report for a batch. Anything that
// doesn't conflict with what's already recorded is applied immediately;
// only genuine conflicts wait on the Director. Re-uploading replaces the
// current report for that batch.

import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import {
  Upload, FileSpreadsheet, CheckCircle, AlertTriangle, ArrowLeft,
  RefreshCw, Clock, XCircle, Download,
} from 'lucide-react';
import dayjs from '../../lib/dayjs';

interface Batch { id: string; batchCode: string; }

interface Discrepancy {
  id: string;
  rowDate: string;
  field: string;
  discrepancyType: string;
  locationRef: string | null;
  systemValue: string | null;
  reportValue: string | null;
  resolved: boolean;
  resolution: string | null;
}

interface Report {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  discrepancyCount: number;
  autofillCount: number;
  matchedCount: number;
  resubmissionCount: number;
  uploadedAt: string;
  rejectionReason: string | null;
  discrepancies: Discrepancy[];
  uploadedBy?: { fullName: string };
}

function useBatches() {
  return useQuery<Batch[]>({
    queryKey: ['batches-active'],
    queryFn: async () => (await api.get('/flock/batches', { params: { isActive: true } })).data,
    staleTime: 60_000,
  });
}

function useCurrentReport(batchId: string | null) {
  return useQuery<Report | null>({
    queryKey: ['production-report', batchId],
    queryFn: async () => {
      if (!batchId) return null;
      try {
        return (await api.get(`/store/production-reports/${batchId}`)).data;
      } catch (err: any) {
        if (err?.response?.status === 404) return null;
        throw err;
      }
    },
    enabled: !!batchId,
  });
}

const STATUS_STYLE: Record<string, string> = {
  APPROVED: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  PENDING:  'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  REJECTED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

function StatusBadge({ status }: { status: string }) {
  const icon = status === 'APPROVED' ? <CheckCircle className="w-3.5 h-3.5" /> :
               status === 'PENDING'  ? <Clock className="w-3.5 h-3.5" /> :
                                       <XCircle className="w-3.5 h-3.5" />;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_STYLE[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {icon}{status}
    </span>
  );
}

function CurrentReportPanel({ batchId }: { batchId: string }) {
  const { data: report, isLoading } = useCurrentReport(batchId);

  if (isLoading) return <div className="h-24 bg-gray-100 dark:bg-dark-border rounded-2xl animate-pulse" />;
  if (!report) return (
    <div className="text-center py-8 text-gray-400 text-sm">
      No production report has been uploaded for this batch yet.
    </div>
  );

  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Current report</p>
          <p className="text-xs text-gray-500">
            Uploaded {dayjs(report.uploadedAt).format('D MMM YYYY, HH:mm')}
            {report.uploadedBy && ` by ${report.uploadedBy.fullName}`}
            {report.resubmissionCount > 0 && ` · re-uploaded ${report.resubmissionCount}×`}
          </p>
        </div>
        <StatusBadge status={report.status} />
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="bg-gray-50 dark:bg-dark-bg rounded-xl py-3">
          <p className="text-lg font-bold text-brand-green">{report.matchedCount}</p>
          <p className="text-[11px] text-gray-500">Matched</p>
        </div>
        <div className="bg-gray-50 dark:bg-dark-bg rounded-xl py-3">
          <p className="text-lg font-bold text-blue-500">{report.autofillCount}</p>
          <p className="text-[11px] text-gray-500">Auto-filled</p>
        </div>
        <div className="bg-gray-50 dark:bg-dark-bg rounded-xl py-3">
          <p className="text-lg font-bold text-amber-500">{report.discrepancyCount}</p>
          <p className="text-[11px] text-gray-500">Discrepancies</p>
        </div>
      </div>

      {report.status === 'REJECTED' && report.rejectionReason && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 rounded-xl p-3 text-sm text-red-700 dark:text-red-400">
          <span className="font-semibold">Rejected: </span>{report.rejectionReason}
          <p className="text-xs mt-1 text-red-500">Correct the issue and re-upload below.</p>
        </div>
      )}

      {report.discrepancies.filter(d => !d.resolved).length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Open discrepancies — awaiting Director review</p>
          {report.discrepancies.filter(d => !d.resolved).map(d => (
            <div key={d.id} className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30 rounded-xl p-3 text-sm">
              <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium text-gray-800 dark:text-gray-200">
                  {d.field} — {dayjs(d.rowDate).format('D MMM YYYY')}{d.locationRef ? ` (${d.locationRef})` : ''}
                </p>
                <p className="text-xs text-gray-500">System: {d.systemValue ?? '—'} · Report: {d.reportValue ?? '—'}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <a
        href={`${api.defaults.baseURL}/store/production-reports/${batchId}/export`}
        target="_blank" rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-green hover:underline"
      >
        <Download className="w-3.5 h-3.5" /> Export current report
      </a>
    </div>
  );
}

function UploadPanel({ batchId, onSubmitted }: { batchId: string; onSubmitted: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<{ fields: Record<string, string>; items: Record<string, string> }>({ fields: {}, items: {} });
  const [detecting, setDetecting] = useState(false);
  const [totalRows, setTotalRows] = useState(0);

  const FIELD_OPTIONS: { key: string; label: string }[] = [
    { key: 'date', label: 'Date' }, { key: 'row', label: 'Row / Deck' }, { key: 'level', label: 'Level' },
    { key: 'cage', label: 'Cage' }, { key: 'feedKg', label: 'Feed (Kg)' }, { key: 'feedType', label: 'Feed Type' },
    { key: 'waterLts', label: 'Water (L)' }, { key: 'mortality', label: 'Mortality' }, { key: 'culling', label: 'Culling' },
    { key: 'openingStock', label: 'Opening Stock' }, { key: 'closingStock', label: 'Closing Stock' },
    { key: 'avgWeight', label: 'Avg Weight' }, { key: 'temperature', label: 'Temperature' },
    { key: 'humidity', label: 'Humidity' }, { key: 'lux', label: 'Lux' },
    { key: 'drugsVaccines', label: 'Drugs / Vaccines' }, { key: 'notes', label: 'Remarks' },
  ];

  const submit = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('No file selected');
      const form = new FormData();
      form.append('file', file);
      form.append('mapping', JSON.stringify(mapping));
      return (await api.post(`/store/production-reports/${batchId}/submit`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })).data;
    },
    onSuccess: () => {
      setFile(null); setHeaders([]); setMapping({ fields: {}, items: {} });
      onSubmitted();
    },
  });

  const handleFile = async (f: File) => {
    setFile(f);
    setDetecting(true);
    try {
      const form = new FormData();
      form.append('file', f);
      const res = await api.post('/store/production-reports/detect-headers', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setHeaders(res.data.headers ?? []);
      setTotalRows(res.data.totalRows ?? 0);
      setMapping(res.data.suggestedMapping ?? { fields: {}, items: {} });
    } catch (err: any) {
      alert('Could not read file: ' + (err?.response?.data?.message ?? 'Unknown error'));
      setFile(null);
    }
    setDetecting(false);
  };

  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-5 space-y-4">
      <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Upload production report</p>

      {!file ? (
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full border-2 border-dashed border-gray-200 dark:border-dark-border rounded-xl py-10 flex flex-col items-center gap-2 text-gray-400 hover:border-brand-green/50 hover:text-brand-green transition-colors"
        >
          <Upload className="w-6 h-6" />
          <span className="text-sm font-medium">Click to select a spreadsheet (.xlsx, .xls, .csv)</span>
        </button>
      ) : detecting ? (
        <div className="h-24 bg-gray-100 dark:bg-dark-border rounded-xl animate-pulse flex items-center justify-center text-sm text-gray-400">
          Reading file…
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <FileSpreadsheet className="w-4 h-4 text-brand-green" />
            <span className="font-medium">{file.name}</span>
            <span className="text-xs text-gray-400">· {totalRows} rows detected</span>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Column mapping — check before submitting</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {FIELD_OPTIONS.map(f => (
                <div key={f.key} className="flex items-center gap-2">
                  <label className="text-xs text-gray-500 w-28 flex-shrink-0">{f.label}</label>
                  <select
                    value={mapping.fields[f.key] ?? ''}
                    onChange={e => setMapping(m => ({ ...m, fields: { ...m.fields, [f.key]: e.target.value } }))}
                    className="flex-1 text-xs border border-gray-200 dark:border-dark-border rounded-lg px-2 py-1.5 bg-white dark:bg-dark-bg"
                  >
                    <option value="">— not in this report —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {Object.keys(mapping.items ?? {}).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Store items matched on this sheet</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(mapping.items).map(([id, header]) => (
                  <span key={id} className="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 px-2.5 py-1 rounded-full">
                    {header}
                  </span>
                ))}
              </div>
            </div>
          )}

          {!mapping.fields.date && (
            <p className="text-xs text-red-500">A Date column must be mapped before submitting.</p>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={() => { setFile(null); setHeaders([]); }}
              className="text-xs font-semibold text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              <ArrowLeft className="w-3 h-3" /> Choose a different file
            </button>
            <button
              disabled={!mapping.fields.date || submit.isPending}
              onClick={() => submit.mutate()}
              className="ml-auto bg-brand-green text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-brand-green/90 disabled:opacity-50 transition-colors flex items-center gap-1.5"
            >
              {submit.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
              Submit report
            </button>
          </div>

          {submit.isSuccess && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-900/30 rounded-xl p-3 text-sm text-green-700 dark:text-green-400">
              Submitted — {submit.data.matchedCount} matched, {submit.data.autofillCount} auto-filled
              {submit.data.discrepancyCount > 0
                ? `, ${submit.data.discrepancyCount} discrepanc${submit.data.discrepancyCount === 1 ? 'y' : 'ies'} sent to the Director.`
                : ' — applied with no discrepancies.'}
            </div>
          )}
          {submit.isError && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 rounded-xl p-3 text-sm text-red-700 dark:text-red-400">
              {(submit.error as any)?.response?.data?.message ?? 'Submission failed'}
            </div>
          )}
        </div>
      )}

      <input
        ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
        onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
    </div>
  );
}

export function StoreProductionReportPage() {
  const { data: batches = [] } = useBatches();
  const [batchId, setBatchId] = useState<string>('');
  const qc = useQueryClient();

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Production Report</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Upload the day-by-day production sheet for a batch — feed, mortality, stock, and items used are
          checked against what's already recorded and applied automatically wherever there's no conflict.
        </p>
      </div>

      <select
        value={batchId}
        onChange={e => setBatchId(e.target.value)}
        className="w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-card"
      >
        <option value="">Select a batch…</option>
        {batches.map(b => <option key={b.id} value={b.id}>{b.batchCode}</option>)}
      </select>

      {batchId && (
        <>
          <CurrentReportPanel batchId={batchId} />
          <UploadPanel batchId={batchId} onSubmitted={() => qc.invalidateQueries({ queryKey: ['production-report', batchId] })} />
        </>
      )}
    </div>
  );
}

export default StoreProductionReportPage;
