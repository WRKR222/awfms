// src/modules/breed-standards/feed-nutrients.catalog.ts
//
// Nutrients a feed lab test can report, and how each one is compared with a
// breed guide:
//   • rearing (weeks 1–17): the diet's concentration vs the guide's diet
//     specification for the phase           → metric DIET_<KEY>
//   • laying (week 18+): daily intake per bird (g feed eaten × concentration)
//     vs the guide's daily intake for the laying phase → metric INTAKE_<KEY>
// Lab tests report TOTAL amino acids, so they are compared with the guide's
// "total" figures (the guide prints "SID / total").

export interface FeedNutrient {
  key: string;
  label: string;
  /** Unit the lab reports and DIET_* is compared in (as fed). */
  concUnit: '%' | 'kcal/kg' | 'mg/kg';
  /** Unit INTAKE_* is compared in. */
  intakeUnit: string;
  /** Daily intake per bird from grams of feed eaten and the concentration. */
  intake: (feedGrams: number, conc: number) => number;
  /** Compared with the guide (false = recorded only). */
  compared: boolean;
  ifLow: string;
  ifHigh?: string;
}

const pctToMg = (g: number, pct: number) => g * pct * 10;   // g × pct/100 × 1000
const pctToG = (g: number, pct: number) => (g * pct) / 100;
const perKg = (g: number, v: number) => (g / 1000) * v;

export const FEED_NUTRIENTS: FeedNutrient[] = [
  { key: 'ENERGY', label: 'Metabolizable energy', concUnit: 'kcal/kg', intakeUnit: 'kcal/bird/day', intake: perKg, compared: true,
    ifLow: 'Too little energy cuts egg mass and laying rate and makes birds lose weight; in rearing it slows growth.',
    ifHigh: 'Too much energy makes birds fat (fatty liver, prolapse) and wastes money; hens also eat less, which can short them of protein and calcium.' },
  { key: 'PROTEIN', label: 'Crude protein', concUnit: '%', intakeUnit: 'g/day', intake: pctToG, compared: true,
    ifLow: 'Low protein reduces egg size and egg numbers and slows pullet growth. (The guide treats protein as a typical value — amino acids matter more.)' },
  { key: 'LYSINE', label: 'Lysine (total)', concUnit: '%', intakeUnit: 'mg/day', intake: pctToMg, compared: true,
    ifLow: 'Lysine short of the guide limits egg mass and growth — usually the first amino acid to check when eggs are small or production drops.' },
  { key: 'METHIONINE', label: 'Methionine (total)', concUnit: '%', intakeUnit: 'mg/day', intake: pctToMg, compared: true,
    ifLow: 'Low methionine gives smaller eggs, lower production and poor feathering; it is the first limiting amino acid in most layer diets.' },
  { key: 'MET_CYS', label: 'Methionine + cystine (total)', concUnit: '%', intakeUnit: 'mg/day', intake: pctToMg, compared: true,
    ifLow: 'Low methionine + cystine reduces egg weight and feather cover, and can increase feather pecking.' },
  { key: 'THREONINE', label: 'Threonine (total)', concUnit: '%', intakeUnit: 'mg/day', intake: pctToMg, compared: true,
    ifLow: 'Low threonine reduces egg mass (albumen) and growth.' },
  { key: 'TRYPTOPHAN', label: 'Tryptophan (total)', concUnit: '%', intakeUnit: 'mg/day', intake: pctToMg, compared: true,
    ifLow: 'Low tryptophan reduces feed intake and egg output and is linked to nervousness and feather pecking.' },
  { key: 'ARGININE', label: 'Arginine (total)', concUnit: '%', intakeUnit: 'mg/day', intake: pctToMg, compared: true,
    ifLow: 'Low arginine limits growth and egg output.' },
  { key: 'ISOLEUCINE', label: 'Isoleucine (total)', concUnit: '%', intakeUnit: 'mg/day', intake: pctToMg, compared: true,
    ifLow: 'Low isoleucine limits egg mass, especially in low-protein diets.' },
  { key: 'VALINE', label: 'Valine (total)', concUnit: '%', intakeUnit: 'mg/day', intake: pctToMg, compared: true,
    ifLow: 'Low valine limits egg mass and growth, especially in low-protein diets.' },
  { key: 'CALCIUM', label: 'Calcium', concUnit: '%', intakeUnit: 'g/day', intake: pctToG, compared: true,
    ifLow: 'Calcium short of the guide gives thin and soft shells, more broken eggs and, over time, weak bones (cage layer fatigue).',
    ifHigh: 'Calcium far above the guide in rearing diets can damage pullet kidneys; give the high-calcium diet only from pre-lay.' },
  { key: 'AV_PHOSPHORUS', label: 'Phosphorus (available)', concUnit: '%', intakeUnit: 'mg/day', intake: pctToMg, compared: true,
    ifLow: 'Low available phosphorus weakens bones and shells and can raise mortality late in lay.' },
  { key: 'SODIUM', label: 'Sodium', concUnit: '%', intakeUnit: 'mg/day', intake: pctToMg, compared: true,
    ifLow: 'Low sodium reduces feed and water intake and egg weight, and can trigger feather pecking.' },
  { key: 'CHLORIDE', label: 'Chloride', concUnit: '%', intakeUnit: 'mg/day', intake: pctToMg, compared: true,
    ifLow: 'Low chloride reduces feed intake and growth; balance with sodium matters for shell quality.' },
  { key: 'LINOLEIC', label: 'Linoleic acid (C18:2 n-6)', concUnit: '%', intakeUnit: 'g/day', intake: pctToG, compared: true,
    ifLow: 'Low linoleic acid gives smaller eggs, especially early in lay.' },
  { key: 'CHOLINE', label: 'Choline', concUnit: 'mg/kg', intakeUnit: 'mg/day', intake: perKg, compared: true,
    ifLow: 'Low choline raises the risk of fatty liver and can reduce egg production.' },
  // Recorded only — the guide gives no target for these.
  { key: 'MOISTURE', label: 'Moisture', concUnit: '%', intakeUnit: '', intake: pctToG, compared: false, ifLow: '' },
  { key: 'FIBRE', label: 'Crude fibre', concUnit: '%', intakeUnit: '', intake: pctToG, compared: false, ifLow: '' },
  { key: 'FAT', label: 'Crude fat (ether extract)', concUnit: '%', intakeUnit: '', intake: pctToG, compared: false, ifLow: '' },
  { key: 'ASH', label: 'Ash', concUnit: '%', intakeUnit: '', intake: pctToG, compared: false, ifLow: '' },
  { key: 'DIG_PHOSPHORUS', label: 'Phosphorus (digestible)', concUnit: '%', intakeUnit: '', intake: pctToMg, compared: false, ifLow: '' },
  { key: 'TOTAL_PHOSPHORUS', label: 'Phosphorus (total)', concUnit: '%', intakeUnit: '', intake: pctToMg, compared: false, ifLow: '' },
  { key: 'CALCIUM_COARSE', label: 'Limestone coarse fraction (2–4 mm)', concUnit: '%', intakeUnit: '', intake: pctToG, compared: false, ifLow: '' },
];

