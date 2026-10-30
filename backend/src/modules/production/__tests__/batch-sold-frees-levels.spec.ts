import { describe, expect, it, vi } from 'vitest';
import { ProductionCageService } from '../production-cage.service';
import { HealthService } from '../../health/health.service';

// Minimal in-memory stand-in for the Prisma calls the release path makes.
function fakeDb() {
  const state = {
    batches: [
      { id: 'sold', batchCode: 'B-SOLD', stage: 'PRODUCTION', isActive: true, createdById: 'u1' },
      { id: 'live', batchCode: 'B-LIVE', stage: 'PRODUCTION', isActive: true, createdById: 'u1' },
    ] as any[],
    // level unit → batches on it; R1-L4 is shared by both batches, ISO has no row
    cageAssignments: [
      { cageId: 'R1-L4', rowId: 'R1', batchId: 'sold', birdCount: 200, placedDate: new Date('2026-01-01') },
      { cageId: 'R1-L4', rowId: 'R1', batchId: 'live', birdCount: 3, placedDate: new Date('2026-02-01') },
      { cageId: 'R1-L3', rowId: 'R1', batchId: 'sold', birdCount: 384, placedDate: new Date('2026-01-01') },
      { cageId: 'R2-L4', rowId: 'R2', batchId: 'sold', birdCount: 384, placedDate: new Date('2026-01-01') },
      { cageId: 'iso1', rowId: null, batchId: 'sold', birdCount: 2, placedDate: new Date('2026-03-01') },
    ] as any[],
    rollups: [
      { rowId: 'R1', batchId: 'sold', birdCount: 584 },
      { rowId: 'R2', batchId: 'sold', birdCount: 384 },
    ] as any[],
    brooderCages: [{ batchId: 'sold' }] as any[],
    brooderLevels: [{ batchId: 'sold' }] as any[],
  };
  const removeWhere = (key: keyof typeof state, pred: (r: any) => boolean) => {
    const before = state[key].length;
    (state as any)[key] = state[key].filter(r => !pred(r));
    return { count: before - state[key].length };
  };
  const db: any = {
    productionCage: {
      findMany: async ({ where }: any) => state.cageAssignments
        .filter(a => a.batchId === where.assignments.some.batchId).map(a => ({ rowId: a.rowId })),
    },
    productionCageAssignment: {
      deleteMany: async ({ where }: any) => removeWhere('cageAssignments', a => a.batchId === where.batchId),
      findMany: async ({ where }: any) => state.cageAssignments.filter(a => a.rowId === where.cage.rowId),
    },
    batchCageAssignment: {
      deleteMany: async ({ where }: any) => removeWhere('rollups', r =>
        (where.rowId === undefined || r.rowId === where.rowId) && (where.batchId === undefined || r.batchId === where.batchId)),
      upsert: async ({ where, create, update }: any) => {
        const r = state.rollups.find(x => x.rowId === where.rowId);
        if (r) Object.assign(r, update); else state.rollups.push(create);
      },
    },
    brooderCageAssignment: { deleteMany: async ({ where }: any) => removeWhere('brooderCages', r => r.batchId === where.batchId) },
    brooderLevelAssignment: { deleteMany: async ({ where }: any) => removeWhere('brooderLevels', r => r.batchId === where.batchId) },
    batch: {
      update: async ({ where, data }: any) => Object.assign(state.batches.find(b => b.id === where.id), data),
      findUnique: async ({ where }: any) => state.batches.find(b => b.id === where.id),
    },
    healthEvent: { create: async ({ data }: any) => ({ id: 'ev1', ...data }) },
  };
  db.$transaction = async (fn: any) => fn(db);
  return { db, state };
}

const cagesFor = (db: any) => new ProductionCageService(db, { emit: vi.fn() } as any, {} as any);

describe('selling a whole batch empties its production levels', () => {
  it('releaseBatch frees every level incl. isolation and fixes shared-row rollups', async () => {
    const { db, state } = fakeDb();
    const freed = await cagesFor(db).releaseBatch(db, 'sold', 'u1');

    expect(freed).toBe(4);
    expect(state.cageAssignments.map(a => [a.cageId, a.batchId])).toEqual([['R1-L4', 'live']]);
    // R1 now rolls up to the remaining batch; R2 is empty so its rollup is gone
    expect(state.rollups).toEqual([{ rowId: 'R1', batchId: 'live', birdCount: 3 }]);
  });

  it('Farm Events BATCH_SOLD marks the batch sold and clears production levels + brooder cages', async () => {
    const { db, state } = fakeDb();
    const notifications = { notifyRole: vi.fn().mockResolvedValue(undefined) };
    const health = new HealthService(db, notifications as any, {} as any, cagesFor(db));

    await health.logHealthEvent(
      { batchId: 'sold', eventType: 'BATCH_SOLD' as any, eventDate: '2026-10-30', affectedCount: 0 }, 'u1');

    expect(state.batches[0]).toMatchObject({ stage: 'SOLD', isActive: false });
    expect(state.cageAssignments.filter(a => a.batchId === 'sold')).toHaveLength(0);
    expect(state.rollups.filter(r => r.batchId === 'sold')).toHaveLength(0);
    expect(state.brooderCages).toHaveLength(0);
    expect(state.brooderLevels).toHaveLength(0);
    // the other batch in the house is untouched
    expect(state.cageAssignments).toEqual([expect.objectContaining({ cageId: 'R1-L4', batchId: 'live' })]);
  });
});
