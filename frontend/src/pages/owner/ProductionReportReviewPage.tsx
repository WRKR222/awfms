// src/pages/owner/ProductionReportReviewPage.tsx
// Director pulls a batch's current production report and views it as a
// table — the system only ever keeps ONE report row per batch (the latest
// upload's reconciled state, upserted on every re-submit), so "pull the
// report" always means "the current state," not picking from a history of
// past uploads.
//
// Almost everything reconciles automatically now — feed, mortality, stock
// counts, environmental readings, and vaccine/supplement/treatment
// quantities are all corrected to match the report directly, with no
// Director sign-off needed (see ProductionReportReconciliationService).
// What's still flagged is the small set of things that genuinely can't be
// auto-resolved — a feed/item name that doesn't match anything in the store
// catalogue, a unit that can't be converted, a day with nowhere yet to
// write into, or a cage reassignment across batches — so those still show
// up in a compact "Needs your input" panel with Approve/Reject.

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import { AlertTriangle, CheckCircle, XCircle, Download, RefreshCw, FileSpreadsheet } from 'lucide-react';
import dayjs from '../../lib/dayjs';
import { ProductionReportTable } from '../../components/production-report/ReportTable';

interface Batch { id: string; batchCode: string; }

interface Discrepancy {
  id: string;
  rowDate: string;
  field: string;
  discrepancyType: string;
  locationRef: string | null;
  systemValue: string | null;
  reportValue: string | null;
  notes: string | null;
  resolved: boolean;
}

interface Report {
  id: string;
  batchId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  fileName: string;
  rawRows: any[];
  // Original sheet column order — see StoreProductionReport.rawHeaders on
  // the backend. rawRows alone (jsonb) doesn't reliably preserve column
  // order once persisted; this is what keeps the Director's table matching
  // the sheet's actual column arrangement.
  rawHeaders?: string[];
  discrepancyCount: number;
  autofillCount: number;
  matchedCount: number;
  resubmissionCount: number;
  uploadedAt: string;
  uploadedBy?: { fullName: string };
  discrepancies: Discrepancy[];
}

function useBatches() {
  return useQuery<Batch[]>({
    queryKey: ['batches-active'],
    queryFn: async () => (await api.get('/flock/batches', { params: { isActive: true } })).data,
    staleTime: 60_000,
  });
}

