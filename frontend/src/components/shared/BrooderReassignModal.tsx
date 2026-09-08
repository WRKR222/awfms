// src/components/shared/BrooderReassignModal.tsx
//
// Cage reassignment — describe a batch's whole new cage layout as a handful
// of patterns instead of moving birds cage-by-cage. Extracted back out into
// its own standalone action (this is what the cage map's "Reassign" button
// opens) now that BrooderDailyLogModal (which had folded this in alongside
// the daily log) has been retired in favour of the 3-popup attendant daily
// log — reassignment isn't part of "daily log" and doesn't belong gated
// behind any of the 3 popups' time windows.
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X, AlertTriangle, Plus, Info, Grid3x3, Eye, Loader2, CheckCircle2,
} from 'lucide-react';
import { api } from '../../lib/api';
import dayjs from '../../lib/dayjs';
import { useBrooderRowsAndLevels } from '../../hooks/useBrooderCageMap';

const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500';
const lCls = 'block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide';

export interface BrooderBatchLite {
  id: string;
  batchCode: string;
  currentBirdCount: number;
  quantityReceived: number;
  dateOfHatch: string;
}

interface Props {
  batch: BrooderBatchLite;
  onClose: () => void;
}

function errMsg(err: any): string {
  const m = err?.response?.data?.message ?? err?.message ?? 'Failed to save.';
  return Array.isArray(m) ? m.join(', ') : String(m);
}

