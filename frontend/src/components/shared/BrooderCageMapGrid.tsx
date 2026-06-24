// src/components/shared/BrooderCageMapGrid.tsx
// Brooder Cage Map — fixed 6 rows/decks × 4 levels (bottom→top) grid.
//
// CHANGES from original:
//  • LevelCell now accepts an `onLogMortality` callback and renders a
//    small "💀" button on occupied cells (Req 1).
//  • RowBlock and BrooderCageMapGrid accept and forward the new prop.
//  • Daily ration vs dispensed shown more prominently with colour coding.

import { useState } from 'react';
import {
  Flame, Zap, Bird, AlertTriangle, CheckCircle2, Clock, Layers, XCircle,
} from 'lucide-react';
import dayjs from '../../lib/dayjs';
import {
  useBrooderCageMap, type BrooderLevelData, type BrooderRowData,
} from '../../hooks/useBrooderCageMap';

// ── Helpers ──────────────────────────────────────────────────────────────────

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
// Occupied cells have two click targets:
//   • The main cell body → open feed log modal  (existing behaviour)
//   • The XCircle button → open mortality modal  (new — Req 1)

function LevelCell({
  level,
  onSelect,
  onLogMortality,
}: {
  level:          BrooderLevelData;
  onSelect:       (level: BrooderLevelData) => void;
  onLogMortality: (level: BrooderLevelData) => void;
}) {
  const occupied = !!level.assignment;

  // Feed status colour for the ration line
  const feedStatus = (() => {
    if (!occupied || level.dailyRationKg === null) return null;
    const dispensedToday = level.dispensedKgToday ?? 0;
    const ration         = level.dailyRationKg;
    if (dispensedToday >= ration) return 'full';       // green
    if (dispensedToday / ration >= 0.8) return 'near'; // amber
    return 'low';                                       // red/dim
  })();

  return (
    <div className={`w-full rounded-lg border transition-colors relative ${
      occupied
        ? 'bg-amber-950/30 border-amber-700/40 hover:border-amber-500/60'
        : 'bg-white/5 border-white/10 hover:border-white/20'
    }`}>
      {/* Main click target — log feed */}
      <button
        onClick={() => onSelect(level)}
        className="w-full text-left p-2.5"
      >
        <div className="flex items-center justify-between gap-1">
          <span className="text-[9px] font-bold text-white/40 uppercase tracking-wider">
            {level.label}
          </span>
          {level.assignment && level.feedVariancePercent === 0 && (
            <CheckCircle2 className="w-3 h-3 text-green-400" />
          )}
        </div>

        {occupied ? (
          <>
            <p className="text-[11px] font-bold text-white mt-1 font-mono truncate">
              {level.batch?.batchCode}
            </p>
            <p className="text-[10px] text-amber-200/80 flex items-center gap-1 mt-0.5">
              <Bird className="w-2.5 h-2.5" /> {level.assignment!.birdCount.toLocaleString()}
              {level.hylineWeek && (
                <span className="text-white/30 ml-1">wk{level.hylineWeek}</span>
              )}
            </p>
            {/* Daily ration status (Req 3) */}
            {level.dailyRationKg !== null && (
              <p className={`text-[9px] mt-1 font-semibold ${
                feedStatus === 'full' ? 'text-green-400'
                : feedStatus === 'near' ? 'text-amber-400'
                : 'text-white/40'
              }`}>
                Today: {(level.dispensedKgToday ?? 0).toFixed(1)}/{level.dailyRationKg.toFixed(1)}kg
              </p>
            )}
            {/* Weekly ration status */}
            {level.requiredKgThisWeek != null && (
              <p className={`text-[9px] mt-0.5 ${varianceColor(level.feedVariancePercent)}`}>
                Week: {level.dispensedKgThisWeek}/{level.requiredKgThisWeek}kg
              </p>
            )}
          </>
        ) : (
          <p className="text-[10px] text-white/25 mt-2">Empty</p>
        )}
      </button>

      {/* Mortality button — only shown on occupied cells (Req 1) */}
      {occupied && (
        <button
          onClick={e => { e.stopPropagation(); onLogMortality(level); }}
          className="absolute top-2 right-2 p-0.5 rounded hover:bg-red-900/40 transition-colors group"
          title="Log mortality / culling"
        >
          <XCircle className="w-3 h-3 text-white/20 group-hover:text-red-400 transition-colors" />
        </button>
      )}
    </div>
  );
}

// ── Row block ────────────────────────────────────────────────────────────────

function RowBlock({
  row,
  onSelectLevel,
  onLogHeat,
  onLogMortality,
}: {
  row:            BrooderRowData;
  onSelectLevel:  (level: BrooderLevelData, row: BrooderRowData) => void;
  onLogHeat:      (row: BrooderRowData) => void;
  onLogMortality: (level: BrooderLevelData, row: BrooderRowData) => void;
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

      <div className="grid grid-cols-2 gap-1.5 mt-2">
        {row.levels.map(level => (
          <LevelCell
            key={level.levelId}
            level={level}
            onSelect={l => onSelectLevel(l, row)}
            onLogMortality={l => onLogMortality(l, row)}
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
}: {
  onSelectLevel?:  (level: BrooderLevelData, row: BrooderRowData) => void;
  onLogHeat?:      (row: BrooderRowData) => void;
  onLogMortality?: (level: BrooderLevelData, row: BrooderRowData) => void;
}) {
  const { data, isLoading } = useBrooderCageMap();
  const [, setSelected]     = useState<BrooderLevelData | null>(null);

  const rows        = data?.rows ?? [];
  const totalChicks = data?.totalChicks ?? 0;

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
          <XCircle className="w-3 h-3 text-red-400/60" /> Log mortality
        </span>
        <span className="text-[10px] text-white/30">Tap cell = log feed</span>
      </div>

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
