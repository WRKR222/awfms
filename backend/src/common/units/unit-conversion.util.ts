// src/common/units/unit-conversion.util.ts
// Understands the units written on a farm's paper sheets — "500 grms",
// "2 Ltrs", "12 m.l.", "1.5 kilos", "6 bags" — and converts report
// quantities into a StoreItem's stock unit (e.g. report says grams, item is
// stocked in kg). Mass and volume convert numerically; count units (bags,
// sachets, doses, bottles...) only ever match the same count unit, since a
// bag or sachet has no fixed weight. convertToUnit() returns null rather
// than guessing whenever two units can't be safely converted — callers
// treat that as "needs manual reconciliation".

export type UnitDimension = 'mass' | 'volume' | 'count';

export interface ResolvedUnit {
  /** Canonical short form: 'mg' | 'g' | 'kg' | 't' | 'ml' | 'l' | 'bag' | 'sachet' | ... */
  canonical: string;
  dim: UnitDimension;
  /** Multiply by this to reach the dimension's base unit (kg, litre). 1 for count units. */
  factor: number;
}

const MASS: Record<string, { canonical: string; factor: number; aliases: string[] }> = {
  mg: { canonical: 'mg', factor: 0.000001, aliases: ['mg', 'mgs', 'milligram', 'milligrams', 'milligramme', 'milligrammes', 'mgrm', 'mgm'] },
  g: { canonical: 'g', factor: 0.001, aliases: ['g', 'gs', 'gm', 'gms', 'gr', 'grs', 'grm', 'grms', 'gram', 'grams', 'gramme', 'grammes'] },
  kg: { canonical: 'kg', factor: 1, aliases: ['kg', 'kgs', 'kgm', 'kgms', 'kilo', 'kilos', 'kilogram', 'kilograms', 'kilogramme', 'kilogrammes', 'kgr'] },
  t: { canonical: 't', factor: 1000, aliases: ['t', 'ton', 'tons', 'tonne', 'tonnes'] },
};

const VOLUME: Record<string, { canonical: string; factor: number; aliases: string[] }> = {
  ml: { canonical: 'ml', factor: 0.001, aliases: ['ml', 'mls', 'mil', 'mils', 'cc', 'milliliter', 'milliliters', 'millilitre', 'millilitres', 'mililitre', 'mililitres', 'mililiter', 'mililiters'] },
  cl: { canonical: 'cl', factor: 0.01, aliases: ['cl', 'centiliter', 'centilitre', 'centiliters', 'centilitres'] },
  l: { canonical: 'l', factor: 1, aliases: ['l', 'ls', 'lt', 'lts', 'ltr', 'ltrs', 'lit', 'lits', 'liter', 'liters', 'litre', 'litres'] },
};

// Count units — no numeric conversion between them, only same-unit matches.
const COUNT: Record<string, string[]> = {
  bag: ['bag', 'bags', 'sack', 'sacks'],
  sachet: ['sachet', 'sachets', 'satchet', 'satchets'],
  dose: ['dose', 'doses', 'ds'],
  piece: ['piece', 'pieces', 'pc', 'pcs'],
  roll: ['roll', 'rolls'],
  box: ['box', 'boxes'],
  unit: ['unit', 'units'],
  packet: ['packet', 'packets', 'pkt', 'pkts', 'pack', 'packs'],
  bottle: ['bottle', 'bottles', 'btl', 'btls'],
  tablet: ['tablet', 'tablets', 'tab', 'tabs'],
  vial: ['vial', 'vials'],
  tray: ['tray', 'trays'],
};

const ALIAS_TO_UNIT = new Map<string, ResolvedUnit>();
for (const def of Object.values(MASS)) for (const a of def.aliases) ALIAS_TO_UNIT.set(a, { canonical: def.canonical, dim: 'mass', factor: def.factor });
for (const def of Object.values(VOLUME)) for (const a of def.aliases) ALIAS_TO_UNIT.set(a, { canonical: def.canonical, dim: 'volume', factor: def.factor });
for (const [canonical, aliases] of Object.entries(COUNT)) for (const a of aliases) ALIAS_TO_UNIT.set(a, { canonical, dim: 'count', factor: 1 });

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/** Works out which unit a piece of sheet text means: exact abbreviations
 *  and plurals ("grms", "Ltrs", "kgs"), dotted forms ("m.l.", "kg."), word
 *  prefixes ("kilogrammes", "litres"), and — unless `fuzzy` is false —
 *  small misspellings of longer unit words ("gramms", "mililitre",
 *  "litrs"). Returns null for anything it can't place with confidence. */
