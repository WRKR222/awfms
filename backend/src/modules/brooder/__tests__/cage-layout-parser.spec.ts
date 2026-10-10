import { describe, expect, it } from 'vitest';
import { parseCageLayoutDescription } from '../cage-layout-parser.util';

const simple = (b: any) => ({
  row: b.rowLabel, levels: b.levelLabels, start: b.startCageNumber, count: b.cageCount,
  birds: b.birdsPerCage, iso: b.isIsolation,
});

describe('parseCageLayoutDescription (free wording)', () => {
  it('still reads the original header + segment layout', () => {
    const out = parseCageLayoutDescription('Row F Level 4:\n1-33: 9 birds each\n34: 8 birds\n35-39: 9 birds each\n40 = 8\n41 to 44: 9');
    expect(out.map(simple)).toEqual([
      { row: 'F', levels: ['4'], start: 1, count: 33, birds: 9, iso: false },
      { row: 'F', levels: ['4'], start: 34, count: 1, birds: 8, iso: false },
      { row: 'F', levels: ['4'], start: 35, count: 5, birds: 9, iso: false },
      { row: 'F', levels: ['4'], start: 40, count: 1, birds: 8, iso: false },
      { row: 'F', levels: ['4'], start: 41, count: 4, birds: 9, iso: false },
    ]);
  });

  it('reads a single comma-separated line', () => {
    const out = parseCageLayoutDescription('Row F Levels 4/3/2: 1-33=9, 34=8, 35-39=9');
    expect(out.map(simple)).toEqual([
      { row: 'F', levels: ['4', '3', '2'], start: 1, count: 33, birds: 9, iso: false },
      { row: 'F', levels: ['4', '3', '2'], start: 34, count: 1, birds: 8, iso: false },
      { row: 'F', levels: ['4', '3', '2'], start: 35, count: 5, birds: 9, iso: false },
    ]);
  });

  it('reads a sentence in any order', () => {
    const out = parseCageLayoutDescription('Put nine birds each in cages 1 to 33 of row F, level 4, and 8 birds in cage 34');
    expect(out.map(simple)).toEqual([
      { row: 'F', levels: ['4'], start: 1, count: 33, birds: 9, iso: false },
      { row: 'F', levels: ['4'], start: 34, count: 1, birds: 8, iso: false },
    ]);
  });

  it('understands top/bottom, shared counts and isolation', () => {
    const out = parseCageLayoutDescription(
      'On the top level of row B cages 1-10 and 12-20 have 10 each.\n' +
      'Row B bottom level cage 44 has 3 birds isolated because they are coughing',
    );
    expect(out.map(simple)).toEqual([
      { row: 'B', levels: ['4'], start: 1, count: 10, birds: 10, iso: false },
      { row: 'B', levels: ['4'], start: 12, count: 9, birds: 10, iso: false },
      { row: 'B', levels: ['1'], start: 44, count: 1, birds: 3, iso: true },
    ]);
    expect(out[2].isolationReason).toMatch(/coughing/);
  });

  it('supports "all cages"', () => {
    const out = parseCageLayoutDescription('deck 3, levels 1 and 2: all cages have 12 birds');
    expect(out[0]).toMatchObject({ rowLabel: '3', levelLabels: ['1', '2'], allCages: true, birdsPerCage: 12 });
  });

  it('fails loudly with a line number when the count is missing', () => {
    expect(() => parseCageLayoutDescription('Row A level 2\ncages 1-5')).toThrow(/Line 2/);
  });

  it('parses the example shown in the reassignment modal', () => {
    const out = parseCageLayoutDescription(
      'Put 9 birds each in cages 1 to 33 of row F, level 4, and 8 birds in cage 34.\n' +
      'Cages 35-39 have 9 each, 40 has 8, 41 to 44 have 9.\n' +
      'Row B top level cage 44: 3 birds isolated because they were coughing',
    );
    expect(out.map(simple)).toEqual([
      { row: 'F', levels: ['4'], start: 1, count: 33, birds: 9, iso: false },
      { row: 'F', levels: ['4'], start: 34, count: 1, birds: 8, iso: false },
      { row: 'F', levels: ['4'], start: 35, count: 5, birds: 9, iso: false },
      { row: 'F', levels: ['4'], start: 40, count: 1, birds: 8, iso: false },
      { row: 'F', levels: ['4'], start: 41, count: 4, birds: 9, iso: false },
      { row: 'B', levels: ['4'], start: 44, count: 1, birds: 3, iso: true },
    ]);
  });
});
