// src/components/shared/ProductionCageMap.tsx
//
// Interactive per-cage map of the production houses (Block 1 & Block 2),
// mirroring the brooder cage map: sections A/B/C → rows A1…C2 → 4 levels
// (top to bottom) → tiers (Block 1: 24, Block 2: 38) → 4 cages per tier, plus
// 8 isolation cages per house. A cage holds at most 4 birds.
//
//   • Tap a level           → expands its tiers and cages.
//   • Tap a cage (editable) → assign a batch / change the bird count / empty it.
//   • "Fill empty cages"    → place a batch into every empty cage of a level.
//   • Picker mode (onPickCage) → tapping a cage hands it back to the caller
//     instead (used to record per-cage mortality on the egg collection page).
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bird, ChevronDown, Grid3x3, Layers, Lock, Skull, Warehouse, X } from 'lucide-react';
import { api } from '../../lib/api/client';
import dayjs from '../../lib/dayjs';
import {
  HOUSES, HOUSE_QUERY_KEYS, cageCode, cageLabel, isolationCode, levelLabel, pad2, useHouseMap,
  type HouseCode, type OccupiedCage,
} from '../../hooks/useProductionHouses';

const PALETTE = [
  'bg-emerald-500/30 border-emerald-400/60 text-emerald-100',
  'bg-sky-500/30 border-sky-400/60 text-sky-100',
  'bg-fuchsia-500/30 border-fuchsia-400/60 text-fuchsia-100',
  'bg-amber-500/30 border-amber-400/60 text-amber-100',
  'bg-orange-500/30 border-orange-400/60 text-orange-100',
  'bg-violet-500/30 border-violet-400/60 text-violet-100',
];
const DOT = ['bg-emerald-400', 'bg-sky-400', 'bg-fuchsia-400', 'bg-amber-400', 'bg-orange-400', 'bg-violet-400'];

export interface PickedCage {
  code: string;
  label: string;
  birdCount: number;
  batchCode: string | null;
}

interface CageTarget {
  code: string;
  label: string;
  isIsolation: boolean;
  occupied: OccupiedCage | null;
}

function errMsg(err: any): string {
  const m = err?.response?.data?.message ?? err?.message ?? 'Failed to save.';
  return Array.isArray(m) ? m.join(', ') : String(m);
}

function useProductionBatches(enabled: boolean) {
  return useQuery<any[]>({
    queryKey: ['batches', 'active'],
    queryFn: () => api.get('/flock/batches?isActive=true').then(r => r.data),
    enabled,
    staleTime: 60_000,
    select: (rows: any[]) => rows.filter(b => b.stage === 'PRODUCTION'),
  });
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  HOUSE_QUERY_KEYS.forEach(k => qc.invalidateQueries({ queryKey: k }));
}

// ── Cage edit modal ──────────────────────────────────────────────────────────

