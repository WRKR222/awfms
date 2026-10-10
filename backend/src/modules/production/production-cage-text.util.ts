// src/modules/production/production-cage-text.util.ts
//
// Reads a production-house cage reassignment written in the attendant's own
// words and turns it into operations the cage map can apply. No fixed
// grammar — each clause is scanned for whatever it mentions, in any order:
//
//   "Moved 3 birds from A1 level 2 cage 17 into isolation cage 2 because they were limping"
//   "transferred two hens to cage 3 from B2 top level cage 37"
//   "C1 bottom level cages 1-24 now have 4 birds each"
//   "isolation cage 4 is empty"            "Block 2 A2 L3 T7 C2: 2 birds"
//
// A clause with "from … to/into …" (or a move verb + "to") is a MOVE; any
// other clause naming cages and a bird count (or "empty") SETS those cages.
// Cages are numbered along the level (Block 1: 1–96, Block 2: 1–152); tiers
// never need to be named, though "tier 5 cage 1" is still understood.
// Clauses that mention no cage at all are ignored. Row / level / tier carry
// over from the previous clause when a clause leaves them out, so
// "A1 level 4: tiers 1-10 four each; tier 11 three each" works too.

import {
  blank, isolationReasonFrom, levelsFromWords, mentionsIsolation, normalizeCageText,
  parseNumberList, splitCageClauses, takeBirdCount, takeKeywordList, takeLevelList,
} from '../../common/cage-text/cage-text.util';

export interface CageRef {
  blockCode?: 'BLK1' | 'BLK2';
  rowCode?: string;
  levels?: number[];
  tiers?: number[];
  cages?: number[];
  isolation?: boolean;
}

export type ParsedCageOp =
  | { kind: 'MOVE'; clause: string; count: number | null; from: CageRef; to: CageRef; isolationReason: string | null }
  | { kind: 'SET'; clause: string; birdsPerCage: number; target: CageRef; isolationReason: string | null };

export interface ParsedCageText {
  ops: ParsedCageOp[];
  /** Clauses that named no cage — kept so the user sees nothing was lost. */
  ignored: string[];
  /** Clauses that named cages but couldn't be turned into an operation. */
  problems: { clause: string; reason: string }[];
}

const MOVE_VERBS = /\b(mov\w*|transfer\w*|shift\w*|put|plac\w*|relocat\w*|took|taken|take|swap\w*|brought|bring)\b/;