export function resolveUnit(raw: string | undefined | null, opts: { fuzzy?: boolean } = {}): ResolvedUnit | null {
  const word = String(raw ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (!word) return null;
  const exact = ALIAS_TO_UNIT.get(word);
  if (exact) return exact;
  if (opts.fuzzy === false) return null;

  // Longer spellings recognised by their stem.
  if (/^kilo/.test(word)) return ALIAS_TO_UNIT.get('kg')!;
  if (/^mill?ig/.test(word)) return ALIAS_TO_UNIT.get('mg')!;
  if (/^mill?il/.test(word)) return ALIAS_TO_UNIT.get('ml')!;
  if (/^gra?m/.test(word)) return ALIAS_TO_UNIT.get('g')!;
  if (/^lit[re]/.test(word)) return ALIAS_TO_UNIT.get('l')!;

  // One stray letter in a word of 4+ letters (two in 8+): "gramms", "litrs".
  if (word.length >= 4) {
    const maxDist = word.length >= 8 ? 2 : 1;
    let best: ResolvedUnit | null = null;
    let bestDist = Infinity;
    for (const [alias, unit] of ALIAS_TO_UNIT) {
      if (alias.length < 4) continue;
      const d = editDistance(word, alias);
      if (d < bestDist) { bestDist = d; best = unit; }
    }
    if (best && bestDist <= maxDist) return best;
  }
  return null;
}

/** Converts `qty` from `fromUnit` to `toUnit` (either may be written any way
 *  resolveUnit() understands). Returns null when either unit can't be
 *  recognised, or the two can't be converted (mass vs. volume, or two
 *  different count units) — callers must never guess in that case. */
export function convertToUnit(qty: number, fromUnit: string | undefined | null, toUnit: string | undefined | null): number | null {
  const from = resolveUnit(fromUnit);
  const to = resolveUnit(toUnit);
  if (!from || !to) {
    // Unrecognised on either side: only an identical spelling is safe.
    const a = String(fromUnit ?? '').trim().toLowerCase();
    const b = String(toUnit ?? '').trim().toLowerCase();
    return a && a === b ? qty : null;
  }
  if (from.dim !== to.dim) return null;
  if (from.dim === 'count') return from.canonical === to.canonical ? qty : null;
  return (qty * from.factor) / to.factor;
}

/** The first quantity in a cell, with the unit written after it — "6bags",
 *  "1,000 grms", "12 m.l.", "Amprolium 10ml". Percentages are concentrations,
 *  not amounts, so "Amprolium 20%" has no quantity and "Amprolium 20% 5g"
 *  gives 5 g. Returns null when there's no amount in the text. */
export function parseQuantityWithUnit(raw: unknown): { qty: number; unit?: string } | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const re = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(%|[a-zA-Z][a-zA-Z.]*)?/g;
  for (const m of text.matchAll(re)) {
    if (m[2] === '%') continue;
    const qty = parseFloat(m[1].replace(/,/g, ''));
    if (!Number.isFinite(qty)) continue;
    const unit = m[2]?.replace(/\./g, '');
    return { qty, unit: unit || undefined };
  }
  return null;
}

// Words farm sheets use for "nothing given/issued/recorded" in a cell.
const NONE_WORDS = new Set(['none', 'nil', 'nill', 'nothing', 'no', 'na', 'notgiven', 'notissued', 'notused', 'zero']);

/** True for cells like "None", "nil", "N/A", "Not given" — meaning nothing
 *  of that column's item was given/issued that day (not a blank cell). */
export function isNoneValue(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  return NONE_WORDS.has(raw.trim().toLowerCase().replace(/[^a-z]/g, ''));
}

const DIM_LABEL: Record<UnitDimension, string> = { mass: 'a weight', volume: 'a volume', count: 'a count' };

/** Plain-language reason a report unit couldn't be converted into an item's
 *  stock unit — shown to Store on the flagged row. */
export function explainUnitMismatch(reportUnit: string, stockUnit: string): string {
  const from = resolveUnit(reportUnit);
  const to = resolveUnit(stockUnit);
  if (!from) return `The report's unit "${reportUnit}" isn't a unit the system recognises — enter the amount in ${stockUnit} or fix the wording on the sheet.`;
  if (!to) return `This item's stock unit "${stockUnit}" isn't a unit the system recognises — update the item's unit in Store Inventory.`;
  if (from.dim !== to.dim) return `The report gives ${DIM_LABEL[from.dim]} ("${reportUnit}") but this item is stocked as ${DIM_LABEL[to.dim]} (${stockUnit}) — one can't be converted into the other.`;
  return `"${reportUnit}" and ${stockUnit} are different count units (a ${from.canonical} has no fixed number of ${to.canonical}s) — enter the amount in ${stockUnit}.`;
}
