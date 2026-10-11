// src/modules/breed-standards/breed-metrics.catalog.ts
//
// Breed-agnostic catalogue of every parameter a breed guide can carry.
// A guide (Hy-Line, Lohmann, ISA …) only supplies NUMBERS for these keys
// (BreedStandardPoint rows); everything about how a parameter behaves —
// which way is "better", whether the system can measure it, what to do
// once a batch is older than the guide's last row, and what it means for
// the farm if it is not recorded or not followed — lives here, once.
//
// Unknown metric keys in an uploaded guide are still stored and shown as
// reference data; they are simply never evaluated.

export type MetricDirection = 'IN_BAND' | 'HIGHER_BETTER' | 'LOWER_BETTER';

/**
 * How the farm can provide a value for the parameter:
 *  SYSTEM    – AWFMS already records the raw data; the farmer chooses at
 *              batch registration whether they will keep recording it.
 *  DECLARED  – the farmer states their practice (e.g. light hours) on the
 *              batch and updates it when it changes.
 *  NO_INPUT  – no input exists in AWFMS (egg grading, egg quality, body
 *              condition score, water lab tests). Always "not recorded".
 *  REFERENCE – guidance only (nutrition specs, space) — shown, never scored.
 */
export type MetricCapture = 'SYSTEM' | 'DECLARED' | 'NO_INPUT' | 'REFERENCE';

/**
 * What to do once a batch is older than the guide's last row:
 *  HOLD_LAST – keep using the last row (e.g. week 100 body weight / HD%).
 *  NONE      – stop comparing (cumulative totals, brooding-only values,
 *              one-off milestones) — holding them flat would be wrong.
 */
export type MetricExtrapolation = 'HOLD_LAST' | 'NONE';

export type MetricGroup =
  | 'GROWTH' | 'LIVABILITY' | 'FEED_WATER' | 'PRODUCTION' | 'EGG_QUALITY'
  | 'ENVIRONMENT' | 'MANAGEMENT' | 'NUTRITION' | 'WATER_QUALITY' | 'SPACE';

export interface MetricDefinition {
  key: string;
  label: string;
  unit: string;
  group: MetricGroup;
  direction: MetricDirection;
  capture: MetricCapture;
  extrapolation: MetricExtrapolation;
  /** For single-value guide rows (no min/max) — system default tolerance
   *  around the target before a value counts as off-standard. Not from any
   *  guide; a FarmStandard can replace it. */
  tolerancePct?: number;
  /** Same as tolerancePct but in the metric's own unit (e.g. ±0.5 h of light). */
  toleranceAbs?: number;
  /** Shown to the farmer (and passed to AI) when they choose not to record it. */
  ifNotRecorded: string;
  /** Plain-English consequence when a value is below / above the standard. */
  ifBelow?: string;
  ifAbove?: string;
}

