import { z } from 'zod';

export const CreateFeedEntrySchema = z.object({
  batchId: z.string().uuid(),
  houseId: z.string().uuid(),
  logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  feedType: z.enum(['CHICK_MASH', 'GROWER_MASH', 'LAYER_MASH']),
  quantityDispensedKg: z.number().positive().max(5000),
  feedingTime: z.enum(['MORNING', 'AFTERNOON']),
  wastageKg: z.number().min(0).max(5000).default(0),
  wastageObserved: z.boolean().default(false),
}).refine(
  data => {
    const entry = new Date(data.logDate);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    return entry <= today;
  },
  { message: 'Log date cannot be in the future', path: ['logDate'] },
).refine(
  data => data.wastageKg <= data.quantityDispensedKg,
  { message: 'Wastage cannot exceed quantity dispensed', path: ['wastageKg'] },
);
export type CreateFeedEntryDto = z.infer<typeof CreateFeedEntrySchema>;

export const ReturnFeedEntrySchema = z.object({
  rejectionNote: z.string().min(1).max(500),
});
export type ReturnFeedEntryDto = z.infer<typeof ReturnFeedEntrySchema>;

export const CreateFeedDeliverySchema = z.object({
  supplierId: z.string().uuid(),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  feedType: z.enum(['CHICK_MASH', 'GROWER_MASH', 'LAYER_MASH']),
  quantityKg: z.number().positive().max(100000),
  lpoReference: z.string().max(50).optional(),
  costKes: z.number().positive(),
});
export type CreateFeedDeliveryDto = z.infer<typeof CreateFeedDeliverySchema>;
