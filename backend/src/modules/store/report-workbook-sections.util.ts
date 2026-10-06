// src/modules/store/report-workbook-sections.util.ts
// A production report workbook can carry more than the daily log: farms
// keep extra tabs alongside it, e.g.
//   • "Weight track"   — one row per weighing: date, week, day, expected
//                        min/max/average weight and the actual average.
//   • "Stock per cage" — the brooder cage map as a grid: blocks of
//                        ROW | LEVEL | CAGE 1 | CAGE 2 | ... with a bird
//                        count in every cell, one block per row (A-F).
// Each tab is recognised by its layout, not its name, so a renamed or
// reordered tab still reads. Pure functions over raw cell grids (an
// array of rows, as XLSX.utils.sheet_to_json(ws, { header: 1 }) returns)
// — no database, so they're unit-testable on their own.
import { resolveUnit } from '../../common/units/unit-conversion.util';
import { CageStockSection, WeightTrackPoint } from './production-report.dto';

export type SheetKind = 'DAILY' | 'WEIGHT_TRACK' | 'CAGE_STOCK';

const HEADER_SCAN_ROWS = 20;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function norm(cell: unknown): string {
  return String(cell ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** "1,051.70" / 1051.7 / " 9 " -> number; blank or text -> undefined. */
export function sheetNumber(cell: unknown): number | undefined {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : undefined;
  const text = String(cell ?? '').trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(text)) return undefined;
  return parseFloat(text);
}

/** A sheet date cell as YYYY-MM-DD: real dates, Excel serials, ISO text,
 *  "27-Jun-26" / "27 Jun 2026" and "6/27/26" (month first, as Excel writes
 *  US-locale dates). null for anything else (blank, month banners). */
export function coerceSheetDate(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10);
  if (typeof raw === 'number') {
    if (raw <= 0) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + raw * 86400000);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const text = String(raw).trim();
  const fullYear = (y: string) => (y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10));
  const iso = (y: number, m: number, d: number) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
  };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[\s\-/.]+([a-z]{3})[a-z]*[\s\-/.,]+(\d{2,4})$/i.exec(text);
  if (m && MONTHS.includes(m[2].toLowerCase())) return iso(fullYear(m[3]), MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(text);
  if (m) return iso(fullYear(m[3]), +m[1], +m[2]);
  // Anything else the JS date parser understands ("June 27, 2026") — but
  // only text with a digit in it, so a "JUNE" month banner isn't a date.
  if (!/\d/.test(text)) return null;
  const parsed = new Date(text);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

const CAGE_HEADER_RE = /^cage\s*0*(\d+)$/i;

function cageColumns(row: unknown[]): Map<number, number> {
  const cols = new Map<number, number>(); // column index -> cage number
  row.forEach((cell, i) => {
    const m = CAGE_HEADER_RE.exec(String(cell ?? '').trim());
    if (m) cols.set(i, parseInt(m[1], 10));
  });
  return cols;
}

type WeightColumn = 'date' | 'week' | 'day' | 'minExpectedG' | 'maxExpectedG' | 'avgExpectedG' | 'avgActualG';

function classifyWeightHeader(cell: unknown): WeightColumn | null {
  const h = norm(cell);
  if (!h) return null;
  if (h === 'date') return 'date';
  if (h.startsWith('week')) return 'week';
  if (h === 'day' || h.startsWith('dayno') || h === 'age' || h.startsWith('agedays')) return 'day';
  if (h.includes('differ') || h.includes('variance') || h.includes('deviation')) return null;
  const expected = h.includes('expect') || h.includes('standard') || h.includes('target');
  if (expected && h.includes('min')) return 'minExpectedG';
  if (expected && h.includes('max')) return 'maxExpectedG';
  if (expected) return 'avgExpectedG';
  if (h.includes('weight') && (h.includes('actual') || h.startsWith('av'))) return 'avgActualG';
  return null;
}

/** Grams per unit written in a weight header, e.g. "(Grms)" -> 1, "(kg)" -> 1000. */
function headerGramsFactor(cell: unknown): number {
  const m = /\(([^)]+)\)/.exec(String(cell ?? ''));
  const unit = m ? resolveUnit(m[1]) : null;
  return unit?.dim === 'mass' ? unit.factor / 0.001 : 1;
}

function findWeightHeader(raw: unknown[][]): { rowIdx: number; cols: Map<number, WeightColumn>; factors: Map<number, number> } | null {
  for (let i = 0; i < Math.min(raw.length, HEADER_SCAN_ROWS); i++) {
    const cols = new Map<number, WeightColumn>();
    const factors = new Map<number, number>();
    (raw[i] ?? []).forEach((cell, c) => {
      const kind = classifyWeightHeader(cell);
      if (kind && ![...cols.values()].includes(kind)) {
        cols.set(c, kind);
        factors.set(c, headerGramsFactor(cell));
      }
    });
    const kinds = new Set(cols.values());
    const hasExpected = kinds.has('avgExpectedG') || kinds.has('minExpectedG') || kinds.has('maxExpectedG');
    if (kinds.has('date') && kinds.has('avgActualG') && hasExpected) return { rowIdx: i, cols, factors };
  }
  return null;
}

/** Which kind of tab a raw cell grid is. A cage grid has a ROW / LEVEL /
 *  CAGE 1.. header; a weight track has date + expected + actual weight
 *  columns; anything else is treated as the daily log. */
