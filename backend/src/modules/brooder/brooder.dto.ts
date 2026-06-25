// src/modules/brooder/brooder.dto.ts
import { z } from 'zod';

// ── Level assignment (place / move a batch's chicks onto a row+level) ──────
export const AssignLevelSchema = z.object({
  batchId:     z.string().uuid(),
  birdCount:   z.number().int().min(0),
  placedDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes:       z.string().max(500).optional(),
});
export type AssignLevelDto = z.infer<typeof AssignLevelSchema>;

// ── Heat logs ────────────────────────────────────────────────────────────
export const CreateCharcoalHeatLogSchema = z.object({
  rowId:       z.string().uuid(),
  logDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceType:  z.literal('CHARCOAL'),
  charcoalKg:  z.number().positive().max(500),
  notes:       z.string().max(500).optional(),
});

export const StartBulbHeatLogSchema = z.object({
  rowId:       z.string().uuid(),
  logDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceType:  z.literal('HEAT_BULB'),
  bulbCount:   z.number().int().min(1).max(50).default(1),
  notes:       z.string().max(500).optional(),
});

export const CreateHeatLogSchema = z.discriminatedUnion('sourceType', [
  CreateCharcoalHeatLogSchema,
  StartBulbHeatLogSchema,
]);
export type CreateHeatLogDto = z.infer<typeof CreateHeatLogSchema>;

export const StopBulbHeatLogSchema = z.object({
  notes: z.string().max(500).optional(),
});
export type StopBulbHeatLogDto = z.infer<typeof StopBulbHeatLogSchema>;

// ── Per-level feed logs ──────────────────────────────────────────────────
export const CreateLevelFeedLogSchema = z.object({
  levelId:              z.string().uuid(),
  feedType:             z.enum(['CHICK_MASH', 'GROWER_MASH', 'LAYER_MASH']),
  entryDate:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  quantityDispensedKg:  z.number().positive().max(2000),
  notes:                z.string().max(500).optional(),
});
export type CreateLevelFeedLogDto = z.infer<typeof CreateLevelFeedLogSchema>;

// ── Per-level mortality log (new — req 1) ─────────────────────────────────
// Records mortality AND/OR culling for a specific row+level.
// Service will validate that mortalityCount + cullingCount > 0.
export const CreateLevelMortalityLogSchema = z.object({
  levelId:        z.string().uuid(),
  batchId:        z.string().uuid(),
  logDate:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mortalityCount: z.number().int().min(0).default(0),
  cullingCount:   z.number().int().min(0).default(0),
  cause: z.enum([
    'DISEASE', 'INJURY', 'HEAT_STRESS', 'PREDATOR',
    'CULLED_SICK', 'CULLED_LOW_PRODUCTIVITY', 'CULLED_OVERPOPULATION', 'UNKNOWN',
  ]).optional(),
  notes: z.string().max(500).optional(),
}).refine(
  d => d.mortalityCount + d.cullingCount > 0,
  { message: 'At least one of mortalityCount or cullingCount must be > 0' },
);
export type CreateLevelMortalityLogDto = z.infer<typeof CreateLevelMortalityLogSchema>;

// ── Bird weight sample (checked against HyLine control standard) ──────────
export const CreateBrooderWeightSampleSchema = z.object({
  batchId:       z.string().uuid(),
  sampleDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sampleCount:   z.number().int().min(1),
  totalWeightG:  z.number().int().min(1),
  notes:         z.string().max(500).optional(),
});
export type CreateBrooderWeightSampleDto = z.infer<typeof CreateBrooderWeightSampleSchema>;

// ── Control standard query ────────────────────────────────────────────────
export const ControlStandardQuerySchema = z.object({
  week: z.coerce.number().int().min(1).max(19).optional(),
});

// ── Brooder daily log — two distinct entry types ──────────────────────────
//
// SESSION LOG  (temperature / humidity / light_intensity)
//   • Must include a logSession: MORNING | MIDDAY | EVENING
//   • Recorded up to 3× per day (one per session)
//   • Uniqueness enforced: (batchId, logDate, logSession)
//
// ONCE-DAILY LOG  (water consumption / vaccine / supplement / notes)
//   • logSession must be omitted or null
//   • Recorded only once per calendar day
//   • Uniqueness enforced: (batchId, logDate) WHERE log_session IS NULL
// ─────────────────────────────────────────────────────────────────────────

const BrooderLogSession = z.enum(['MORNING', 'MIDDAY', 'EVENING']);

// Session log: environmental readings recorded 3× per day
export const CreateBrooderSessionLogSchema = z.object({
  batchId:           z.string().uuid(),
  logDate:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  logSession:        BrooderLogSession,            // required for session logs
  temperature:       z.number().min(-10).max(60).optional(),
  humidityPercent:   z.number().min(0).max(100).optional(),
  lightIntensityLux: z.number().int().min(0).max(100_000).optional(),
  lightingOk:        z.boolean().default(true),
  rowId:             z.string().uuid().optional(),
  levelId:           z.string().uuid().optional(),
  notes:             z.string().max(500).optional(),
}).refine(
  d => d.temperature != null || d.humidityPercent != null || d.lightIntensityLux != null,
  { message: 'At least one of temperature, humidityPercent, or lightIntensityLux is required for a session log' },
);
export type CreateBrooderSessionLogDto = z.infer<typeof CreateBrooderSessionLogSchema>;

// Once-daily log: water, vaccine, supplement — no session tag
export const CreateBrooderDailyEntrySchema = z.object({
  batchId:           z.string().uuid(),
  logDate:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  logSession:        z.null().optional(),         // must NOT be set for daily entries
  waterConsumptionL: z.number().min(0).max(50_000).optional(),
  vaccineGiven:      z.string().max(200).optional(),
  vaccineDose:       z.string().max(200).optional(),
  vaccineRoute:      z.string().max(100).optional(),
  supplement:        z.string().max(200).optional(),
  supplementDose:    z.string().max(200).optional(),
  rowId:             z.string().uuid().optional(),
  levelId:           z.string().uuid().optional(),
  notes:             z.string().max(500).optional(),
}).refine(
  d => (d.waterConsumptionL != null)
    || (d.vaccineGiven && d.vaccineGiven.trim().length > 0)
    || (d.supplement   && d.supplement.trim().length  > 0),
  { message: 'At least one of waterConsumptionL, vaccineGiven, or supplement is required for a daily entry' },
);
export type CreateBrooderDailyEntryDto = z.infer<typeof CreateBrooderDailyEntrySchema>;
