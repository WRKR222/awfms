// src/pages/store/StoreProductionReportPage.tsx
// Store uploads a day-by-day production report for a batch. Before anything
// is committed, Store reviews the FULL parsed table (§2/§2a) and explicitly
// clicks Approve & Submit — only after that does reconciliation run.
// Anything that doesn't conflict with what's already recorded is applied
// immediately; genuine conflicts show up below as open discrepancies, which
// Store also resolves itself — either by matching an unrecognised item name
// (UnmatchedItemRow) or by trusting/rejecting the report as a whole
// (ResolvePanel). No separate Director/Owner sign-off is required at any
// step. Re-uploading replaces the current report for that batch.

import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import {
  Upload, FileSpreadsheet, CheckCircle, AlertTriangle, ArrowLeft,
  RefreshCw, Clock, XCircle, Download, Eye, X,
} from 'lucide-react';
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
  resolution: string | null;
}

interface StoreItemOption { id: string; name: string; category: string; unit: string; }

function useStoreItems() {
  return useQuery<StoreItemOption[]>({
    queryKey: ['store-items-active'],
    queryFn: async () => (await api.get('/store/inventory/items', { params: { isActive: true } })).data,
    staleTime: 60_000,
  });
}

/** A discrepancy the automatic matcher couldn't resolve — "Could not match
 *  this ... to any store item" (see production-report-reconciliation.
 *  service.ts). Lets Store pick which existing store item the sheet's
 *  wording actually means; saved as a reusable alias so the same wording
 *  auto-matches on every future report from then on. */
function UnmatchedItemRow({ d, batchId }: { d: Discrepancy; batchId: string }) {
  const { data: items = [] } = useStoreItems();
  const qc = useQueryClient();
  const [storeItemId, setStoreItemId] = useState('');

  const match = useMutation({
    mutationFn: async () => (await api.post(`/store/production-reports/${batchId}/match-item`, { rawLabel: d.reportValue, storeItemId, discrepancyId: d.id })).data as { matchedItem: { id: string; name: string } },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['production-report', batchId] }),
  });

  if (match.isSuccess) {
    return (
      <div className="flex items-center gap-2 bg-green-50 dark:bg-green-900/10 border border-green-100 dark:border-green-900/30 rounded-xl p-3 text-sm text-green-700 dark:text-green-400">
        <CheckCircle className="w-4 h-4 flex-shrink-0" />
        {d.reportValue?.trim() ? `Matched "${d.reportValue}" to ${match.data.matchedItem.name} — applied.` : `Resolved against ${match.data.matchedItem.name}.`}
      </div>
    );
  }

  // `field` on this discrepancy is the kind ("vaccine" / "supplement" /
  // "treatment") or "item:<StoreItem name>" for generic issued items —
  // always show it so Store knows WHICH column/field is unmatched even in
  // the rare case reportValue itself comes back blank.
  const kindLabel = d.field.startsWith('item:') ? d.field.slice(5) : d.field.charAt(0).toUpperCase() + d.field.slice(1);
  const hasRawText = !!d.reportValue?.trim();

  return (
    <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30 rounded-xl p-3 text-sm space-y-2">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-medium text-gray-800 dark:text-gray-200">
            <span className="inline-block bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 mr-1.5 align-middle">
              {kindLabel}
            </span>
            {hasRawText ? `"${d.reportValue}"` : <span className="text-gray-400 italic">(blank cell on the sheet)</span>}
            {' — '}{dayjs(d.rowDate).format('D MMM YYYY')}{d.locationRef ? ` (${d.locationRef})` : ''}
          </p>
          <p className="text-xs text-gray-500">
            {hasRawText
              ? `"${d.reportValue}" doesn't match any store item by name. Pick which item this is:`
              : 'This cell had only whitespace and no real text — nothing to match. Re-upload after clearing the cell, or pick an item below if it was meant to say something:'}
          </p>
          {d.notes && <p className="text-[11px] text-gray-400 mt-0.5">{d.notes}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 pl-6">
        <select
          value={storeItemId}
          onChange={e => setStoreItemId(e.target.value)}
          className="flex-1 text-xs border border-gray-200 dark:border-dark-border rounded-lg px-2 py-1.5 bg-white dark:bg-dark-bg"
        >
          <option value="">Select the matching store item…</option>
          {items.map(i => <option key={i.id} value={i.id}>{i.name} ({i.category.replace(/_/g, ' ').toLowerCase()})</option>)}
        </select>
        <button
          disabled={!storeItemId || match.isPending}
          onClick={() => match.mutate()}
          className="bg-brand-green text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-brand-green/90 disabled:opacity-50 flex-shrink-0"
        >
          {match.isPending ? 'Matching…' : 'Match'}
        </button>
      </div>
      {match.isError && <p className="text-xs text-red-500 pl-6">{(match.error as any)?.response?.data?.message ?? 'Match failed'}</p>}
    </div>
  );
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
  storeVerifiedBy?: { fullName: string };
  storeVerifiedAt?: string | null;
  rolledBackAt?: string | null;
  // The exact parsed table as uploaded — every column/cell from the sheet,
  // per row (see ProductionReportTable). Store needs to see this too, not
  // just the Director — same table, same data, same component.
  rawRows?: any[];
}

