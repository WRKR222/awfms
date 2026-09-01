// src/pages/manager/HdpControlsPage.tsx
//
// Production Manager uploads the target Hen-Day Production % curve (a
// breed/standard control sheet) as PDF, Excel, or Word, and compares actual
// recorded HDP% against it, per batch.
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import { UploadCloud, TrendingUp, CheckCircle, AlertTriangle, FileText } from 'lucide-react';
import dayjs from '../../lib/dayjs';

const cardCls = 'bg-white dark:bg-dark-card rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-dark-border';

function useActiveControl() {
  return useQuery({
    queryKey: ['hdp-control-active'],
    queryFn: () => api.get('/production/hdp-controls/active').then(r => r.data),
  });
}

function useBatches() {
  return useQuery({
    queryKey: ['batches', 'production'],
    queryFn: () => api.get('/flock/batches?isActive=true').then(r => r.data),
  });
}

function useComparison(batchId: string) {
  return useQuery({
    queryKey: ['hdp-comparison', batchId],
    queryFn: () => api.get(`/production/hdp-controls/comparison/${batchId}`).then(r => r.data),
    enabled: !!batchId,
    retry: false,
  });
}

export function HdpControlsPage() {
  const qc = useQueryClient();
  const { data: active, isLoading: activeLoading } = useActiveControl();
  const { data: allBatches = [] } = useBatches();
  const batches = (allBatches as any[]).filter(b => b.stage === 'PRODUCTION');

  const [file, setFile] = useState<File | null>(null);
  const [granularity, setGranularity] = useState<'DAILY' | 'WEEKLY'>('WEEKLY');
  const [notes, setNotes] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState('');

  const { data: comparison, isError: comparisonError, error: comparisonErrObj } = useComparison(selectedBatchId);

  const upload = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('Select a file first');
      const form = new FormData();
      form.append('file', file);
      form.append('granularity', granularity);
      if (notes.trim()) form.append('notes', notes.trim());
      return api.post('/production/hdp-controls/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => {
      setFile(null);
      setNotes('');
      setUploadError(null);
      qc.invalidateQueries({ queryKey: ['hdp-control-active'] });
      qc.invalidateQueries({ queryKey: ['hdp-comparison'] });
    },
    onError: (err: any) => {
      setUploadError(err?.response?.data?.message ?? 'Upload failed. Check the file and try again.');
    },
  });

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-brand-green" /> HDP% Controls
        </h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Upload the target Hen-Day Production % curve and compare it against actual production.
        </p>
      </div>

      {/* Upload card */}
      <div className={cardCls}>
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-2">
          <UploadCloud className="w-4 h-4 text-brand-green" /> Upload Target Curve
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-500 mb-1">File (PDF, Excel, or Word)</label>
            <input
              type="file"
              accept=".pdf,.xlsx,.xls,.csv,.docx,.doc"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Specified per</label>
            <select
              value={granularity}
              onChange={e => setGranularity(e.target.value as 'DAILY' | 'WEEKLY')}
              className="w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100"
            >
              <option value="WEEKLY">Week of production</option>
              <option value="DAILY">Day of production</option>
            </select>
          </div>
        </div>
        <div className="mt-3">
          <label className="block text-xs text-gray-500 mb-1">Notes (optional)</label>
          <input
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="e.g. HyLine Brown standard, 2026 revision"
            className="w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100"
          />
        </div>
        {uploadError && (
          <div className="mt-3 flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl p-3 text-red-700 dark:text-red-400 text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {uploadError}
          </div>
        )}
        <button
          onClick={() => { setUploadError(null); upload.mutate(); }}
          disabled={!file || upload.isPending}
          className="mt-3 w-full bg-brand-green text-white rounded-xl py-2.5 text-sm font-bold disabled:opacity-50"
        >
          {upload.isPending ? 'Uploading…' : 'Upload & Set as Active Control'}
        </button>
        <p className="text-[11px] text-gray-400 mt-2">
          Uploading a new curve replaces the currently active one (history is kept, not deleted).
        </p>
      </div>

      {/* Active control summary */}
      <div className={cardCls}>
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4 text-blue-500" /> Active Control Curve
        </p>
        {activeLoading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : !active ? (
          <p className="text-sm text-gray-400 italic">No HDP% control curve uploaded yet.</p>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-brand-green" /> {active.fileName}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {active.granularity === 'WEEKLY' ? 'Per week of production' : 'Per day of production'} ·
                {' '}{active.points?.length ?? 0} points · uploaded {dayjs(active.createdAt).format('D MMM YYYY')}
              </p>
              {active.notes && <p className="text-xs text-gray-400 mt-0.5">{active.notes}</p>}
            </div>
          </div>
        )}
      </div>

      {/* Comparison */}
      <div className={cardCls}>
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
          Actual vs. Target
        </p>
        <select
          value={selectedBatchId}
          onChange={e => setSelectedBatchId(e.target.value)}
          className="w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 mb-3"
        >
          <option value="">Select batch...</option>
          {batches.map((b: any) => (
            <option key={b.id} value={b.id}>{b.batchCode}</option>
          ))}
        </select>

        {!selectedBatchId ? (
          <p className="text-sm text-gray-400 italic">Select a batch to compare its actual HDP% against the target curve.</p>
        ) : comparisonError ? (
          <p className="text-sm text-amber-600">
            {(comparisonErrObj as any)?.response?.data?.message ?? 'No comparison available for this batch yet.'}
          </p>
        ) : !comparison ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b border-gray-100 dark:border-dark-border">
                  <th className="text-left py-1.5 pr-3 font-medium">
                    {comparison.granularity === 'WEEKLY' ? 'Week' : 'Day'}
                  </th>
                  <th className="text-right py-1.5 px-2 font-medium">Target %</th>
                  <th className="text-right py-1.5 px-2 font-medium">Actual %</th>
                  <th className="text-right py-1.5 pl-2 font-medium">Variance</th>
                </tr>
              </thead>
              <tbody>
                {comparison.rows.map((r: any) => (
                  <tr key={r.periodIndex} className="border-b border-gray-50 dark:border-dark-border/50">
                    <td className="py-1.5 pr-3 font-semibold text-gray-700 dark:text-gray-200">{r.periodIndex}</td>
                    <td className="text-right px-2 text-gray-500">{r.targetHdpPercent ?? '—'}</td>
                    <td className="text-right px-2 text-gray-700 dark:text-gray-200">{r.actualHdpPercent ?? '—'}</td>
                    <td className={`text-right pl-2 font-semibold ${
                      r.varianceHdpPercent == null ? 'text-gray-400'
                        : r.varianceHdpPercent < -3 ? 'text-red-500'
                        : r.varianceHdpPercent < 0 ? 'text-amber-500'
                        : 'text-green-600'
                    }`}>
                      {r.varianceHdpPercent == null ? '—' : `${r.varianceHdpPercent > 0 ? '+' : ''}${r.varianceHdpPercent}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
