// Pure-function unit tests for the report-reconciliation fixes:
//   1. Additive delta correction — never duplicate a full amount when
//      something is already recorded, only top up the difference, and
//      never auto-reduce a system value the report shows less of.
//   2. Unit-word canonicalisation — "150G" / "150 GRAMS" / "150gm" all
//      normalise identically for item-name / free-text matching.
import { describe, it, expect } from 'vitest';
import {
  resolveAdditiveCorrection, canonicaliseUnitWords, normaliseText,
} from '../production-report-reconciliation.service';

describe('resolveAdditiveCorrection (report says more/less than already recorded)', () => {
  it('matches cleanly when the report agrees with what is already recorded', () => {
    const outcome = resolveAdditiveCorrection(12, 12, 100, 'ml');
    expect(outcome.resolution).toBe('MATCHED');
    expect(outcome.deltaToApply).toBe(0);
  });

  it('applies only the DELTA when the report shows more — the exact "6ml logged, report says 12ml" case', () => {
    // System already has 6ml logged for the day; report says 12ml total.
    const outcome = resolveAdditiveCorrection(6, 12, 100, 'ml');
    expect(outcome.resolution).toBe('AUTOFILLED');
    expect(outcome.deltaToApply).toBe(6); // top-up only, never the full 12 again
  });

  it('never applies a correction bigger than what is actually available (no over-issuance)', () => {
    // Only 3ml is available beyond what's already logged, but the report
    // wants 6 more (6 -> 12) — must NOT silently apply a partial amount or
    // pretend it's fine; must flag it instead.
    const outcome = resolveAdditiveCorrection(6, 12, 3, 'ml');
    expect(outcome.resolution).toBe('DISCREPANCY');
    expect(outcome.deltaToApply).toBe(0);
  });

  it('never auto-reduces when the report shows LESS than what is already recorded', () => {
    const outcome = resolveAdditiveCorrection(12, 6, 100, 'ml');
    expect(outcome.resolution).toBe('DISCREPANCY');
    expect(outcome.deltaToApply).toBe(0);
  });

  it('applies the full amount as a top-up when nothing was recorded yet (alreadyRecorded = 0)', () => {
    const outcome = resolveAdditiveCorrection(0, 12, 100, 'ml');
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
