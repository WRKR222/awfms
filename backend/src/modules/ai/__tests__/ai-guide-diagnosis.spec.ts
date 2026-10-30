import { describe, expect, it } from 'vitest';
import { AiGuideDiagnosisService } from '../ai-guide-diagnosis.service';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const week = (ageIndex: number, from: string, to: string, metric: string, actual: number, min: number, target: number, max: number, status: string) =>
  ({ ageIndex, periodStart: d(from), periodEnd: d(to), metric, actualValue: actual, minValue: min, targetValue: target, maxValue: max, status, basis: 'GUIDE' });
const session = (date: string, extra: any = {}) => ({
  sessionDate: d(date), shift: 'AM', closingStock: 1000, mortalities: 0, feedKg: 55, feedTypeName: 'LAYER_MASH',
  waterLiters: 200, houseTempC: 24, totalGoodEggs: 900, totalStarterEggs: 0, totalBrokenEggs: 10, totalDamaged: 0,
  totalSoftShell: 5, totalDeformed: 0, mortalityCagesJson: null, ...extra,
});

function prismaWith(opts: { rows?: any[]; sessions?: any[]; mortLogs?: any[]; health?: any[] }) {
  return {
    batch: { findFirst: async () => ({ id: 'b1', batchCode: 'HL-01', dateOfHatch: d('2026-04-01'), quantityReceived: 1000, currentBirdCount: 980 }) },
    batchStandardMetric: { findMany: async () => opts.rows ?? [] },
    eggCollectionSession: { findMany: async () => opts.sessions ?? [] },
    productionCageMortalityLog: { findMany: async () => opts.mortLogs ?? [] },
    healthEvent: { findMany: async () => opts.health ?? [] },
    vaccinationRecord: { findMany: async () => [] },
  } as any;
}

describe('AI guide vs actual diagnosis context', () => {
  const rows = [
    week(29, '2026-10-14', '2026-10-20', 'HEN_DAY_PCT', 93, 92, 94, 95, 'IN_BAND'),
    week(30, '2026-10-21', '2026-10-27', 'HEN_DAY_PCT', 84.5, 92, 94, 95, 'BELOW'),
    week(30, '2026-10-21', '2026-10-27', 'MORTALITY_CUM_LAY', 1.2, 0, 0.8, 1, 'ABOVE'),
  ];

  it('shows the gap against the guide and the records around it', async () => {
    const svc = new AiGuideDiagnosisService(prismaWith({
      rows,
      sessions: [
        session('2026-10-15'),
        session('2026-10-22', { waterLiters: 120, houseTempC: 31, feedTypeName: 'LAYER_MASH_2', mortalities: 6 }),
      ],
      mortLogs: [{ logDate: d('2026-10-22'), count: 6, cause: 'heat stress', cage: { label: 'A1 · Level 4 (Top)' } }],
      health: [{ eventDate: d('2026-10-23'), eventType: 'DISEASE_OUTBREAK', affectedCount: 12, symptoms: 'panting', diagnosis: null, treatment: null }],
    }));
    const text = await svc.batchBlock('b1');
    expect(text).toContain('off the guide in: Production, Mortality / livability');
    expect(text).toMatch(/wk 30: 84\.5 vs guide 92–95, target 94 → BELOW \(-9\.5\)/);
    expect(text).toContain('water 120 ml/bird/day');
    expect(text).toContain('house temp 31°C');
    expect(text).toContain('house temp 24°C');
    expect(text).toContain('(CHANGED from previous week)');
    expect(text).toContain('heat stress (6)');
    expect(text).toContain('A1 · Level 4 (Top) (6)');
    expect(text).toContain('symptoms: panting');
  });

  it('farm-wide block leaves out batches that are on the guide', async () => {
    const svc = new AiGuideDiagnosisService(prismaWith({ rows: [rows[0]], sessions: [session('2026-10-15')] }));
    expect(await svc.batchesBlock(['b1'])).toBe('');
  });

  it('a batch without a guide is compared against its own weeks', async () => {
    const svc = new AiGuideDiagnosisService(prismaWith({ sessions: [] }));
    const text = await svc.batchBlock('b1', 2);
    expect(text).toContain('NO BREED GUIDE linked');
    expect(text).not.toContain('GUIDE vs ACTUAL:');
    expect(text).toContain('RECORDS FOR THE SAME WEEKS');
  });
});