function useBatchReport(batchId: string) {
  return useQuery<Report | null>({
    queryKey: ['production-report', batchId],
    queryFn: async () => {
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

function NeedsInputPanel({ report }: { report: Report }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const open = report.discrepancies.filter(d => !d.resolved);

  const approve = useMutation({
    mutationFn: () => api.post(`/store/production-reports/${report.id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['production-report', report.batchId] }),
  });
  const reject = useMutation({
    mutationFn: () => api.post(`/store/production-reports/${report.id}/reject`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production-report', report.batchId] });
      setShowReject(false); setReason('');
    },
  });

  if (open.length === 0) return null;

  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl border border-amber-200 dark:border-amber-900/40 p-5 space-y-3">
      <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Needs your input — {open.length} item{open.length === 1 ? '' : 's'}</p>
      <p className="text-xs text-gray-500">
        Everything else in this report reconciled and applied automatically. These couldn't — usually a name on
        the sheet that doesn't match anything in the store catalogue, or a cage moving to a different batch.
      </p>
      <div className="space-y-2">
        {open.map(d => (
          <div key={d.id} className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30 rounded-xl p-3 text-sm">
            <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-gray-800 dark:text-gray-200">
                {d.field} — {dayjs(d.rowDate).format('D MMM YYYY')}{d.locationRef ? ` (${d.locationRef})` : ''}
              </p>
              {(d.systemValue || d.reportValue) && (
                <p className="text-xs text-gray-500">
                  System has: <span className="font-semibold">{d.systemValue ?? '—'}</span> · Report says: <span className="font-semibold">{d.reportValue ?? '—'}</span>
                </p>
              )}
              {d.notes && <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">{d.notes}</p>}
            </div>
          </div>
        ))}
      </div>

      {!showReject ? (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => approve.mutate()}
            disabled={approve.isPending}
            className="flex-1 bg-brand-green text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-brand-green/90 disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            <CheckCircle className="w-4 h-4" /> Trust the report for these
          </button>
          <button
            onClick={() => setShowReject(true)}
            className="flex-1 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-red-100 flex items-center justify-center gap-1.5"
          >
            <XCircle className="w-4 h-4" /> Reject
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Reason for rejecting — Store will see this"
            className="w-full text-sm border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2 bg-white dark:bg-dark-bg"
            rows={2}
          />
          <div className="flex items-center gap-2">
            <button onClick={() => setShowReject(false)} className="flex-1 text-sm font-semibold text-gray-500 px-4 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-dark-bg">
              Cancel
            </button>
            <button
              disabled={!reason.trim() || reject.isPending}
              onClick={() => reject.mutate()}
              className="flex-1 bg-red-500 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-red-600 disabled:opacity-50"
            >
              Confirm rejection
            </button>
          </div>
        </div>
      )}
      {approve.isError && <p className="text-xs text-red-500">{(approve.error as any)?.response?.data?.message ?? 'Approval failed'}</p>}
    </div>
  );
}

function BatchReportPanel({ batchId }: { batchId: string }) {
  const { data: report, isLoading, isFetching, refetch } = useBatchReport(batchId);

  if (isLoading) return <div className="h-64 bg-gray-100 dark:bg-dark-border rounded-2xl animate-pulse" />;
  if (!report) return (
    <div className="text-center py-16 text-gray-400">
      <FileSpreadsheet className="w-10 h-10 mx-auto mb-3 opacity-30" />
      <p className="text-sm">No production report has been uploaded for this batch yet.</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Current report — {report.fileName}</p>
            <p className="text-xs text-gray-500">
              Last updated {dayjs(report.uploadedAt).format('D MMM YYYY, HH:mm')}
              {report.uploadedBy && ` by ${report.uploadedBy.fullName}`}
              {report.resubmissionCount > 0 && ` · re-uploaded ${report.resubmissionCount}×`}
            </p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <button
              onClick={() => refetch()}
              className="text-xs font-semibold text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <a
              href={`${api.defaults.baseURL}/store/production-reports/${batchId}/export`}
              target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-green hover:underline"
            >
              <Download className="w-3.5 h-3.5" /> Export
            </a>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-gray-50 dark:bg-dark-bg rounded-xl py-3">
            <p className="text-lg font-bold text-brand-green">{report.matchedCount}</p>
            <p className="text-[11px] text-gray-500">Matched</p>
          </div>
          <div className="bg-gray-50 dark:bg-dark-bg rounded-xl py-3">
            <p className="text-lg font-bold text-blue-500">{report.autofillCount}</p>
            <p className="text-[11px] text-gray-500">Auto-corrected</p>
          </div>
          <div className="bg-gray-50 dark:bg-dark-bg rounded-xl py-3">
            <p className="text-lg font-bold text-amber-500">{report.discrepancies.filter(d => !d.resolved).length}</p>
            <p className="text-[11px] text-gray-500">Needs input</p>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Report as uploaded — every column, every row (same table Store sees)
          </p>
          <ProductionReportTable rows={report.rawRows ?? []} headers={report.rawHeaders} />
        </div>
      </div>

      <NeedsInputPanel report={report} />
    </div>
  );
}

export function ProductionReportReviewPage() {
  const { data: batches = [] } = useBatches();
  const [batchId, setBatchId] = useState('');

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Production Reports</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Pull a batch's current production report — feed, mortality, stock, and items are already reconciled
          against recorded data. Pick a batch to view it as a table, or export it to a spreadsheet.
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

      {batchId && <BatchReportPanel batchId={batchId} />}
    </div>
  );
}

export default ProductionReportReviewPage;
