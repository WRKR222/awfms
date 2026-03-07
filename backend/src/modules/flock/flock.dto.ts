import { z } from 'zod';

// ── Batch ─────────────────────────────────────────────────────────────────────
export const CreateBatchSchema = z.object({
  batchCode: z.string().min(1).max(20).regex(/^[A-Z0-9\-]+$/, 'Batch code must be uppercase alphanumeric'),
  houseId: z.string().uuid(),
  supplierId: z.string().uuid(),
  breed: z.string().min(1).max(80),
  batchType: z.enum(['LAYERS', 'KIENYEJI', 'BROILER']),
  quantityReceived: z.number().int().positive().max(50000),
  hatchDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  intakeDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  vaccinationStatusOnArrival: z.string().max(500).optional(),
  mortalityOnArrival: z.number().int().min(0).default(0),
  transportConditions: z.string().max(500).optional(),
});
export type CreateBatchDto = z.infer<typeof CreateBatchSchema>;

export const UpdateBatchStageSchema = z.object({
  stage: z.enum(['BROODING', 'GROWER', 'PRODUCTION']),
});
export type UpdateBatchStageDto = z.infer<typeof UpdateBatchStageSchema>;

// ── Flock Daily Entry ─────────────────────────────────────────────────────────
export const CreateFlockEntrySchema = z.object({
  batchId: z.string().uuid(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format'),
  deaths: z.number().int().min(0),
  culls: z.number().int().min(0),
  deathCause: z.string().max(80).optional(),
  notes: z.string().max(500).optional(),
}).refine(
  data => {
    // Entry date cannot be in the future
    const entry = new Date(data.entryDate);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    return entry <= today;
  },
  { message: 'Entry date cannot be in the future', path: ['entryDate'] },
);
export type CreateFlockEntryDto = z.infer<typeof CreateFlockEntrySchema>;

export const VerifyEntrySchema = z.object({
  notes: z.string().max(500).optional(),
});
export type VerifyEntryDto = z.infer<typeof VerifyEntrySchema>;

export const ReturnEntrySchema = z.object({
  rejectionNote: z.string().min(1, 'Please explain what needs to be corrected').max(500),
});
export type ReturnEntryDto = z.infer<typeof ReturnEntrySchema>;

// ── Bird Weight Sample ────────────────────────────────────────────────────────
export const CreateWeightSampleSchema = z.object({
  batchId: z.string().uuid(),
  sampleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weightsKg: z.array(z.number().positive().max(10)).min(1).max(100),
  sampleSize: z.number().int().positive(),
}).refine(
  data => data.weightsKg.length === data.sampleSize,
  { message: 'Number of weights provided must equal sampleSize', path: ['weightsKg'] },
);
export type CreateWeightSampleDto = z.infer<typeof CreateWeightSampleSchema>;

// ── Query params ──────────────────────────────────────────────────────────────
export const BatchQuerySchema = z.object({
  stage: z.enum(['BROODING', 'GROWER', 'PRODUCTION', 'CLOSED']).optional(),
  houseId: z.string().uuid().optional(),
  includeArchived: z.coerce.boolean().default(false),
});
export type BatchQueryDto = z.infer<typeof BatchQuerySchema>;
