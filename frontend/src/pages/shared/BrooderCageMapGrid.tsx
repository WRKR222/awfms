// src/components/shared/BrooderCageMapGrid.tsx
// Brooder Cage Map — fixed 6 rows/decks × 4 levels (bottom→top) grid.
// Replaces the old single-unit BrooderCageMap with a true cage map so any
// issue can be isolated to a specific row/level instead of "the brooder".
// Used by ATTENDANT (BrooderPage), MANAGER (ManagerHome) and OWNER (OwnerHome).
//
// Rules enforced in this component:
//   • A level cell can only be interacted with (select / log feed) if it has
//     an active batch assignment. Empty levels are purely visual — they show
//     "Empty" and reject clicks.
//   • The "Log heat" button on a row is disabled and visually muted when the
//     row has zero birds assigned (no batch on any of its 4 levels).

import { useState } from 'react';
import {
  Flame, Zap, Bird, AlertTriangle, CheckCircle2, Clock, Layers,
} from 'lucide-react';
import dayjs from '../../lib/dayjs';
import {
  useBrooderCageMap, type BrooderLevelData, type BrooderRowData,
} from '../../hooks/useBrooderCageMap';

// ── Helpers ──────────────────────────────────────────────────────────────

function varianceColor(pct: number | null) {
  if (pct === null) return 'text-gray-400';
  if (pct === 0) return 'text-green-400';
  if (Math.abs(pct) <= 5) return 'text-amber-300';
  return 'text-red-400';
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
  // HEAT_BULB
  const minutes = heat.bulbMinutesOn ?? 0;
  const hrs = Math.floor(minutes / 60);
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

// ── Level cell ───────────────────────────────────────────────────────────

function LevelCell({
  level, onSelect,
}: {
  level: BrooderLevelData;
  onSelect: (level: BrooderLevelData) => void;
}) {
  const occupied = !!level.assignment;

  // Empty levels are NOT interactive — no assignment means no action available.
  if (!occupied) {
    return (
      <div
        className="w-full text-left rounded-lg p-2.5 border border-white/10 bg-white/[0.02] cursor-not-allowed select-none"
        title="No batch assigned to this level"
      >
        <div className="flex items-center justify-between gap-1">
          <span className="text-[9px] font-bold text-white/30 uppercase tracking-wider">
            {level.label}
          </span>
        </div>
        <p className="text-[10px] text-white/20 mt-2">Empty</p>
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(level)}
      className="w-full text-left rounded-lg p-2.5 border transition-colors bg-amber-950/30 border-amber-700/40 hover:border-amber-500/60"
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-[9px] font-bold text-white/40 uppercase tracking-wider">
          {level.label}
        </span>
        {level.feedVariancePercent === 0 && (
          <CheckCircle2 className="w-3 h-3 text-green-400" />
        )}
      </div>
      <p className="text-[11px] font-bold text-white mt-1 font-mono truncate">
        {level.batch?.batchCode}
      </p>
      <p className="text-[10px] text-amber-200/80 flex items-center gap-1 mt-0.5">
        <Bird className="w-2.5 h-2.5" /> {level.assignment!.birdCount.toLocaleString()}
      </p>
      {level.requiredKgThisWeek != null && (
        <p className={`text-[9px] mt-1 ${varianceColor(level.feedVariancePercent)}`}>
          {level.dispensedKgThisWeek}/{level.requiredKgThisWeek}kg wk
        </p>
      )}
    </button>
  );
}

// ── Row block (4 levels stacked, header has heat status) ───────────────────

function RowBlock({
  row, onSelectLevel, onLogHeat,
}: {
  row: BrooderRowData;
  onSelectLevel: (level: BrooderLevelData, row: BrooderRowData) => void;
  onLogHeat: (row: BrooderRowData) => void;
}) {
  // "Log heat" is only available when at least one level in this row has birds.
  const rowHasBirds = row.birdTotal > 0;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-amber-400" />
          <p className="text-xs font-bold text-white">{row.label}</p>
          <span className="text-[10px] text-white/40">
            {row.birdTotal.toLocaleString()} chicks
          </span>
        </div>
        {rowHasBirds ? (
          <button
            onClick={() => onLogHeat(row)}
            className="text-[10px] text-amber-300 hover:text-amber-200 font-semibold"
          >
            Log heat
          </button>
        ) : (
          <span
            className="text-[10px] text-white/20 font-semibold cursor-not-allowed select-none"
            title="Assign a batch to this row before logging heat"
          >
            Log heat
          </span>
        )}
      </div>
      {rowHasBirds && <HeatBadge heat={row.heatToday} />}
      {/* Levels: top (4) rendered first visually so it reads bottom→top like the real cage */}
      <div className="grid grid-cols-4 gap-1.5 mt-2">
        {[...row.levels].reverse().map(level => (
          <LevelCell key={level.levelId} level={level} onSelect={() => onSelectLevel(level, row)} />
        ))}
      </div>
    </div>
  );
}

// ── Main grid ────────────────────────────────────────────────────────────

export function BrooderCageMapGrid({
  onSelectLevel,
  onLogHeat,
}: {
  onSelectLevel?: (level: BrooderLevelData, row: BrooderRowData) => void;
  onLogHeat?: (row: BrooderRowData) => void;
}) {
  const { data, isLoading } = useBrooderCageMap();
  const [, setSelected] = useState<BrooderLevelData | null>(null);

  const rows = data?.rows ?? [];
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
