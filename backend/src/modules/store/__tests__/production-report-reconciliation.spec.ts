// Pure-function unit tests for the report-reconciliation fixes:
//   1. Report-is-authoritative correction — whatever the report says for a
//      field is what gets recorded, whether higher or lower than what's
//      already in the system, with no held-balance ceiling.
//   2. Unit-word canonicalisation — "150G" / "150 GRAMS" / "150gm" all
//      normalise identically for item-name / free-text matching.
import { describe, it, expect } from 'vitest';
import {
  resolveReportCorrection, canonicaliseUnitWords, normaliseText,
  planDayReplacement, feedLinesMatch, vaccineGivenNames,
} from '../production-report-reconciliation.service';

/** Day total after applying a plan: target takes the report value, cleared records drop to 0. */
function dayAfter(records: { id: string; v: number }[], report: number) {
  const plan = planDayReplacement(records, r => r.v, report);
  if (plan.matched) return records.reduce((s, r) => s + r.v, 0);
  return records.reduce((s, r) => {
    if (r === plan.target) return s + report;
    if (plan.clearIds.includes(r.id)) return s;
    return s + r.v;
  }, 0);
}

describe('planDayReplacement (report replaces the day, never adds to it)', () => {
  it('601 kg logged on PM + report 600 kg leaves the day at 600, not 1201', () => {
    const records = [{ id: 'AM', v: 0 }, { id: 'PM', v: 601 }];
    const plan = planDayReplacement(records, r => r.v, 600);
    expect(plan.matched).toBe(false);
    expect(plan.target?.id).toBe('PM');
    expect(dayAfter(records, 600)).toBe(600);
  });

  it('385 kg recorded + report 600 kg replaces the 385 record with 600', () => {
    const records = [{ id: 'AM', v: 385 }];
    const plan = planDayReplacement(records, r => r.v, 600);
    expect(plan.target?.id).toBe('AM');
    expect(plan.clearIds).toEqual([]);
    expect(dayAfter(records, 600)).toBe(600);
  });

  it('matches when AM + PM already add up to the report — nothing is written', () => {
    const plan = planDayReplacement([{ id: 'AM', v: 300 }, { id: 'PM', v: 300 }], r => r.v, 600);
    expect(plan.matched).toBe(true);
    expect(plan.target).toBeNull();
  });

  it('a split day that disagrees ends at the report figure, with the other record cleared', () => {
    const records = [{ id: 'AM', v: 300 }, { id: 'PM', v: 200 }];
    const plan = planDayReplacement(records, r => r.v, 650);
    expect(plan.target?.id).toBe('AM');
    expect(plan.clearIds).toEqual(['PM']);
    expect(dayAfter(records, 650)).toBe(650);
  });

  it('fills a gap: nothing recorded on the day gets the report figure', () => {
    const records = [{ id: 'AM', v: 0 }];
    expect(dayAfter(records, 600)).toBe(600);
  });

  it('re-uploading the same report is a no-op (idempotent)', () => {
    const records = [{ id: 'AM', v: 0 }, { id: 'PM', v: 601 }];
    const first = planDayReplacement(records, r => r.v, 600);
    const applied = records.map(r => (r === first.target ? { ...r, v: 600 } : first.clearIds.includes(r.id) ? { ...r, v: 0 } : r));
    expect(planDayReplacement(applied, r => r.v, 600).matched).toBe(true);
  });

  it('no records and a zero report figure is a match, not a write', () => {
    expect(planDayReplacement([], () => 0, 0).matched).toBe(true);
  });
});

describe('feedLinesMatch (split feed days)', () => {
  it('matches the same feeds and amounts in any order', () => {
    expect(feedLinesMatch(
      [{ key: 'item:crumbs', kg: 290.25 }, { key: 'item:growers', kg: 96.75 }],
      [{ key: 'item:growers', kg: 96.75 }, { key: 'item:crumbs', kg: 290.25 }],
    )).toBe(true);
  });

  it('does not match when an amount differs', () => {
    expect(feedLinesMatch([{ key: 'item:crumbs', kg: 290 }], [{ key: 'item:crumbs', kg: 385 }])).toBe(false);
  });

  it('does not match when the day carries an extra entry (would otherwise double count)', () => {
    expect(feedLinesMatch(
      [{ key: 'item:crumbs', kg: 600 }],
      [{ key: 'item:crumbs', kg: 600 }, { key: 'item:crumbs', kg: 601 }],
    )).toBe(false);
  });
});

