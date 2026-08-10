// src/modules/store/production-report.dto.ts
// Shared types for the Store Production Report verification feature.
// The report format is deliberately generic ("any kind of production
// report") — a canonical field dictionary + synonym matching lets the same
// pipeline handle differently-laid-out spreadsheets without code changes.

/** Canonical fields the parser understands. Any of these may be absent from
 *  a given report — only present + mapped columns are cross-checked. */
export type CanonicalField =
  | 'date'
  | 'row'            // free-form row/deck label, if the report breaks data down by row
  | 'level'          // free-form level label, if the report breaks data down by level
  | 'cage'           // free-form cage label, if the report breaks data down by cage
  | 'feedKg'
  | 'feedType'
  | 'waterLts'
  | 'mortality'
  | 'culling'
  | 'openingStock'
  | 'closingStock'
  | 'avgWeight'
  | 'temperature'
  | 'humidity'
  | 'lux'
  | 'drugsVaccines'  // fallback for sheets that blend vaccine/supplement/treatment into one column
  | 'vaccineText'
  | 'supplementText'
  | 'treatmentText'
  | 'notes';

export const CANONICAL_FIELD_LABELS: Record<CanonicalField, string> = {
  date:          'Date',
  row:           'Row / Deck',
  level:         'Level',
  cage:          'Cage',
  feedKg:        'Feed (Kg)',
  feedType:      'Feed Type',
  waterLts:      'Water (Litres)',
  mortality:     'Mortality',
  culling:       'Culling',
  openingStock:  'Opening Stock',
  closingStock:  'Closing Stock',
  avgWeight:     'Average Weight',
  temperature:   'Temperature',
  humidity:      'Humidity',
  lux:           'Light (Lux)',
  drugsVaccines: 'Drugs / Vaccines / Supplements (blended)',
  vaccineText:   'Vaccine',
  supplementText:'Supplement',
  treatmentText: 'Treatment',
  notes:         'Remarks',
};

/** Header text (normalised: lowercase, alphanumerics only) each canonical
 *  field is auto-recognised by. First match wins during auto-detection —
 *  the user can always override the suggestion before submitting. */
export const FIELD_SYNONYMS: Record<CanonicalField, string[]> = {
  date:          ['date'],
  row:           ['row', 'deck'],
  level:         ['level'],
  cage:          ['cage'],
  feedKg:        ['feedskgs', 'feedkg', 'feedkgs', 'feed', 'feeds'],
  feedType:      ['feedtype', 'typeoffeed'],
  waterLts:      ['waterlts', 'water', 'waterl', 'waterltrs', 'waterlitres'],
  mortality:     ['mortality', 'deaths', 'mortalities'],
  culling:       ['culling', 'culled', 'cull'],
  openingStock:  ['ostock', 'openingstock', 'opstock'],
  closingStock:  ['cstock', 'closingstock', 'clstock'],
  avgWeight:     ['aweight', 'avgweight', 'averageweight'],
  temperature:   ['temp', 'temperature'],
  humidity:      ['humidity', 'humid'],
  lux:           ['lux', 'light', 'lightintensity'],
  // Kept as a fallback match for sheets with one blended column; vaccine/
  // supplement/treatment specific synonyms are tried first during header
  // detection (see parser) so a sheet with all three separate columns maps
  // each to its own field instead of all three collapsing onto this one.
  drugsVaccines: ['drugsvaccinesupplementlubricantlaxative'],
  vaccineText:   ['vaccine', 'vaccines', 'vaccination'],
  supplementText:['supplement', 'supplements', 'additive', 'additives'],
  treatmentText: ['treatment', 'treatments', 'drug', 'drugs', 'medication', 'medications'],
  notes:         ['remarks', 'notes', 'comments'],
};

/** Canonical fields that may legitimately appear more than once per day on a
 *  sheet (e.g. "Temp AM" / "Temp Noon" / "Temp PM"). Only the first `MAX_ENV_READINGS_PER_DAY`
 *  matched columns (in sheet column order) are read — see §9/§11 of the
 *  workflow spec: truncate to 3, or fewer if the sheet only has 1-2. */
export const MULTI_READING_FIELDS = ['temperature', 'humidity', 'lux'] as const;
export type MultiReadingField = (typeof MULTI_READING_FIELDS)[number];
export const MAX_ENV_READINGS_PER_DAY = 3;
export const ENV_READING_LABELS = ['Morning', 'Midday', 'Evening'] as const;

/** One (canonical field -> source header) map, plus (StoreItem id -> source
 *  header) for any columns that represent an item issued from the store
 *  (e.g. "Charcoal"). Persisted on the report so re-exports/audits can show
 *  exactly how the sheet was interpreted.
 *
 *  `fields` covers every canonical field as a single source column — this
 *  stays the primary mapping surface, including for temperature/humidity/lux
 *  when the sheet only has one column for that metric. `envFields` is an
 *  optional ADDITIONAL mapping, used only when a sheet carries more than one
 *  same-day column for a metric (e.g. multiple temperature readings) — when
 *  present for a field, it takes priority over `fields` for that field. */
export interface ProductionReportColumnMapping {
  fields: Partial<Record<CanonicalField, string>>;
  items: Record<string, string>; // storeItemId -> source header
  envFields?: Partial<Record<MultiReadingField, string[]>>; // ordered source headers, first 3 used
}

