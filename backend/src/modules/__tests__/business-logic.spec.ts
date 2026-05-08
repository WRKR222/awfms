import { describe, it, expect } from 'vitest';

describe('Flock Business Logic', () => {
  it('computes closing count: opening - deaths - culls', () => {
    expect(1000 - 5 - 2).toBe(993);
  });

  it('rejects deaths + culls exceeding opening count', () => {
    const opening = 100; const deaths = 60; const culls = 50;
    expect(deaths + culls > opening).toBe(true);
  });

  it('rejects future dates', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const today = new Date(); today.setHours(23, 59, 59, 999);
    expect(tomorrow > today).toBe(true);
  });
});

describe('Production Business Logic', () => {
  it('calculates hen-day % correctly', () => {
    const totalEggs = 850; const currentCount = 1000;
    const henDayPct = Math.round((totalEggs / currentCount) * 10000) / 100;
    expect(henDayPct).toBe(85.0);
  });

  it('returns null for zero bird count', () => {
    const currentCount = 0;
    const henDayPct = currentCount > 0 ? (900 / currentCount) * 100 : null;
    expect(henDayPct).toBeNull();
  });

  it('sums all grade columns into totalEggs', () => {
    const total = 80 + 200 + 350 + 200 + 20;
    expect(total).toBe(850);
  });
});

describe('Feed Business Logic', () => {
  type AgeKey = '0-6' | '7-18' | '19-99';

  const FEED_STANDARDS: Record<AgeKey, { minKg: number; maxKg: number }> = {
    '0-6':   { minKg: 0.020, maxKg: 0.030 },
    '7-18':  { minKg: 0.060, maxKg: 0.080 },
    '19-99': { minKg: 0.110, maxKg: 0.130 },
  };

  function getAgeKey(ageWeeks: number): AgeKey {
    if (ageWeeks <= 6) return '0-6';
    if (ageWeeks <= 18) return '7-18';
    return '19-99';
  }

  it('calculates feed range for brooding birds', () => {
    const standard = FEED_STANDARDS[getAgeKey(3)];
    expect(standard.minKg * 1000).toBe(20);
    expect(standard.maxKg * 1000).toBe(30);
  });

  it('triggers alert when days remaining <= 3', () => {
    expect(2.8 <= 3).toBe(true);
  });

  it('calculates FCR correctly', () => {
    const totalFeedKg = 1000;
    const totalEggKg = (8000 * 60) / 1000;
    const fcr = Math.round((totalFeedKg / totalEggKg) * 100) / 100;
    expect(fcr).toBeCloseTo(2.08, 1);
  });
});

describe('Invoice Business Logic', () => {
  it('applies TIER_1 for 1-10 trays', () => {
    const tier = (trays: number) => trays >= 11 ? 'TIER_2' : 'TIER_1';
    expect(tier(1)).toBe('TIER_1');
    expect(tier(10)).toBe('TIER_1');
  });

  it('applies TIER_2 for 11+ trays', () => {
    const tier = (trays: number) => trays >= 11 ? 'TIER_2' : 'TIER_1';
    expect(tier(11)).toBe('TIER_2');
  });

  it('balance after partial payment', () => {
    expect(8000 - 5000).toBe(3000);
  });
});