export function classifySheet(raw: unknown[][]): SheetKind {
  for (let i = 0; i < Math.min(raw.length, HEADER_SCAN_ROWS); i++) {
    const row = raw[i] ?? [];
    const hasRowAndLevel = row.some(c => norm(c) === 'row') && row.some(c => norm(c) === 'level');
    if (hasRowAndLevel && cageColumns(row).size >= 3) return 'CAGE_STOCK';
  }
  if (findWeightHeader(raw)) return 'WEIGHT_TRACK';
  return 'DAILY';
}

/** Reads a weight-track tab into one point per date (a repeated date keeps
 *  the later row). Weights come back in grams whatever the header's unit. */
export function parseWeightTrackSheet(raw: unknown[][]): WeightTrackPoint[] {
  const header = findWeightHeader(raw);
  if (!header) return [];
  const byDate = new Map<string, WeightTrackPoint>();
  for (const row of raw.slice(header.rowIdx + 1)) {
    let date: string | null = null;
    const point: Partial<WeightTrackPoint> = {};
    for (const [c, kind] of header.cols) {
      const cell = (row ?? [])[c];
      if (kind === 'date') { date = coerceSheetDate(cell); continue; }
      const n = sheetNumber(cell);
      if (n === undefined) continue;
      if (kind === 'week' || kind === 'day') point[kind] = Math.round(n);
      else point[kind] = Math.round(n * (header.factors.get(c) ?? 1) * 100) / 100;
    }
    if (!date) continue;
    if (point.avgActualG === undefined && point.avgExpectedG === undefined) continue;
    byDate.set(date, { date, ...point });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Reads a stock-per-cage grid. Each block starts with a header row
 *  (ROW | LEVEL | CAGE 1 | CAGE 2 ...); the rows under it carry a level
 *  number and one bird count per cage column. The row letter is written
 *  once per block (merged/blank below it), so it carries down. Blank
 *  cells are skipped; the per-level and grand totals the sheet adds (in
 *  columns with no CAGE header, or a "TOTAL POPULATION" cell) are only
 *  used to cross-check what was read. */
export function parseCageStockSheet(raw: unknown[][]): CageStockSection {
  const cages: CageStockSection['cages'] = [];
  const warnings: string[] = [];
  let sheetTotal: number | undefined;
  let cols: Map<number, number> | null = null;
  let rowCol = -1;
  let levelCol = -1;
  let currentRow = '';
  const seen = new Set<string>();

  raw.forEach((row, r) => {
    const cells = row ?? [];
    // "TOTAL POPULATION" with the figure in a later cell on the same row.
    const totalIdx = cells.findIndex(c => norm(c).startsWith('totalpopulation') || norm(c) === 'grandtotal');
    if (totalIdx >= 0) {
      const n = cells.slice(totalIdx + 1).map(sheetNumber).find(v => v !== undefined);
      if (n !== undefined) sheetTotal = n;
    }

    const headerCols = cageColumns(cells);
    if (headerCols.size >= 3) {
      cols = headerCols;
      rowCol = cells.findIndex(c => norm(c) === 'row');
      levelCol = cells.findIndex(c => norm(c) === 'level');
      currentRow = '';
      return;
    }
    if (!cols || levelCol < 0) return;

    const rowText = String(cells[rowCol] ?? '').trim().replace(/^row\s*/i, '');
    if (rowText) currentRow = rowText.toUpperCase();
    const levelMatch = /(\d+)/.exec(String(cells[levelCol] ?? ''));
    if (!levelMatch) return; // a totals line between blocks
    if (!currentRow) {
      warnings.push(`Sheet row ${r + 1}: a level is listed before any row letter — skipped.`);
      return;
    }
    const levelNumber = parseInt(levelMatch[1], 10);
    for (const [c, cageNumber] of cols) {
      const birds = sheetNumber(cells[c]);
      if (birds === undefined) continue;
      const key = `${currentRow}|${levelNumber}|${cageNumber}`;
      if (seen.has(key)) {
        warnings.push(`Row ${currentRow} · Level ${levelNumber} · Cage ${cageNumber} appears twice — the later count was used.`);
        const i = cages.findIndex(x => x.rowLabel === currentRow && x.levelNumber === levelNumber && x.cageNumber === cageNumber);
        cages.splice(i, 1);
      }
      seen.add(key);
      cages.push({ rowLabel: currentRow, levelNumber, cageNumber, birdCount: Math.max(0, Math.round(birds)) });
    }
  });

  const totalBirds = cages.reduce((s, c) => s + c.birdCount, 0);
  if (sheetTotal !== undefined && sheetTotal !== totalBirds) {
    warnings.push(`The sheet's total population says ${sheetTotal.toLocaleString()} but its cages add up to ${totalBirds.toLocaleString()}.`);
  }

  const byKey = new Map<string, CageStockSection['byRowLevel'][number]>();
  for (const c of cages) {
    const key = `${c.rowLabel}|${c.levelNumber}`;
    const entry = byKey.get(key) ?? { rowLabel: c.rowLabel, levelNumber: c.levelNumber, cages: 0, birds: 0 };
    if (c.birdCount > 0) entry.cages += 1;
    entry.birds += c.birdCount;
    byKey.set(key, entry);
  }
  const byRowLevel = [...byKey.values()].sort((a, b) => a.rowLabel.localeCompare(b.rowLabel) || b.levelNumber - a.levelNumber);

  return { sheetName: '', cages, totalBirds, sheetTotal, byRowLevel, warnings };
}
