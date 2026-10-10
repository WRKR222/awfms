// src/modules/brooder/cage-layout-parser.util.ts
//
// Turns a plain-text description of a cage layout into the same
// {rowLabel, levelLabels, startCageNumber, cageCount, birdsPerCage}
// "block" shape that bulkReassignCages already understands — just with
// row/level identified by LABEL instead of an id, since the caller is
// typing a description rather than picking ids from a dropdown.
//
// Why a text grammar instead of one-block-per-count already being
// possible via the JSON API: the JSON API technically supports mixed
// counts today (submit N blocks, one per distinct run), but composing
// that by hand for a real layout — "cages 1-33 have 9 birds, 34 has 8,
// 35-39 have 9, 40 has 8, 41-44 have 9" — means manually computing 5
// start/count pairs and getting the JSON exactly right. This lets
// someone type the description the way they'd actually say it out loud
// and get the same 5 blocks computed for them.
//
// Deliberately NOT an LLM call: bird counts feed directly into feed
// rationing, mortality baselines, and capacity checks, so parsing must be
// deterministic and auditable — and the UI always previews the result
// before it is saved.
//
// ─────────────────────────────────────────────────────────────────────
// NO FIXED GRAMMAR. Each line (and each "." / ";" sentence in it) is
// scanned for whatever it mentions, in any word order:
//   row      "Row F", "deck 6", "F row"
//   levels   "Level 4", "levels 4, 3 and 2", "L4/L3", "top", "bottom"
//   cages    "cages 1-33", "1 to 33", "cage 34", "35, 36 and 40", "all cages"
//   birds    "9 birds each", "9 each", "with 9", "= 9", ": 9"
//   isolation  "isolation", "isolated", "quarantine" (+ "because …"/"(isolation: …)")
// Comma / "and" separated cage groups share the row and levels in force.
// Row and levels carry over from line to line until changed, so both
//   "Row F Level 4:\n1-33: 9 birds each\n34: 8 birds"   and
//   "Put 9 birds each in cages 1 to 33 of row F, level 4, and 8 in cage 34"
// read the same. Anything that names cages but can't be resolved is
// reported with its line number — never guessed.
// ─────────────────────────────────────────────────────────────────────

import {
  blank, isolationReasonFrom, levelsFromWords, mentionsIsolation, normalizeCageText,
  parseNumberList, takeBirdCount, takeKeywordList, takeLevelList,
} from '../../common/cage-text/cage-text.util';

export interface ParsedCageBlock {
  rowLabel: string;
  levelLabels: string[];
  startCageNumber: number;
  cageCount: number;
  birdsPerCage: number;
  isIsolation: boolean;
  isolationReason: string | null;
  /** True for "all cages" — the service expands it to the level's cage count. */
  allCages?: boolean;
  /** 1-based source line number, for error messages / preview display. */
  sourceLine: number;
}

export class CageLayoutParseError extends Error {
  constructor(message: string, public readonly line: number, public readonly rawLine: string) {
    super(`Line ${line}: ${message} — "${rawLine.trim()}"`);
  }
}

const LEVEL_COUNT = 4;

function takeRow(text: string): { label: string; start: number; end: number } | null {
  const patterns = [
    /\b(?:row|deck)\s*(?:no\.?\s*)?([a-z]|\d+)\b/,
    /\b([a-f])\s*(?:row|deck)\b/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return { label: m[1].toUpperCase(), start: m.index, end: m.index + m[0].length };
  }
  return null;
}

/** Contiguous runs of a sorted cage list → (start, count) pairs. */
function runs(cages: number[]): { start: number; count: number }[] {
  const sorted = [...new Set(cages)].sort((a, b) => a - b);
  const out: { start: number; count: number }[] = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last && last.start + last.count === n) last.count += 1;
    else out.push({ start: n, count: 1 });
  }
  return out;
}

