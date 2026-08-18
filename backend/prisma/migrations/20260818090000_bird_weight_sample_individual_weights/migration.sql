-- ============================================================================
-- Migration: BirdWeightSample.individualWeightsG
-- ----------------------------------------------------------------------------
-- schema.prisma declares this column (Int[] @default([]) @map("individual_weights_g"))
-- but no migration was ever generated for it, so the deployed database never
-- got the column while the generated Prisma client already expects it —
-- causing:
--   PrismaClientKnownRequestError: The column `bird_weight_samples.individual_weights_g`
--   does not exist in the current database.
-- on any query selecting BirdWeightSample (e.g. BrooderService.getCageMap).
--
-- Backfills the column as an empty array default for all existing rows
-- (legacy/manual samples that only ever carried the aggregate totalWeightG),
-- matching the Prisma field's @default([]). Idempotent (IF NOT EXISTS).
-- ============================================================================

ALTER TABLE "bird_weight_samples"
  ADD COLUMN IF NOT EXISTS "individual_weights_g" INTEGER[] NOT NULL DEFAULT '{}';
