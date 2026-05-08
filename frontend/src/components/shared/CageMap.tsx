// src/components/shared/CageMap.tsx
// Phase 7 Addendum B — Interactive live cage map for Block 1 (and future Block 2)
// Accessible by MANAGER and OWNER/DIRECTOR

import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api/client';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BatchInfo {
  batchCode: string;
  strain: string;
  stage: string;
  birdCount: number;
  ageWeeks: number | null;
  hdpPercent: number | null;
  transferDate: string;
}

interface RowData {
  rowCode: string;
  isActive: boolean;
  batch: BatchInfo | null;
}

interface SectionData {
  code: string;
  rows: RowData[];
}

interface BlockData {
  block: { id: string; name: string; code: string; isActive: boolean; isUnderConstruction: boolean };
  sections: SectionData[];
}

// ── Palette ───────────────────────────────────────────────────────────────────

const BATCH_PALETTE = [
  { bg: '#0d4f2e', border: '#22c55e', text: '#bbf7d0', dot: '#4ade80' },
  { bg: '#1a3a5c', border: '#38bdf8', text: '#bae6fd', dot: '#7dd3fc' },
  { bg: '#4a1942', border: '#e879f9', text: '#f5d0fe', dot: '#d946ef' },
  { bg: '#3d2a00', border: '#fbbf24', text: '#fef3c7', dot: '#f59e0b' },
  { bg: '#2d1a00', border: '#fb923c', text: '#fed7aa', dot: '#f97316' },
  { bg: '#1a0a2e', border: '#a78bfa', text: '#ede9fe', dot: '#8b5cf6' },
];

function useBatchColorMap(sections: SectionData[]) {
  const mapRef = useRef<Record<string, typeof BATCH_PALETTE[0]>>({});
  const counterRef = useRef(0);

  sections.forEach(sec =>
    sec.rows.forEach(row => {
      if (row.batch && !mapRef.current[row.batch.batchCode]) {
        mapRef.current[row.batch.batchCode] =
          BATCH_PALETTE[counterRef.current % BATCH_PALETTE.length];
        counterRef.current++;
      }
    }),
  );

  return mapRef.current;
}

// ── HDP status ────────────────────────────────────────────────────────────────

function hdpStatus(pct: number | null) {
  if (pct === null) return { label: 'N/A', color: '#6b7280' };
  if (pct >= 85) return { label: 'Excellent', color: '#4ade80' };
  if (pct >= 75) return { label: 'Good',      color: '#a3e635' };
  if (pct >= 65) return { label: 'Fair',      color: '#fbbf24' };
  return          { label: 'Low',             color: '#f87171' };
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

interface TooltipProps {
  row: RowData;
  color: typeof BATCH_PALETTE[0];
  anchorRect: DOMRect;
  containerRect: DOMRect;
}

function Tooltip({ row, color, anchorRect, containerRect }: TooltipProps) {
  const TIP_W = 230;
  const TIP_H = 180;
  const MARGIN = 8;

  let left = anchorRect.left - containerRect.left + anchorRect.width / 2 - TIP_W / 2;
  let top  = anchorRect.top  - containerRect.top  - TIP_H - MARGIN;

  if (left < 0) left = MARGIN;
  if (left + TIP_W > containerRect.width) left = containerRect.width - TIP_W - MARGIN;
  if (top < 0) top = anchorRect.bottom - containerRect.top + MARGIN;

  const { batch } = row;
  const hdp = hdpStatus(batch?.hdpPercent ?? null);

  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width: TIP_W,
        background: '#0f1a11',
        border: `1px solid ${batch ? color.border : '#2a2a2a'}`,
        borderRadius: 10,
        padding: '12px 14px',
        zIndex: 50,
        pointerEvents: 'none',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        fontFamily: 'monospace',
      }}
    >
      {batch ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: color.dot }} />
            <span style={{ color: color.text, fontWeight: 700, fontSize: 13, letterSpacing: 1 }}>
              {batch.batchCode}
            </span>
            <span style={{ color: '#6b7280', fontSize: 10, marginLeft: 'auto' }}>{row.rowCode}</span>
          </div>
          <div style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.8 }}>
            <div><span style={{ color: '#6b7280' }}>Strain:  </span>{batch.strain}</div>
            <div><span style={{ color: '#6b7280' }}>Birds:   </span>
              <span style={{ color: '#e5e7eb', fontWeight: 600 }}>{batch.birdCount.toLocaleString()}</span>
            </div>
            <div><span style={{ color: '#6b7280' }}>Age:     </span>
              {batch.ageWeeks !== null ? `Wk ${batch.ageWeeks}` : '—'}
            </div>
            <div><span style={{ color: '#6b7280' }}>HDP:     </span>
              <span style={{ color: hdp.color, fontWeight: 600 }}>
                {batch.hdpPercent !== null ? `${batch.hdpPercent}%` : '—'}
              </span>
              {batch.hdpPercent !== null && (
                <span style={{ color: hdp.color, fontSize: 10, marginLeft: 4 }}>({hdp.label})</span>
              )}
            </div>
            <div><span style={{ color: '#6b7280' }}>Stage:   </span>{batch.stage}</div>
            <div>
              <span style={{ color: '#6b7280' }}>Placed:  </span>
              {new Date(batch.transferDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
          </div>
        </>
      ) : (
        <div style={{ color: '#6b7280', fontSize: 11, textAlign: 'center', padding: '8px 0' }}>
          <div style={{ fontSize: 20, marginBottom: 4 }}>—</div>
          {row.isActive ? 'Vacant — no batch assigned' : 'Inactive row'}
        </div>
      )}
    </div>
  );
}

