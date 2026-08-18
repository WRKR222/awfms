// src/modules/weight/weight.dto.ts
// Shared types for:
//   1. ProductionWeightAlert — the Director-facing "weight is outside the
//      HyLine standard band" flag, raised from either an uploaded
//      production report row (avgWeight column) or a Farm Events "Bird
//      Weighing" entry.
//   2. BirdWeightReportUpload — the PM's raw uploaded weight sheet, parsed
//      into per-batch/per-date samples that can be pulled into the Farm
//      Events form via the autofill endpoint.

export interface FeedContextSnapshot {
  windowDays: number;
  totalDispensedKg: number;
  recommendedKg: number | null;
  pctOfRecommended: number | null; // null when recommendedKg is null/0
  entryCount: number;
  note: string;
}

export interface MortalityContextSnapshot {
  windowDays: number;
  totalDeaths: number;
  cumulativePct: number | null;
  standardCeilingPct: number | null;
  overCeiling: boolean;
  note: string;
}

export interface BirdWeightReportRow {
  date: string; // YYYY-MM-DD
  batchCode: string;
  batchId?: string; // resolved server-side once matched to a Batch
  rowCode?: string; // optional cage-map row/deck label
  sampleCount: number;
  individualWeightsG: number[]; // may be empty if the sheet only gave an aggregate
  totalWeightG: number;
  averageWeightG: number;
  matched: boolean; // whether batchCode resolved to a real Batch
}

export interface BirdWeightReportPreview {
  uploadId: string;
  fileName: string;
  rows: BirdWeightReportRow[];
  unmatchedBatchCodes: string[];
}

export interface WeightAutofillResult {
  found: boolean;
  sampleCount?: number;
  individualWeightsG?: number[];
  totalWeightG?: number;
  averageWeightG?: number;
  sourceUploadId?: string;
  reportDate?: string;
}
