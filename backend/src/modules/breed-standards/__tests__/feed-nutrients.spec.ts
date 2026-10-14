import { describe, it, expect } from 'vitest';
import { NUTRIENT_BY_KEY, nutrientKeyFromLabel, parseGuideNutrient } from '../feed-nutrients.catalog';
import { normaliseLabValues } from '../feed-lab.service';
import { dayDiet, labTestFor } from '../standard-compliance.service';
import { metricDef, metricsUnderPlanKey, recordableMetrics } from '../breed-metrics.catalog';
import { HYLINE_BROWN_2024 } from '../guides/hyline-brown-2024.guide';

describe('guide nutrient parsing', () => {
  it('uses the TOTAL figure from "SID / total"', () => expect(parseGuideNutrient('830 / 909')).toEqual({ target: 909 }));
  it('reads ranges and single values', () => {
    expect(parseGuideNutrient('315–330')).toEqual({ min: 315, max: 330 });
    expect(parseGuideNutrient('17.80')).toEqual({ target: 17.8 });
  });
  it('maps guide labels to nutrient keys', () => {
    expect(nutrientKeyFromLabel('Methionine+Cystine (SID / total)')).toBe('MET_CYS');
    expect(nutrientKeyFromLabel('Methionine (SID / total)')).toBe('METHIONINE');
    expect(nutrientKeyFromLabel('Phosphorus (available)')).toBe('AV_PHOSPHORUS');
    expect(nutrientKeyFromLabel('Calcium particle size (fine : coarse)')).toBeNull();
  });
  it('Hy-Line seed carries numeric targets', () => {
    const p = HYLINE_BROWN_2024.points;
    expect(p.find(x => x.metric === 'INTAKE_LYSINE' && x.variant === 'OPTIMAL' && x.phase === 'Peaking')?.target).toBe(953);
    expect(p.find(x => x.metric === 'DIET_LYSINE' && x.phase === 'Grower')?.target).toBe(0.89);
    expect(p.find(x => x.metric === 'INTAKE_CALCIUM' && x.ageFrom === 34)?.target).toBe(4.2);
  });
});

describe('intake conversion', () => {
  it('g feed × % → mg or g per day; kcal/kg → kcal per day', () => {
    expect(NUTRIENT_BY_KEY.get('LYSINE')!.intake(110, 0.8)).toBeCloseTo(880);
    expect(NUTRIENT_BY_KEY.get('CALCIUM')!.intake(110, 4)).toBeCloseTo(4.4);
    expect(NUTRIENT_BY_KEY.get('ENERGY')!.intake(110, 2800)).toBeCloseTo(308);
  });
});

describe('normaliseLabValues', () => {
  it('converts dry matter to as fed and MJ to kcal', () => {
    const v = normaliseLabValues({ ENERGY: 13, LYSINE: 1, MOISTURE: 12 }, 'DRY_MATTER', 'MJ');
    expect(v.LYSINE).toBeCloseTo(0.88);
    expect(v.ENERGY).toBeCloseTo(13 * 239.006 * 0.88, 1);
    expect(v.MOISTURE).toBe(12);
  });
  it('rejects impossible figures', () => {
    expect(() => normaliseLabValues({ PROTEIN: 150 })).toThrow(/over 100/);
    expect(() => normaliseLabValues({ ENERGY: 12 })).toThrow(/looks wrong/);
    expect(() => normaliseLabValues({ PROTEIN: 17 }, 'DRY_MATTER')).toThrow(/moisture/);
    expect(() => normaliseLabValues({ MOISTURE: 11 })).toThrow(/at least one/);
  });
});

describe('matching feed eaten to lab tests', () => {
  const tests = [
    { storeItemId: 'a', feedFamily: 'LAYER_MASH', effectiveFrom: new Date('2026-07-01'), values: { LYSINE: 0.8, CALCIUM: 4 } },
    { storeItemId: 'a', feedFamily: 'LAYER_MASH', effectiveFrom: new Date('2026-05-01'), values: { LYSINE: 0.7 } },
    { storeItemId: 'g', feedFamily: 'GROWER_MASH', effectiveFrom: new Date('2026-04-01'), values: { LYSINE: 0.9, CALCIUM: 1 } },
  ].sort((x, y) => y.effectiveFrom.getTime() - x.effectiveFrom.getTime());
  it('uses the newest test in force on the day', () => {
    expect(labTestFor(tests, { kg: 1, storeItemId: 'a', family: null }, new Date('2026-06-01'))?.values.LYSINE).toBe(0.7);
    expect(labTestFor(tests, { kg: 1, storeItemId: 'a', family: null }, new Date('2026-07-02'))?.values.LYSINE).toBe(0.8);
  });
  it('falls back to the feed family when the store item is unknown', () => {
    expect(labTestFor(tests, { kg: 1, storeItemId: null, family: 'GROWER_MASH' }, new Date('2026-06-01'))?.storeItemId).toBe('g');
  });
  it('blends a transition day by kg and skips days with an untested feed', () => {
    const d = dayDiet([{ kg: 75, storeItemId: 'g', family: null }, { kg: 25, storeItemId: 'a', family: null }], tests, new Date('2026-07-10'));
    expect(d!.conc.LYSINE).toBeCloseTo(0.875);
    expect(d!.conc.CALCIUM).toBeCloseTo(1.75);
    expect(dayDiet([{ kg: 10, storeItemId: 'x', family: 'CHICK_MASH' }], tests, new Date('2026-07-10'))).toBeNull();
  });
});

describe('recording plan switch', () => {
  it('one FEED_NUTRIENTS choice covers every nutrient metric', () => {
    const keys = metricsUnderPlanKey('FEED_NUTRIENTS');
    expect(keys).toContain('INTAKE_LYSINE');
    expect(keys).toContain('DIET_CALCIUM');
    expect(recordableMetrics().map(m => m.key)).toContain('FEED_NUTRIENTS');
    expect(recordableMetrics().map(m => m.key)).not.toContain('INTAKE_LYSINE');
    expect(metricDef('INTAKE_LYSINE')?.direction).toBe('HIGHER_BETTER');
    expect(metricDef('INTAKE_ENERGY')?.direction).toBe('IN_BAND');
  });
});

describe('isFeedItem (feed dropdown)', () => {
  it('includes feeds filed under Feed, or Other/Supplement with a feed label or name', async () => {
    const { isFeedItem } = await import('../feed-lab.service');
    expect(isFeedItem({ name: 'Grower Mash 70kg', category: 'FEED' })).toBe(true);
    expect(isFeedItem({ name: 'Kenchic Layers', category: 'OTHER', customCategoryLabel: 'Feeds' })).toBe(true);
    expect(isFeedItem({ name: 'Layers Mash', category: 'OTHER' })).toBe(true);
    expect(isFeedItem({ name: 'Chick Crumbs', category: 'SUPPLEMENT' })).toBe(true);
  });
  it('never includes medicines, vaccines or equipment', async () => {
    const { isFeedItem } = await import('../feed-lab.service');
    expect(isFeedItem({ name: 'Layer Booster Vitamins', category: 'MEDICATION' })).toBe(false);
    expect(isFeedItem({ name: 'Feeder trough', category: 'EQUIPMENT' })).toBe(false);
    expect(isFeedItem({ name: 'Charcoal', category: 'OTHER', customCategoryLabel: 'Fuel' })).toBe(false);
  });
});