/** Undoes every auto-filled/auto-corrected daily record this report has
 *  ever written (across all its uploads/resubmissions) — the "I uploaded
 *  the wrong sheet after it already applied" escape hatch. Only relevant
 *  once something's actually been auto-filled; a report re-upload starts
 *  this fresh (see submit() resetting rolledBackAt), so it's hidden again
 *  after that. Does not touch anything separately Director-approved via
 *  applyDiscrepancy() — see ProductionReportRollbackService. */
function RollbackPanel({ report, batchId }: { report: Report; batchId: string }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const rollback = useMutation({
    mutationFn: async () => (await api.post(`/store/production-reports/${report.id}/rollback`)).data as {
      reverted: number; totalChanges: number; skipped: { entityType: string; reason: string }[];
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['production-report', batchId] }); setConfirming(false); },
  });

  if (report.rolledBackAt) {
    return <p className="text-xs text-gray-400">Rolled back {dayjs(report.rolledBackAt).format('D MMM YYYY, HH:mm')} — every auto-filled entry this report wrote has been reversed.</p>;
  }
  if (report.autofillCount === 0) return null;

  return (
    <div className="pt-1">
      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="text-xs font-semibold text-red-600 hover:text-red-700 flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> Roll back this report's auto-filled entries
        </button>
      ) : (
        <div className="bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-xl p-3 space-y-2">
          <p className="text-xs text-red-700 dark:text-red-400">
            This reverses all {report.autofillCount} auto-filled/auto-corrected entr{report.autofillCount === 1 ? 'y' : 'ies'} this
            report has written for this batch — mortality, feed, water, environmental, stock counts, cage moves. Anything an
            attendant has hand-edited since is left alone. This can't be undone.
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => setConfirming(false)} className="flex-1 text-xs font-semibold text-gray-500 px-3 py-1.5 rounded-lg hover:bg-white dark:hover:bg-dark-bg">
              Cancel
            </button>
            <button
              disabled={rollback.isPending}
              onClick={() => rollback.mutate()}
              className="flex-1 bg-red-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-red-600 disabled:opacity-50"
            >
              {rollback.isPending ? 'Rolling back…' : 'Confirm rollback'}
            </button>
          </div>
        </div>
      )}
      {rollback.isSuccess && (
        <p className="text-xs text-green-600 mt-1">
          Reverted {rollback.data.reverted}/{rollback.data.totalChanges}.
          {rollback.data.skipped.length ? ` ${rollback.data.skipped.length} couldn't be reversed (edited since) — check those manually.` : ''}
        </p>
      )}
      {rollback.isError && <p className="text-xs text-red-500 mt-1">{(rollback.error as any)?.response?.data?.message ?? 'Rollback failed'}</p>}
    </div>
  );
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

