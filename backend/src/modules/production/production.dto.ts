// src/modules/production/production.dto.ts
//
// Lead Attendant egg-collection submission shape.
// Aligned with frontend EggCollectionPage and Anza Whole Foods System Summary:
//   • rowData now records a single unclassified `broken` count plus a
//     `damaged` count (replaces the old brokenUnsellable / brokenSellable
//     split — that sellable/unsellable classification happens later, at
//     three-party tally sign-off, entered by Sales) and includes starterEggs.
//   • Session-level: feedStoreItemId + feedKg (feed is now drawn against a
//     Store-issued item, same residual-ledger gating as the brooder module;
//     feedKg allows any number of decimal places), waterLiters + houseTempC,
//     optional vaccines/supplements list (each also store-item-linked).
import { z } from 'zod';

const RowDataEntrySchema = z.object({
  rowCode: z.string().min(1),                  // e.g. "A1", "B2", "C1"
  totalBirds: z.number().int().min(0),
  totalEggs: z.number().int().min(0),
  starterEggs: z.number().int().min(0).default(0),
  broken:  z.number().int().min(0).default(0), // unclassified broken eggs — Sales splits sellable/unsellable at tally sign-off
  damaged: z.number().int().min(0).default(0), // e.g. dented/stained but not broken
  softShell: z.number().int().min(0).default(0),
  deformed:  z.number().int().min(0).default(0),
  weightKg:  z.number().min(0).default(0),
  attendantName: z.string().default(''),
});

const SessionFeedSchema = z.object({
  feedKg: z.number().positive('Feed kg must be greater than zero'),
  feedStoreItemId: z.string().uuid('Feed type (store item) is required'),
});

const EnvironmentSchema = z.object({
  waterLiters: z.number().positive('Water consumption (litres) is required'),
  houseTempC:  z.number().positive('House temperature (°C) is required'),
});

const VaccineGivenSchema = z.object({
  kind: z.enum(['VACCINE', 'SUPPLEMENT']),
  storeItemId: z.string().uuid('Vaccine/supplement must be selected from issued store items'),
  name: z.string().min(1),
  dosage: z.string().min(1),
  quantityUsed: z.number().positive().optional(), // allows any number of decimal places
});

export const CreateEggCollectionSessionSchema = z.object({
  batchId: z.string().uuid(),
  houseId: z.string().uuid(),
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shift: z.enum(['AM', 'PM']),
  block: z.enum(['BLOCK1']).default('BLOCK1'),       // BLOCK2 disabled (under construction)
  openingPop: z.number().int().min(0),
  mortalities: z.number().int().min(0),
  rowData: z.array(RowDataEntrySchema).min(1),
  sessionFeed: SessionFeedSchema,                    // required — bundled w/ submission
  environment: EnvironmentSchema,                    // required — bundled w/ submission
  vaccinesGiven: z.array(VaccineGivenSchema).default([]),
  remarks: z.string().optional(),
});
export type CreateEggCollectionSessionDto = z.infer<typeof CreateEggCollectionSessionSchema>;

// ── Legacy production-entry DTO retained for migration parity with old clients ──
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
    const gradeSum = data.gradeXl + data.gradeL + data.gradeM + data.gradeS + data.gradeReject;
    return gradeSum === data.totalWhole || gradeSum === 0;
  },
  { message: 'Grade totals must sum to total whole eggs', path: ['gradeXl'] },
);
export type CreateProductionEntryDto = z.infer<typeof CreateProductionEntrySchema>;

export const ReturnProductionEntrySchema = z.object({
  rejectionNote: z.string().min(1).max(500),
});
export type ReturnProductionEntryDto = z.infer<typeof ReturnProductionEntrySchema>;