function parseRef(text: string, levelCount: number): CageRef {
  let t = text;
  const ref: CageRef = {};

  const block = t.match(/\b(?:block|blk|house|ph|production house)\s*(?:no\.?\s*)?([12])\b/);
  if (block) {
    ref.blockCode = block[1] === '2' ? 'BLK2' : 'BLK1';
    t = blank(t, block.index!, block.index! + block[0].length);
  }

  if (mentionsIsolation(t)) {
    ref.isolation = true;
    const iso = t.match(/\b(?:isolat\w*|quarantin\w*|iso)\s*(?:cages?)?\s*(?:no\.?|number|#)?\s*((?:\d+)(?:\s*(?:-|to|,|&|and|\/)\s*\d+)*)/);
    if (iso) ref.cages = parseNumberList(iso[1]);
    else {
      const c = takeKeywordList(t, 'cages?|c');
      if (c) ref.cages = c.values;
    }
    return ref;
  }

  // Row: "row A1", "section A row 1", "unit B row 2", "A1", "a-2"
  const sectionRow = t.match(/\b(?:section|unit|sec)\s*([abc])\b[^.]*?\brow\s*([12])\b/);
  const rowExplicit = t.match(/\brow\s*([abc])\s*-?\s*([12])\b/);
  const rowBare = t.match(/\b([abc])\s*-?\s*([12])\b(?!\s*(?:birds?|hens?|each))/);
  const row = sectionRow ?? rowExplicit ?? rowBare;
  if (row) {
    ref.rowCode = `${row[1].toUpperCase()}${row[2]}`;
    t = blank(t, row.index!, row.index! + row[0].length);
  }

  const lvl = takeLevelList(t, levelCount);
  if (lvl) {
    ref.levels = lvl.values;
    t = blank(t, lvl.start, lvl.end);
  } else {
    const words = levelsFromWords(t, levelCount);
    if (words.length) ref.levels = words;
  }

  const tier = takeKeywordList(t, 'tiers?|t');
  if (tier) {
    ref.tiers = tier.values;
    t = blank(t, tier.start, tier.end);
  }

  const cage = takeKeywordList(t, 'cages?|c');
  if (cage) {
    ref.cages = cage.values;
    t = blank(t, cage.start, cage.end);
  }

  // "all tiers" / "every cage" → explicitly the whole range (empty array).
  if (!ref.tiers && /\b(?:all|every|whole)\s+(?:the\s+)?tiers?\b/.test(t)) ref.tiers = [];
  if (!ref.cages && /\b(?:all|every|whole)\s+(?:the\s+)?cages?\b/.test(t)) ref.cages = [];
  return ref;
}

function hasLocation(ref: CageRef) {
  return !!(ref.isolation || ref.rowCode || ref.levels || ref.tiers || ref.cages);
}

/** Fills in what a destination left out from the source/context — only the
 *  coarser parts above the most specific thing it named. */
function inherit(target: CageRef, from: CageRef): CageRef {
  const out: CageRef = { ...target };
  out.blockCode = out.blockCode ?? from.blockCode;
  if (out.isolation) return out;
  if (out.rowCode) return out;
  out.rowCode = from.rowCode;
  if (out.levels) return out;
  out.levels = from.levels;
  if (out.tiers) return out;
  out.tiers = from.tiers;
  return out;
}

/** Finds the "to/into/onto" that introduces a destination — skipping the
 *  "to" inside a number range like "cages 1 to 4". */
function findDestinationKeyword(text: string): { index: number; length: number } | null {
  const re = /\b(into|onto|in to|to)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const before = text.slice(0, m.index).trimEnd();
    const after = text.slice(m.index + m[0].length).trimStart();
    const isRange = m[1] === 'to' && /\d$/.test(before) && /^\d/.test(after);
    if (!isRange) return { index: m.index, length: m[0].length };
  }
  return null;
}

export function parseProductionCageText(raw: string, levelCount = 4): ParsedCageText {
  const result: ParsedCageText = { ops: [], ignored: [], problems: [] };
  let context: CageRef = {};

  for (const clause of splitCageClauses(raw ?? '')) {
    const text = normalizeCageText(clause);
    const reason = isolationReasonFrom(clause);
    const dest = findDestinationKeyword(text);
    const fromIdx = text.search(/\bfrom\b/);
    const isMove = dest !== null && (fromIdx >= 0 || MOVE_VERBS.test(text));

    if (isMove) {
      const count = takeBirdCount(text);
      let t = count ? blank(text, count.start, count.end) : text;
      t = t.replace(/\b(?:all|the|of|them|birds?|hens?|layers?|chickens?)\b/g, m => ' '.repeat(m.length)); // keep offsets
      const destStart = dest!.index + dest!.length;
      let srcText: string;
      let dstText: string;
      if (fromIdx >= 0 && fromIdx < dest!.index) {
        srcText = t.slice(fromIdx + 4, dest!.index);
        dstText = t.slice(destStart);
      } else if (fromIdx > dest!.index) {
        dstText = t.slice(destStart, fromIdx);
        srcText = t.slice(fromIdx + 4);
      } else {
        srcText = t.slice(0, dest!.index);
        dstText = t.slice(destStart);
      }
      const src = inherit(parseRef(srcText, levelCount), context);
      let dst = parseRef(dstText, levelCount);
      // "…to 4" with no keyword: a bare number is the cage on the same tier.
      if (!hasLocation(dst)) {
        const bare = parseNumberList(dstText);
        if (bare.length) dst = { cages: bare };
      }
      if (!hasLocation(src) || !hasLocation(dst)) {
        result.problems.push({
          clause,
          reason: !hasLocation(src)
            ? 'Could not tell which cage the birds were moved from.'
            : 'Could not tell which cage the birds were moved to.',
        });
        continue;
      }
      dst = inherit(dst, src);
      result.ops.push({
        kind: 'MOVE', clause, count: count ? count.count : null, from: src, to: dst,
        isolationReason: dst.isolation ? (reason ?? 'Moved to isolation') : null,
      });
      context = { blockCode: src.blockCode, rowCode: src.rowCode, levels: src.levels, tiers: src.tiers };
      continue;
    }

    const count = takeBirdCount(text);
    const emptied = /\b(empty|emptied|vacant|cleared|no birds|0 birds|removed all|nothing)\b/.test(text);
    const t = count ? blank(text, count.start, count.end) : text;
    const ref = parseRef(t, levelCount);
    if (!hasLocation(ref)) {
      result.ignored.push(clause);
      continue;
    }
    const target = inherit(ref, context);
    if (!count && !emptied) {
      result.problems.push({ clause, reason: 'Names cages but not how many birds are in them now.' });
      context = { ...target, cages: undefined };
      continue;
    }
    result.ops.push({
      kind: 'SET', clause, birdsPerCage: emptied && !count ? 0 : count!.count, target,
      isolationReason: target.isolation ? (reason ?? 'Isolation') : null,
    });
    context = { blockCode: target.blockCode, rowCode: target.rowCode, levels: target.levels, tiers: target.tiers };
  }
  return result;
}
