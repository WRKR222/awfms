// Parsing real sheet cells: "None" means nothing given; units convert.
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { ProductionReportParserService } from '../production-report-parser.service';

function sheet(rows: Record<string, unknown>[]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

const mapping = {
  fields: {
    date: 'Date', feedKg: 'Feed', waterLts: 'Water', mortality: 'Mortality',
    openingStock: 'O.Stock', vaccineText: 'Vaccine', feedType: 'Feed Type',
  },
  items: { 'charcoal-id': 'Charcoal' },
} as any;

const parser = new ProductionReportParserService({} as any);

describe('production report parsing', () => {
  it('reads "None" as nothing given/issued, and leaves stock counts unknown', () => {
    const [row] = parser.parseRows(sheet([{
      Date: '2026-09-28', Feed: 'None', Water: 'Nil', Mortality: 'none', 'O.Stock': 'None',
      Vaccine: 'None', 'Feed Type': 'None', Charcoal: 'None',
    }]), mapping);
    expect(row.feedKg).toBe(0);
    expect(row.waterLts).toBe(0);
    expect(row.mortality).toBe(0);
    expect(row.openingStock).toBeUndefined();
    expect(row.vaccineText).toBeUndefined();
    expect(row.feedType).toBeUndefined();
    expect(row.itemsIssued).toEqual([expect.objectContaining({ storeItemId: 'charcoal-id', quantity: 0 })]);
  });

  it('leaves a blank cell as not filled in', () => {
    const [row] = parser.parseRows(sheet([{ Date: '2026-09-28', Feed: '', Water: '', Mortality: '', Vaccine: '' }]), mapping);
    expect(row.feedKg).toBeUndefined();
    expect(row.mortality).toBeUndefined();
    expect(row.vaccineText).toBeUndefined();
  });

  it('converts feed and water written in other units into kg and litres', () => {
    const [row] = parser.parseRows(sheet([{ Date: '2026-09-28', Feed: '600,000 grms', Water: '2,500 mls' }]), mapping);
    expect(row.feedKg).toBeCloseTo(600);
    expect(row.waterLts).toBeCloseTo(2.5);
  });

  it('keeps plain numbers as written', () => {
    const [row] = parser.parseRows(sheet([{ Date: '2026-09-28', Feed: 601, Water: '120 ltrs', Mortality: 3 }]), mapping);
    expect(row.feedKg).toBe(601);
    expect(row.waterLts).toBe(120);
    expect(row.mortality).toBe(3);
  });
});