export const METRICS: MetricDefinition[] = [
  // ── Growth ──────────────────────────────────────────────────────────────
  {
    key: 'BODY_WEIGHT', label: 'Body weight', unit: 'g', group: 'GROWTH',
    direction: 'IN_BAND', capture: 'SYSTEM', extrapolation: 'HOLD_LAST',
    ifNotRecorded: 'Growth cannot be checked against the guide, so under- or over-weight pullets go unnoticed until egg numbers, egg size or livability suffer. Diet changes and light stimulation are meant to follow body weight, not age.',
    ifBelow: 'Underweight birds come into lay late, lay smaller eggs and peak lower; in lay it points to low feed intake, disease or heat stress.',
    ifAbove: 'Overweight birds risk fatty liver, prolapse and poorer feed conversion; in rearing it can bring lay forward before the frame is ready.',
  },
  {
    key: 'UNIFORMITY', label: 'Flock uniformity (±10% of mean weight)', unit: '%', group: 'GROWTH',
    direction: 'HIGHER_BETTER', capture: 'SYSTEM', extrapolation: 'HOLD_LAST',
    ifNotRecorded: 'Uniformity needs individual bird weights at each weighing. Without it the farm cannot tell whether the flock is ready for light stimulation (guide: 85% uniformity) and uneven flocks give a wide spread of egg sizes and a lower peak.',
    ifBelow: 'An uneven flock comes into lay over a longer period, peaks lower and gives a wider spread of egg sizes. Check feeder space, beak condition, disease and stocking density.',
  },
  // ── Livability ──────────────────────────────────────────────────────────
  {
    key: 'MORTALITY_CUM_REARING', label: 'Cumulative mortality (rearing, from arrival)', unit: '%', group: 'LIVABILITY',
    direction: 'LOWER_BETTER', capture: 'SYSTEM', extrapolation: 'NONE',
    ifNotRecorded: 'Losses during rearing cannot be compared with the guide.',
    ifAbove: 'Rearing losses above the guide point to brooding temperature, water/feed access, vaccination or disease problems — fewer pullets reach lay.',
  },
  {
    key: 'MORTALITY_CUM_LAY', label: 'Cumulative mortality (laying, from week 18)', unit: '%', group: 'LIVABILITY',
    direction: 'LOWER_BETTER', capture: 'SYSTEM', extrapolation: 'NONE',
    ifNotRecorded: 'Laying-period losses cannot be compared with the guide, so hen-housed egg numbers cannot be explained.',
    ifAbove: 'Laying losses above the guide cut hen-housed eggs and income; investigate disease, heat stress, prolapse/peck injuries and nutrition.',
  },
  // ── Feed & water ────────────────────────────────────────────────────────
  {
    key: 'FEED_INTAKE', label: 'Feed intake', unit: 'g/bird/day', group: 'FEED_WATER',
    direction: 'IN_BAND', capture: 'SYSTEM', extrapolation: 'HOLD_LAST',
    ifNotRecorded: 'Feed per bird cannot be checked, so under-feeding, over-issue and feed wastage cannot be told apart, and FCR cannot be calculated.',
    ifBelow: 'Feed intake below the guide limits growth, egg numbers and egg size; check feed availability, feed form, heat stress and water.',
    ifAbove: 'Feed recorded above the guide means feed wastage, spillage, rodents or a recording error — it raises cost per egg.',
  },
  {
    key: 'FEED_CUM_REARING', label: 'Cumulative feed intake (rearing)', unit: 'g/bird', group: 'FEED_WATER',
    direction: 'IN_BAND', capture: 'SYSTEM', extrapolation: 'NONE',
    ifNotRecorded: 'Total rearing feed per pullet cannot be compared with the guide.',
    ifBelow: 'Less total feed than the guide usually shows up as underweight pullets at transfer.',
    ifAbove: 'More total feed than the guide means feed wastage or overweight pullets — check both.',
  },
  {
    key: 'WATER_INTAKE', label: 'Water intake', unit: 'ml/bird/day', group: 'FEED_WATER',
    direction: 'IN_BAND', capture: 'SYSTEM', extrapolation: 'HOLD_LAST',
    ifNotRecorded: 'A drop in water use is often the first sign of illness or a blocked line, usually a day or two before feed intake and egg numbers drop. Without it, that early warning is lost.',
    ifBelow: 'Low water intake reduces feed intake and egg output; check drinkers/nipples, water temperature and quality, and early disease.',
    ifAbove: 'High water intake points to heat stress, leaking drinkers, salty feed/water or disease (wet droppings).',
  },
  // ── Production ──────────────────────────────────────────────────────────
  {
    key: 'HEN_DAY_PCT', label: 'Hen-day production', unit: '%', group: 'PRODUCTION',
    direction: 'IN_BAND', capture: 'SYSTEM', extrapolation: 'HOLD_LAST',
    ifNotRecorded: 'Laying rate cannot be compared with the guide.',
    ifBelow: 'Laying below the guide is lost income; usual causes are low body weight at start of lay, feed/water intake, light programme, heat stress or disease.',
    ifAbove: 'Laying above the guide range — good, but check the population count (opening stock) is correct.',
  },
  {
    key: 'HD_EGGS_CUM', label: 'Hen-day eggs (cumulative)', unit: 'eggs/hen', group: 'PRODUCTION',
    direction: 'HIGHER_BETTER', capture: 'SYSTEM', extrapolation: 'NONE',
    ifNotRecorded: 'Cumulative eggs per hen cannot be compared with the guide.',
    ifBelow: 'Cumulative eggs behind the guide — the gap is eggs the farm will not get back.',
  },
  {
    key: 'HH_EGGS_CUM', label: 'Hen-housed eggs (cumulative)', unit: 'eggs/hen housed', group: 'PRODUCTION',
    direction: 'HIGHER_BETTER', capture: 'SYSTEM', extrapolation: 'NONE',
    ifNotRecorded: 'Eggs per hen housed (laying rate and livability combined) cannot be compared with the guide.',
    ifBelow: 'Hen-housed eggs behind the guide combine a lower laying rate and/or higher mortality — both cut flock income.',
  },
  {
    key: 'EGG_WEIGHT', label: 'Average egg weight', unit: 'g/egg', group: 'PRODUCTION',
    direction: 'IN_BAND', capture: 'SYSTEM', extrapolation: 'HOLD_LAST', tolerancePct: 5,
    ifNotRecorded: 'Egg size trend and egg mass cannot be checked. Egg weight responds to body weight at lay, protein/amino-acid and energy intake.',
    ifBelow: 'Small eggs sell for less; check body weight at start of lay, feed intake, protein/methionine and linoleic acid supply, and heat stress.',
    ifAbove: 'Heavier eggs than the guide: more breakage and shell problems later in lay; nutrition (protein/energy) can be adjusted to control size.',
  },
  {
    key: 'EGG_MASS_CUM', label: 'Egg mass per hen housed (cumulative)', unit: 'kg', group: 'PRODUCTION',
    direction: 'HIGHER_BETTER', capture: 'SYSTEM', extrapolation: 'NONE', tolerancePct: 10,
    ifNotRecorded: 'Egg mass needs eggs weighed at collection; without it FCR (kg feed per kg egg) cannot be measured.',
    ifBelow: 'Less egg mass than the guide — combined effect of laying rate, egg size and mortality.',
  },
  {
    key: 'FCR_CUM', label: 'Feed conversion (kg feed per kg egg, from week 20)', unit: 'kg/kg', group: 'PRODUCTION',
    direction: 'LOWER_BETTER', capture: 'SYSTEM', extrapolation: 'NONE',
    ifNotRecorded: 'FCR needs both feed and egg weights recorded; without it feed efficiency — the biggest cost driver — cannot be benchmarked.',
    ifAbove: 'Using more feed per kg of eggs than the guide raises cost per egg: look for feed wastage, low laying rate, small eggs, heat or cold stress and disease.',
  },
  {
    key: 'DAYS_TO_50_PCT', label: 'Age at 50% production', unit: 'days from hatch', group: 'PRODUCTION',
    direction: 'LOWER_BETTER', capture: 'SYSTEM', extrapolation: 'NONE',
    ifNotRecorded: 'Onset of lay cannot be compared with the guide.',
    ifAbove: 'Late onset of lay usually follows low body weight/uniformity at transfer or a delayed/weak light stimulation — days of lost production.',
  },
  {
    key: 'PEAK_HDP', label: 'Peak hen-day production', unit: '%', group: 'PRODUCTION',
    direction: 'HIGHER_BETTER', capture: 'SYSTEM', extrapolation: 'NONE',
    ifNotRecorded: 'Peak production cannot be compared with the guide.',
    ifBelow: 'A low peak is rarely recovered later in lay; it usually traces back to rearing (body weight, uniformity) or a health challenge around peak.',
  },
  // ── Management / environment ────────────────────────────────────────────
  {
    key: 'BROODING_TEMP', label: 'Brooding air temperature', unit: '°C', group: 'ENVIRONMENT',
    direction: 'IN_BAND', capture: 'SYSTEM', extrapolation: 'NONE',
    ifNotRecorded: 'Brooder temperature cannot be checked against the guide; chilled or overheated chicks eat and drink less, which shows up as poor 7-day livability and weight.',
    ifBelow: 'Chicks too cold huddle, eat less and are more prone to disease and early mortality.',
    ifAbove: 'Chicks too hot pant, spread away from heat and drink more but eat less — dehydration and poor growth.',
  },
  {
    key: 'LIGHT_INTENSITY', label: 'Light intensity (brooding)', unit: 'lux', group: 'ENVIRONMENT',
    direction: 'IN_BAND', capture: 'SYSTEM', extrapolation: 'NONE',
    ifNotRecorded: 'Brooding light intensity cannot be checked; chicks need bright light early to find feed and water.',
    ifBelow: 'Too little light early on means chicks find feed and water more slowly — weak start.',
    ifAbove: 'Too much light later in rearing can increase activity and feather pecking.',
  },
  {
    key: 'LIGHT_HOURS', label: 'Hours of light per day', unit: 'h', group: 'MANAGEMENT',
    direction: 'IN_BAND', capture: 'DECLARED', extrapolation: 'HOLD_LAST', toleranceAbs: 0.5,
    ifNotRecorded: 'The lighting programme cannot be compared with the guide. Day length controls when pullets come into lay; increasing light before body weight (1.35 kg) and uniformity (85%) are reached brings small eggs and a lower peak.',
    ifBelow: 'Fewer light hours than the guide can delay onset of lay and reduce feed intake and egg numbers in lay.',
    ifAbove: 'More light hours than the guide in rearing can bring pullets into lay early at low body weight — small eggs, more prolapse, lower peak.',
  },
  {
    key: 'FEED_PHASE', label: 'Diet phase for age / body weight', unit: '', group: 'MANAGEMENT',
    direction: 'IN_BAND', capture: 'SYSTEM', extrapolation: 'HOLD_LAST',
    ifNotRecorded: 'Diet changes cannot be checked against the guide.',
    ifAbove: 'A diet ahead of or behind the guide phase gives the wrong nutrient density for the bird’s stage (e.g. pre-lay too early, or pre-lay after first egg, which is short of calcium for shell).',
  },
  {
    key: 'TRANSFER_AGE', label: 'Age at transfer to laying house', unit: 'weeks', group: 'MANAGEMENT',
    direction: 'IN_BAND', capture: 'SYSTEM', extrapolation: 'NONE',
    ifNotRecorded: 'Transfer timing cannot be checked.',
    ifBelow: 'Transferring very early adds stress while the skeleton is still developing.',
    ifAbove: 'Transferring late means birds start laying while settling into new cages — stress, floor/cage eggs and a slower peak. Birds normally lose 10–12% body weight at transfer.',
  },
  // ── Not measurable at the farm (no input) ───────────────────────────────
  {
    key: 'EGG_SIZE_DISTRIBUTION', label: 'Egg size distribution (S/M/L/XL)', unit: '%', group: 'EGG_QUALITY',
    direction: 'IN_BAND', capture: 'NO_INPUT', extrapolation: 'HOLD_LAST',
    ifNotRecorded: 'Egg grading is not done, so the share of small/medium/large eggs (and the price mix it brings) is unknown. Average egg weight from weighed trays is the only size signal available.',
  },
  {
    key: 'HAUGH_UNITS', label: 'Haugh units (albumen quality)', unit: 'HU', group: 'EGG_QUALITY',
    direction: 'HIGHER_BETTER', capture: 'NO_INPUT', extrapolation: 'HOLD_LAST',
    ifNotRecorded: 'Internal egg quality (freshness of the white) is not measured — problems from storage temperature, disease (e.g. IB) or old flocks will only show up as customer complaints.',
  },
  {
    key: 'BREAKING_STRENGTH', label: 'Shell breaking strength', unit: 'g force', group: 'EGG_QUALITY',
    direction: 'HIGHER_BETTER', capture: 'NO_INPUT', extrapolation: 'HOLD_LAST',
    ifNotRecorded: 'Shell strength is not measured; broken/soft-shell counts at collection are the only shell-quality signal (calcium supply, particle size, vitamin D3, age, disease).',
  },
  {
    key: 'SHELL_COLOR', label: 'Shell colour score', unit: 'score', group: 'EGG_QUALITY',
    direction: 'HIGHER_BETTER', capture: 'NO_INPUT', extrapolation: 'HOLD_LAST',
    ifNotRecorded: 'Shell colour is not scored; pale shells can be an early sign of stress or disease (e.g. IB, EDS).',
  },
  {
    key: 'BODY_CONDITION_SCORE', label: 'Body condition score (0–6)', unit: 'score', group: 'GROWTH',
    direction: 'IN_BAND', capture: 'NO_INPUT', extrapolation: 'HOLD_LAST',
    ifNotRecorded: 'Body condition (breast muscle, abdominal fat) is not scored, so the farm relies on body weight alone — a bird can be on weight but too fat or too lean.',
  },
  {
    key: 'WATER_QUALITY', label: 'Drinking water quality (lab test)', unit: 'mg/L', group: 'WATER_QUALITY',
    direction: 'LOWER_BETTER', capture: 'NO_INPUT', extrapolation: 'HOLD_LAST',
    ifNotRecorded: 'Water is not lab-tested, so nitrates, bacteria, hardness or pH outside the guide limits would go unnoticed (they reduce water/feed intake and can cause wet droppings or disease).',
  },
  // ── Reference only ──────────────────────────────────────────────────────
  { key: 'NUTRIENT_REARING', label: 'Rearing diet nutrient concentration', unit: '', group: 'NUTRITION', direction: 'IN_BAND', capture: 'REFERENCE', extrapolation: 'HOLD_LAST', ifNotRecorded: '' },
  { key: 'NUTRIENT_DAILY', label: 'Laying daily nutrient intake', unit: '', group: 'NUTRITION', direction: 'IN_BAND', capture: 'REFERENCE', extrapolation: 'HOLD_LAST', ifNotRecorded: '' },
  { key: 'NUTRITION_PHASE', label: 'Laying diet phase by hen-day %', unit: '%', group: 'NUTRITION', direction: 'IN_BAND', capture: 'REFERENCE', extrapolation: 'HOLD_LAST', ifNotRecorded: '' },
  { key: 'CALCIUM_PHOSPHORUS', label: 'Calcium & phosphorus intake (laying)', unit: '', group: 'NUTRITION', direction: 'IN_BAND', capture: 'REFERENCE', extrapolation: 'HOLD_LAST', ifNotRecorded: '' },
  { key: 'VITAMINS_MINERALS', label: 'Vitamins & trace minerals per tonne', unit: '', group: 'NUTRITION', direction: 'IN_BAND', capture: 'REFERENCE', extrapolation: 'HOLD_LAST', ifNotRecorded: '' },
  { key: 'SPACE', label: 'Space allowance', unit: '', group: 'SPACE', direction: 'IN_BAND', capture: 'REFERENCE', extrapolation: 'HOLD_LAST', ifNotRecorded: '' },
  { key: 'LIGHT_STIM_BODY_WEIGHT', label: 'Minimum body weight before light stimulation', unit: 'g', group: 'MANAGEMENT', direction: 'HIGHER_BETTER', capture: 'REFERENCE', extrapolation: 'NONE', ifNotRecorded: '' },
  { key: 'LIGHT_STIM_UNIFORMITY', label: 'Minimum uniformity before light stimulation', unit: '%', group: 'MANAGEMENT', direction: 'HIGHER_BETTER', capture: 'REFERENCE', extrapolation: 'NONE', ifNotRecorded: '' },
  { key: 'PRELAY_EARLIEST_WEEK', label: 'Earliest week for pre-lay diet', unit: 'week', group: 'MANAGEMENT', direction: 'HIGHER_BETTER', capture: 'REFERENCE', extrapolation: 'NONE', ifNotRecorded: '' },
  { key: 'GUIDE_NOTE', label: 'Guide note', unit: '', group: 'MANAGEMENT', direction: 'IN_BAND', capture: 'REFERENCE', extrapolation: 'NONE', ifNotRecorded: '' },
];

const BY_KEY = new Map(METRICS.map(m => [m.key, m]));

export function metricDef(key: string): MetricDefinition | undefined {
  return BY_KEY.get(key);
}

/** Metrics a farmer can choose to record (or not) for a batch. */
export function recordableMetrics(): MetricDefinition[] {
  return METRICS.filter(m => m.capture === 'SYSTEM' || m.capture === 'DECLARED');
}

/** Metrics the farm cannot record in AWFMS today — always "not recorded". */
export function noInputMetrics(): MetricDefinition[] {
  return METRICS.filter(m => m.capture === 'NO_INPUT');
}