export type RowResolution = 'MATCHED' | 'AUTOFILLED' | 'DISCREPANCY' | 'SKIPPED';

export interface ParsedItemUsage {
  storeItemId: string;
  storeItemName: string;
  quantity: number;
  unit?: string;
  rawText: string;
  resolution: RowResolution;
}

/** One matched (or unmatched) mention of a vaccine/supplement/treatment on a
 *  report row. `storeItemId` is null when the free text couldn't be matched
 *  to any active StoreItem in the relevant category — still carried through
 *  for display/audit, but plays no role in stock deduction. */
export interface ParsedHealthUsage {
  kind: 'vaccine' | 'supplement' | 'treatment';
  rawText: string;
  storeItemId: string | null;
  storeItemName: string | null;
  quantity?: number;
  unit?: string;
  resolution: RowResolution;
}

/** One environmental reading slot (temperature/humidity/lux), labelled by
 *  time-of-day position rather than a specific clock time, since sheets
 *  rarely label columns with exact times. */
export interface EnvReading {
  label: (typeof ENV_READING_LABELS)[number];
  value: string;
}

/** One portion of a split "Feed Type" cell — e.g. the sheet writes
 *  "chickcrumbs/growers 75:25%" to mean 75% of that day's feedKg total is
 *  Chick Crumbs and 25% is Growers Mash (stores already issues the day's
 *  stock-out split to that ratio, so the report is just describing it).
 *  `percent` is normalised so every row's portions sum to exactly 100 (a
 *  report showing "70:20%" is treated as 70/90 and 20/90, not 70% and 20%
 *  of nothing) and `kg` is `feedKg * percent / 100`, rounded to 2dp, so the
 *  portions' kg always sum to the row's feedKg exactly. */
export interface FeedSplitPortion {
  label: string;   // raw text for this portion, e.g. "chickcrumbs" or "growers"
  percent: number; // 0-100, normalised so all portions on the row sum to 100
  kg: number;      // this portion's share of row.feedKg
}

export interface ParsedReportRow {
  date: string; // YYYY-MM-DD
  locationRef: string | null; // combined Row/Level/Cage label if present, else null (whole-batch row)
  // Parsed numeric row/level/cage identifiers (leading digits pulled out of
  // whatever free text the row/level/cage columns carry, e.g. "Row 3" -> 3,
  // "Cage 07" -> 7) — used to resolve the actual BrooderRow/Level/Cage record
  // for cage-map reconciliation. undefined when that column isn't mapped or
  // the cell didn't parse to a number.
  rowNumber?: number;
  levelNumber?: number;
  cageNumber?: number;
  feedKg?: number;
  feedType?: string;
  // Populated only when feedType text carries a two-way percentage split
  // (e.g. "chickcrumbs/growers 75:25%") — see FeedSplitPortion. Undefined
  // for the normal single-feed-type case, which is unaffected.
  feedSplit?: FeedSplitPortion[];
  waterLts?: number;
  mortality?: number;
  culling?: number;
  openingStock?: number;
  closingStock?: number;
  avgWeight?: string;
  // Single-reading fallback (used when the sheet has exactly one column for
  // the metric — kept for backward compatibility with existing rawRows and
  // simple sheets).
  temperature?: string;
  humidity?: string;
  lux?: string;
  // Multi-reading breakdown (up to 3/day) — populated whenever envFields
  // mapped more than one source column for the metric.
  temperatureReadings?: EnvReading[];
  humidityReadings?: EnvReading[];
  luxReadings?: EnvReading[];
  drugsVaccines?: string; // blended free text, only when the sheet wasn't split into the three fields below
  vaccineText?: string;
  supplementText?: string;
  treatmentText?: string;
  notes?: string;
  itemsIssued: ParsedItemUsage[];
  healthUsages: ParsedHealthUsage[]; // matched vaccine/supplement/treatment items, per §3
  raw: Record<string, any>; // original cell values for this row, for export/audit

  // Populated by the reconciliation engine — per-field outcome so the store
  // and the Director can both see, at a glance, what happened with each row.
  resolution: {
    mortality?: RowResolution;
    feedKg?: RowResolution;
    stockCount?: RowResolution;
    cageAssignment?: RowResolution; // set only for per-cage rows (rowNumber/levelNumber/cageNumber all present) — see §cage reassignment
    environmental?: RowResolution; // rolls up temperature/humidity/lux across whatever sessions this row carried readings for
    water?: RowResolution; // report waterLts vs. BrooderLog.waterConsumptionL (brooding) / EggCollectionSession.waterLiters (production)
  };
}

export interface SubmitReportResult {
  reportId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  totalRows: number;
  matchedCount: number;
  autofillCount: number;
  discrepancyCount: number;
  stage: 'BROODING' | 'PRODUCTION' | 'OTHER';
}

/** Response shape for the Step-1b verify screen — the full (uncapped) parsed
 *  table, with the recorded-column set the frontend should render (see §2:
 *  "only columns that actually have data"). Purely a read of preview() — no
 *  reconciliation, nothing mutated. */
export interface PreviewReportResult {
  rows: ParsedReportRow[];
  totalRows: number;
  presentFields: CanonicalField[]; // fields with at least one non-empty value across all rows
  presentItemColumns: { storeItemId: string; storeItemName: string; header: string }[];
}