describe('vaccineGivenNames (laying-batch free-text health entries)', () => {
  it('reads names out of the attendant form format', () => {
    expect(vaccineGivenNames('V: Newcastle (10ml); T: Amprolium (5g)')).toEqual(['Newcastle', 'Amprolium']);
  });

  it('reads names out of a line a previous report upload appended', () => {
    expect(vaccineGivenNames('Amprolium 20% (5G) — 5G used — Auto-filled (from store production report "x.xlsx")'))
      .toEqual(['Amprolium 20%']);
  });

  it('handles an empty field', () => {
    expect(vaccineGivenNames(null)).toEqual([]);
  });
});

describe('resolveReportCorrection (report is authoritative)', () => {
  it('matches cleanly when the report agrees with what is already recorded', () => {
    const outcome = resolveReportCorrection(12, 12, 'ml');
    expect(outcome.resolution).toBe('MATCHED');
    expect(outcome.deltaToApply).toBe(0);
  });

  it('applies only the DELTA when the report shows more — the exact "6ml logged, report says 12ml" case', () => {
    // System already has 6ml logged for the day; report says 12ml total.
    const outcome = resolveReportCorrection(6, 12, 'ml');
    expect(outcome.resolution).toBe('AUTOFILLED');
    expect(outcome.deltaToApply).toBe(6); // top-up only, never the full 12 again
  });

  it('corrects with no held-balance ceiling — the report is trusted even beyond what was ever issued', () => {
    const outcome = resolveReportCorrection(6, 12, 'ml');
    expect(outcome.resolution).toBe('AUTOFILLED');
    expect(outcome.deltaToApply).toBe(6);
  });

  it('corrects DOWN (negative delta) when the report shows LESS than what is already recorded', () => {
    const outcome = resolveReportCorrection(12, 6, 'ml');
    expect(outcome.resolution).toBe('AUTOFILLED');
    expect(outcome.deltaToApply).toBe(-6);
  });

  it('applies the full amount as a top-up when nothing was recorded yet (alreadyRecorded = 0)', () => {
    const outcome = resolveReportCorrection(0, 12, 'ml');
    expect(outcome.resolution).toBe('AUTOFILLED');
    expect(outcome.deltaToApply).toBe(12);
  });
});

describe('canonicaliseUnitWords / normaliseText (unit-synonym matching)', () => {
  it('treats 150G, 150 GRAMS and 150gm as the same token once fully normalised', () => {
    // canonicaliseUnitWords only substitutes unit synonyms — case folding
    // happens in normaliseText() right after, so compare post-normaliseText.
    expect(normaliseText('150G')).toBe(normaliseText('150 GRAMS'));
    expect(normaliseText('150gm')).toBe(normaliseText('150 GRAMS'));
    expect(canonicaliseUnitWords('150 GRAMS').toLowerCase()).toBe('150g');
  });

  it('normaliseText makes "Chick Start 150G" and "Chick Start 150 Grams" compare equal', () => {
    expect(normaliseText('Chick Start 150G')).toBe(normaliseText('Chick Start 150 Grams'));
    expect(normaliseText('Chick Start 150GM')).toBe(normaliseText('Chick Start 150 Grams'));
  });

  it('normaliseText makes "12ml" and "12 Millilitres" compare equal', () => {
    expect(normaliseText('Sol-vita 12ml')).toBe(normaliseText('Sol-vita 12 Millilitres'));
  });

  it('does not merge genuinely different quantities', () => {
    expect(normaliseText('Chick Start 150G')).not.toBe(normaliseText('Chick Start 200G'));
  });
});
