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
  | 'drugsVaccines'
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
  drugsVaccines: 'Drugs / Vaccines / Supplements',
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
  drugsVaccines: [
    'drugsvaccinesupplementlubricantlaxative', 'drugs', 'vaccine',
    'vaccines', 'medication', 'supplement', 'treatment',
  ],
  notes:         ['remarks', 'notes', 'comments'],
};

/** One (canonical field -> source header) map, plus (StoreItem id -> source
 *  header) for any columns that represent an item issued from the store
 *  (e.g. "Charcoal"). Persisted on the report so re-exports/audits can show
 *  exactly how the sheet was interpreted. */
export interface ProductionReportColumnMapping {
  fields: Partial<Record<CanonicalField, string>>;
  items: Record<string, string>; // storeItemId -> source header
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

export interface ParsedReportRow {
  date: string; // YYYY-MM-DD
  locationRef: string | null; // combined Row/Level/Cage label if present, else null (whole-batch row)
  feedKg?: number;
  feedType?: string;
  waterLts?: number;
  mortality?: number;
  culling?: number;
  openingStock?: number;
  closingStock?: number;
  avgWeight?: string;
  temperature?: string;
  humidity?: string;
  lux?: string;
  drugsVaccines?: string;
  notes?: string;
  itemsIssued: ParsedItemUsage[];
  raw: Record<string, any>; // original cell values for this row, for export/audit

  // Populated by the reconciliation engine — per-field outcome so the store
  // and the Director can both see, at a glance, what happened with each row.
  resolution: {
    mortality?: RowResolution;
    feedKg?: RowResolution;
    stockCount?: RowResolution;
  };
}

export interface SubmitReportResult {
  reportId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  totalRows: number;
  matchedCount: number;
  autofillCount: number;
  discrepancyCount: number;
}