// ── Row Cell ──────────────────────────────────────────────────────────────────

interface RowCellProps {
  row: RowData;
  color: typeof BATCH_PALETTE[0] | null;
  highlightBatchCode?: string | null;
  onHover: (row: RowData, rect: DOMRect) => void;
  onLeave: () => void;
}

function RowCell({ row, color, highlightBatchCode, onHover, onLeave }: RowCellProps) {
  const ref = useRef<HTMLDivElement>(null);

  const isDimmed = highlightBatchCode
    ? row.batch?.batchCode !== highlightBatchCode
    : false;

  const bg = !row.isActive
    ? '#0d0d0d'
    : row.batch && color
    ? color.bg
    : '#111a14';

  const borderColor = !row.isActive
    ? '#1a1a1a'
    : row.batch && color
    ? color.border
    : '#1f2f24';

  return (
    <div
      ref={ref}
      onMouseEnter={() => ref.current && onHover(row, ref.current.getBoundingClientRect())}
      onMouseLeave={onLeave}
      style={{
        flex: 1,
        minHeight: 68,
        background: bg,
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        padding: '10px 12px',
        cursor: 'pointer',
        transition: 'transform 0.15s, filter 0.15s',
        opacity: isDimmed ? 0.3 : 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
      className="cage-row-cell"
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span style={{
          fontSize: 11,
          fontWeight: 800,
          fontFamily: 'monospace',
          letterSpacing: 2,
          color: color ? color.text : row.isActive ? '#374151' : '#1f2f24',
        }}>
          {row.rowCode}
        </span>
        {row.batch && color && (
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: color.dot,
            boxShadow: `0 0 6px ${color.dot}`,
          }} />
        )}
      </div>

      {row.batch ? (
        <div>
          <div style={{ fontSize: 10, fontFamily: 'monospace', color: color?.text ?? '#4b5563', letterSpacing: 1 }}>
            {row.batch.batchCode}
          </div>
          <div style={{ fontSize: 9, color: '#6b7280', marginTop: 2 }}>
            {row.batch.birdCount.toLocaleString()} birds
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 9, color: '#374151', fontFamily: 'monospace', letterSpacing: 1 }}>
          {row.isActive ? 'VACANT' : 'INACTIVE'}
        </div>
      )}
    </div>
  );
}

// ── Stats Bar ─────────────────────────────────────────────────────────────────

