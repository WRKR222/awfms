import { describe, expect, it } from 'vitest';
import { parseProductionCageText } from '../production-cage-text.util';

describe('parseProductionCageText', () => {
  it('reads a plain move into isolation with a reason', () => {
    const r = parseProductionCageText('Moved 3 birds from A1 level 2 tier 5 cage 1 into isolation cage 2 because they were limping');
    expect(r.problems).toEqual([]);
    expect(r.ops).toHaveLength(1);
    const op = r.ops[0] as any;
    expect(op.kind).toBe('MOVE');
    expect(op.count).toBe(3);
    expect(op.from).toMatchObject({ rowCode: 'A1', levels: [2], tiers: [5], cages: [1] });
    expect(op.to).toMatchObject({ isolation: true, cages: [2] });
    expect(op.isolationReason).toMatch(/limping/);
  });

  it('accepts destination before source and number words', () => {
    const r = parseProductionCageText('transferred two hens to cage 3 from B2 top level tier 10 cage 1');
    const op = r.ops[0] as any;
    expect(op.kind).toBe('MOVE');
    expect(op.count).toBe(2);
    expect(op.from).toMatchObject({ rowCode: 'B2', levels: [4], tiers: [10], cages: [1] });
    // destination inherits row / level / tier from the source
    expect(op.to).toMatchObject({ rowCode: 'B2', levels: [4], tiers: [10], cages: [3] });
  });

  it('reads abbreviations and a block mention', () => {
    const r = parseProductionCageText('Block 2 A2 L3 T7 C2: 2 birds');
    const op = r.ops[0] as any;
    expect(op.kind).toBe('SET');
    expect(op.birdsPerCage).toBe(2);
    expect(op.target).toMatchObject({ blockCode: 'BLK2', rowCode: 'A2', levels: [3], tiers: [7], cages: [2] });
  });

  it('sets ranges and carries context to the next clause', () => {
    const r = parseProductionCageText('C1 bottom level: tiers 1-6 have 4 birds each; tier 7 three birds each');
    expect(r.problems).toEqual([]);
    expect(r.ops).toHaveLength(2);
    expect((r.ops[0] as any).target).toMatchObject({ rowCode: 'C1', levels: [1], tiers: [1, 2, 3, 4, 5, 6] });
    expect((r.ops[0] as any).birdsPerCage).toBe(4);
    expect((r.ops[1] as any).target).toMatchObject({ rowCode: 'C1', levels: [1], tiers: [7] });
    expect((r.ops[1] as any).birdsPerCage).toBe(3);
  });

  it('understands an emptied cage and ignores chatter', () => {
    const r = parseProductionCageText('We reshuffled today.\nIsolation cage 4 is empty now');
    expect(r.ignored).toEqual(['We reshuffled today']);
    expect(r.ops[0]).toMatchObject({ kind: 'SET', birdsPerCage: 0, target: { isolation: true, cages: [4] } });
  });

  it('reports what it cannot place instead of guessing', () => {
    const r = parseProductionCageText('moved some birds from A1 level 2 tier 3 cage 1 to somewhere');
    expect(r.ops).toHaveLength(0);
    expect(r.problems[0].reason).toMatch(/moved to/);
  });

  it('handles "cage 1 to 4" ranges inside a move', () => {
    const r = parseProductionCageText('took all birds from A1 level 4 tier 2 cages 1 to 4 to tier 3');
    const op = r.ops[0] as any;
    expect(op.count).toBeNull();
    expect(op.from.cages).toEqual([1, 2, 3, 4]);
    expect(op.to).toMatchObject({ rowCode: 'A1', levels: [4], tiers: [3] });
  });

  it('reads cage numbers along the level without any tier', () => {
    const r = parseProductionCageText('Moved 2 birds from A2 level 3 cage 37 to isolation cage 1 because they were coughing');
    const op = r.ops[0] as any;
    expect(op.from).toEqual({ rowCode: 'A2', levels: [3], cages: [37], tiers: undefined, blockCode: undefined });
    expect(op.to).toMatchObject({ isolation: true, cages: [1] });
  });
});
