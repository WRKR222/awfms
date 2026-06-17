import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import { useBatches } from '../../hooks/useFlock';
import {
  Brain, ChevronDown, ChevronUp, RefreshCw, Loader2,
  TrendingUp, AlertTriangle, BarChart2, Lightbulb, Clipboard, Bird,
} from 'lucide-react';
import dayjs from 'dayjs';

// ── Types ─────────────────────────────────────────────────────────────────────
interface AiReport {
  id: string;
  reportType: string;
  weekEnding: string | null;
  content: string;
  rawData: Record<string, any>;
  generatedAt: string;
}

interface ReportsResponse {
  reports: AiReport[];
  total: number;
  page: number;
  limit: number;
}

// ── Config per report type ────────────────────────────────────────────────────
const REPORT_META: Record<string, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  WEEKLY_PERFORMANCE:      { label: 'Weekly Report',          icon: BarChart2,    color: 'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-900/20' },
  DISEASE_PATTERN:         { label: 'Disease Pattern',        icon: AlertTriangle, color: 'text-red-600',   bg: 'bg-red-50 dark:bg-red-900/20' },
  BATCH_CLOSURE_FORECAST:  { label: 'Batch Forecast',         icon: TrendingUp,   color: 'text-brand-green', bg: 'bg-green-50 dark:bg-green-900/20' },
  IMPROVEMENT_SUGGESTIONS: { label: 'Improvement Tips',       icon: Lightbulb,    color: 'text-amber-600',  bg: 'bg-amber-50 dark:bg-amber-900/20' },
};

