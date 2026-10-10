// src/common/cage-text/cage-text.util.ts
//
// Shared helpers for reading cage reassignments written in plain words —
// "moved three birds from A1 level 2 tier 5 cage 1 into isolation cage 2",
// "Row F, levels 4 and 3: cages 1 to 33 have 9 birds each" — in any word
// order. Nothing here assumes a fixed sentence layout: each clause is
// scanned for the pieces it mentions (row, level, tier, cage, bird count,
// isolation) wherever they appear. Callers always show the parsed result
// back to the user for confirmation before anything is written.

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, none: 0, no: 0, one: 1, a: 1, an: 1, single: 1, two: 2, pair: 2, three: 3, four: 4,
  five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
};
const ORDINAL_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8,
};

/** Lower-cases, unifies dashes/arrows, turns number words into digits. */
export function normalizeCageText(raw: string): string {
  let s = ` ${raw} `
    .replace(/[‒-―−]/g, '-')
    .replace(/→|=>|-+>/g, ' to ')
    .replace(/[“”"']/g, ' ')
    .toLowerCase();
  // Ordinals: "3rd tier" / "second level" → "tier 3" / "level 2", then any
  // remaining "1st/2nd" → plain digits.
  s = s.replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth)\b/g,
    (_m, w: string) => `${ORDINAL_WORDS[w]}th`);
  s = s.replace(/\b(\d+)(?:st|nd|rd|th)\s+(row|level|tier|cage|deck)\b/g, '$2 $1');
  s = s.replace(/\b(\d+)(?:st|nd|rd|th)\b/g, '$1');
  // number words ("a", "an", "no" only when followed by a bird word, to keep
  // ordinary English like "a cage" / "no change" intact)
  s = s.replace(/\b(a|an|no|single|pair)\s+(?=(?:of\s+)?(?:birds?|hens?|layers?|chickens?|chicks?)\b)/g,
    (_m, w: string) => `${NUMBER_WORDS[w]} `);
  s = s.replace(/\b(zero|none|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)\b/g,
    (_m, w: string) => String(NUMBER_WORDS[w]));
  return s.replace(/\s+/g, ' ');
}

/** Splits a description into clauses: lines, ";", sentence full stops and
 *  "then"/"and then"/"also" joins. Keeps each clause's original text. */
export function splitCageClauses(raw: string): string[] {
  return raw
    .split(/\r?\n|;|(?<!\b(?:no|nos|lvl|approx|[ltc]))\.(?=\s|$)|\bthen\b|\balso\b/i)
    .map(c => c.replace(/^\s*(?:and|,)\s*/i, '').trim())
    .filter(c => c.length > 0);
}

