import { describe, expect, it } from 'vitest';
import { resolvePlanMonday } from '../issuance-plan.service';

// "Today" on the farm: Monday 2 Nov 2026.
const today = new Date(Date.UTC(2026, 10, 2));

describe('issuance plan week', () => {
  it('accepts a missed past week, this week and next week', () => {
    expect(resolvePlanMonday('2026-10-26', today).toISOString().slice(0, 10)).toBe('2026-10-26');
    expect(resolvePlanMonday('2026-11-02', today).toISOString().slice(0, 10)).toBe('2026-11-02');
    expect(resolvePlanMonday('2026-11-09', today).toISOString().slice(0, 10)).toBe('2026-11-09');
  });

  it('refuses a week further ahead than next week (e.g. 26 Nov typed for 26 Oct)', () => {
    expect(() => resolvePlanMonday('2026-11-23', today)).toThrow(/next week \(9 Nov\) at the latest/);
  });

  it('refuses a date that is not a Monday', () => {
    expect(() => resolvePlanMonday('2026-10-28', today)).toThrow(/must be a Monday/);
  });
});