/** The handful of open discrepancies that couldn't auto-reconcile and
 *  aren't a "doesn't match any store item by name" case — a unit that
 *  couldn't be converted, a cage reassignment across batches, a day with
 *  nowhere yet to write into, etc. Store trusts the report (closing these
 *  out as-is) or rejects the whole report to fix and re-upload. No
 *  Director/Owner sign-off required — Store owns this end-to-end. */
function ResolvePanel({ report, batchId }: { report: Report; batchId: string }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const open = report.discrepancies.filter(d => !d.resolved && !d.notes?.includes('Could not match'));

  const approve = useMutation({
    mutationFn: async () => (await api.post(`/store/production-reports/${report.id}/approve`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['production-report', batchId] }),
  });
  const reject = useMutation({
    mutationFn: async () => (await api.post(`/store/production-reports/${report.id}/reject`, { reason })).data as {
      rollbackReverted: number; rollbackSkipped: { entityType: string; reason: string }[];
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production-report', batchId] });
      setShowReject(false); setReason('');
    },
  });

  if (open.length === 0) return null;

  return (
    <div className="space-y-2 pt-1">
      {!showReject ? (
        <div className="flex items-center gap-2">
          <button
            onClick={() => approve.mutate()}
            disabled={approve.isPending}
            className="flex-1 bg-brand-green text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-brand-green/90 disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            <CheckCircle className="w-4 h-4" /> {approve.isPending ? 'Applying…' : 'Trust the report for these'}
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
            placeholder="Reason for rejecting"
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
              {reject.isPending ? 'Rejecting…' : 'Confirm rejection'}
            </button>
          </div>
        </div>
      )}
      {approve.isError && <p className="text-xs text-red-500">{(approve.error as any)?.response?.data?.message ?? 'Approval failed'}</p>}
      {reject.isError && <p className="text-xs text-red-500">{(reject.error as any)?.response?.data?.message ?? 'Rejection failed'}</p>}
    </div>
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
          {report.storeVerifiedBy && (
            <p className="text-[11px] text-gray-400 mt-0.5">
              Table verified by {report.storeVerifiedBy.fullName} before submission
              {report.storeVerifiedAt && ` · ${dayjs(report.storeVerifiedAt).format('D MMM, HH:mm')}`}
            </p>
          )}
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

      {report.rawRows && report.rawRows.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Report as uploaded — every column, every row
          </p>
          <ProductionReportTable rows={report.rawRows} />
        </div>
      )}

      {report.status === 'REJECTED' && report.rejectionReason && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 rounded-xl p-3 text-sm text-red-700 dark:text-red-400">
          <span className="font-semibold">Rejected: </span>{report.rejectionReason}
          <p className="text-xs mt-1 text-red-500">Correct the issue and re-upload below.</p>
        </div>
      )}

      {report.discrepancies.filter(d => !d.resolved).length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Open discrepancies — resolve to finalize</p>
          {report.discrepancies.filter(d => !d.resolved).map(d => (
            d.notes?.includes('Could not match') ? (
              <UnmatchedItemRow key={d.id} d={d} batchId={batchId} />
            ) : (
              <div key={d.id} className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30 rounded-xl p-3 text-sm">
                <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-gray-800 dark:text-gray-200">
                    {d.field} — {dayjs(d.rowDate).format('D MMM YYYY')}{d.locationRef ? ` (${d.locationRef})` : ''}
                  </p>
                  <p className="text-xs text-gray-500">System: {d.systemValue ?? '—'} · Report: {d.reportValue ?? '—'}</p>
                  {d.notes && <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">{d.notes}</p>}
                </div>
              </div>
            )
          ))}
          <ResolvePanel report={report} batchId={batchId} />
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <a
          href={`${api.defaults.baseURL}/store/production-reports/${batchId}/export`}
          target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-green hover:underline"
        >
          <Download className="w-3.5 h-3.5" /> Export current report
        </a>
      </div>

      <RollbackPanel report={report} batchId={batchId} />
    </div>
  );
}

