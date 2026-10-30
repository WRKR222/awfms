// src/components/shared/ProductionCageMap.tsx
//
// Interactive map of the production houses (Block 1 & Block 2), recorded per
// row · level: sections A/B/C → rows A1…C2 → 4 levels (top to bottom). Each
// level still has its cages (Block 1: 96, Block 2: 152, 4 birds each), which
// set its capacity, but birds, mortalities and moves are kept per level. A
// level may hold several batches. Plus 8 isolation cages per house; birds put
// into an isolation cage are always taken from a named level (their origin).
//
//   • Tap a level (editable) → set each batch's birds on it, add a batch, empty it.
//   • Tap an isolation cage  → change its birds (taken from a level) or empty it.
//   • Picker mode (onPickCage) → tapping a level / isolation cage hands it back
//     to the caller instead (used to record mortality on the egg collection page).
import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bird, Layers, Lock, Skull, Trash2, Warehouse, X } from 'lucide-react';
import { api } from '../../lib/api/client';
import dayjs from '../../lib/dayjs';
import {
  HOUSES, HOUSE_QUERY_KEYS, levelCode, levelLabel, useHouseMap,
  type HouseCode, type HouseMap, type IsolationUnit, type LevelUnit, type UnitBatch,
} from '../../hooks/useProductionHouses';

const BAR = ['bg-emerald-400', 'bg-sky-400', 'bg-fuchsia-400', 'bg-amber-400', 'bg-orange-400', 'bg-violet-400'];