function CageModal({ house, target, editable, onClose }: {
  house: HouseCode; target: CageTarget; editable: boolean; onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: batches = [] } = useProductionBatches(editable);
  const [batchId, setBatchId] = useState(target.occupied?.batchId ?? '');
  const [count, setCount] = useState(String(target.occupied?.birdCount ?? 4));
  const [reason, setReason] = useState(target.occupied?.isolationReason ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (birdCount: number) => api.post(`/production/houses/${house}/cages/assign`, {
      cageCodes: [target.code], batchId: batchId || undefined, birdCount,
      isolationReason: target.isIsolation ? reason : undefined,
    }),
    onSuccess: () => { invalidateAll(qc); onClose(); },
    onError: (e: any) => setError(errMsg(e)),
  });

  const occ = target.occupied;
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-dark-card w-full md:max-w-sm rounded-t-3xl md:rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-dark-border">
          <div>
            <p className="font-bold text-gray-800 dark:text-gray-100 text-sm">{target.label}</p>
            <p className="text-[11px] text-gray-400 font-mono">{target.code}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-bg"><X className="w-4 h-4 text-gray-500" /></button>
        </div>
        <div className="p-4 space-y-3 text-sm">
          {occ ? (
            <div className="rounded-xl bg-gray-50 dark:bg-dark-bg p-3 text-xs text-gray-600 dark:text-gray-300 space-y-0.5">
              <p><span className="text-gray-400">Batch:</span> <strong>{occ.batchCode}</strong></p>
              <p><span className="text-gray-400">Birds:</span> <strong>{occ.birdCount}</strong> / {occ.capacity}</p>
              <p><span className="text-gray-400">Placed:</span> {dayjs(occ.placedDate).format('D MMM YYYY')}</p>
              {occ.mortality7d > 0 && <p className="text-red-500">Mortalities (7 days): {occ.mortality7d}</p>}
              {occ.isolationReason && <p className="text-purple-600 dark:text-purple-300">Isolation: {occ.isolationReason}</p>}
            </div>
          ) : (
            <p className="text-xs text-gray-400">Empty cage.</p>
          )}

          {editable && (
            <>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Batch</label>
                <select value={batchId} onChange={e => setBatchId(e.target.value)}
                  className="w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2 bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100">
                  <option value="">Select batch…</option>
                  {batches.map(b => <option key={b.id} value={b.id}>{b.batchCode}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Birds in cage (max 4)</label>
                <div className="grid grid-cols-5 gap-1.5">
                  {[0, 1, 2, 3, 4].map(n => (
                    <button key={n} type="button" onClick={() => setCount(String(n))}
                      className={`rounded-lg py-2 font-bold border ${count === String(n)
                        ? 'border-brand-green bg-brand-green/10 text-brand-green'
                        : 'border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-300'}`}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              {target.isIsolation && (
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Isolation reason</label>
                  <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. limping, under observation"
                    className="w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2 bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100" />
                </div>
              )}
              {error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg p-2">{error}</p>}
              <div className="flex gap-2 pt-1">
                {occ && (
                  <button type="button" disabled={save.isPending} onClick={() => save.mutate(0)}
                    className="flex-1 border border-red-200 dark:border-red-800 text-red-600 rounded-xl py-2.5 font-semibold disabled:opacity-60">
                    Empty cage
                  </button>
                )}
                <button type="button" disabled={save.isPending || (Number(count) > 0 && !batchId)}
                  onClick={() => { setError(null); save.mutate(Number(count)); }}
                  className="flex-1 bg-brand-green text-white rounded-xl py-2.5 font-semibold disabled:opacity-60">
                  {save.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Fill-level modal ─────────────────────────────────────────────────────────

function FillModal({ house, rowCode, level, emptyCages, onClose }: {
  house: HouseCode; rowCode: string; level: number; emptyCages: number; onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: batches = [] } = useProductionBatches(true);
  const [batchId, setBatchId] = useState('');
  const [perCage, setPerCage] = useState('4');
  const [total, setTotal] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fill = useMutation({
    mutationFn: () => api.post(`/production/houses/${house}/cages/fill`, {
      batchId, rowCode, level, birdsPerCage: Number(perCage), totalBirds: total ? Number(total) : undefined,
    }),
    onSuccess: () => { invalidateAll(qc); onClose(); },
    onError: (e: any) => setError(errMsg(e)),
  });
  const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2 bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 text-sm';
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-dark-card w-full md:max-w-sm rounded-t-3xl md:rounded-2xl shadow-2xl p-4 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="font-bold text-gray-800 dark:text-gray-100 text-sm">Fill empty cages — {rowCode} · {levelLabel(level)}</p>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-dark-bg"><X className="w-4 h-4 text-gray-500" /></button>
        </div>
        <p className="text-xs text-gray-500">{emptyCages} empty cage{emptyCages === 1 ? '' : 's'} on this level · room for {emptyCages * 4} birds.</p>
        <select value={batchId} onChange={e => setBatchId(e.target.value)} className={iCls}>
          <option value="">Select batch…</option>
          {batches.map(b => <option key={b.id} value={b.id}>{b.batchCode}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] text-gray-500 mb-1">Birds per cage</label>
            <select value={perCage} onChange={e => setPerCage(e.target.value)} className={iCls}>
              {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-1">Total birds (optional)</label>
            <input type="number" min={1} value={total} onChange={e => setTotal(e.target.value)} className={iCls} placeholder={`up to ${emptyCages * Number(perCage)}`} />
          </div>
        </div>
        {error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg p-2">{error}</p>}
        <button disabled={!batchId || fill.isPending} onClick={() => { setError(null); fill.mutate(); }}
          className="w-full bg-brand-green text-white rounded-xl py-2.5 font-semibold text-sm disabled:opacity-60">
          {fill.isPending ? 'Placing…' : 'Place birds'}
        </button>
      </div>
    </div>
  );
}

// ── Level (expandable) ───────────────────────────────────────────────────────

function LevelBlock({
  house, rowCode, level, levels, tiers, cagesPerTier, byCode, colorOf, editable, onCage, onFill,
}: {
  house: HouseCode; rowCode: string; level: number; levels: number; tiers: number; cagesPerTier: number;
  byCode: Map<string, OccupiedCage>; colorOf: (batchId: string) => number; editable: boolean;
  onCage: (t: CageTarget) => void; onFill: (rowCode: string, level: number, empty: number) => void;
}) {
  const [open, setOpen] = useState(false);
  let birds = 0, occupied = 0, mortality = 0;
  for (let t = 1; t <= tiers; t++) {
    for (let c = 1; c <= cagesPerTier; c++) {
      const o = byCode.get(cageCode(house, rowCode, level, t, c));
      if (o) { birds += o.birdCount; occupied++; mortality += o.mortality7d; }
    }
  }
  const total = tiers * cagesPerTier;
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03]">
      <button type="button" onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-2 px-2.5 py-2 text-left">
        <span className="text-[10px] font-bold text-white/60 uppercase tracking-wider w-28 shrink-0">{levelLabel(level, levels)}</span>
        <span className="text-[11px] text-emerald-200 flex items-center gap-1"><Bird className="w-3 h-3" />{birds.toLocaleString()}</span>
        <span className="text-[10px] text-white/40 flex items-center gap-1"><Grid3x3 className="w-3 h-3" />{occupied}/{total}</span>
        {mortality > 0 && <span className="text-[10px] text-red-300 flex items-center gap-0.5"><Skull className="w-3 h-3" />{mortality}</span>}
        <ChevronDown className={`w-3.5 h-3.5 ml-auto text-white/40 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-2 pb-2">
          {editable && occupied < total && (
            <button type="button" onClick={() => onFill(rowCode, level, total - occupied)}
              className="mb-2 text-[10px] font-semibold text-emerald-300 hover:text-emerald-200 underline">
              Fill empty cages on this level
            </button>
          )}
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-1">
            {Array.from({ length: tiers }, (_, i) => i + 1).map(t => (
              <div key={t} className="rounded-md border border-white/5 bg-black/20 p-1">
                <p className="text-[8px] text-white/30 font-mono mb-0.5">T{pad2(t)}</p>
                <div className="grid grid-cols-4 gap-0.5">
                  {Array.from({ length: cagesPerTier }, (_, j) => j + 1).map(c => {
                    const code = cageCode(house, rowCode, level, t, c);
                    const o = byCode.get(code) ?? null;
                    return (
                      <button key={c} type="button"
                        title={`${cageLabel(rowCode, level, t, c)}${o ? ` — ${o.batchCode}: ${o.birdCount} birds` : ' — empty'}`}
                        onClick={() => onCage({ code, label: cageLabel(rowCode, level, t, c), isIsolation: false, occupied: o })}
                        className={`relative h-5 rounded-[3px] border text-[9px] font-bold leading-none flex items-center justify-center ${o
                          ? PALETTE[colorOf(o.batchId) % PALETTE.length]
                          : 'bg-white/5 border-white/10 text-white/20 hover:border-white/30'}`}>
                        {o ? o.birdCount : ''}
                        {o && o.mortality7d > 0 && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-red-500" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function ProductionCageMap({
  houseCode, editable = false, onPickCage, title = 'Production Houses — Cage Map',
}: {
  /** Lock to one house (hides the Block 1 / Block 2 tabs). */
  houseCode?: HouseCode;
  /** Attendant / PM can assign, change and empty cages. */
  editable?: boolean;
  /** Picker mode: tapping a cage returns it instead of opening the editor. */
  onPickCage?: (cage: PickedCage) => void;
  title?: string;
}) {
  const [tab, setTab] = useState<HouseCode>(houseCode ?? 'BLK1');
  const house = houseCode ?? tab;
  const { data, isLoading, isError } = useHouseMap(house);
  const [target, setTarget] = useState<CageTarget | null>(null);
  const [fill, setFill] = useState<{ rowCode: string; level: number; empty: number } | null>(null);

  const byCode = useMemo(() => new Map((data?.occupied ?? []).map(o => [o.code, o])), [data]);
  const colorIndex = useMemo(() => {
    const m = new Map<string, number>();
    (data?.batches ?? []).forEach((b, i) => m.set(b.id, i));
    return m;
  }, [data]);
  const colorOf = (id: string) => colorIndex.get(id) ?? 0;

  const handleCage = (t: CageTarget) => {
    if (onPickCage) {
      onPickCage({ code: t.code, label: t.label, birdCount: t.occupied?.birdCount ?? 0, batchCode: t.occupied?.batchCode ?? null });
      return;
    }
    setTarget(t);
  };

  const block = data?.block;
  const totals = data?.totals;

  return (
    <div className="rounded-2xl overflow-hidden border border-white/10"
      style={{ background: 'linear-gradient(135deg, #04140b 0%, #0b2416 60%, #06150c 100%)' }}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-emerald-500/20 border border-emerald-500/40 rounded-lg flex items-center justify-center">
            <Warehouse className="w-4 h-4 text-emerald-300" />
          </div>
          <div>
            <p className="text-sm font-bold text-white">{title}</p>
            <p className="text-[11px] text-white/40">
              {block ? `${block.name} · 6 rows × 4 levels × ${block.tiersPerLevel} tiers × 4 cages · max 4 birds/cage` : 'Loading…'}
            </p>
          </div>
        </div>
        {!houseCode && (
          <div className="flex rounded-xl bg-white/5 p-1 gap-1">
            {HOUSES.map(h => (
              <button key={h.code} type="button" onClick={() => setTab(h.code)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${tab === h.code ? 'bg-emerald-500 text-white' : 'text-white/50 hover:text-white'}`}>
                {h.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {totals && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/5 border-b border-white/10">
          {[
            ['Birds', totals.birds.toLocaleString(), 'text-emerald-300'],
            ['Occupied cages', `${totals.occupiedCages.toLocaleString()} / ${totals.totalCages.toLocaleString()}`, 'text-sky-300'],
            ['Free space', `${totals.freeSpaces.toLocaleString()} birds`, totals.freeSpaces > 0 ? 'text-amber-300' : 'text-red-400'],
            ['Batches', String(data?.batches.length ?? 0), 'text-violet-300'],
          ].map(([l, v, c]) => (
            <div key={l} className="px-3 py-2 text-center bg-black/20">
              <p className={`text-base font-bold ${c}`}>{v}</p>
              <p className="text-[9px] text-white/40 uppercase tracking-wider">{l}</p>
            </div>
          ))}
        </div>
      )}

      {data && data.batches.length > 0 && (
        <div className="px-4 pt-3 flex flex-wrap gap-3">
          {data.batches.map((b, i) => (
            <span key={b.id} className="text-[10px] text-white/60 flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-sm ${DOT[i % DOT.length]}`} />
              <span className="font-mono font-semibold text-white/80">{b.batchCode}</span> {b.birds.toLocaleString()} birds · {b.cages} cages
            </span>
          ))}
          {onPickCage && <span className="text-[10px] text-amber-300">Tap the cage the bird died in.</span>}
        </div>
      )}

      <div className="p-4 space-y-3">
        {isLoading && <div className="h-40 rounded-xl bg-white/5 animate-pulse" />}
        {isError && <p className="text-sm text-red-300">Could not load the cage map.</p>}

        {block && (
          <>
            {/* Isolation cages */}
            <div className="rounded-xl border border-purple-500/30 bg-purple-950/30 p-3">
              <p className="text-xs font-bold text-purple-200 flex items-center gap-1.5 mb-2">
                <Lock className="w-3.5 h-3.5" /> Isolation cages ({block.isolationCageCount})
              </p>
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
                {Array.from({ length: block.isolationCageCount }, (_, i) => i + 1).map(n => {
                  const code = isolationCode(house, n);
                  const o = byCode.get(code) ?? null;
                  return (
                    <button key={n} type="button" title={o?.isolationReason ?? ''}
                      onClick={() => handleCage({ code, label: `Isolation Cage ${n}`, isIsolation: true, occupied: o })}
                      className={`rounded-lg border px-1.5 py-1.5 text-left ${o ? 'bg-purple-500/25 border-purple-400/60' : 'bg-white/5 border-white/10 hover:border-white/30'}`}>
                      <p className="text-[9px] text-purple-200/70">ISO {n}</p>
                      <p className="text-xs font-bold text-white">{o ? `${o.birdCount} · ${o.batchCode}` : '—'}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sections → rows → levels */}
            {data!.sections.map(section => (
              <div key={section.code} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <p className="text-xs font-bold text-white mb-2">Section {section.code}</p>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {section.rows.map(row => {
                    const levelsTopDown = Array.from({ length: block.levelsPerRow }, (_, i) => block.levelsPerRow - i);
                    const rowBirds = data!.occupied.filter(o => o.rowCode === row.rowCode).reduce((s, o) => s + o.birdCount, 0);
                    return (
                      <div key={row.rowId} className="rounded-lg border border-white/10 p-2">
                        <p className="text-[11px] font-bold text-emerald-200 flex items-center gap-1.5 mb-1.5">
                          <Layers className="w-3.5 h-3.5" /> Row {row.rowCode}
                          <span className="text-white/40 font-normal">{rowBirds.toLocaleString()} birds</span>
                        </p>
                        <div className="space-y-1">
                          {levelsTopDown.map(level => (
                            <LevelBlock key={level} house={house} rowCode={row.rowCode} level={level}
                              levels={block.levelsPerRow} tiers={block.tiersPerLevel} cagesPerTier={block.cagesPerTier}
                              byCode={byCode} colorOf={colorOf} editable={editable && !onPickCage}
                              onCage={handleCage} onFill={(r, l, e) => setFill({ rowCode: r, level: l, empty: e })} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="px-4 py-2 border-t border-white/5">
        <p className="text-[10px] text-white/25">
          Tap a level to see its tiers · {editable ? 'tap a cage to assign, change or empty it · ' : ''}red dot = mortality in the last 7 days · refreshes every minute
        </p>
      </div>

      {target && <CageModal house={house} target={target} editable={editable} onClose={() => setTarget(null)} />}
      {fill && <FillModal house={house} rowCode={fill.rowCode} level={fill.level} emptyCages={fill.empty} onClose={() => setFill(null)} />}
    </div>
  );
}
