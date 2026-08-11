// src/common/units/unit-conversion.util.ts
// Generic unit conversion for comparing/deducting report-derived quantities
// against a StoreItem's stock unit (e.g. report records grams, StoreItem is
// stocked in kg). See AWFMS-Production-Report-Workflow.md §4.
//
// Deliberately conservative: only mass and volume are modelled numerically.
// Count-based units (bags, sachets, doses, pcs...) have no universal
// conversion factor between each other, so those must match the StoreItem's
// unit exactly — convertToUnit() returns null rather than guessing, and
// callers must treat null as "needs manual reconciliation", never as "assume
// they're equal".

export type UnitDimension = 'mass' | 'volume';

interface UnitDef {
  dim: UnitDimension;
  factor: number; // multiply by this to get to the dimension's base unit
}

// Base units: mass -> kg, volume -> litre.
const UNIT_TO_BASE: Record<string, UnitDef> = {
  // mass
  mg: { dim: 'mass', factor: 0.000001 },
  mgs: { dim: 'mass', factor: 0.000001 },
  g: { dim: 'mass', factor: 0.001 },
  gram: { dim: 'mass', factor: 0.001 },
  grams: { dim: 'mass', factor: 0.001 },
  gs: { dim: 'mass', factor: 0.001 },
  kg: { dim: 'mass', factor: 1 },
  kgs: { dim: 'mass', factor: 1 },
  kilogram: { dim: 'mass', factor: 1 },
  kilograms: { dim: 'mass', factor: 1 },
  tonne: { dim: 'mass', factor: 1000 },
  tonnes: { dim: 'mass', factor: 1000 },
  t: { dim: 'mass', factor: 1000 },

  // volume
  ml: { dim: 'volume', factor: 0.001 },
  mls: { dim: 'volume', factor: 0.001 },
  milliliter: { dim: 'volume', factor: 0.001 },
  milliliters: { dim: 'volume', factor: 0.001 },
  millilitre: { dim: 'volume', factor: 0.001 },
  millilitres: { dim: 'volume', factor: 0.001 },
  cl: { dim: 'volume', factor: 0.01 },
  l: { dim: 'volume', factor: 1 },
  lt: { dim: 'volume', factor: 1 },
  ltr: { dim: 'volume', factor: 1 },
  ltrs: { dim: 'volume', factor: 1 },
  liter: { dim: 'volume', factor: 1 },
  liters: { dim: 'volume', factor: 1 },
  litre: { dim: 'volume', factor: 1 },
  litres: { dim: 'volume', factor: 1 },
};

// Units with no numeric conversion — always require an exact match against
// the StoreItem's unit, ONCE both sides have been folded to a single
// canonical spelling (see COUNT_UNIT_CANONICAL below). Not exhaustive;
// anything not present in UNIT_TO_BASE is already treated this way by
// convertToUnit()'s null return.
export const COUNT_UNITS = new Set(['bag', 'sachet', 'dose', 'piece', 'roll', 'box', 'unit']);

// Plural (and a couple of common abbreviation) spellings of count-based
// units, folded onto one canonical singular form. This is what makes a
// report cell like "6 bags" reconcile cleanly against a StoreItem whose
// `unit` column is stored as "BAG" — without this, normaliseUnit() would
// leave them as the two different strings "bags" and "bag", the equality
// check in convertToUnit() would fail, neither string is in UNIT_TO_BASE
// (count-based units have no numeric factor), and the pair would
// incorrectly fall through to "needs manual conversion" even though they
// obviously mean the same unit. Kept separate from UNIT_WORD_CANONICAL in
// production-report-reconciliation.service.ts, which does the equivalent
// job for free-text ITEM NAME matching rather than a StoreItem's `unit`
// column — the two lists happen to overlap but serve different call sites.
const COUNT_UNIT_CANONICAL: Record<string, string> = {
  bag: 'bag', bags: 'bag',
  sachet: 'sachet', sachets: 'sachet',
  dose: 'dose', doses: 'dose',
  piece: 'piece', pieces: 'piece', pc: 'piece', pcs: 'piece',
  roll: 'roll', rolls: 'roll',
  box: 'box', boxes: 'box',
  unit: 'unit', units: 'unit',
};

export function normaliseUnit(u: string | undefined | null): string {
  const base = String(u ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
  return COUNT_UNIT_CANONICAL[base] ?? base;
}

/** Converts `qty` from `fromUnit` to `toUnit`. Returns null when either unit
 *  is unrecognised or the two units aren't the same dimension (e.g. mass vs.
 *  volume, or two different count-based units) — callers must never guess in
 *  that case, only flag for manual reconciliation. Returns `qty` unchanged
 *  (dimension-free) when the units are already textually identical, even if
 *  neither is in the numeric table (e.g. "bags" -> "bags"). */
export function convertToUnit(qty: number, fromUnit: string | undefined | null, toUnit: string | undefined | null): number | null {
  const fromNorm = normaliseUnit(fromUnit);
  const toNorm = normaliseUnit(toUnit);
  if (!fromNorm || !toNorm) return null;
  if (fromNorm === toNorm) return qty; // identical unit strings — no conversion needed, count-based or not

  const from = UNIT_TO_BASE[fromNorm];
  const to = UNIT_TO_BASE[toNorm];
  if (!from || !to || from.dim !== to.dim) return null; // incompatible or unrecognised — do NOT guess

  return (qty * from.factor) / to.factor;
}

/** Convenience wrapper for the report-vs-stock comparison case: given a
 *  usage figure parsed off the report (with its own unit, possibly absent)
 *  and the StoreItem's stock unit, returns the converted quantity plus a
 *  human-readable reason when conversion wasn't possible. */
export function reconcileUnit(
  qty: number,
  reportUnit: string | undefined,
  stockUnit: string,
): { convertedQty: number; note: string | null } | { convertedQty: null; note: string } {
  if (!reportUnit) {
    // No unit on the report cell — assume it was already recorded in the
    // stock unit (matches today's behaviour for cells like "6" with no
    // trailing unit text).
    return { convertedQty: qty, note: null };
  }
  const converted = convertToUnit(qty, reportUnit, stockUnit);
  if (converted === null) {
    return {
      convertedQty: null,
      note: `Unit "${reportUnit}" on the report could not be reconciled against stock unit "${stockUnit}" — needs manual conversion.`,
    };
  }
  return { convertedQty: converted, note: null };
}