export interface PickedCage {
  code: string;
  label: string;
  birdCount: number;
  batches: UnitBatch[];
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

const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2 bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 text-sm';

function Sheet({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-dark-card w-full md:max-w-md rounded-t-3xl md:rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-dark-border">
          <div>
            <p className="font-bold text-gray-800 dark:text-gray-100 text-sm">{title}</p>
            {sub && <p className="text-[11px] text-gray-400">{sub}</p>}
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-bg"><X className="w-4 h-4 text-gray-500" /></button>
        </div>
        <div className="p-4 space-y-3 text-sm">{children}</div>
      </div>
    </div>
  );
}

// ── Level modal ──────────────────────────────────────────────────────────────

function LevelModal({ house, map, level, editable, onClose }: {
  house: HouseCode; map: HouseMap; level: LevelUnit; editable: boolean; onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: batches = [] } = useProductionBatches(editable);
  const [counts, setCounts] = useState<Record<string, string>>(
    Object.fromEntries(level.batches.map(b => [b.batchId, String(b.birdCount)])),
  );
  const [newBatch, setNewBatch] = useState('');
  const [newCount, setNewCount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const done = () => { invalidateAll(qc); onClose(); };

  const set = useMutation({
    mutationFn: (v: { batchId: string; birdCount: number }) =>
      api.post(`/production/houses/${house}/units/set`, { unitCode: level.code, ...v }),
    onSuccess: done,
    onError: (e: any) => setError(errMsg(e)),
  });
  const clear = useMutation({
    mutationFn: (batchId?: string) =>
      api.delete(`/production/houses/${house}/units/${level.code}`, { params: batchId ? { batchId } : {} }),
    onSuccess: done,
    onError: (e: any) => setError(errMsg(e)),
  });
  const busy = set.isPending || clear.isPending;
  const free = level.capacity - level.birds;
  const choosable = batches.filter(b => !level.batches.some(x => x.batchId === b.id));

  return (
    <Sheet title={level.label} sub={`${map.block.cagesPerLevel} cages · holds up to ${level.capacity.toLocaleString()} birds · records kept per level`} onClose={onClose}>
      <div className="rounded-xl bg-gray-50 dark:bg-dark-bg p-3 text-xs text-gray-600 dark:text-gray-300 space-y-0.5">
        <p><span className="text-gray-400">Birds:</span> <strong>{level.birds.toLocaleString()}</strong> / {level.capacity.toLocaleString()} · room for {free.toLocaleString()}</p>
        {level.mortality7d > 0 && <p className="text-red-500">Mortalities (7 days): {level.mortality7d}</p>}
      </div>

      {level.batches.length === 0 && <p className="text-xs text-gray-400">Empty level.</p>}
      {level.batches.map(b => (
        <div key={b.batchId} className="border border-gray-100 dark:border-dark-border rounded-xl p-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-mono font-semibold text-gray-800 dark:text-gray-100">{b.batchCode}</span>
            <span className="text-gray-400">placed {dayjs(b.placedDate).format('D MMM YYYY')}</span>
          </div>
          {editable ? (
            <div className="flex gap-2 mt-2">
              <input type="number" min={0} max={level.capacity} value={counts[b.batchId] ?? ''}
                onChange={e => setCounts(c => ({ ...c, [b.batchId]: e.target.value }))} className={iCls} />
              <button type="button" disabled={busy || counts[b.batchId] === String(b.birdCount) || counts[b.batchId] === ''}
                onClick={() => { setError(null); set.mutate({ batchId: b.batchId, birdCount: Number(counts[b.batchId]) }); }}
                className="px-3 rounded-xl bg-brand-green text-white font-semibold text-xs disabled:opacity-50">Save</button>
              <button type="button" disabled={busy} title={`Remove ${b.batchCode} from this level`}
                onClick={() => { setError(null); clear.mutate(b.batchId); }}
                className="px-2.5 rounded-xl border border-red-200 dark:border-red-800 text-red-600 disabled:opacity-50"><Trash2 className="w-4 h-4" /></button>
            </div>
          ) : (
            <p className="text-sm font-bold text-gray-800 dark:text-gray-100 mt-1">{b.birdCount.toLocaleString()} birds</p>
          )}
        </div>
      ))}

      {editable && free > 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 dark:border-dark-border p-2.5 space-y-2">
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Add a batch to this level</p>
          <select value={newBatch} onChange={e => setNewBatch(e.target.value)} className={iCls}>
            <option value="">Select batch…</option>
            {choosable.map(b => <option key={b.id} value={b.id}>{b.batchCode}</option>)}
          </select>
          <div className="flex gap-2">
            <input type="number" min={1} max={free} value={newCount} onChange={e => setNewCount(e.target.value)}
              placeholder={`Birds (up to ${free.toLocaleString()})`} className={iCls} />
            <button type="button" disabled={busy || !newBatch || !(Number(newCount) > 0)}
              onClick={() => { setError(null); set.mutate({ batchId: newBatch, birdCount: Number(newCount) }); }}
              className="px-3 rounded-xl bg-brand-green text-white font-semibold text-xs disabled:opacity-50">Add</button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg p-2">{error}</p>}
      {editable && level.batches.length > 0 && (
        <button type="button" disabled={busy} onClick={() => { setError(null); clear.mutate(undefined); }}
          className="w-full border border-red-200 dark:border-red-800 text-red-600 rounded-xl py-2.5 font-semibold disabled:opacity-60">
          Empty level
        </button>
      )}
    </Sheet>
  );
}

// ── Isolation modal ──────────────────────────────────────────────────────────

function IsolationModal({ house, map, iso, editable, onClose }: {
  house: HouseCode; map: HouseMap; iso: IsolationUnit; editable: boolean; onClose: () => void;
}) {
  const qc = useQueryClient();
  const occ = iso.batches[0] ?? null;
  const [count, setCount] = useState(String(occ?.birdCount ?? 1));
  const [reason, setReason] = useState(iso.isolationReason ?? '');
  const [error, setError] = useState<string | null>(null);
  const rowCodes = map.sections.flatMap(sec => sec.rows.map(r => r.rowCode));
  const [fromRow, setFromRow] = useState(rowCodes[0] ?? 'A1');
  const [fromLevel, setFromLevel] = useState(String(map.block.levelsPerRow));
  const fromCode = levelCode(house, fromRow, Number(fromLevel));
  const fromUnit = map.levels.find(l => l.code === fromCode) ?? null;
  const sourceBatches = occ ? (fromUnit?.batches ?? []).filter(b => b.batchId === occ.batchId) : (fromUnit?.batches ?? []);
  const [fromBatch, setFromBatch] = useState('');
  const pickedBatch = sourceBatches.length === 1 ? sourceBatches[0].batchId : fromBatch;
  const growing = Number(count) > (occ?.birdCount ?? 0);

  const save = useMutation({
    mutationFn: (birdCount: number) => api.post(`/production/houses/${house}/units/set`, {
      unitCode: iso.code, birdCount, isolationReason: reason,
      fromCode: growing ? fromCode : undefined, batchId: growing ? pickedBatch || undefined : undefined,
    }),
    onSuccess: () => { invalidateAll(qc); onClose(); },
    onError: (e: any) => setError(errMsg(e)),
  });

  return (
    <Sheet title={iso.label} sub={iso.code} onClose={onClose}>
      {occ ? (
        <div className="rounded-xl bg-gray-50 dark:bg-dark-bg p-3 text-xs text-gray-600 dark:text-gray-300 space-y-0.5">
          <p><span className="text-gray-400">Batch:</span> <strong>{occ.batchCode}</strong></p>
          <p><span className="text-gray-400">Birds:</span> <strong>{occ.birdCount}</strong> / {iso.capacity}</p>
          <p><span className="text-gray-400">Placed:</span> {dayjs(occ.placedDate).format('D MMM YYYY')}</p>
          {iso.mortality7d > 0 && <p className="text-red-500">Mortalities (7 days): {iso.mortality7d}</p>}
          {iso.isolationReason && <p className="text-purple-600 dark:text-purple-300">Isolation: {iso.isolationReason}</p>}
          {iso.origin && <p className="text-purple-600 dark:text-purple-300">Came from: {iso.origin}</p>}
        </div>
      ) : <p className="text-xs text-gray-400">Empty isolation cage.</p>}

      {editable && (
        <>
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Birds in cage (max {iso.capacity})</label>
            <div className="grid grid-cols-5 gap-1.5">
              {Array.from({ length: iso.capacity + 1 }, (_, n) => n).map(n => (
                <button key={n} type="button" onClick={() => setCount(String(n))}
                  className={`rounded-lg py-2 font-bold border ${count === String(n)
                    ? 'border-brand-green bg-brand-green/10 text-brand-green'
                    : 'border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-300'}`}>{n}</button>
              ))}
            </div>
          </div>
          {growing && (
            <div className="rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50/60 dark:bg-purple-900/20 p-2.5 space-y-1.5">
              <p className="text-[11px] font-semibold text-purple-700 dark:text-purple-300 uppercase tracking-wide">Came from (required)</p>
              <div className="grid grid-cols-2 gap-1.5">
                <select value={fromRow} onChange={e => setFromRow(e.target.value)} className={iCls}>
                  {rowCodes.map(r => <option key={r} value={r}>Row {r}</option>)}
                </select>
                <select value={fromLevel} onChange={e => setFromLevel(e.target.value)} className={iCls}>
                  {Array.from({ length: map.block.levelsPerRow }, (_, i) => map.block.levelsPerRow - i).map(l => (
                    <option key={l} value={l}>{levelLabel(l, map.block.levelsPerRow)}</option>
                  ))}
                </select>
              </div>
              {sourceBatches.length > 1 && (
                <select value={fromBatch} onChange={e => setFromBatch(e.target.value)} className={iCls}>
                  <option value="">Which batch?</option>
                  {sourceBatches.map(b => <option key={b.batchId} value={b.batchId}>{b.batchCode} · {b.birdCount} birds</option>)}
                </select>
              )}
              <p className="text-[11px] text-gray-500">
                {sourceBatches.length
                  ? `${sourceBatches.map(b => `${b.batchCode}: ${b.birdCount}`).join(' · ')} on that level — the moved birds are taken from it.`
                  : occ ? `No ${occ.batchCode} birds on that level.` : 'That level is empty on the map.'}
              </p>
            </div>
          )}
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Isolation reason</label>
            <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. limping, under observation" className={iCls} />
          </div>
          {error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg p-2">{error}</p>}
          <div className="flex gap-2 pt-1">
            {occ && (
              <button type="button" disabled={save.isPending} onClick={() => save.mutate(0)}
                className="flex-1 border border-red-200 dark:border-red-800 text-red-600 rounded-xl py-2.5 font-semibold disabled:opacity-60">
                Empty cage
              </button>
            )}
            <button type="button" disabled={save.isPending || (growing && (!sourceBatches.length || !pickedBatch))}
              onClick={() => { setError(null); save.mutate(Number(count)); }}
              className="flex-1 bg-brand-green text-white rounded-xl py-2.5 font-semibold disabled:opacity-60">
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

// ── Level row ────────────────────────────────────────────────────────────────

function LevelRow({ unit, levels, colorOf, onTap }: {
  unit: LevelUnit; levels: number; colorOf: (batchId: string) => number; onTap: () => void;
}) {
  const pct = (n: number) => `${Math.min(100, (n / unit.capacity) * 100)}%`;
  return (
    <button type="button" onClick={onTap}
      className="w-full rounded-lg border border-white/10 bg-white/[0.03] hover:border-white/30 px-2.5 py-2 text-left">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold text-white/60 uppercase tracking-wider w-28 shrink-0">{levelLabel(unit.level ?? 0, levels)}</span>
        <span className="text-[11px] text-emerald-200 flex items-center gap-1"><Bird className="w-3 h-3" />{unit.birds.toLocaleString()}</span>
        <span className="text-[10px] text-white/40">/ {unit.capacity.toLocaleString()}</span>
        {unit.mortality7d > 0 && <span className="text-[10px] text-red-300 flex items-center gap-0.5"><Skull className="w-3 h-3" />{unit.mortality7d}</span>}
        <span className="ml-auto text-[10px] text-white/50 font-mono truncate">{unit.batches.map(b => b.batchCode).join(' · ')}</span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden flex">
        {unit.batches.map(b => (
          <span key={b.batchId} className={`h-full ${BAR[colorOf(b.batchId) % BAR.length]}`} style={{ width: pct(b.birdCount) }} />
        ))}
      </div>
    </button>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function ProductionCageMap({
  houseCode, editable = false, onPickCage, title = 'Production Houses — Map',
}: {
  /** Lock to one house (hides the Block 1 / Block 2 tabs). */
  houseCode?: HouseCode;
  /** Attendant / PM can set the birds on levels and isolation cages. */
  editable?: boolean;
  /** Picker mode: tapping a level / isolation cage returns it instead of opening the editor. */
  onPickCage?: (unit: PickedCage) => void;
  title?: string;
}) {
  const [tab, setTab] = useState<HouseCode>(houseCode ?? 'BLK1');
  const house = houseCode ?? tab;
  const { data, isLoading, isError } = useHouseMap(house);
  const [openLevel, setOpenLevel] = useState<LevelUnit | null>(null);
  const [openIso, setOpenIso] = useState<IsolationUnit | null>(null);

  const levelsByCode = useMemo(() => new Map((data?.levels ?? []).map(l => [l.code, l])), [data]);
  const colorIndex = useMemo(() => {
    const m = new Map<string, number>();
    (data?.batches ?? []).forEach((b, i) => m.set(b.id, i));
    return m;
  }, [data]);
  const colorOf = (id: string) => colorIndex.get(id) ?? 0;

  const tap = (u: LevelUnit | IsolationUnit, isIso: boolean) => {
    if (onPickCage) {
      onPickCage({ code: u.code, label: u.label, birdCount: u.birds, batches: u.batches });
      return;
    }
    if (isIso) setOpenIso(u as IsolationUnit); else setOpenLevel(u as LevelUnit);
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
              {block
                ? `${block.name} · 6 rows × ${block.levelsPerRow} levels · ${block.cagesPerLevel} cages per level (max ${block.birdsPerCage} birds/cage) · records per level`
                : 'Loading…'}
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
            ['Birds', `${totals.birds.toLocaleString()} / ${totals.capacityBirds.toLocaleString()}`, 'text-emerald-300'],
            ['Levels in use', `${totals.occupiedLevels} / ${totals.totalLevels}`, 'text-sky-300'],
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

      {data && (data.batches.length > 0 || onPickCage) && (
        <div className="px-4 pt-3 flex flex-wrap gap-3">
          {data.batches.map((b, i) => (
            <span key={b.id} className="text-[10px] text-white/60 flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-sm ${BAR[i % BAR.length]}`} />
              <span className="font-mono font-semibold text-white/80">{b.batchCode}</span> {b.birds.toLocaleString()} birds · {b.levels} level{b.levels === 1 ? '' : 's'}
            </span>
          ))}
          {onPickCage && <span className="text-[10px] text-amber-300">Tap the level (or isolation cage) the bird died on.</span>}
        </div>
      )}

      <div className="p-4 space-y-3">
        {isLoading && <div className="h-40 rounded-xl bg-white/5 animate-pulse" />}
        {isError && <p className="text-sm text-red-300">Could not load the map.</p>}

        {block && (
          <>
            {/* Isolation cages */}
            <div className="rounded-xl border border-purple-500/30 bg-purple-950/30 p-3">
              <p className="text-xs font-bold text-purple-200 flex items-center gap-1.5 mb-2">
                <Lock className="w-3.5 h-3.5" /> Isolation cages ({block.isolationCageCount})
              </p>
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
                {data!.isolation.map(iso => {
                  const o = iso.batches[0];
                  return (
                    <button key={iso.code} type="button" title={[iso.isolationReason, iso.origin ? `From ${iso.origin}` : ''].filter(Boolean).join(' · ')}
                      onClick={() => tap(iso, true)}
                      className={`rounded-lg border px-1.5 py-1.5 text-left ${o ? 'bg-purple-500/25 border-purple-400/60' : 'bg-white/5 border-white/10 hover:border-white/30'}`}>
                      <p className="text-[9px] text-purple-200/70">ISO {iso.cageNo}</p>
                      <p className="text-xs font-bold text-white">{o ? `${o.birdCount} · ${o.batchCode}` : '—'}</p>
                      {iso.origin && <p className="text-[9px] text-purple-200/80 truncate">from {iso.origin}</p>}
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
                    const units = Array.from({ length: block.levelsPerRow }, (_, i) => block.levelsPerRow - i)
                      .map(l => levelsByCode.get(levelCode(house, row.rowCode, l)))
                      .filter((u): u is LevelUnit => !!u);
                    const rowBirds = units.reduce((s, u) => s + u.birds, 0);
                    return (
                      <div key={row.rowId} className="rounded-lg border border-white/10 p-2">
                        <p className="text-[11px] font-bold text-emerald-200 flex items-center gap-1.5 mb-1.5">
                          <Layers className="w-3.5 h-3.5" /> Row {row.rowCode}
                          <span className="text-white/40 font-normal">{rowBirds.toLocaleString()} birds</span>
                        </p>
                        <div className="space-y-1">
                          {units.map(u => (
                            <LevelRow key={u.code} unit={u} levels={block.levelsPerRow} colorOf={colorOf} onTap={() => tap(u, false)} />
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
          {editable ? 'Tap a level to set its birds per batch · ' : 'Tap a level for details · '}red skull = mortality in the last 7 days · refreshes every minute
        </p>
      </div>

      {openLevel && data && <LevelModal house={house} map={data} level={openLevel} editable={editable} onClose={() => setOpenLevel(null)} />}
      {openIso && data && <IsolationModal house={house} map={data} iso={openIso} editable={editable} onClose={() => setOpenIso(null)} />}
    </div>
  );
}