function StatsBar({ sections }: { sections: SectionData[] }) {
  let totalBirds = 0, occupiedRows = 0, vacantRows = 0, inactiveRows = 0;
  const batches = new Set<string>();

  sections.forEach(sec =>
    sec.rows.forEach(row => {
      if (!row.isActive) { inactiveRows++; return; }
      if (row.batch) {
        occupiedRows++;
        totalBirds += row.batch.birdCount;
        batches.add(row.batch.batchCode);
      } else {
        vacantRows++;
      }
    }),
  );

  const stats = [
    { label: 'Total Birds',    value: totalBirds.toLocaleString(), color: '#4ade80' },
    { label: 'Active Batches', value: batches.size,                color: '#38bdf8' },
    { label: 'Occupied Rows',  value: occupiedRows,                color: '#a3e635' },
    { label: 'Vacant Rows',    value: vacantRows,                  color: '#fbbf24' },
    { label: 'Inactive Rows',  value: inactiveRows,                color: '#374151' },
  ];

  return (
    <div style={{
      display: 'flex', gap: 1, marginBottom: 16,
      background: '#0a0f0d', border: '1px solid #1f2f24',
      borderRadius: 10, overflow: 'hidden',
    }}>
      {stats.map((s, i) => (
        <div key={i} style={{
          flex: 1, padding: '10px 8px',
          borderRight: i < stats.length - 1 ? '1px solid #1f2f24' : 'none',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 18, fontWeight: 900, fontFamily: 'monospace', color: s.color }}>
            {s.value}
          </div>
          <div style={{ fontSize: 8, color: '#6b7280', fontFamily: 'monospace', letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 2 }}>
            {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────

function Legend({ sections, colorMap }: { sections: SectionData[]; colorMap: Record<string, typeof BATCH_PALETTE[0]> }) {
  const seen = new Map<string, { batch: BatchInfo; color: typeof BATCH_PALETTE[0] }>();
  sections.forEach(sec =>
    sec.rows.forEach(row => {
      if (row.batch && !seen.has(row.batch.batchCode)) {
        seen.set(row.batch.batchCode, { batch: row.batch, color: colorMap[row.batch.batchCode] });
      }
    }),
  );

  if (!seen.size) return null;

  return (
    <div style={{
      marginTop: 14,
      display: 'flex',
      flexWrap: 'wrap',
      gap: 12,
      padding: '10px 14px',
      background: '#0a0f0d',
      border: '1px solid #1f2f24',
      borderRadius: 10,
    }}>
      <span style={{ fontSize: 9, color: '#4b5563', fontFamily: 'monospace', letterSpacing: 2, alignSelf: 'center' }}>
        LEGEND
      </span>
      {[...seen.entries()].map(([code, { batch, color }]) => {
        const hdp = hdpStatus(batch.hdpPercent);
        return (
          <div key={code} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: color.bg, border: `1px solid ${color.border}` }} />
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: color.text, letterSpacing: 1 }}>{code}</span>
            <span style={{ color: '#6b7280', fontSize: 10 }}>
              {batch.strain} · Wk {batch.ageWeeks ?? '?'} ·{' '}
              <span style={{ color: hdp.color }}>{batch.hdpPercent !== null ? `${batch.hdpPercent}%` : '—'}</span>
            </span>
          </div>
        );
      })}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
        {[['#111a14', '#1f2f24', 'Vacant'], ['#0d0d0d', '#1a1a1a', 'Inactive']].map(([bg, br, label]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: bg, border: `1px solid ${br}` }} />
            <span style={{ fontSize: 10, color: '#4b5563', fontFamily: 'monospace' }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main CageMap component ────────────────────────────────────────────────────

interface CageMapProps {
  blockCode?: string;        // default 'BLK1'
  highlightBatchCode?: string | null;
  compact?: boolean;         // reduced header for embedding
}

export function CageMap({ blockCode = 'BLK1', highlightBatchCode, compact = false }: CageMapProps) {
  const { data, isLoading, error, dataUpdatedAt } = useQuery<BlockData>({
    queryKey: ['cage-map', blockCode],
    queryFn: async () => {
      const res = await api.get(`/production/blocks/${blockCode}`);
      return res.data;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const [hovered, setHovered] = useState<{ row: RowData; anchorRect: DOMRect } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerRect, setContainerRect] = useState<DOMRect | null>(null);

  const updateRect = useCallback(() => {
    if (containerRef.current) setContainerRect(containerRef.current.getBoundingClientRect());
  }, []);

  useEffect(() => {
    updateRect();
    window.addEventListener('resize', updateRect);
    return () => window.removeEventListener('resize', updateRect);
  }, [updateRect]);

  const colorMap = useBatchColorMap(data?.sections ?? []);

  // ── Under construction state ──────────────────────────────────────────────
  if (data?.block.isUnderConstruction) {
    return (
      <div style={{
        fontFamily: 'monospace',
        background: '#0a0f0d',
        border: '1px solid #1f2f24',
        borderRadius: 14,
        padding: 32,
        textAlign: 'center',
        color: '#fbbf24',
      }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>🚧</div>
        <div style={{ fontSize: 14, letterSpacing: 2, fontWeight: 700 }}>{data.block.name}</div>
        <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4, letterSpacing: 2 }}>
          UNDER CONSTRUCTION
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={{
        fontFamily: 'monospace', background: '#0a0f0d', border: '1px solid #1f2f24',
        borderRadius: 14, padding: 32, textAlign: 'center', color: '#4b5563',
        fontSize: 11, letterSpacing: 2,
      }}>
        LOADING CAGE MAP…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{
        fontFamily: 'monospace', background: '#0a0f0d', border: '1px solid #1f2f24',
        borderRadius: 14, padding: 32, textAlign: 'center', color: '#f87171',
        fontSize: 11, letterSpacing: 2,
      }}>
        UNABLE TO LOAD CAGE MAP
      </div>
    );
  }

  const lastUpdated = new Date(dataUpdatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  return (
    <>
      <style>{`
        .cage-row-cell:hover {
          filter: brightness(1.25);
          transform: translateY(-2px);
          box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        }
        @keyframes cmPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.75); }
        }
      `}</style>

      <div style={{ width: '100%', fontFamily: 'monospace' }}>
        {/* Header */}
        {!compact && (
          <div style={{ marginBottom: 16, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 9, color: '#2E8B57', letterSpacing: 4, textTransform: 'uppercase', marginBottom: 4 }}>
                Anza Whole Foods · Live View
              </div>
              <h2 style={{ fontSize: 22, fontWeight: 900, color: '#e5e7eb', letterSpacing: 2, margin: 0 }}>
                {data.block.name.toUpperCase()}
                <span style={{ fontSize: 12, color: '#4b5563', marginLeft: 10, letterSpacing: 4, fontWeight: 400 }}>
                  CAGE MAP
                </span>
              </h2>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#4ade80', animation: 'cmPulse 2s infinite' }} />
                <span style={{ fontSize: 9, color: '#4ade80', letterSpacing: 2 }}>LIVE</span>
              </div>
              <span style={{ fontSize: 9, color: '#374151', letterSpacing: 1 }}>Updated {lastUpdated}</span>
            </div>
          </div>
        )}

        {/* Stats */}
        <StatsBar sections={data.sections} />

        {/* Map grid */}
        <div
          ref={containerRef}
          style={{
            position: 'relative',
            background: '#0a0f0d',
            border: '1px solid #1f2f24',
            borderRadius: 14,
            padding: 18,
          }}
        >
          {/* Column headers */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, paddingLeft: 'calc(16% + 8px)' }}>
            {['Row 1', 'Row 2'].map(lbl => (
              <div key={lbl} style={{
                flex: 1, textAlign: 'center',
                fontSize: 8, color: '#374151', letterSpacing: 2, textTransform: 'uppercase',
              }}>
                {lbl}
              </div>
            ))}
          </div>

          {/* Sections */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.sections.map(section => (
              <div key={section.code} style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                {/* Section label */}
                <div style={{
                  width: '16%', display: 'flex', alignItems: 'center',
                  justifyContent: 'flex-end', paddingRight: 8, gap: 4,
                }}>
                  <span style={{ fontSize: 8, color: '#4b5563', letterSpacing: 2, textTransform: 'uppercase' }}>Sec</span>
                  <span style={{
                    fontSize: 20, fontWeight: 900, letterSpacing: 1,
                    color: section.rows.some(r => r.batch)
                      ? colorMap[section.rows.find(r => r.batch)!.batch!.batchCode]?.text ?? '#2a3d2e'
                      : '#2a3d2e',
                  }}>
                    {section.code}
                  </span>
                </div>

                {/* Row cells */}
                <div style={{ flex: 1, display: 'flex', gap: 8 }}>
                  {section.rows.map(row => (
                    <RowCell
                      key={row.rowCode}
                      row={row}
                      color={row.batch ? colorMap[row.batch.batchCode] ?? null : null}
                      highlightBatchCode={highlightBatchCode}
                      onHover={(r, rect) => setHovered({ row: r, anchorRect: rect })}
                      onLeave={() => setHovered(null)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Tooltip */}
          {hovered && containerRect && (
            <Tooltip
              row={hovered.row}
              color={
                hovered.row.batch
                  ? colorMap[hovered.row.batch.batchCode] ?? BATCH_PALETTE[0]
                  : { bg: '#111', border: '#333', text: '#888', dot: '#555' }
              }
              anchorRect={hovered.anchorRect}
              containerRect={containerRect}
            />
          )}
        </div>

        {/* Legend */}
        <Legend sections={data.sections} colorMap={colorMap} />

        {/* Hint */}
        <div style={{ textAlign: 'center', marginTop: 10 }}>
          <span style={{ fontSize: 9, color: '#374151', letterSpacing: 2 }}>
            HOVER OVER ANY ROW FOR BATCH DETAILS · AUTO-REFRESHES EVERY 60s
          </span>
        </div>
      </div>
    </>
  );
}
