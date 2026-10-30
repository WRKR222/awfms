import { describe, expect, it, vi } from 'vitest';
import { CreateEggCollectionSessionSchema } from '../production.dto';
import { CageMapService } from '../cage-map.service';

const base = {
  batchId: '00000000-0000-4000-8000-000000000001',
  houseId: '00000000-0000-4000-8000-000000000002',
  sessionDate: '2026-10-30',
  shift: 'AM',
  block: 'BLOCK1',
  openingPop: 900,
  mortalities: 0,
  sessionFeed: { feedKg: 40, feedType: 'LAYER_MASH' },
  environment: { waterLiters: 80, houseTempC: 24 },
};
const entry = (rowCode: string, level?: number, totalEggs = 10) =>
  ({ rowCode, ...(level ? { level } : {}), totalBirds: 50, totalEggs });

describe('egg collection rowData per row · level', () => {
  it('accepts one entry per row · level and keeps the level', () => {
    const r = CreateEggCollectionSessionSchema.safeParse({
      ...base, rowData: [entry('A1', 4), entry('A1', 3), entry('A2', 4)],
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.rowData.map(x => x.level)).toEqual([4, 3, 4]);
  });

  it('refuses the same row · level twice and levels outside 1–4', () => {
    expect(CreateEggCollectionSessionSchema.safeParse({ ...base, rowData: [entry('A1', 4), entry('a1', 4)] }).success).toBe(false);
    expect(CreateEggCollectionSessionSchema.safeParse({ ...base, rowData: [entry('A1', 5)] }).success).toBe(false);
  });

  it('still accepts older per-row entries without a level', () => {
    expect(CreateEggCollectionSessionSchema.safeParse({ ...base, rowData: [entry('A1'), entry('A2')] }).success).toBe(true);
  });

  it('row population sync adds up a row\'s levels', async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma: any = {
      batchCageAssignment: {
        findMany: vi.fn().mockResolvedValue([{ id: 'a1', birdCount: 100, row: { rowCode: 'A1' } }]),
        update,
      },
    };
    const svc = new CageMapService(prisma, { emit: vi.fn() } as any);
    await svc.syncRowPopulations('b1', [
      { rowCode: 'A1', level: 4, totalBirds: 380 } as any,
      { rowCode: 'A1', level: 3, totalBirds: 300 } as any,
      { rowCode: 'B1', level: 4, totalBirds: 10 } as any,
    ]);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { birdCount: 680 } });
  });
});