export function parseCageLayoutDescription(raw: string): ParsedCageBlock[] {
  if (!raw || !raw.trim()) {
    throw new Error('Description is empty — nothing to parse.');
  }

  const blocks: ParsedCageBlock[] = [];
  let currentRow: string | null = null;
  let currentLevels: string[] = [];
  let scopeIsolation: { isIsolation: boolean; reason: string | null } = { isIsolation: false, reason: null };

  raw.split(/\r?\n/).forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    if (!rawLine.trim()) return;

    const sentences = rawLine
      .split(/;|(?<!\b(?:no|lvl|[lc]))\.(?=\s|$)/i)
      .map(x => x.trim())
      .filter(Boolean);

    for (const sentence of sentences) {
      let text = normalizeCageText(sentence);
      const sentenceIsolation = mentionsIsolation(text);
      const reason = isolationReasonFrom(sentence);
      if (sentenceIsolation) text = text.replace(/\(([^)]*)\)/g, m => ' '.repeat(m.length));

      const row = takeRow(text);
      if (row) {
        currentRow = row.label;
        currentLevels = [];
        scopeIsolation = { isIsolation: false, reason: null };
        text = blank(text, row.start, row.end);
      }
      const lvl = takeLevelList(text, LEVEL_COUNT);
      if (lvl) {
        currentLevels = lvl.values.map(String);
        text = blank(text, lvl.start, lvl.end);
      } else {
        const words = levelsFromWords(text, LEVEL_COUNT);
        if (words.length) {
          currentLevels = words.map(String);
          text = text.replace(/\b(?:top(?:most)?|bottom(?:most)?|lowest|ground)\b(?:\s+levels?)?/g, m => ' '.repeat(m.length));
        }
      }

      // A header-only sentence ("Row F Level 4 (isolation: sick)") sets the
      // isolation scope for what follows until the next row header.
      const segments = text
        .split(/,|\band\b|&/)
        .map(seg => seg.replace(/\b(?:isolat\w*|quarantin\w*|separat\w*)\b/g, ' '));

      type Pending = { cages: number[] | 'ALL'; birds: number | null };
      const pending: Pending[] = [];
      let lastBirds: number | null = null;
      for (const segRaw of segments) {
        let seg = segRaw;
        const count = takeBirdCount(seg);
        if (count) seg = blank(seg, count.start, count.end);
        const kw = takeKeywordList(seg, 'cages?|c');
        let cages: number[] | 'ALL' | null = null;
        if (kw) cages = kw.values;
        else if (/\b(?:all|every)\s+(?:the\s+)?cages?\b|\ball of them\b/.test(seg)) cages = 'ALL';
        else {
          const bare = parseNumberList(seg.replace(/\b(?:birds?|each|cages?)\b/g, ' '));
          if (bare.length) cages = bare;
        }
        if (count) lastBirds = count.count;
        if (cages) pending.push({ cages, birds: count ? count.count : null });
        else if (count && pending.length && pending[pending.length - 1].birds == null) {
          pending[pending.length - 1].birds = count.count;
        }
      }
      // Cage groups listed without a count take the next count in the
      // sentence ("cages 1-33 and 35-39 have 9 each"), else the last one.
      for (let i = 0; i < pending.length; i++) {
        if (pending[i].birds != null) continue;
        const next = pending.slice(i + 1).find(p => p.birds != null);
        pending[i].birds = next?.birds ?? lastBirds;
      }

      if (!pending.length) {
        if (sentenceIsolation && (row || lvl)) scopeIsolation = { isIsolation: true, reason };
        continue;
      }

      for (const p of pending) {
        if (p.birds == null) {
          throw new CageLayoutParseError('Says which cages but not how many birds are in each', lineNo, rawLine);
        }
        if (!currentRow) throw new CageLayoutParseError('No row mentioned yet (e.g. "Row F")', lineNo, rawLine);
        if (!currentLevels.length) throw new CageLayoutParseError('No level mentioned yet (e.g. "Level 4" or "top level")', lineNo, rawLine);
        const iso = sentenceIsolation
          ? { isIsolation: true, reason: reason ?? scopeIsolation.reason }
          : scopeIsolation;
        const groups = p.cages === 'ALL' ? [{ start: 1, count: 0 }] : runs(p.cages);
        for (const g of groups) {
          blocks.push({
            rowLabel: currentRow,
            levelLabels: [...currentLevels],
            startCageNumber: g.start,
            cageCount: g.count,
            birdsPerCage: p.birds,
            isIsolation: iso.isIsolation,
            isolationReason: iso.isIsolation ? (iso.reason ?? 'Isolation') : null,
            allCages: p.cages === 'ALL' ? true : undefined,
            sourceLine: lineNo,
          });
        }
      }
    }
  });

  if (blocks.length === 0) {
    throw new Error(
      'No cages with bird counts were found. Mention a row, a level, the cages and how many birds — ' +
      'in any order, e.g. "Row F level 4: cages 1 to 33 have 9 birds each".',
    );
  }

  return blocks;
}
