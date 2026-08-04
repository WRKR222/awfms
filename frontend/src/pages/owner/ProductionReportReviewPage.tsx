// src/pages/owner/ProductionReportReviewPage.tsx
// Director's queue for store production reports that have open discrepancies.
// A clean report never shows up here — it was applied automatically the
// moment Store submitted it. This page is only for the genuine conflicts.

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import { AlertTriangle, CheckCircle, XCircle, Download, Inbox } from 'lucide-react';
import dayjs from '../../lib/dayjs';

interface Discrepancy {
  id: string;
  rowDate: string;
  field: string;
  discrepancyType: string;
  locationRef: string | null;
  systemValue: string | null;
  reportValue: string | null;
  notes: string | null;
}

interface PendingReport {
  id: string;
  batchId: string;
  batch: { batchCode: string };
  uploadedBy: { fullName: string };
  uploadedAt: string;
  discrepancyCount: number;
  autofillCount: number;
  matchedCount: number;
  discrepancies: Discrepancy[];
}

function usePending() {
  return useQuery<PendingReport[]>({
    queryKey: ['production-reports-pending'],
    queryFn: async () => (await api.get('/store/production-reports/pending')).data,
    staleTime: 15_000,
  });
}

function ReportCard({ report }: { report: PendingReport }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [showReject, setShowReject] = useState(false);

  const approve = useMutation({
    mutationFn: () => api.post(`/store/production-reports/${report.id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['production-reports-pending'] }),
  });

  const reject = useMutation({
    mutationFn: () => api.post(`/store/production-reports/${report.id}/reject`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production-reports-pending'] });
      setShowReject(false); setReason('');
    },
  });

  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="font-bold text-gray-800 dark:text-gray-100">{report.batch.batchCode}</p>
          <p className="text-xs text-gray-500">
            Submitted by {report.uploadedBy.fullName} · {dayjs(report.uploadedAt).format('D MMM YYYY, HH:mm')}
          </p>
        </div>
        <a
          href={`${api.defaults.baseURL}/store/production-reports/${report.batchId}/export`}
          target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-green hover:underline flex-shrink-0"
        >
          <Download className="w-3.5 h-3.5" /> Export
        </a>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="bg-gray-50 dark:bg-dark-bg rounded-xl py-2.5">
          <p className="text-base font-bold text-brand-green">{report.matchedCount}</p>
          <p className="text-[11px] text-gray-500">Matched</p>
        </div>
        <div className="bg-gray-50 dark:bg-dark-bg rounded-xl py-2.5">
          <p className="text-base font-bold text-blue-500">{report.autofillCount}</p>
          <p className="text-[11px] text-gray-500">Auto-filled</p>
        </div>
        <div className="bg-gray-50 dark:bg-dark-bg rounded-xl py-2.5">
          <p className="text-base font-bold text-amber-500">{report.discrepancyCount}</p>
          <p className="text-[11px] text-gray-500">Discrepancies</p>
        </div>
      </div>

      <div className="space-y-2">
        {report.discrepancies.map(d => (
          <div key={d.id} className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30 rounded-xl p-3 text-sm">
            <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-gray-800 dark:text-gray-200">
                {d.field} — {dayjs(d.rowDate).format('D MMM YYYY')}{d.locationRef ? ` (${d.locationRef})` : ''}
              </p>
              <p className="text-xs text-gray-500">
                System has: <span className="font-semibold">{d.systemValue ?? '—'}</span> · Report says: <span className="font-semibold">{d.reportValue ?? '—'}</span>
              </p>
              {d.notes && <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">{d.notes}</p>}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-400">
        Approve trusts the report's values for every discrepancy above (an adjusting entry is added — the
        attendant's original record isn't overwritten). Reject leaves the system as-is; Store must fix and re-upload.
      </p>

      {!showReject ? (
        <div className="flex items-center gap-2">
          <button
            onClick={() => approve.mutate()}
            disabled={approve.isPending}
            className="flex-1 bg-brand-green text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-brand-green/90 disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            <CheckCircle className="w-4 h-4" /> Approve
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
            <button
              onClick={() => setShowReject(false)}
              className="flex-1 text-sm font-semibold text-gray-500 px-4 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-dark-bg"
            >
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

      {approve.isError && (
        <p className="text-xs text-red-500">{(approve.error as any)?.response?.data?.message ?? 'Approval failed'}</p>
      )}
    </div>
  );
}

export function ProductionReportReviewPage() {
  const { data: reports = [], isLoading } = usePending();

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Production Reports</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Reports that matched or auto-filled cleanly are applied automatically and don't appear here —
          only reports with a genuine mismatch against recorded data need your review.
        </p>
      </div>

      {isLoading ? (
        [1, 2].map(i => <div key={i} className="h-40 bg-gray-100 dark:bg-dark-border rounded-2xl animate-pulse" />)
      ) : reports.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Inbox className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No reports awaiting review</p>
        </div>
      ) : (
        reports.map(r => <ReportCard key={r.id} report={r} />)
      )}
    </div>
  );
}

export default ProductionReportReviewPage;
