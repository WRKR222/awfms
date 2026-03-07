import { z } from 'zod';

export const CreateProductionEntrySchema = z.object({
  batchId: z.string().uuid(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  collectionTime: z.enum(['AM', 'PM']),
  totalWhole: z.number().int().min(0),
  brokenCracked: z.number().int().min(0).default(0),
  shellless: z.number().int().min(0).default(0),
  deformed: z.number().int().min(0).default(0),
  gradeXl: z.number().int().min(0).default(0),
  gradeL: z.number().int().min(0).default(0),
  gradeM: z.number().int().min(0).default(0),
  gradeS: z.number().int().min(0).default(0),
  gradeReject: z.number().int().min(0).default(0),
}).refine(
  data => {
    const entry = new Date(data.entryDate);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    return entry <= today;
  },
  { message: 'Entry date cannot be in the future', path: ['entryDate'] },
).refine(
  data => {
    // Grade totals must add up to totalWhole
    const gradeSum = data.gradeXl + data.gradeL + data.gradeM + data.gradeS + data.gradeReject;
    return gradeSum === data.totalWhole || gradeSum === 0; // 0 = grades not yet filled
  },
  { message: 'Grade totals must sum to total whole eggs', path: ['gradeXl'] },
);
export type CreateProductionEntryDto = z.infer<typeof CreateProductionEntrySchema>;

export const ReturnProductionEntrySchema = z.object({
  rejectionNote: z.string().min(1).max(500),
});
export type ReturnProductionEntryDto = z.infer<typeof ReturnProductionEntrySchema>;
