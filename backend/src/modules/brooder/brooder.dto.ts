// src/modules/brooder/brooder.dto.ts
import { z } from 'zod';

// ── Level assignment (place / move a batch's chicks onto a row+level) ──────
export const AssignLevelSchema = z.object({
  batchId: z.string().uuid(),
  birdCount: z.number().int().min(0),
  placedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(500).optional(),
});
export type AssignLevelDto = z.infer<typeof AssignLevelSchema>;

// ── Heat logs ────────────────────────────────────────────────────────────
export const CreateCharcoalHeatLogSchema = z.object({
  rowId: z.string().uuid(),
  logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceType: z.literal('CHARCOAL'),
  charcoalKg: z.number().positive().max(500),
  notes: z.string().max(500).optional(),
});

export const StartBulbHeatLogSchema = z.object({
  rowId: z.string().uuid(),
  logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceType: z.literal('HEAT_BULB'),
  bulbCount: z.number().int().min(1).max(50).default(1),
  notes: z.string().max(500).optional(),
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
  levelId: z.string().uuid(),
  feedType: z.enum(['CHICK_MASH', 'GROWER_MASH', 'LAYER_MASH']),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  quantityDispensedKg: z.number().positive().max(2000),
  notes: z.string().max(500).optional(),
});
export type CreateLevelFeedLogDto = z.infer<typeof CreateLevelFeedLogSchema>;