/** Expands "1-4", "1 to 4", "1, 3 and 5", "2/3" into [1,2,3,4] etc. */
export function parseNumberList(text: string): number[] {
  const out: number[] = [];
  const re = /(\d+)(?:\s*(?:-|to|through|thru|till|until|up to)\s*(\d+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const a = parseInt(m[1], 10);
    const b = m[2] != null ? parseInt(m[2], 10) : a;
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    if (hi - lo > 500) continue; // nonsense range — ignore rather than explode
    for (let n = lo; n <= hi; n++) if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** Matches `<keyword> <number list>` and returns the numbers plus the matched span. */
export function takeKeywordList(
  text: string, keyword: string,
): { values: number[]; start: number; end: number } | null {
  const re = new RegExp(
    `\\b(?:${keyword})\\s*(?:no\\.?|nos\\.?|number|numbers|#)?\\s*` +
    `((?:\\d+)(?:\\s*(?:-|to|through|thru|till|until|up to|,|&|and|\\/|or)\\s*\\d+)*)`,
  );
  const m = re.exec(text);
  if (!m) return null;
  return { values: parseNumberList(m[1]), start: m.index, end: m.index + m[0].length };
}

/** "9 birds", "9 each", "with 9", "= 9" → bird count, plus the matched span. */
export function takeBirdCount(text: string): { count: number; each: boolean; start: number; end: number } | null {
  const patterns: { re: RegExp; each: boolean }[] = [
    { re: /\b(\d+)\s*(?:of\s+the\s+)?(?:birds?|hens?|layers?|chickens?|chicks?)\b(\s*(?:each|per cage|apiece|in each))?/, each: false },
    { re: /\b(\d+)\s*(?:each|per cage|apiece|\/cage)\b/, each: true },
    { re: /\b(?:each\s+(?:with|has|having|holding|of)?|with|holding|having|has|have|contains?)\s+(\d+)\b/, each: true },
    { re: /[:=]\s*(\d+)\s*$/, each: true },
  ];
  for (const { re, each } of patterns) {
    const m = re.exec(text);
    if (m) {
      const isEach = each || !!(m[2] && m[2].trim());
      return { count: parseInt(m[1], 10), each: isEach, start: m.index, end: m.index + m[0].length };
    }
  }
  return null;
}

export function blank(text: string, start: number, end: number): string {
  return text.slice(0, start) + ' '.repeat(end - start) + text.slice(end);
}

const ISOLATION_WORDS = /\b(isolat\w*|quarantin\w*|sick bay|sickbay|separat\w*)\b/;
export function mentionsIsolation(text: string): boolean {
  return ISOLATION_WORDS.test(text);
}

/** Pulls a reason out of "(isolation: coughing)", "because …", "due to …". */
export function isolationReasonFrom(original: string): string | null {
  const tag = original.match(/isolation\s*[:-]\s*([^)\n]+)/i);
  if (tag) return tag[1].trim();
  const m = original.match(/\b(?:because|due to|since|as they are|as it is|reason[:\s]|for)\s+(.{3,})$/i);
  if (m) return m[1].replace(/[.)]+$/, '').trim();
  const flag = original.match(/\b(sick|injured|weak|limping|coughing|pecked|bleeding|observation|lame)\b.*/i);
  return flag ? flag[0].replace(/[.)]+$/, '').trim() : null;
}

/** Level words → level numbers (1 = bottom, 4 = top). */
export function levelsFromWords(text: string, levelCount: number): number[] {
  const out: number[] = [];
  if (/\btop(?:most)?\b/.test(text)) out.push(levelCount);
  if (/\bbottom(?:most)?\b|\blowest\b|\bground\b/.test(text)) out.push(1);
  return out;
}

/** "level 4", "levels 4, 3 and 2", "L4/L3", "lvl 2-3" → level numbers, never
 *  swallowing a following cage range ("level 4, 1-33 = 9" → just [4]). */
export function takeLevelList(text: string, levelCount: number): { values: number[]; start: number; end: number } | null {
  const head = /\b(?:levels?|lvls?|lvl|l)\s*\.?\s*(?=\d)/g;
  let m: RegExpExecArray | null;
  while ((m = head.exec(text))) {
    let pos = m.index + m[0].length;
    const values: number[] = [];
    let end = pos;
    const item = /^(\d+)(?:\s*(?:-|to)\s*(\d+))?/;
    for (;;) {
      const it = item.exec(text.slice(pos));
      if (!it) break;
      const a = parseInt(it[1], 10);
      const b = it[2] != null ? parseInt(it[2], 10) : a;
      if (a < 1 || a > levelCount || b < 1 || b > levelCount) break;
      for (let n = Math.min(a, b); n <= Math.max(a, b); n++) if (!values.includes(n)) values.push(n);
      pos += it[0].length;
      end = pos;
      const sep = /^\s*(?:,|&|and|\/|or)\s*(?:levels?|lvls?|lvl|l)?\s*(?=\d)/.exec(text.slice(pos));
      if (!sep) break;
      pos += sep[0].length;
    }
    if (values.length) return { values, start: m.index, end };
  }
  return null;
}