export function BrooderReassignModal({ batch, onClose }: Props) {
  const qc = useQueryClient();
  const today = dayjs().format('YYYY-MM-DD');
  const min = dayjs(batch.dateOfHatch).format('YYYY-MM-DD');
  const { data: rowsAndLevels = [] } = useBrooderRowsAndLevels(true);

  const [placedDate, setPlacedDate] = useState(today);

  interface ReassignBlock {
    id: string;
    rowId: string;
    levelIds: string[];
    startCageNumber: string;
    cageCount: string;
    birdsPerCage: string;
    isIsolation: boolean;
    isolationReason: string;
  }
  const emptyReassignBlock = (): ReassignBlock => ({
    id: Math.random().toString(36).slice(2), rowId: '', levelIds: [], startCageNumber: '1', cageCount: '', birdsPerCage: '',
    isIsolation: false, isolationReason: '',
  });
  const [reassignBlocks, setReassignBlocks] = useState<ReassignBlock[]>([emptyReassignBlock()]);
  const [reassignNotes, setReassignNotes] = useState('');
  function addReassignBlock()    { setReassignBlocks(b => [...b, emptyReassignBlock()]); }
  function removeReassignBlock(id: string) { setReassignBlocks(b => b.filter(x => x.id !== id)); }
  function updateReassignBlock(id: string, field: keyof ReassignBlock, val: string | boolean) {
    setReassignBlocks(b => b.map(x => {
      if (x.id !== id) return x;
      const next = { ...x, [field]: val } as ReassignBlock;
      if (field === 'rowId') next.levelIds = [];
      return next;
    }));
  }
  function toggleReassignLevel(id: string, levelId: string) {
    setReassignBlocks(b => b.map(x => x.id !== id ? x : {
      ...x, levelIds: x.levelIds.includes(levelId) ? x.levelIds.filter(l => l !== levelId) : [...x.levelIds, levelId],
    }));
  }
  const reassignTotalBirds = reassignBlocks.reduce(
    (sum, b) => sum + b.levelIds.length * (Number(b.cageCount) || 0) * (Number(b.birdsPerCage) || 0), 0,
  );
  const reassignIsolationBirds = reassignBlocks
    .filter(b => b.isIsolation)
    .reduce((sum, b) => sum + b.levelIds.length * (Number(b.cageCount) || 0) * (Number(b.birdsPerCage) || 0), 0);

  type ReassignPreview = {
    batchCode: string; liveBirdCount: number; cagesAssigned: number;
    isolationCages: number; totalBirds: number; overCapacityBy: number;
    byLevel: { rowLabel: string; levelLabel: string; cages: number; birds: number }[];
  };
  const [reassignMode, setReassignMode] = useState<'blocks' | 'text'>('blocks');
  const [reassignDescription, setReassignDescription] = useState('');
  const [reassignPreview, setReassignPreview] = useState<ReassignPreview | null>(null);
  const previewReassignText = useMutation({
    mutationFn: () =>
      api.post(`/brooder/batches/${batch.id}/reassign-bulk-text/preview`, {
        description: reassignDescription,
        placedDate,
        notes: reassignNotes || undefined,
      }).then(r => r.data as ReassignPreview),
    onSuccess: (data) => setReassignPreview(data),
    onError: () => setReassignPreview(null),
  });
  useEffect(() => { setReassignPreview(null); }, [reassignDescription, placedDate]);

  const REASSIGN_DESCRIPTION_PLACEHOLDER =
    'Row F Level 4:\n1-33: 9 birds each\n34: 8 birds\n35-39: 9 birds each\n40: 8 birds\n41-44: 9 birds each';

  const [submitError, setSubmitError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      if (reassignMode === 'text') {
        const res = await api.post(`/brooder/batches/${batch.id}/reassign-bulk-text`, {
          description: reassignDescription,
          placedDate,
          notes: reassignNotes || undefined,
        });
        return res.data;
      }
      const res = await api.post(`/brooder/batches/${batch.id}/reassign-bulk`, {
        blocks: reassignBlocks.map(b => ({
          rowId: b.rowId,
          levelIds: b.levelIds,
          cageCount: Number(b.cageCount),
          birdsPerCage: Number(b.birdsPerCage),
          startCageNumber: b.startCageNumber ? Number(b.startCageNumber) : undefined,
          isIsolation: b.isIsolation,
          isolationReason: b.isIsolation ? b.isolationReason.trim() : undefined,
        })),
        placedDate,
        notes: reassignNotes || undefined,
      });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brooder-cage-map'] });
      qc.invalidateQueries({ queryKey: ['brooder-rows-and-levels'] });
      qc.invalidateQueries({ queryKey: ['brooder-feed-summary'] });
      onClose();
    },
    onError: (err: any) => setSubmitError(errMsg(err)),
  });

  function handleSubmit() {
    setSubmitError(null);
    if (reassignMode === 'text') {
      if (!reassignDescription.trim()) { setSubmitError('Describe the new cage layout first.'); return; }
      if (!reassignPreview) { setSubmitError('Preview the layout description before saving, so you can confirm it parsed the way you expect.'); return; }
    } else {
      if (reassignBlocks.length === 0) { setSubmitError('Add at least one block.'); return; }
      const incomplete = reassignBlocks.some(b =>
        !b.rowId || b.levelIds.length === 0 || !(Number(b.cageCount) > 0) || b.birdsPerCage === '' || Number(b.birdsPerCage) < 0,
      );
      if (incomplete) {
        setSubmitError('Complete every block (row, at least one level, cage count, and birds per cage) or remove incomplete ones.');
        return;
      }
      const missingIsolationReason = reassignBlocks.some(b => b.isIsolation && b.isolationReason.trim().length < 3);
      if (missingIsolationReason) {
        setSubmitError('Give a reason (at least 3 characters) for each block marked as an isolation cage.');
        return;
      }
    }
    submit.mutate();
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white dark:bg-dark-card w-full md:max-w-xl rounded-t-3xl md:rounded-2xl shadow-2xl overflow-y-auto max-h-[95vh]">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-dark-border sticky top-0 bg-white dark:bg-dark-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-emerald-500 rounded-xl flex items-center justify-center">
              <Grid3x3 className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-bold text-gray-800 dark:text-gray-100">Cage Reassignment</p>
              <p className="text-xs text-gray-400">{batch.batchCode} · pattern-based — replaces per-cage moves</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-bg">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className={lCls}>Effective date</label>
            <input value={placedDate} onChange={e => setPlacedDate(e.target.value)} type="date" min={min} max={today} className={iCls} />
          </div>

          <div className="flex items-start gap-2 bg-gray-50 dark:bg-dark-bg rounded-xl p-3 text-sm">
            <Info className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
            <span className="text-gray-600 dark:text-gray-300">
              Describe the new layout instead of moving birds cage-by-cage — pick <strong>Blocks</strong> to
              build it with row/level pickers, or <strong>Describe layout</strong> to type it out (handles
              mixed counts, like "cages 1-33 have 9 birds, 34 has 8" in one go). This{' '}
              <strong>replaces the batch's entire cage layout</strong> with what you define below.
            </span>
          </div>

          <div className="flex rounded-xl bg-gray-100 dark:bg-dark-bg p-1 gap-1">
            <button type="button" onClick={() => setReassignMode('blocks')}
              className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-colors ${
                reassignMode === 'blocks'
                  ? 'bg-white dark:bg-dark-card text-emerald-600 dark:text-emerald-400 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400'
              }`}>
              Blocks
            </button>
            <button type="button" onClick={() => setReassignMode('text')}
              className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-colors ${
                reassignMode === 'text'
                  ? 'bg-white dark:bg-dark-card text-emerald-600 dark:text-emerald-400 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400'
              }`}>
              Describe layout
            </button>
          </div>

          {reassignMode === 'blocks' && (
            <>
              {reassignBlocks.map((b, i) => {
                const levelsForRow = rowsAndLevels.find(r => r.rowId === b.rowId)?.levels ?? [];
                const blockBirds = b.levelIds.length * (Number(b.cageCount) || 0) * (Number(b.birdsPerCage) || 0);
                return (
                  <div key={b.id} className="rounded-xl border border-emerald-100 dark:border-emerald-800 bg-white dark:bg-dark-bg p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">Block {i + 1}</span>
                      <button type="button" onClick={() => removeReassignBlock(b.id)} className="text-gray-400 hover:text-red-500">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div>
                      <label className={lCls}>Row</label>
                      <select value={b.rowId} onChange={e => updateReassignBlock(b.id, 'rowId', e.target.value)} className={iCls}>
                        <option value="">Select row…</option>
                        {rowsAndLevels.map(r => <option key={r.rowId} value={r.rowId}>{r.label}</option>)}
                      </select>
                    </div>

                    <div>
                      <label className={lCls}>Levels — pattern applies to each one you pick</label>
                      <div className="flex flex-wrap gap-1.5">
                        {!b.rowId && <span className="text-[11px] text-gray-400 italic">Select a row first</span>}
                        {levelsForRow.map(l => (
                          <button key={l.levelId} type="button" onClick={() => toggleReassignLevel(b.id, l.levelId)}
                            className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                              b.levelIds.includes(l.levelId)
                                ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                                : 'border-gray-200 dark:border-dark-border text-gray-500 dark:text-gray-400'
                            }`}>
                            {l.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className={lCls}>Start cage #</label>
                        <input value={b.startCageNumber} onChange={e => updateReassignBlock(b.id, 'startCageNumber', e.target.value)}
                          type="number" min="1" className={iCls} />
                      </div>
                      <div>
                        <label className={lCls}># of cages</label>
                        <input value={b.cageCount} onChange={e => updateReassignBlock(b.id, 'cageCount', e.target.value)}
                          type="number" min="1" className={iCls} placeholder="e.g. 42" />
                      </div>
                      <div>
                        <label className={lCls}>Birds / cage</label>
                        <input value={b.birdsPerCage} onChange={e => updateReassignBlock(b.id, 'birdsPerCage', e.target.value)}
                          type="number" min="0" className={iCls} placeholder="e.g. 20" />
                      </div>
                    </div>

                    {blockBirds > 0 && (
                      <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                        = {blockBirds.toLocaleString()} birds across {b.levelIds.length} level{b.levelIds.length !== 1 ? 's' : ''}
                        {' '}({b.cageCount || 0} cages × {b.birdsPerCage || 0} birds, from cage {b.startCageNumber || 1})
                      </p>
                    )}

                    <label className={`flex items-center gap-2 cursor-pointer p-2.5 rounded-xl ${
                      b.isIsolation ? 'bg-red-50 dark:bg-red-900/20' : 'bg-gray-50 dark:bg-dark-card'
                    }`}>
                      <input type="checkbox" checked={b.isIsolation}
                        onChange={e => updateReassignBlock(b.id, 'isIsolation', e.target.checked)}
                        className="w-4 h-4 accent-red-500" />
                      <AlertTriangle className={`w-4 h-4 ${b.isIsolation ? 'text-red-500' : 'text-gray-400'}`} />
                      <span className={`text-sm font-semibold ${b.isIsolation ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
                        Mark this block as isolation cage{b.levelIds.length * (Number(b.cageCount) || 0) !== 1 ? 's' : ''}
                      </span>
                    </label>
                    {b.isIsolation && (
                      <div>
                        <label className={lCls}>Isolation reason</label>
                        <textarea value={b.isolationReason} onChange={e => updateReassignBlock(b.id, 'isolationReason', e.target.value)}
                          rows={2} className={`${iCls} resize-none`} placeholder="e.g. sick birds separated for observation..." />
                      </div>
                    )}
                  </div>
                );
              })}

              <button type="button" onClick={addReassignBlock}
                className="w-full border border-dashed border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400 rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-1.5 hover:bg-emerald-50 dark:hover:bg-emerald-900/10 transition-colors">
                <Plus className="w-3.5 h-3.5" /> Add block
              </button>

              {reassignBlocks.length > 0 && (
                <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 p-3 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  Total: {reassignTotalBirds.toLocaleString()} birds across {reassignBlocks.length} block{reassignBlocks.length !== 1 ? 's' : ''}
                  {reassignIsolationBirds > 0 && (
                    <span className="block text-red-600 dark:text-red-400 font-normal mt-1">
                      Includes {reassignIsolationBirds.toLocaleString()} birds marked as isolation.
                    </span>
                  )}
                  {reassignTotalBirds > batch.currentBirdCount && (
                    <span className="block text-red-600 dark:text-red-400 font-normal mt-1">
                      Exceeds the {batch.currentBirdCount.toLocaleString()} live birds this batch currently has.
                    </span>
                  )}
                </div>
              )}
            </>
          )}

          {reassignMode === 'text' && (
            <>
              <div>
                <label className={lCls}>Layout description</label>
                <textarea
                  value={reassignDescription}
                  onChange={e => setReassignDescription(e.target.value)}
                  rows={7}
                  className={`${iCls} resize-y font-mono text-xs leading-relaxed`}
                  placeholder={REASSIGN_DESCRIPTION_PLACEHOLDER}
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  Start each row with "Row &lt;letter&gt; Level &lt;number&gt;:", then list cage ranges and
                  bird counts, one per line. Add "(isolation: reason)" after a row/level header or a segment
                  to mark it as isolation.
                </p>
              </div>

              <button type="button"
                onClick={() => previewReassignText.mutate()}
                disabled={!reassignDescription.trim() || previewReassignText.isPending}
                className="w-full border border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400 rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-1.5 hover:bg-emerald-50 dark:hover:bg-emerald-900/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {previewReassignText.isPending
                  ? (<><Loader2 className="w-3.5 h-3.5 animate-spin" /> Parsing…</>)
                  : (<><Eye className="w-3.5 h-3.5" /> Preview</>)}
              </button>

              {previewReassignText.isError && (
                <div className="rounded-xl bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-600 dark:text-red-400">
                  {errMsg(previewReassignText.error as any)}
                </div>
              )}

              {reassignPreview && (
                <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-dark-bg p-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-4 h-4" /> Parsed successfully
                  </div>
                  <div className="space-y-1">
                    {reassignPreview.byLevel.map((lvl, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-300">
                        <span>{lvl.rowLabel} · {lvl.levelLabel}</span>
                        <span className="font-semibold">{lvl.cages} cage{lvl.cages !== 1 ? 's' : ''} · {lvl.birds.toLocaleString()} birds</span>
                      </div>
                    ))}
                  </div>
                  <div className="pt-2 border-t border-gray-100 dark:border-dark-border text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                    Total: {reassignPreview.totalBirds.toLocaleString()} birds across {reassignPreview.cagesAssigned} cage{reassignPreview.cagesAssigned !== 1 ? 's' : ''}
                    {reassignPreview.isolationCages > 0 && (
                      <span className="block text-red-600 dark:text-red-400 font-normal mt-1">
                        Includes {reassignPreview.isolationCages} isolation cage{reassignPreview.isolationCages !== 1 ? 's' : ''}.
                      </span>
                    )}
                    {reassignPreview.overCapacityBy > 0 && (
                      <span className="block text-red-600 dark:text-red-400 font-normal mt-1">
                        Exceeds the {reassignPreview.liveBirdCount.toLocaleString()} live birds this batch currently has by {reassignPreview.overCapacityBy.toLocaleString()}.
                      </span>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {((reassignMode === 'blocks' && reassignBlocks.length > 0) ||
            (reassignMode === 'text' && reassignDescription.trim().length > 0)) && (
            <textarea value={reassignNotes} onChange={e => setReassignNotes(e.target.value)} rows={2}
              className={`${iCls} resize-none`} placeholder="Reassignment notes (optional)..." />
          )}

          {submitError && (
            <p className="text-red-500 text-sm bg-red-50 dark:bg-red-900/20 rounded-xl p-3 whitespace-pre-line">
              {submitError}
            </p>
          )}
        </div>

        <div className="p-5 border-t border-gray-100 dark:border-dark-border sticky bottom-0 bg-white dark:bg-dark-card flex gap-3">
          <button type="button" onClick={onClose}
            className="flex-1 border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 rounded-xl py-3 font-semibold text-sm">
            Cancel
          </button>
          <button type="button" onClick={handleSubmit} disabled={submit.isPending}
            className="flex-1 bg-emerald-500 text-white rounded-xl py-3 font-semibold text-sm disabled:opacity-60">
            {submit.isPending ? 'Saving…' : 'Save Reassignment'}
          </button>
        </div>
      </div>
    </div>
  );
}