// Every canonical field the parser understands, in the order they read most
// naturally on a sheet — mirrors CANONICAL_FIELD_LABELS in the backend DTO.
const FIELD_OPTIONS: { key: string; label: string }[] = [
  { key: 'date', label: 'Date' }, { key: 'row', label: 'Row / Deck' }, { key: 'level', label: 'Level' },
  { key: 'cage', label: 'Cage' }, { key: 'feedKg', label: 'Feed (Kg)' }, { key: 'feedType', label: 'Feed Type' },
  { key: 'waterLts', label: 'Water (L)' }, { key: 'mortality', label: 'Mortality' }, { key: 'culling', label: 'Culling' },
  { key: 'openingStock', label: 'Opening Stock' }, { key: 'closingStock', label: 'Closing Stock' },
  { key: 'avgWeight', label: 'Avg Weight' }, { key: 'temperature', label: 'Temperature' },
  { key: 'humidity', label: 'Humidity' }, { key: 'lux', label: 'Lux' },
  { key: 'vaccineText', label: 'Vaccine' }, { key: 'supplementText', label: 'Supplement' },
  { key: 'treatmentText', label: 'Treatment' },
  { key: 'drugsVaccines', label: 'Drugs/Vaccines (blended col.)' }, { key: 'notes', label: 'Remarks' },
];


