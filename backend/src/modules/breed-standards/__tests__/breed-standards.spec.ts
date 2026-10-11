import { describe, it, expect } from 'vitest';
import { applyTolerance, bandStatus, normaliseBreedText, pickPoint, StandardPoint } from '../breed-standard.service';
import { canonicalFeedType, uniformityPct } from '../standard-compliance.service';
import { rowsToPoints } from '../breed-guide-upload.service';
import { metricDef } from '../breed-metrics.catalog';
import { HYLINE_BROWN_2024 } from '../guides/hyline-brown-2024.guide';
import { hylineStandard, gramsPerBirdPerDay, HYLINE_SCHEDULE_MAX_WEEK } from '../../../common/feed/feed-standard.util';
import { notificationDedupeKey, duplicateWhere } from '../../../common/prisma/notification-dedupe';

const pt = (ageFrom: number, ageTo: number, min: number | null, max: number | null, target: number | null = null): StandardPoint => ({
  metric: 'X', variant: null, ageUnit: 'WEEK', ageFrom, ageTo, min, target, max, unit: null, label: null, phase: null, text: null,
});

describe('pickPoint — guide row for an age', () => {
  const pts = [pt(18, 18, 1, 2), pt(20, 20, 3, 4), pt(100, 100, 70, 71.7)];
  it('uses the covering row', () => expect(pickPoint(pts, 20, 'NONE')?.point.min).toBe(3));
  it('fills a gap inside the guide with the latest earlier row', () => expect(pickPoint(pts, 19, 'NONE')?.point.min).toBe(1));
  it('holds the last row past the guide when HOLD_LAST', () => {
    const r = pickPoint(pts, 120, 'HOLD_LAST');
    expect(r?.point.min).toBe(70);
    expect(r?.extended).toBe(true);
  });
  it('stops past the guide when NONE (cumulative / brooding values)', () => expect(pickPoint(pts, 120, 'NONE')).toBeNull());
  it('has no standard before the guide starts', () => expect(pickPoint(pts, 10, 'HOLD_LAST')).toBeNull());
});

describe('applyTolerance & bandStatus', () => {
  it('turns a single egg-weight value into a ±5% band', () => {
    const b = applyTolerance({ min: null, target: 60, max: null }, metricDef('EGG_WEIGHT'));
    expect(b).toEqual({ min: 57, target: 60, max: 63 });
  });
  it('light hours get ±0.5 h', () => {
    expect(applyTolerance({ min: null, target: 16, max: null }, metricDef('LIGHT_HOURS'))).toEqual({ min: 15.5, target: 16, max: 16.5 });
  });
  it('higher-is-better metrics never flag "above"', () => {
    const b = applyTolerance({ min: 85, target: null, max: null }, metricDef('UNIFORMITY'));
    expect(bandStatus(99, b)).toBe('IN_BAND');
    expect(bandStatus(80, b)).toBe('BELOW');
  });
  it('lower-is-better metrics never flag "below"', () => {
    const b = applyTolerance({ min: 0.1, target: null, max: 0.71 }, metricDef('MORTALITY_CUM_LAY'));
    expect(b.min).toBeNull();
    expect(bandStatus(1.84, b)).toBe('ABOVE');
  });
});

describe('breed text & feed names', () => {
  it('normalises Hy-Line spellings to one alias', () => {
    for (const s of ['Hy-Line', 'hyline brown', 'HyLine Brown Max', 'hy line']) {
      expect(normaliseBreedText(s).includes('hyline')).toBe(true);
    }
  });
  it('maps farm feed names to guide feed families', () => {
    expect(canonicalFeedType('Pre-Layer Mash')).toBe('PRELAYER_MASH');
    expect(canonicalFeedType('LAYER_MASH')).toBe('LAYER_MASH');
    expect(canonicalFeedType('Chick Crumbs')).toBe('CHICK_CRUMBS');
    expect(canonicalFeedType('Kienyeji Grower')).toBeNull();
  });
});

