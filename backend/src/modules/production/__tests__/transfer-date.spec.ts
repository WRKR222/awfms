import { describe, expect, it } from 'vitest';
import { ProductionCageService } from '../production-cage.service';

const batch = {
  id: 'b1', batchCode: 'HL-01', isActive: true, stage: 'BROODING', currentBirdCount: 500,
  dateReceived: new Date('2026-07-01T00:00:00Z'), notes: null,
};
const svc = new ProductionCageService(
  { batch: { findFirst: async () => batch } } as any, { emit() {} } as any, {} as any,
);
const transfer = (transferDate: string) =>
  svc.transferFromBrooder({ batchId: 'b1', houseCode: 'BLK1', birdCount: 100, transferDate }, { id: 'u1' } as any);

describe('transfer to production — date of transfer', () => {
  it('refuses a date in the future', async () => {
    await expect(transfer('2099-01-05')).rejects.toThrow(/can't be in the future/);
  });

  it('refuses a date before the batch arrived', async () => {
    await expect(transfer('2026-06-30')).rejects.toThrow(/before HL-01 arrived \(2026-07-01\)/);
  });
});