function UploadPanel({ batchId, onSubmitted }: { batchId: string; onSubmitted: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<{ fields: Record<string, string>; items: Record<string, string> }>({ fields: {}, items: {} });
  const [detecting, setDetecting] = useState(false);
  const [totalRows, setTotalRows] = useState(0);

  // §2a — the verify step: preview() has been called and Store is looking
  // at the full parsed table, deciding whether to Approve & Submit or
  // Reject and go fix the mapping/sheet. submit() is only ever reachable
  // from here — there is no "submit" button back on the mapping screen.
  const [step, setStep] = useState<'mapping' | 'verify'>('mapping');
  const [previewData, setPreviewData] = useState<{ rows: any[]; totalRows: number; presentFields: string[]; presentItemColumns: any[] } | null>(null);

  const resetAll = () => {
    setFile(null); setHeaders([]); setMapping({ fields: {}, items: {} });
    setStep('mapping'); setPreviewData(null);
  };

  const preview = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('No file selected');
      const form = new FormData();
      form.append('file', file);
      form.append('mapping', JSON.stringify(mapping));
      return (await api.post('/store/production-reports/preview', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })).data;
    },
    onSuccess: (data) => { setPreviewData(data); setStep('verify'); },
  });

  const discard = useMutation({
    mutationFn: async () => (await api.post(`/store/production-reports/${batchId}/discard`, {
      fileName: file?.name, mapping,
    })).data,
    onSuccess: () => resetAll(),
  });

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
      onSubmitted();
      // Keep the confirmation banner visible with the mapping/file gone —
      // resetAll() but preserve the success message by not clearing submit's data.
      setFile(null); setHeaders([]); setMapping({ fields: {}, items: {} }); setStep('mapping'); setPreviewData(null);
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
      ) : step === 'mapping' ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <FileSpreadsheet className="w-4 h-4 text-brand-green" />
            <span className="font-medium">{file.name}</span>
            <span className="text-xs text-gray-400">· {totalRows} rows detected</span>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Column mapping — check before previewing</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
              {FIELD_OPTIONS.map(f => (
                <div key={f.key} className="flex flex-col gap-1 min-w-0">
                  <label className="text-xs text-gray-500 truncate" title={f.label}>{f.label}</label>
                  <select
                    value={mapping.fields[f.key] ?? ''}
                    onChange={e => setMapping(m => ({ ...m, fields: { ...m.fields, [f.key]: e.target.value } }))}
                    className="w-full min-w-0 text-xs border border-gray-200 dark:border-dark-border rounded-lg px-2 py-1.5 bg-white dark:bg-dark-bg"
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
                    {header as string}
                  </span>
                ))}
              </div>
            </div>
          )}

          {!mapping.fields.date && (
            <p className="text-xs text-red-500">A Date column must be mapped before previewing.</p>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={resetAll}
              className="text-xs font-semibold text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              <ArrowLeft className="w-3 h-3" /> Choose a different file
            </button>
            <button
              disabled={!mapping.fields.date || preview.isPending}
              onClick={() => preview.mutate()}
              className="ml-auto bg-brand-green text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-brand-green/90 disabled:opacity-50 transition-colors flex items-center gap-1.5"
            >
              {preview.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
              Preview table
            </button>
          </div>

          {preview.isError && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 rounded-xl p-3 text-sm text-red-700 dark:text-red-400">
              {(preview.error as any)?.response?.data?.message ?? 'Could not read this file with the current mapping'}
            </div>
          )}
        </div>
      ) : (
        // ── Verify step (§2/§2a) ────────────────────────────────────────
        // The full parsed table — every row, only columns that actually
        // have data — so Store can confirm the sheet was read correctly
        // BEFORE anything is reconciled/applied to the system.
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <FileSpreadsheet className="w-4 h-4 text-brand-green" />
              <span className="font-medium">{file.name}</span>
              <span className="text-xs text-gray-400">· {previewData?.totalRows ?? 0} rows — does this look right?</span>
            </div>
            <button
              onClick={() => setStep('mapping')}
              className="text-xs font-semibold text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              <ArrowLeft className="w-3 h-3" /> Back to mapping
            </button>
          </div>

          {previewData && (
            <ProductionReportTable rows={previewData.rows} />
          )}

          <p className="text-xs text-gray-500">
            Review every row above — this is the sheet exactly as uploaded, every column and cell included, not
            just the ones the system recognises. Approving submits this for reconciliation against feed,
            mortality, and store records — anything that doesn't conflict is applied immediately. If the table
            doesn't look right, reject it and fix the file or the column mapping instead.
          </p>

          <div className="flex items-center gap-2 pt-1">
            <button
              disabled={discard.isPending}
              onClick={() => discard.mutate()}
              className="flex items-center gap-1.5 text-sm font-semibold text-red-600 hover:text-red-700 border border-red-200 dark:border-red-900/40 px-4 py-2 rounded-xl disabled:opacity-50"
            >
              {discard.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
              Reject — this isn't right
            </button>
            <button
              disabled={submit.isPending}
              onClick={() => submit.mutate()}
              className="ml-auto bg-brand-green text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-brand-green/90 disabled:opacity-50 transition-colors flex items-center gap-1.5"
            >
              {submit.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
              Approve & Submit
            </button>
          </div>
        </div>
      )}

      {submit.isSuccess && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-900/30 rounded-xl p-3 text-sm text-green-700 dark:text-green-400">
          Submitted — {submit.data.matchedCount} matched, {submit.data.autofillCount} auto-filled
          {submit.data.discrepancyCount > 0
            ? `, ${submit.data.discrepancyCount} discrepanc${submit.data.discrepancyCount === 1 ? 'y' : 'ies'} to resolve below.`
            : ' — applied with no discrepancies.'}
        </div>
      )}
      {submit.isError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 rounded-xl p-3 text-sm text-red-700 dark:text-red-400">
          {(submit.error as any)?.response?.data?.message ?? 'Submission failed'}
        </div>
      )}
      {discard.isSuccess && !file && (
        <div className="bg-gray-50 dark:bg-dark-bg border border-gray-100 dark:border-dark-border rounded-xl p-3 text-sm text-gray-600 dark:text-gray-400">
          Discarded — nothing was applied. Select a file to try again.
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
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Production Report</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Upload the day-by-day production sheet for a batch — feed, mortality, stock, and items used are
          checked against what's already recorded and applied automatically wherever there's no conflict.
          You'll review the full parsed table before anything is submitted, and resolve any remaining
          discrepancies yourself — no Director sign-off needed.
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
