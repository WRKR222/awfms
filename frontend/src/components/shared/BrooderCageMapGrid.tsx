// src/components/shared/BrooderCageMapGrid.tsx
// Brooder Cage Map — fixed 6 rows/decks × 4 levels (bottom→top) grid.
//
// FIXES:
//  • LevelCell — action buttons moved OUT of absolute positioning into a
//    dedicated bottom bar so they never overlap batch name / content.
//  • Mobile: icons stay in their own row, always visible, never clipping
//    onto an adjacent level tab.

import { useState } from 'react';
import {
  Flame, Zap, Bird, AlertTriangle, CheckCircle2, Clock, Layers, XCircle, ArrowLeftRight, Scale, Grid3x3, Lock,
} from 'lucide-react';
import dayjs from '../../lib/dayjs';
import {
  useBrooderCageMap, type BrooderLevelData, type BrooderRowData,
} from '../../hooks/useBrooderCageMap';

// ── Helpers ───────────────────────────────────────────────────────────────────

function varianceColor(pct: number | null) {
  if (pct === null) return 'text-gray-400';
  if (pct === 0)    return 'text-green-400';
  if (Math.abs(pct) <= 5) return 'text-amber-300';
  if (pct > 10)     return 'text-red-400';
  return 'text-orange-400';
}

