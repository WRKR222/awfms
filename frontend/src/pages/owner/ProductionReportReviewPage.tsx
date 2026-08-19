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
import { AlertTriangle, CheckCircle, XCircle, Download, RefreshCw, FileSpreadsheet, Scale } from 'lucide-react';
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

interface WeightAlert {
  id: string;
  batchId: string;
  sampleDate: string;
  averageWeightG: string | number;
  standardMinG: number;
  standardMaxG: number;
  ageWeeks: number;
  direction: 'BELOW_MIN' | 'ABOVE_MAX';
  deviationG: string | number;
  deviationPct: string | number;
  feedContext: { note: string; totalDispensedKg: number; recommendedKg: number | null; pctOfRecommended: number | null; windowDays: number; source: 'report' | 'system' } | null;
  mortalityContext: { note: string; totalDeaths: number; cumulativePct: number | null; standardCeilingPct: number | null; overCeiling: boolean; windowDays: number; source: 'report' | 'system' } | null;
  aiAnalysis: string | null;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  createdAt: string;
  batch?: { batchCode: string; house?: { name: string } | null };
}

function useWeightAlerts(batchId: string) {
  return useQuery<WeightAlert[]>({
    queryKey: ['weight-alerts', batchId],
    queryFn: () => api.get('/weight/alerts', { params: { batchId } }).then(r => r.data),
    enabled: !!batchId,
  });
}

/** Director's "average weight is outside the HyLine standard band" queue
 *  for this batch — separate from the report's own discrepancy list
 *  because there's nothing to approve/reject here (see
 *  ProductionReportDiscrepancyType.WEIGHT doc comment: it's persisted
 *  pre-resolved and never enters that gate). Every flag carries the
 *  cross-referenced feed-intake and mortality context captured at the
 *  moment it was raised, plus the AI's best-effort read on likely cause —
 *  see WeightAlertService.evaluateWeightSample() on the backend. */
function WeightAlertsPanel({ batchId }: { batchId: string }) {
  const qc = useQueryClient();
  const { data: alerts = [], isLoading } = useWeightAlerts(batchId);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACKNOWLEDGED' | 'RESOLVED' }) =>
      api.patch(`/weight/alerts/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['weight-alerts', batchId] }),
  });

  if (isLoading || alerts.length === 0) return null;

  const open = alerts.filter(a => a.status !== 'RESOLVED');
  if (open.length === 0) return null;

  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl border border-red-200 dark:border-red-900/40 p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Scale className="w-4 h-4 text-red-500" />
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
          Weight vs. HyLine standard — {open.length} flag{open.length === 1 ? '' : 's'}
        </p>
      </div>
      <p className="text-xs text-gray-500">
        Recorded average weight fell outside the standard min/max band for the batch's age. Each flag below is
        cross-referenced against recent feed intake and mortality to help judge the likely cause — expand for detail.
      </p>
      <div className="space-y-2">
        {open.map(a => {
          const isBelow = a.direction === 'BELOW_MIN';
          const expanded = expandedId === a.id;
          return (
            <div key={a.id} className="border border-red-100 dark:border-red-900/30 rounded-xl overflow-hidden">
              <button
                onClick={() => setExpandedId(expanded ? null : a.id)}
                className="w-full flex items-start gap-2 bg-red-50 dark:bg-red-900/10 px-3 py-3 text-left"
              >
                <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                    Week {a.ageWeeks} — {Number(a.averageWeightG).toFixed(0)}g is {Math.abs(Number(a.deviationG)).toFixed(0)}g
                    ({Math.abs(Number(a.deviationPct)).toFixed(1)}%) {isBelow ? 'below minimum' : 'above maximum'}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Standard band: {a.standardMinG}–{a.standardMaxG}g · {dayjs(a.sampleDate).format('D MMM YYYY')}
                    {a.status === 'ACKNOWLEDGED' && ' · Acknowledged'}
                  </p>
                </div>
              </button>

              {expanded && (
                <div className="p-3 space-y-3 border-t border-red-100 dark:border-red-900/30">
                  {a.feedContext && (
                    <div className="bg-gray-50 dark:bg-dark-bg rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                          Feed intake, last {a.feedContext.windowDays} days
                        </p>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${a.feedContext.source === 'report' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'}`}>
                          {a.feedContext.source === 'report' ? 'Production report' : 'System log (no report data)'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">
                        {a.feedContext.totalDispensedKg}kg dispensed
                        {a.feedContext.recommendedKg != null && ` vs. ${a.feedContext.recommendedKg}kg recommended`}
                        {a.feedContext.pctOfRecommended != null && ` (${a.feedContext.pctOfRecommended.toFixed(0)}%)`}
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{a.feedContext.note}</p>
                    </div>
                  )}
                  {a.mortalityContext && (
                    <div className={`rounded-lg p-3 ${a.mortalityContext.overCeiling ? 'bg-red-50 dark:bg-red-900/10' : 'bg-gray-50 dark:bg-dark-bg'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                          Mortality, last {a.mortalityContext.windowDays} days
                        </p>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${a.mortalityContext.source === 'report' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'}`}>
                          {a.mortalityContext.source === 'report' ? 'Production report' : 'System log (no report data)'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">
                        {a.mortalityContext.totalDeaths} death(s)
                        {a.mortalityContext.cumulativePct != null && ` · Cumulative ${a.mortalityContext.cumulativePct}%`}
                        {a.mortalityContext.standardCeilingPct != null && ` vs. HyLine ceiling ${a.mortalityContext.standardCeilingPct}%`}
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{a.mortalityContext.note}</p>
                    </div>
                  )}
                  {a.aiAnalysis && (
                    <div className="bg-blue-50 dark:bg-blue-900/10 rounded-lg p-3">
                      <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-1">AI analysis</p>
                      <p className="text-xs text-gray-700 dark:text-gray-300">{a.aiAnalysis}</p>
                    </div>
                  )}
                  <div className="flex gap-2">
                    {a.status === 'OPEN' && (
                      <button
                        onClick={() => setStatus.mutate({ id: a.id, status: 'ACKNOWLEDGED' })}
                        className="text-xs font-semibold text-amber-600 hover:underline"
                      >
                        Acknowledge
                      </button>
                    )}
                    <button
                      onClick={() => setStatus.mutate({ id: a.id, status: 'RESOLVED' })}
                      className="text-xs font-semibold text-brand-green hover:underline"
                    >
                      Mark resolved
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
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

      <WeightAlertsPanel batchId={batchId} />
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