describe('uniformityPct', () => {
  it('counts birds within ±10% of the mean', () => {
    expect(uniformityPct([100, 100, 100, 100, 100, 100, 100, 100, 100, 150])).toBe(90);
  });
  it('needs at least 10 weights', () => expect(uniformityPct([1, 2, 3])).toBeNull());
});

describe('Hy-Line Brown 2024 guide data', () => {
  const pts = HYLINE_BROWN_2024.points;
  const find = (metric: string, week: number) => pts.find(p => p.metric === metric && p.ageFrom === week && !p.variant && (p.ageUnit ?? 'WEEK') === 'WEEK');
  it('covers rearing weeks 1-17 and laying weeks 18-100', () => {
    expect(find('BODY_WEIGHT', 1)).toMatchObject({ min: 70, max: 80 });
    expect(find('BODY_WEIGHT', 17)).toMatchObject({ min: 1485, max: 1590 });
    expect(find('BODY_WEIGHT', 18)).toMatchObject({ min: 1550, max: 1670 });
    expect(find('HEN_DAY_PCT', 100)).toMatchObject({ min: 70, max: 71.7 });
    expect(find('MORTALITY_CUM_LAY', 60)).toMatchObject({ max: 2.57 });
  });
  it('every metric key is in the catalogue', () => {
    const unknown = [...new Set(pts.map(p => p.metric))].filter(k => !metricDef(k));
    expect(unknown).toEqual([]);
  });
});

describe('feed-standard util now follows the guide (De Heus chart replaced)', () => {
  it('week 1 weight band is the guide 70-80 g', () => expect(hylineStandard(1)).toMatchObject({ weightMinG: 70, weightMaxG: 80, feedingGramsPerBird: 13 }));
  it('extends to week 100 and holds week 100 beyond it', () => {
    expect(HYLINE_SCHEDULE_MAX_WEEK).toBe(100);
    expect(hylineStandard(40)).toMatchObject({ weightMinG: 1950, weightMaxG: 2090 });
    expect(hylineStandard(130)).toEqual(hylineStandard(100));
  });
  it('mortality ceiling stays cumulative from arrival', () => expect(hylineStandard(18).cumulativeMortalityPct).toBe(2.05));
  it('layer feed follows age instead of a flat 115 g', () => {
    expect(gramsPerBirdPerDay('LAYER_MASH', 18)).toBe(80.5);
    expect(gramsPerBirdPerDay('KIENYEJI_GROWER', 10)).toBe(100);
  });
});

describe('rowsToPoints (guide template)', () => {
  it('parses rows and reports bad ones', () => {
    const { points, errors } = rowsToPoints([
      { metric: 'body weight', age_from: '1', min: '70', max: '80', unit: 'g' },
      { metric: 'HEN_DAY_PCT', age_from: '', min: 1 },
      { metric: 'EGG_WEIGHT', age_from: 25, target: '58.4' },
    ]);
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ metric: 'BODY_WEIGHT', ageFrom: 1, ageTo: 1, min: 70, max: 80 });
    expect(errors[0]).toMatch(/age_from missing/);
  });
});

describe('notification de-duplication keys', () => {
  const n = { userId: 'u', type: 'SYSTEM', title: 'Low stock', message: 'Feed  low', entityId: null, entityType: null };
  it('same content → same key; whitespace ignored', () => {
    expect(notificationDedupeKey(n)).toBe(notificationDedupeKey({ ...n, message: 'Feed low' }));
  });
  it('changed content → new key', () => expect(notificationDedupeKey(n)).not.toBe(notificationDedupeKey({ ...n, message: 'Feed low (2 days)' })));
  it('caller keys are permanent ("k:")', () => expect(notificationDedupeKey({ ...n, dedupeKey: 'std:b:X' })).toBe('k:std:b:X'));
  it('hash keys only match unread or recent rows', () => {
    const w = duplicateWhere(['u'], ['h:abc'], new Date('2026-10-11T00:00:00Z'));
    expect(w.OR[0].OR).toEqual([{ isRead: false }, { createdAt: { gte: new Date('2026-10-04T00:00:00Z') } }]);
  });
});