function HeatBadge({ heat }: { heat: BrooderRowData['heatToday'] }) {
  if (!heat) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-500">
        <AlertTriangle className="w-2.5 h-2.5" /> No heat logged today
      </span>
    );
  }
  if (heat.sourceType === 'CHARCOAL') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-orange-900/40 text-orange-300 font-semibold">
        <Flame className="w-2.5 h-2.5" /> {heat.charcoalKg ?? 0}kg charcoal
      </span>
    );
  }
  const minutes = heat.bulbMinutesOn ?? 0;
  const hrs  = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold ${
      heat.isRunning
        ? 'bg-amber-900/40 text-amber-300 animate-pulse'
        : 'bg-gray-800 text-gray-400'
    }`}>
      <Zap className="w-2.5 h-2.5" />
      {heat.isRunning ? 'Bulb ON · ' : 'Bulb · '}
      {hrs > 0 ? `${hrs}h ` : ''}{mins}m{heat.isRunning ? ' so far' : ' total'}
      {heat.bulbCount ? ` (${heat.bulbCount}x)` : ''}
    </span>
  );
}

// ── Level cell ────────────────────────────────────────────────────────────────
// Layout:
//   ┌──────────────────────────────┐
//   │ LEVEL LABEL        ✓ (feed) │  ← label row (no absolute icons!)
//   │ BatchCode                    │
//   │ 🐦 1,200 birds  wk3         │
//   │ Today: 1.2/1.5kg            │
//   │ Week: 8.4/10kg              │
//   │ ⚖ 320g (300-340g)           │
//   ├──────────────────────────────┤
//   │  ↔ Reassign  ⚖ Weight  ✕ Mort│  ← action bar — always below content
//   └──────────────────────────────┘

function LevelCell({
  level,
  onSelect,
  onLogMortality,
  onReassign,
  onLogWeight,
}: {
  level:          BrooderLevelData;
  onSelect:       (level: BrooderLevelData) => void;
  onLogMortality: (level: BrooderLevelData) => void;
  onReassign:     (level: BrooderLevelData) => void;
  onLogWeight:    (level: BrooderLevelData) => void;
}) {
  const occupied = !!level.assignment;
  const [showCages, setShowCages] = useState(false);

  const occupiedCages = level.cages.filter(c => c.assignment);
  const cageCounts = occupiedCages.map(c => c.assignment!.birdCount);
  const minPerCage = cageCounts.length ? Math.min(...cageCounts) : 0;
  const maxPerCage = cageCounts.length ? Math.max(...cageCounts) : 0;

  const isolationCages = occupiedCages.filter(c => c.assignment!.isIsolation);
  const isolationBirdCount = isolationCages.reduce((s, c) => s + c.assignment!.birdCount, 0);
  const hasIsolation = isolationCages.length > 0;

  const feedStatus = (() => {
    if (!occupied || level.dailyRationKg === null) return null;
    const dispensedToday = level.dispensedKgToday ?? 0;
    const ration         = level.dailyRationKg;
    if (dispensedToday >= ration) return 'full';
    if (dispensedToday / ration >= 0.8) return 'near';
    return 'low';
  })();

  const weightFlagged = occupied && level.weightCheck !== null && !level.weightCheck.withinBounds;

  return (
    <div className={`w-full rounded-lg border transition-colors flex flex-col ${
      occupied
        ? hasIsolation
          ? 'bg-purple-950/30 border-purple-600/50 hover:border-purple-400/70'
          : weightFlagged
            ? 'bg-red-950/30 border-red-700/50 hover:border-red-500/70'
            : 'bg-amber-950/30 border-amber-700/40 hover:border-amber-500/60'
        : 'bg-white/5 border-white/10 hover:border-white/20'
    }`}>
      {/* ── Content area — tapping opens feed log ── */}
      <button
        onClick={() => onSelect(level)}
        className="w-full text-left p-2.5 flex-1"
      >
        {/* Label row — no absolute-positioned buttons, so no overlap */}
        <div className="flex items-center justify-between gap-1 min-w-0">
          <span className="text-[9px] font-bold text-white/40 uppercase tracking-wider shrink-0">
            {level.label}
          </span>
          <span className="flex items-center gap-1 shrink-0">
            {hasIsolation && (
              <span className="inline-flex items-center gap-0.5 text-[8px] font-bold text-purple-300 bg-purple-500/20 border border-purple-400/40 rounded-full px-1.5 py-0.5">
                <Lock className="w-2 h-2" /> {isolationBirdCount.toLocaleString()}
              </span>
            )}
            {level.assignment && level.feedVariancePercent === 0 && (
              <CheckCircle2 className="w-3 h-3 text-green-400" />
            )}
          </span>
        </div>

        {occupied ? (
          <>
            {/* Batch code — full width, no icons competing for space */}
            <p className="text-[11px] font-bold text-white mt-1 font-mono truncate w-full">
              {level.batch?.batchCode}
            </p>
            <p className="text-[10px] text-amber-200/80 flex items-center gap-1 mt-0.5 flex-wrap">
              <Bird className="w-2.5 h-2.5 shrink-0" />
              <span>{level.assignment!.birdCount.toLocaleString()}</span>
              {level.hylineWeek && (
                <span className="text-white/30">wk{level.hylineWeek}</span>
              )}
            </p>
            {level.dailyRationKg !== null && (
              <p className={`text-[9px] mt-1 font-semibold ${
                feedStatus === 'full' ? 'text-green-400'
                : feedStatus === 'near' ? 'text-amber-400'
                : 'text-white/40'
              }`}>
                Today: {(level.dispensedKgToday ?? 0).toFixed(1)}/{level.dailyRationKg.toFixed(1)}kg
              </p>
            )}
            {level.requiredKgThisWeek != null && (
              <p className={`text-[9px] mt-0.5 ${varianceColor(level.feedVariancePercent)}`}>
                Week: {level.dispensedKgThisWeek}/{level.requiredKgThisWeek}kg
                {(level.feedSource === 'GENERAL' || level.feedSource === 'MIXED') && (
                  <span className="text-white/30"> · incl. general log</span>
                )}
              </p>
            )}
            {level.weightCheck && (
              <p className={`text-[9px] mt-0.5 flex items-center gap-1 font-semibold ${
                weightFlagged ? 'text-red-400' : 'text-green-400'
              }`}>
                {weightFlagged ? <AlertTriangle className="w-2.5 h-2.5" /> : <Scale className="w-2.5 h-2.5" />}
                {level.weightCheck.averageWeightG.toFixed(0)}g
                <span className="text-white/30">({level.weightCheck.minG}-{level.weightCheck.maxG}g)</span>
              </p>
            )}
            {occupiedCages.length > 0 && (
              <p className="text-[9px] mt-0.5 text-white/30 flex items-center gap-1">
                <Grid3x3 className="w-2.5 h-2.5" />
                {occupiedCages.length}/{level.cages.length} cages
                {' · '}
                {minPerCage === maxPerCage ? `${minPerCage}/cage` : `${minPerCage}-${maxPerCage}/cage`}
                {hasIsolation && (
                  <span className="text-purple-300">
                    {' · '}{isolationCages.length} isolated
                  </span>
                )}
              </p>
            )}
          </>
        ) : (
          <p className="text-[10px] text-white/25 mt-2">Empty</p>
        )}
      </button>

      {/* ── Per-cage breakdown — collapsed by default (44 cages/level is a
           lot of chrome); tap to see exactly how the level's birds are
           split across its individual cages. ── */}
      {occupiedCages.length > 0 && (
        <div className="border-t border-white/5">
          <button
            onClick={e => { e.stopPropagation(); setShowCages(v => !v); }}
            className="w-full flex items-center justify-center gap-1 py-1 text-[9px] text-white/30 hover:text-white/60 transition-colors"
          >
            {showCages ? 'Hide cages' : `Show ${level.cages.length} cages`}
          </button>
          {showCages && (
            <div className="px-2 pb-2 grid grid-cols-6 gap-0.5">
              {level.cages.map(c => (
                <div
                  key={c.cageId}
                  title={
                    `${c.label}` +
                    (c.assignment
                      ? ` — ${c.assignment.birdCount} birds` +
                        (c.assignment.isIsolation
                          ? ` · ISOLATION${c.assignment.isolationReason ? `: ${c.assignment.isolationReason}` : ''}`
                          : '')
                      : ' — empty')
                  }
                  className={`relative rounded-[3px] text-[7px] leading-none flex items-center justify-center h-5 ${
                    c.assignment?.isIsolation
                      ? 'bg-purple-500/25 text-purple-200 border border-purple-400/50 ring-1 ring-purple-400/40'
                      : c.assignment
                        ? 'bg-amber-500/20 text-amber-200 border border-amber-500/30'
                        : 'bg-white/5 text-white/20 border border-white/5'
                  }`}
                >
                  {c.assignment?.isIsolation && (
                    <Lock className="w-2 h-2 absolute -top-0.5 -right-0.5 text-purple-300" />
                  )}
                  {c.assignment ? c.assignment.birdCount : ''}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Action bar — lives BELOW content, never overlaps ── */}
      {occupied && (
        <div className="flex items-center justify-end gap-0.5 px-2 pb-1.5 pt-1 border-t border-white/5">
          <button
            onClick={e => { e.stopPropagation(); onReassign(level); }}
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-blue-900/50 transition-colors group"
            title="Reassign birds from another level"
          >
            <ArrowLeftRight className="w-3 h-3 text-white/30 group-hover:text-blue-400 transition-colors" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onLogWeight(level); }}
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-indigo-900/50 transition-colors group"
            title="Log bird weight sample"
          >
            <Scale className={`w-3 h-3 transition-colors ${
              weightFlagged ? 'text-red-400' : 'text-white/30 group-hover:text-indigo-400'
            }`} />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onLogMortality(level); }}
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-red-900/40 transition-colors group"
            title="Log mortality / culling"
          >
            <XCircle className="w-3 h-3 text-white/30 group-hover:text-red-400 transition-colors" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Row block ─────────────────────────────────────────────────────────────────

function RowBlock({
  row,
  onSelectLevel,
  onLogHeat,
  onLogMortality,
  onReassign,
  onLogWeight,
}: {
  row:            BrooderRowData;
  onSelectLevel:  (level: BrooderLevelData, row: BrooderRowData) => void;
  onLogHeat:      (row: BrooderRowData) => void;
  onLogMortality: (level: BrooderLevelData, row: BrooderRowData) => void;
  onReassign:     (level: BrooderLevelData, row: BrooderRowData) => void;
  onLogWeight:    (level: BrooderLevelData, row: BrooderRowData) => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-amber-400" />
          <p className="text-xs font-bold text-white">{row.label}</p>
          <span className="text-[10px] text-white/40">
            {row.birdTotal > 0 ? `${row.birdTotal.toLocaleString()} birds` : 'empty'}
          </span>
        </div>
        <button
          onClick={() => onLogHeat(row)}
          className="text-[10px] text-amber-400/70 hover:text-amber-300 transition-colors px-2 py-0.5 rounded border border-amber-700/30 hover:border-amber-500/50"
        >
          Log heat
        </button>
      </div>

      <HeatBadge heat={row.heatToday} />

      {/* 2-column grid for the 4 levels — cells are self-contained with no absolute overlap */}
      <div className="grid grid-cols-2 gap-1.5 mt-2">
        {row.levels.map(level => (
          <LevelCell
            key={level.levelId}
            level={level}
            onSelect={l => onSelectLevel(l, row)}
            onLogMortality={l => onLogMortality(l, row)}
            onReassign={l => onReassign(l, row)}
            onLogWeight={l => onLogWeight(l, row)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Main grid ─────────────────────────────────────────────────────────────────

export function BrooderCageMapGrid({
  onSelectLevel,
  onLogHeat,
  onLogMortality,
  onReassign,
  onLogWeight,
}: {
  onSelectLevel?:  (level: BrooderLevelData, row: BrooderRowData) => void;
  onLogHeat?:      (row: BrooderRowData) => void;
  onLogMortality?: (level: BrooderLevelData, row: BrooderRowData) => void;
  onReassign?:     (level: BrooderLevelData, row: BrooderRowData) => void;
  onLogWeight?:    (level: BrooderLevelData, row: BrooderRowData) => void;
}) {
  const { data, isLoading } = useBrooderCageMap();
  const [, setSelected]     = useState<BrooderLevelData | null>(null);

  const rows        = data?.rows ?? [];
  const totalChicks = data?.totalChicks ?? 0;

  // Flat list of every isolated cage across the whole brooder, with full
  // row/level/cage context — surfaced as its own panel so the Director
  // (Owner) and Production Manager can see at a glance what's isolated,
  // where, and how many birds, without digging into each level.
  const isolatedCages = rows.flatMap(row =>
    row.levels.flatMap(level =>
      level.cages
        .filter(c => c.assignment?.isIsolation)
        .map(c => ({
          key:        c.cageId,
          rowLabel:   row.label,
          levelLabel: level.label,
          cageLabel:  c.label,
          birdCount:  c.assignment!.birdCount,
          reason:     c.assignment!.isolationReason,
        })),
    ),
  );
  const totalIsolatedBirds = isolatedCages.reduce((s, c) => s + c.birdCount, 0);

  return (
    <div
      className="rounded-2xl overflow-hidden border border-white/10"
      style={{ background: 'linear-gradient(135deg, #1a0a00 0%, #2d1400 60%, #1a0800 100%)' }}
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-amber-500/20 border border-amber-500/40 rounded-lg flex items-center justify-center">
            <Flame className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-white">Brooder Cage Map</p>
            <p className="text-[11px] text-white/40">6 rows × 4 levels · every chick traceable</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold text-amber-400">{totalChicks.toLocaleString()}</p>
          <p className="text-[10px] text-white/40">total chicks</p>
        </div>
      </div>

      {/* Legend */}
      <div className="px-4 pt-3 flex items-center gap-3 flex-wrap">
        <span className="text-[10px] text-white/30 flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3 text-green-400" /> Feed on target
        </span>
        <span className="text-[10px] text-white/30 flex items-center gap-1">
          <ArrowLeftRight className="w-3 h-3 text-blue-400/60" /> Reassign birds
        </span>
        <span className="text-[10px] text-white/30 flex items-center gap-1">
          <Scale className="w-3 h-3 text-indigo-400/60" /> Log weight
        </span>
        <span className="text-[10px] text-white/30 flex items-center gap-1">
          <XCircle className="w-3 h-3 text-red-400/60" /> Log mortality
        </span>
        <span className="text-[10px] text-white/30 flex items-center gap-1">
          <Lock className="w-3 h-3 text-purple-400/70" /> Isolation cage
        </span>
        <span className="text-[10px] text-white/30">Tap cell body = log feed</span>
      </div>

      {/* ── Isolation summary — director/PM visibility into every isolated
           cage: exactly which cage, in which row and level, and how many
           birds are isolated there. ── */}
      {isolatedCages.length > 0 && (
        <div className="mx-4 mt-3 rounded-xl border border-purple-500/30 bg-purple-950/30 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-purple-500/20">
            <span className="flex items-center gap-1.5 text-xs font-bold text-purple-200">
              <Lock className="w-3.5 h-3.5" />
              Isolation Cages ({isolatedCages.length})
            </span>
            <span className="text-xs font-bold text-purple-300">
              {totalIsolatedBirds.toLocaleString()} birds isolated
            </span>
          </div>
          <div className="max-h-40 overflow-y-auto divide-y divide-purple-500/10">
            {isolatedCages.map(c => (
              <div key={c.key} className="flex items-center justify-between gap-2 px-3 py-1.5 text-[11px]">
                <div className="min-w-0">
                  <p className="font-semibold text-purple-100 truncate">
                    {c.rowLabel} · {c.levelLabel} · {c.cageLabel}
                  </p>
                  {c.reason && (
                    <p className="text-purple-300/70 truncate">{c.reason}</p>
                  )}
                </div>
                <span className="shrink-0 font-bold text-purple-200">
                  {c.birdCount.toLocaleString()} birds
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="p-4">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-44 bg-white/5 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-10">
            <Flame className="w-10 h-10 text-amber-500/20 mx-auto mb-3" />
            <p className="text-sm text-white/40 font-medium">Brooder cage map not yet set up</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {rows.map(row => (
              <RowBlock
                key={row.rowId}
                row={row}
                onSelectLevel={(level, r) => {
                  setSelected(level);
                  onSelectLevel?.(level, r);
                }}
                onLogHeat={r => onLogHeat?.(r)}
                onLogMortality={(level, r) => onLogMortality?.(level, r)}
                onReassign={(level, r) => onReassign?.(level, r)}
                onLogWeight={(level, r) => onLogWeight?.(level, r)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="px-5 py-2 border-t border-white/5 flex items-center justify-between">
        <p className="text-[10px] text-white/20">Auto-refreshes every minute</p>
        <p className="text-[10px] text-white/20 flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" /> {dayjs().format('HH:mm')}
        </p>
      </div>
    </div>
  );
}
