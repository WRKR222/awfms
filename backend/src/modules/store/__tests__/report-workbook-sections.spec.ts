// Reading the extra tabs of a production report workbook: weight track and
// stock per cage, recognised by layout rather than tab name.
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  classifySheet, coerceSheetDate, parseCageStockSheet, parseWeightTrackSheet,
} from '../report-workbook-sections.util';
import { ProductionReportParserService } from '../production-report-parser.service';

const cageHeader = ['ROW ', 'LEVEL ', ...Array.from({ length: 4 }, (_, i) => `CAGE ${i + 1}`)];
const cageGrid = [
  ['ANZA WHOLE FOODS LIMITED'],
  ['LAYERS CHICKS BATCH 1-26 STOCK'],
  cageHeader,
  ['F', 4, 10, 10, 10, 9, 39],
  ['', 3, 10, 10, 10, 10, 40],
  ['   ', 2, 10, '', 10, 10, 30],
  [null, null, null, null, null, null, 109],
  cageHeader,
  ['E', 4, 9, 9, 9, 9, 36, 'TOTAL POPULATION', '', '145'],
];

const weightGrid = [
  ['ANZA WHOLE FOODS LIMITED'],
  ['DATE ', 'WEEK ', 'DAY', 'Minimum expected weight(Grms)', 'Maximum expected weight (Grms)', 'Average expected weight (Grms)', 'Average actual weight (Grms)', 'Difference'],
  ['27-Jun-26', 1, 1, 110, 117, 168.5, 35, -133.5],
  [new Date(Date.UTC(2026, 8, 18)), 13, 84, '1,120', '1,184', 1712, '1,051.70', -660.3],
  ['', '', '', '', '', '', '', ''],
];

describe('classifySheet', () => {
  it('recognises each tab by its layout', () => {
    expect(classifySheet(cageGrid)).toBe('CAGE_STOCK');
    expect(classifySheet(weightGrid)).toBe('WEIGHT_TRACK');
    expect(classifySheet([['DATE', 'MORTALITIES', 'FEEDS/KGS/DAY'], ['6/27/26', 5, 152]])).toBe('DAILY');
  });
});

describe('parseWeightTrackSheet', () => {
  it('reads expected and actual weights in grams, with thousands commas', () => {
    const points = parseWeightTrackSheet(weightGrid);
    expect(points).toEqual([
      { date: '2026-06-27', week: 1, day: 1, minExpectedG: 110, maxExpectedG: 117, avgExpectedG: 168.5, avgActualG: 35 },
      { date: '2026-09-18', week: 13, day: 84, minExpectedG: 1120, maxExpectedG: 1184, avgExpectedG: 1712, avgActualG: 1051.7 },
    ]);
  });

  it('converts a kg header into grams', () => {
    const points = parseWeightTrackSheet([
      ['Date', 'Expected weight (kg)', 'Actual weight (kg)'],
      ['2026-09-25', 1.712, 1.1562],
    ]);
    expect(points[0].avgExpectedG).toBeCloseTo(1712);
    expect(points[0].avgActualG).toBeCloseTo(1156.2);
  });
});

describe('parseCageStockSheet', () => {
  const section = parseCageStockSheet(cageGrid);

  it('reads every cage, carrying the row letter down its block', () => {
    expect(section.cages).toContainEqual({ rowLabel: 'F', levelNumber: 4, cageNumber: 4, birdCount: 9 });
    expect(section.cages).toContainEqual({ rowLabel: 'F', levelNumber: 2, cageNumber: 1, birdCount: 10 });
    expect(section.cages).toContainEqual({ rowLabel: 'E', levelNumber: 4, cageNumber: 2, birdCount: 9 });
    // the blank cell (Row F, Level 2, Cage 2) isn't a cage reading
    expect(section.cages.find(c => c.rowLabel === 'F' && c.levelNumber === 2 && c.cageNumber === 2)).toBeUndefined();
    expect(section.cages).toHaveLength(15);
  });

  it('ignores the per-level totals column and checks the grand total', () => {
    expect(section.totalBirds).toBe(145);
    expect(section.sheetTotal).toBe(145);
    expect(section.warnings).toEqual([]);
  });

  it('summarises birds per row and level', () => {
    expect(section.byRowLevel[0]).toEqual({ rowLabel: 'E', levelNumber: 4, cages: 4, birds: 36 });
    expect(section.byRowLevel.find(r => r.rowLabel === 'F' && r.levelNumber === 2)).toEqual({ rowLabel: 'F', levelNumber: 2, cages: 3, birds: 30 });
  });

  it('flags a sheet total that disagrees with its cages', () => {
    const grid = cageGrid.map(r => [...r]);
    grid[8][9] = '150';
    expect(parseCageStockSheet(grid).warnings[0]).toMatch(/150.*145/);
  });
});

describe('coerceSheetDate', () => {
  it.each([
    ['27-Jun-26', '2026-06-27'], ['2-Jul-2026', '2026-07-02'], ['6/27/26', '2026-06-27'], ['2026-09-04', '2026-09-04'],
  ])('reads %s', (raw, iso) => expect(coerceSheetDate(raw)).toBe(iso));

  it('does not read a month banner as a date', () => {
    expect(coerceSheetDate('JUNE')).toBeNull();
    expect(coerceSheetDate('')).toBeNull();
  });
});

describe('multi-tab workbook', () => {
  function workbook(): Buffer {
    const wb = XLSX.utils.book_new();
    // Weight track first: the daily log must still be found by layout.
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(weightGrid), 'Weight track');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['DATE', 'DAY', 'OP.STOCK', 'MORTALITIES', 'C.STOCK', 'AV. WEIGHT(GRMS)', 'FEEDS/KGS/DAY'],
      ['2026-06-27', 1, 12731, 5, 12726, 35, 152],
    ]), 'Stock');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cageGrid), 'Stock per cage');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }
  const parser = new ProductionReportParserService({ storeItem: { findMany: async () => [] } } as any);

  it('finds the daily log, weight track and cage grid', () => {
    const sections = parser.readSections(workbook());
    expect(sections.dailySheet).toBe('Stock');
    expect(sections.weightTrack?.sheetName).toBe('Weight track');
    expect(sections.weightTrack?.points).toHaveLength(2);
    expect(sections.cageStock?.sheetName).toBe('Stock per cage');
    expect(sections.cageStock?.totalBirds).toBe(145);
    expect(sections.ignoredSheets).toEqual([]);
  });

  it('maps the daily log columns, including "AV. WEIGHT(GRMS)"', async () => {
    const { headers, suggestedMapping } = await parser.detectHeaders(workbook());
    expect(headers[0]).toBe('DATE');
    expect(suggestedMapping.fields.avgWeight).toBe('AV. WEIGHT(GRMS)');
    const [row] = parser.parseRows(workbook(), suggestedMapping);
    expect(row).toMatchObject({ date: '2026-06-27', mortality: 5, feedKg: 152, avgWeight: '35' });
  });
});
