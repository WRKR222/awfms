// Tests for the "temperature/humidity/lux from a single comma-packed cell"
// fix — this is the exact shape BATCH_1_CHICK_LAYERS_2026.xlsx uses: one
// "Temp"/"Lux"/"Humidity" column per day, with morning/midday/evening (or
// however many were actually taken) jammed into one cell, e.g. "32,31,30".
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { splitMultiValueCell, ProductionReportParserService } from '../production-report-parser.service';
import { ProductionReportColumnMapping } from '../production-report.dto';

describe('splitMultiValueCell', () => {
  it('splits a comma-packed cell into individual readings', () => {
    expect(splitMultiValueCell('32,31,30')).toEqual(['32', '31', '30']);
  });
  it('caps nothing itself (caller truncates) but drops blank tokens', () => {
    expect(splitMultiValueCell('32,31,30,34,31')).toEqual(['32', '31', '30', '34', '31']);
    expect(splitMultiValueCell('32,,30')).toEqual(['32', '30']);
  });
  it('handles a single value with no delimiter', () => {
    expect(splitMultiValueCell('30')).toEqual(['30']);
  });
  it('handles semicolon/slash delimiters too', () => {
    expect(splitMultiValueCell('100;70')).toEqual(['100', '70']);
    expect(splitMultiValueCell('15/15/15')).toEqual(['15', '15', '15']);
  });
  it('returns empty for blank/undefined cells', () => {
    expect(splitMultiValueCell('')).toEqual([]);
    expect(splitMultiValueCell(undefined)).toEqual([]);
    expect(splitMultiValueCell(null)).toEqual([]);
  });
});

describe('ProductionReportParserService.parseRows — environmental readings from a single packed cell', () => {
  const parser = new ProductionReportParserService(null as any);

  function buildBuffer(rows: (string | number)[][]): Buffer {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Date', 'Temp', 'Lux', 'Humidity'],
      ...rows,
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  const mapping: ProductionReportColumnMapping = {
    fields: { date: 'Date', temperature: 'Temp', lux: 'Lux', humidity: 'Humidity' },
    items: {},
  };

  it('splits a 3-value Temp cell into Morning/Midday/Evening readings', () => {
    const buf = buildBuffer([['2026-06-27', '32,31,30', '100,70', '15,15,15']]);
    const rows = parser.parseRows(buf, mapping);
    expect(rows).toHaveLength(1);
    expect(rows[0].temperatureReadings).toEqual([
      { label: 'Morning', value: '32' }, { label: 'Midday', value: '31' }, { label: 'Evening', value: '30' },
    ]);
    expect(rows[0].luxReadings).toEqual([
      { label: 'Morning', value: '100' }, { label: 'Midday', value: '70' },
    ]);
    expect(rows[0].humidityReadings).toEqual([
      { label: 'Morning', value: '15' }, { label: 'Midday', value: '15' }, { label: 'Evening', value: '15' },
    ]);
    // Single-value fallback fields must stay undefined once split into readings
    // (§ never double-count the same cell).
    expect(rows[0].temperature).toBeUndefined();
    expect(rows[0].lux).toBeUndefined();
    expect(rows[0].humidity).toBeUndefined();
  });

  it('truncates a 5-value cell to the first 3, ignoring the extras', () => {
    const buf = buildBuffer([['2026-07-10', '32,30,34,34,31', '', '']]);
    const rows = parser.parseRows(buf, mapping);
    expect(rows[0].temperatureReadings).toEqual([
      { label: 'Morning', value: '32' }, { label: 'Midday', value: '30' }, { label: 'Evening', value: '34' },
    ]);
  });

  it('falls back to a single Morning-only value when the cell has just one number', () => {
    const buf = buildBuffer([['2026-06-27', '30', '', '']]);
    const rows = parser.parseRows(buf, mapping);
    expect(rows[0].temperatureReadings).toBeUndefined();
    expect(rows[0].temperature).toBe('30');
  });
});
