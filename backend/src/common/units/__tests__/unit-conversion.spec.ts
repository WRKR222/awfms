// Unit recognition, conversion and "None" handling for production-report cells.
import { describe, it, expect } from 'vitest';
import {
  resolveUnit, convertToUnit, parseQuantityWithUnit, isNoneValue, explainUnitMismatch,
} from '../unit-conversion.util';

describe('resolveUnit', () => {
  it.each([
    ['grms', 'g'], ['GMS', 'g'], ['gm', 'g'], ['Grams', 'g'], ['gr', 'g'],
    ['kgs', 'kg'], ['Kilos', 'kg'], ['kg.', 'kg'], ['kilogrammes', 'kg'],
    ['mls', 'ml'], ['m.l.', 'ml'], ['cc', 'ml'], ['millilitres', 'ml'],
    ['Ltrs', 'l'], ['lts', 'l'], ['Litres', 'l'], ['liter', 'l'],
    ['bags', 'bag'], ['sacks', 'bag'], ['sachets', 'sachet'], ['doses', 'dose'], ['ds', 'dose'],
  ])('recognises %s as %s', (raw, canonical) => {
    expect(resolveUnit(raw)?.canonical).toBe(canonical);
  });

  it.each([
    ['gramms', 'g'], ['mililitres', 'ml'], ['litrs', 'l'], ['kilogrm', 'kg'],
  ])('tolerates the misspelling %s as %s', (raw, canonical) => {
    expect(resolveUnit(raw)?.canonical).toBe(canonical);
  });

  it('refuses to guess at words that are not units', () => {
    expect(resolveUnit('vaccine')).toBeNull();
    expect(resolveUnit('xyz')).toBeNull();
  });

  it('does not guess misspellings when fuzzy matching is off', () => {
    expect(resolveUnit('gramms', { fuzzy: false })).toBeNull();
  });
});

describe('convertToUnit', () => {
  it('converts grams to a kg stock unit', () => {
    expect(convertToUnit(500, 'grms', 'KG')).toBeCloseTo(0.5);
  });

  it('converts kg to a gram stock unit', () => {
    expect(convertToUnit(1.5, 'kgs', 'G')).toBeCloseTo(1500);
  });

  it('converts ml to a litre stock unit', () => {
    expect(convertToUnit(250, 'mls', 'LITRES')).toBeCloseTo(0.25);
  });

  it('converts litres to an ml stock unit', () => {
    expect(convertToUnit(2, 'Ltrs', 'ML')).toBeCloseTo(2000);
  });

  it('matches plural/singular count units', () => {
    expect(convertToUnit(6, 'bags', 'BAG')).toBe(6);
  });

  it('never converts weight into volume', () => {
    expect(convertToUnit(5, 'g', 'ML')).toBeNull();
  });

  it('never converts between different count units', () => {
    expect(convertToUnit(2, 'sachets', 'G')).toBeNull();
    expect(convertToUnit(2, 'sachets', 'BAG')).toBeNull();
  });
});

describe('parseQuantityWithUnit', () => {
  it('reads thousands separators', () => {
    expect(parseQuantityWithUnit('1,000 grms')).toEqual({ qty: 1000, unit: 'grms' });
  });

  it('reads dotted unit abbreviations', () => {
    expect(parseQuantityWithUnit('12 m.l.')).toEqual({ qty: 12, unit: 'ml' });
  });

  it('treats a percentage as a concentration, not an amount', () => {
    expect(parseQuantityWithUnit('Amprolium 20%')).toBeNull();
    expect(parseQuantityWithUnit('Amprolium 20% 5g')).toEqual({ qty: 5, unit: 'g' });
  });

  it('reads a quantity with no unit', () => {
    expect(parseQuantityWithUnit('6')).toEqual({ qty: 6, unit: undefined });
  });
});

describe('isNoneValue', () => {
  it.each(['None', 'none', 'NIL', 'nil', 'N/A', 'n.a', 'Nothing', 'Not given', 'no'])('treats "%s" as nothing given', v => {
    expect(isNoneValue(v)).toBe(true);
  });

  it.each(['', '0', 'Amprolium', 'Newcastle', 'Noroflox'])('does not treat "%s" as none', v => {
    expect(isNoneValue(v)).toBe(false);
  });
});

describe('explainUnitMismatch', () => {
  it('explains a weight/volume mismatch', () => {
    expect(explainUnitMismatch('ml', 'G')).toMatch(/volume.*weight/);
  });

  it('explains an unrecognised unit', () => {
    expect(explainUnitMismatch('xyz', 'G')).toMatch(/isn't a unit the system recognises/);
  });
});
