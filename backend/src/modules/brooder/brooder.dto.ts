// src/modules/brooder/brooder.dto.ts
import { z } from 'zod';

// ── Cage assignment (place / move a batch's chicks onto a row+level+cage) ──
// Population, mortality, reassignment, and weighing are now tracked at the
// individual-cage level. The parent BrooderLevel's aggregate assignment is
// maintained automatically by the service as the sum of its cages.
export const AssignCageSchema = z.object({
  batchId:      z.string().uuid(),
  birdCount:    z.number().int().min(0),
  placedDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes:        z.string().max(500).optional(),
  /** UUID of the cage birds are being moved FROM. When provided the service
   *  decrements that cage's (and its level's) birdCount by the same amount.
   *  Required on all reassignments; optional only for a fresh placement
   *  into an empty cage. */
  sourceCageId: z.string().uuid().optional(),
});
export type AssignCageDto = z.infer<typeof AssignCageSchema>;

// Retained only for reading historical/legacy level-level assignment rows
// created before the per-cage migration; no longer accepted for writes.
export const AssignLevelSchema = AssignCageSchema;
export type AssignLevelDto = AssignCageDto;

// ── Whole-level placement, split equally across the level's cages ────────
// birdCount here is the LEVEL total (not per-cage) — the service divides it
// evenly across every cage on the level (remainder going to the first N
// cages), so a Lead Attendant can place e.g. 1,200 birds on a level without
// typing a count into 44 individual cages one at a time.
export const AssignLevelEquallySchema = z.object({
  batchId:    z.string().uuid(),
  birdCount:  z.number().int().min(1),
  placedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes:      z.string().max(500).optional(),
});
export type AssignLevelEquallyDto = z.infer<typeof AssignLevelEquallySchema>;

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
//
// Two modes:
//   1. Normal issuance: feedType + quantityDispensedKg provided.
//      The schedule (HyLine ration) is shown as a reference only — no
//      hard cap is enforced.  The attendant may issue any amount; the
//      system tracks variance for the store issuance plan and residual
//      carry-forward calculation.
//
//   2. No-feed-issued entry: noFeedIssued = true + noFeedIssuedReason.
//      Records that the attendant checked and deliberately issued nothing
//      because birds are still consuming feed placed on an earlier day.
//      Stores the date of the original dispensing so the system can
//      calculate how many days the carry-forward feed has been consumed.
//      quantityDispensedKg is 0 in this case.
//
export const CreateLevelFeedLogSchema = z.discriminatedUnion('noFeedIssued', [
  // ── Mode 1: feed was dispensed ──────────────────────────────────────
  z.object({
    noFeedIssued:         z.literal(false).default(false),
    levelId:              z.string().uuid(),
    feedType:             z.enum(['CHICK_MASH', 'GROWER_MASH', 'LAYER_MASH']),
    storeItemId:          z.string().uuid().optional(),
    entryDate:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    quantityDispensedKg:  z.number().positive().max(5000),
    notes:                z.string().max(500).optional(),
  }),
  // ── Mode 2: no feed issued (carry-forward from an earlier day) ──────
  z.object({
    noFeedIssued:         z.literal(true),
    levelId:              z.string().uuid(),
    feedType:             z.enum(['CHICK_MASH', 'GROWER_MASH', 'LAYER_MASH']),
    storeItemId:          z.string().uuid().optional(),
    entryDate:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    quantityDispensedKg:  z.literal(0).default(0),
    /** ISO date string of the dispensing day whose feed is still in the trough. */
    carryFromDate:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notes:                z.string().max(500).optional(),
  }),
]);
export type CreateLevelFeedLogDto = z.infer<typeof CreateLevelFeedLogSchema>;

// ── Per-cage mortality log (mortality/reassignment/weighing now tracked
//    per cage — see AGENTS.md / brooder cage-map notes) ────────────────────
// Records mortality AND/OR culling for a specific row+level+cage.
// Service will validate that mortalityCount + cullingCount > 0.
export const CreateLevelMortalityLogSchema = z.object({
  levelId:        z.string().uuid(),
  cageId:         z.string().uuid(),
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

// ── General (batch-wide) population feed log ──────────────────────────────
// Used when the Lead Attendant cannot break feed down by individual
// row/level — records against the whole batch instead. The server refuses
// to save this if row/level-specific feed has already been logged for the
// same batch + date (see BrooderService.assertNoLevelSpecificFeedLog),
// so totals are never double-counted.
export const CreateGeneralFeedLogSchema = z.object({
  batchId:             z.string().uuid(),
  feedType:            z.enum([
    'CHICK_MASH', 'GROWER_MASH', 'LAYER_MASH',
    'KIENYEJI_STARTER', 'KIENYEJI_GROWER', 'KIENYEJI_FINISHER',
  ]),
  storeItemId:         z.string().uuid().optional(),
  entryDate:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  quantityDispensedKg: z.number().positive().max(20000),
  notes:               z.string().max(500).optional(),
});
export type CreateGeneralFeedLogDto = z.infer<typeof CreateGeneralFeedLogSchema>;

// ── General (batch-wide) population mortality log ─────────────────────────
// Same escape hatch as above, for mortality/culling. Mutually exclusive
// with row/level mortality logs for the same batch + date.
export const CreateGeneralMortalityLogSchema = z.object({
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
export type CreateGeneralMortalityLogDto = z.infer<typeof CreateGeneralMortalityLogSchema>;

// ── Bird weight sample (checked against HyLine control standard) ──────────
// Preferred: pass cageId — the service derives batchId + rowId + levelId
// from the cage's active assignment, so weight can be logged from any
// occupied row/level/cage on the cage map. levelId (level-only, legacy) and
// batchId alone are still accepted for backward compatibility.
export const CreateBrooderWeightSampleSchema = z.object({
  cageId:        z.string().uuid().optional(),
  levelId:       z.string().uuid().optional(),
  batchId:       z.string().uuid().optional(),
  sampleDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sampleCount:   z.number().int().min(1),
  totalWeightG:  z.number().int().min(1),
  notes:         z.string().max(500).optional(),
}).refine(
  d => !!d.cageId || !!d.levelId || !!d.batchId,
  { message: 'One of cageId (an occupied cage), levelId (an occupied row/level), or batchId is required' },
);
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