export const NUTRIENT_BY_KEY = new Map(FEED_NUTRIENTS.map(n => [n.key, n]));
export const COMPARED_NUTRIENTS = FEED_NUTRIENTS.filter(n => n.compared);

/** Guide row label → nutrient key (both Hy-Line tables and uploaded guides). */
export function nutrientKeyFromLabel(label: string): string | null {
  const l = label.toLowerCase();
  if (l.includes('energy')) return 'ENERGY';
  if (l.includes('methionine+cystine') || l.includes('methionine + cystine') || l.includes('m+c')) return 'MET_CYS';
  if (l.includes('methionine')) return 'METHIONINE';
  if (l.includes('lysine')) return 'LYSINE';
  if (l.includes('threonine')) return 'THREONINE';
  if (l.includes('tryptophan')) return 'TRYPTOPHAN';
  if (l.includes('arginine')) return 'ARGININE';
  if (l.includes('isoleucine')) return 'ISOLEUCINE';
  if (l.includes('valine')) return 'VALINE';
  if (l.includes('crude protein')) return 'PROTEIN';
  if (l.includes('particle')) return null;
  if (l.includes('calcium')) return 'CALCIUM';
  if (l.includes('phosphorus (available)')) return 'AV_PHOSPHORUS';
  if (l.includes('sodium')) return 'SODIUM';
  if (l.includes('chloride')) return 'CHLORIDE';
  if (l.includes('linoleic')) return 'LINOLEIC';
  if (l.includes('choline')) return 'CHOLINE';
  return null;
}

/** Guide text "830 / 909" (SID / total) → total; "315–330" → range; "17.80" → value. */
export function parseGuideNutrient(text: string): { min?: number; max?: number; target?: number } | null {
  const t = text.replace(/,/g, '').trim();
  const slash = t.split('/').map(s => s.trim());
  if (slash.length === 2) { const v = Number(slash[1]); return Number.isFinite(v) ? { target: v } : null; }
  const range = t.split(/[–-]/).map(s => Number(s.trim()));
  if (range.length === 2 && range.every(Number.isFinite)) return { min: range[0], max: range[1] };
  const v = Number(t);
  return Number.isFinite(v) ? { target: v } : null;
}
