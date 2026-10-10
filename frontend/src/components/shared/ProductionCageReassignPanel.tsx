// src/components/shared/ProductionCageReassignPanel.tsx
//
// Record a production-house cage reassignment in plain words — no fixed
// format. The server reads it, shows exactly which cages change (Preview),
// then applies it to the cage map. Anything it can't place can still be saved
// as a written note so nothing the attendant typed is lost.
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, CheckCircle2, Eye, Loader2, NotebookPen, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api/client';
import dayjs from '../../lib/dayjs';
import { HOUSE_QUERY_KEYS, type HouseCode } from '../../hooks/useProductionHouses';

interface Preview {
  steps: { clause: string; summary: string }[];
  problems: { clause: string; reason: string }[];
  ignored: string[];
  changes: { cageCode: string; cageLabel: string; beforeCount: number; afterCount: number }[];
  canApply: boolean;
}

function errMsg(err: any): string {
  const m = err?.response?.data?.message ?? err?.message ?? 'Failed.';
  return Array.isArray(m) ? m.join(', ') : String(m);
}

const EXAMPLES =
  'Moved 3 birds from A1 level 2 tier 5 cage 1 into isolation cage 2 because they were limping.\n' +
  'Transferred two hens to cage 3 from B2 top level tier 10 cage 1.\n' +
  'C1 bottom level tiers 1-6 now have 4 birds each.';

export function ProductionCageReassignPanel({ houseCode, batchId }: { houseCode: HouseCode; batchId?: string }) {
  const qc = useQueryClient();
  const [description, setDescription] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { setPreview(null); }, [description, houseCode]);

  const { data: recent = [] } = useQuery<any[]>({
    queryKey: ['production-reassignments', houseCode],
    queryFn: () => api.get(`/production/houses/${houseCode}/reassignments`).then(r => r.data),
    staleTime: 30_000,
  });

  const doPreview = useMutation({
    mutationFn: () => api.post(`/production/houses/${houseCode}/reassignments/preview`, { description, batchId })
      .then(r => r.data as Preview),
    onSuccess: setPreview,
  });
  const save = useMutation({
    mutationFn: (noteOnly: boolean) => api.post(`/production/houses/${houseCode}/reassignments`, {
      description, batchId, noteOnly, effectiveDate: dayjs().format('YYYY-MM-DD'),
    }).then(r => r.data),
    onSuccess: (rec: any) => {
      HOUSE_QUERY_KEYS.forEach(k => qc.invalidateQueries({ queryKey: k }));
      qc.invalidateQueries({ queryKey: ['production-reassignments', houseCode] });
      setMessage(rec.applied ? 'Reassignment applied to the cage map.' : 'Saved as a note — cage map unchanged.');
      setDescription('');
    },
  });

  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-dark-border space-y-3">
      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide flex items-center gap-2">
        <ArrowRightLeft className="w-4 h-4 text-emerald-500" /> Cage Reassignment ({houseCode === 'BLK2' ? 'Block 2' : 'Block 1'})
      </p>
      <p className="text-[11px] text-gray-400">
        Write where the birds went in your own words — any order, any wording. Mention the row (A1–C2), level
        (or top/bottom), tier and cage, or an isolation cage, and how many birds. Preview shows what will change.
      </p>
      <textarea value={description} onChange={e => { setDescription(e.target.value); setMessage(null); }} rows={4}
        placeholder={EXAMPLES}
        className="w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-y" />

      <div className="flex gap-2 flex-wrap">
        <button type="button" disabled={!description.trim() || doPreview.isPending} onClick={() => doPreview.mutate()}
          className="flex-1 min-w-[8rem] border border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400 rounded-xl py-2 text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50">
          {doPreview.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />} Preview
        </button>
        <button type="button" disabled={!preview?.canApply || save.isPending} onClick={() => save.mutate(false)}
          className="flex-1 min-w-[8rem] bg-emerald-500 text-white rounded-xl py-2 text-sm font-semibold disabled:opacity-50">
          Apply to cage map
        </button>
        <button type="button" disabled={!description.trim() || save.isPending} onClick={() => save.mutate(true)}
          className="flex-1 min-w-[8rem] border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-300 rounded-xl py-2 text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50">
          <NotebookPen className="w-3.5 h-3.5" /> Save as note only
        </button>
      </div>

      {doPreview.isError && <p className="text-sm text-red-500">{errMsg(doPreview.error)}</p>}
      {save.isError && <p className="text-sm text-red-500 whitespace-pre-line">{errMsg(save.error)}</p>}
      {message && <p className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> {message}</p>}

      {preview && (
        <div className="rounded-xl border border-gray-100 dark:border-dark-border p-3 space-y-2 text-xs">
          {preview.steps.map((s, i) => (
            <p key={i} className="text-gray-700 dark:text-gray-200"><CheckCircle2 className="w-3.5 h-3.5 inline text-emerald-500 mr-1" />{s.summary}</p>
          ))}
          {preview.problems.map((p, i) => (
            <p key={i} className="text-red-600 dark:text-red-400">
              <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />“{p.clause}” — {p.reason}
            </p>
          ))}
          {preview.ignored.length > 0 && (
            <p className="text-gray-400">Not about a cage (kept in the note): {preview.ignored.map(c => `“${c}”`).join(', ')}</p>
          )}
          {preview.changes.length > 0 && (
            <div className="max-h-40 overflow-y-auto divide-y divide-gray-100 dark:divide-dark-border">
              {preview.changes.map(c => (
                <div key={c.cageCode} className="flex justify-between py-1 text-gray-600 dark:text-gray-300">
                  <span>{c.cageLabel}</span>
                  <span className="font-semibold">{c.beforeCount} → {c.afterCount}</span>
                </div>
              ))}
            </div>
          )}
          {!preview.canApply && (
            <p className="text-amber-600 dark:text-amber-400">
              Fix the highlighted parts and preview again, or save it as a note only.
            </p>
          )}
        </div>
      )}

      {recent.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-gray-500">Recent reassignments ({recent.length})</summary>
          <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
            {recent.map(r => (
              <div key={r.id} className="rounded-lg bg-gray-50 dark:bg-dark-bg p-2">
                <p className="text-gray-400">{dayjs(r.createdAt).format('D MMM HH:mm')} · {r.applied ? 'applied' : 'note only'}</p>
                <p className="text-gray-700 dark:text-gray-200 whitespace-pre-line">{r.description}</p>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