const TYPE_FILTERS = [
  { value: '',                     label: 'All reports' },
  { value: 'WEEKLY_PERFORMANCE',   label: 'Weekly Reports' },
  { value: 'BATCH_CLOSURE_FORECAST', label: 'Batch Forecasts' },
  { value: 'IMPROVEMENT_SUGGESTIONS', label: 'Improvement Tips' },
  { value: 'DISEASE_PATTERN',      label: 'Disease Patterns' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatReportType(type: string): string {
  return REPORT_META[type]?.label ?? type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function ReportIcon({ type, size = 'sm' }: { type: string; size?: 'sm' | 'md' }) {
  const meta = REPORT_META[type];
  const Icon = meta?.icon ?? Clipboard;
  const sz = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  return <Icon className={`${sz} ${meta?.color ?? 'text-gray-500'}`} />;
}

// ── Main component ────────────────────────────────────────────────────────────
export function AiReportsPage() {
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<ReportsResponse>({
    queryKey: ['ai-reports', typeFilter, page],
    queryFn: () =>
      api.get('/ai/reports', { params: { page, limit: 15, ...(typeFilter ? { type: typeFilter } : {}) } })
        .then(r => r.data),
    staleTime: 2 * 60_000,
  });

  // All batches (active + closed/sold/discarded) for the per-batch report selector.
  const { data: batches = [] } = useBatches();
  const batchOptions = [...batches].sort((a: any, b: any) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1; // active batches first
    return dayjs(b.updatedAt ?? b.createdAt).valueOf() - dayjs(a.updatedAt ?? a.createdAt).valueOf();
  });

  const trigger = useMutation({
    mutationFn: () => api.post('/ai/reports/trigger').then(r => r.data),
    onSuccess: () => {
      setTimeout(() => qc.invalidateQueries({ queryKey: ['ai-reports'] }), 3000);
    },
  });

  const triggerBatch = useMutation({
    mutationFn: (batchId: string) => api.post(`/ai/reports/batch/${batchId}/trigger`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-reports'] });
      setExpandedId(null);
    },
  });

  const totalPages = data ? Math.ceil(data.total / 15) : 0;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <Brain className="w-5 h-5 text-brand-green" />
            AI Intelligence Reports
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {data?.total ?? 0} reports generated · Auto-updated weekly
          </p>
        </div>

        <button
          onClick={() => trigger.mutate()}
          disabled={trigger.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-brand-green text-white rounded-xl text-sm font-medium hover:bg-brand-mid transition-colors disabled:opacity-60"
        >
          {trigger.isPending ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
          ) : (
            <><RefreshCw className="w-4 h-4" /> Generate Weekly Report</>
          )}
        </button>
      </div>

      {trigger.isSuccess && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl p-3 text-green-700 dark:text-green-400 text-sm">
          Weekly report generated — it will appear in the list below.
        </div>
      )}
      {trigger.isError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl p-3 text-red-600 dark:text-red-400 text-sm">
          {(trigger.error as any)?.response?.data?.message ?? 'Failed to generate the weekly report. Please try again.'}
        </div>
      )}

      {/* Per-batch report generator */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Bird className="w-4 h-4 text-brand-green" />
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Report on a specific batch</p>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Generate a report for any existing batch — active or recently closed — using whatever
          production data is available for it.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <select
            value={selectedBatchId}
            onChange={e => setSelectedBatchId(e.target.value)}
            className="flex-1 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green"
          >
            <option value="">Select a batch…</option>
            {batchOptions.map((b: any) => (
              <option key={b.id} value={b.id}>
                {b.batchCode}{b.isActive ? '' : ` (closed${b.stage ? `, ${b.stage.toLowerCase()}` : ''})`}
              </option>
            ))}
          </select>
          <button
            onClick={() => selectedBatchId && triggerBatch.mutate(selectedBatchId)}
            disabled={!selectedBatchId || triggerBatch.isPending}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-green text-white rounded-xl text-sm font-medium hover:bg-brand-mid transition-colors disabled:opacity-60"
          >
            {triggerBatch.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
            ) : (
              <><RefreshCw className="w-4 h-4" /> Generate Report</>
            )}
          </button>
        </div>
        {triggerBatch.isSuccess && (
          <p className="text-xs text-green-600 dark:text-green-400">Report generated — it will appear in the list below.</p>
        )}
        {triggerBatch.isError && (
          <p className="text-xs text-red-500 dark:text-red-400">
            {(triggerBatch.error as any)?.response?.data?.message ?? 'Failed to generate the report. Please try again.'}
          </p>
        )}
      </div>

      {/* Type filter tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {TYPE_FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => { setTypeFilter(f.value); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              typeFilter === f.value
                ? 'bg-brand-green text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Reports list */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-brand-green" />
        </div>
      ) : !data?.reports.length ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
          <Brain className="w-10 h-10 opacity-30" />
          <p className="text-sm">No reports yet</p>
          <p className="text-xs text-center max-w-xs">
            Reports are generated automatically every Monday at 6 AM. You can also trigger one manually above.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.reports.map(report => {
            const meta = REPORT_META[report.reportType];
            const isExpanded = expandedId === report.id;

            return (
              <div
                key={report.id}
                className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden"
              >
                {/* Report header — always visible */}
                <button
                  className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : report.id)}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl ${meta?.bg ?? 'bg-gray-100 dark:bg-gray-800'} flex items-center justify-center flex-shrink-0`}>
                      <ReportIcon type={report.reportType} size="md" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                        {formatReportType(report.reportType)}
                        {report.reportType === 'BATCH_CLOSURE_FORECAST' && report.rawData?.batchCode && (
                          <span className="ml-2 text-xs font-normal text-gray-400">
                            — {String(report.rawData.batchCode)}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {report.weekEnding
                          ? `Week ending ${dayjs(report.weekEnding).format('D MMM YYYY')}`
                          : dayjs(report.generatedAt).format('D MMM YYYY [at] h:mm A')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Mini KPI chips from rawData */}
                    {report.reportType === 'WEEKLY_PERFORMANCE' && report.rawData?.avgHdp && (
                      <span className="hidden sm:inline text-xs bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full">
                        HDP {String(report.rawData.avgHdp)}%
                      </span>
                    )}
                    {report.reportType === 'BATCH_CLOSURE_FORECAST' && report.rawData?.ageWeeks && (
                      <span className="hidden sm:inline text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-full">
                        Age {String(report.rawData.ageWeeks)}w
                      </span>
                    )}
                    {isExpanded
                      ? <ChevronUp className="w-4 h-4 text-gray-400" />
                      : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </div>
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t border-gray-100 dark:border-gray-800 p-4 space-y-3">
                    {/* Full report text — formatted as plain paragraphs */}
                    <div className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-line">
                      {report.content}
                    </div>

                    {/* Raw KPI strip */}
                    {report.reportType === 'WEEKLY_PERFORMANCE' && (
                      <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                        {[
                          { k: 'totalEggs',    label: 'Eggs',     fmt: (v: unknown) => Number(v).toLocaleString() },
                          { k: 'avgHdp',       label: 'Avg HDP',  fmt: (v: unknown) => `${v}%` },
                          { k: 'totalMort',    label: 'Mortality', fmt: (v: unknown) => String(v) },
                          { k: 'totalRevenue', label: 'Revenue',  fmt: (v: unknown) => `KES ${Number(v).toLocaleString()}` },
                          { k: 'fcr',          label: 'FCR',      fmt: (v: unknown) => String(v) },
                        ].filter(f => report.rawData[f.k] !== undefined).map(f => (
                          <span key={f.k} className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2.5 py-1 rounded-lg">
                            {f.label}: <strong>{f.fmt(report.rawData[f.k])}</strong>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-xs rounded-lg bg-gray-100 dark:bg-gray-800 disabled:opacity-40 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            Previous
          </button>
          <span className="text-xs text-gray-500">Page {page} of {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 text-xs rounded-lg bg-gray-100 dark:bg-gray-800 disabled:opacity-40 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
