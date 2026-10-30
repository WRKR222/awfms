// Egg-collection rowData is recorded per row · level (A1 level 4 … C2 level 1).
// Sessions recorded before that have one entry per row and no `level`.

export const PRODUCTION_UNITS = ['A', 'B', 'C'] as const;
export const PRODUCTION_ROWS = PRODUCTION_UNITS.flatMap(u => [`${u}1`, `${u}2`]);
/** Top level first — the same order as the production house map. */
export const PRODUCTION_LEVELS_TOP_DOWN = [4, 3, 2, 1] as const;

export function levelShort(level: number) {
  return level === 4 ? 'L4 (Top)' : level === 1 ? 'L1 (Bottom)' : `L${level}`;
}

/** "A1 · L4 (Top)" for a per-level entry, "A1" for an older per-row one. */
export function rowLevelLabel(row: { rowCode: string; level?: number | null }) {
  return row.level ? `${row.rowCode} · ${levelShort(row.level)}` : row.rowCode;
}
