-- ============================================================================
-- Migration: BirdWeightSample.sourceUploadId
-- ----------------------------------------------------------------------------
-- schema.prisma declares this column (String? @map("source_upload_id")) but
-- no migration was ever generated for it, so the deployed database never
-- got the column while the generated Prisma client already expects it —
-- causing:
--   PrismaClientKnownRequestError: The column `bird_weight_samples.source_upload_id`
--   does not exist in the current database.
-- on any query selecting BirdWeightSample (e.g. BrooderService.getCageMap,
-- getFeedRequirementSummary). Same drift class as the individual_weights_g
-- column fixed in 20260818090000.
--
-- Nullable, no default needed. Idempotent (IF NOT EXISTS).
-- ============================================================================

ALTER TABLE "bird_weight_samples"
  ADD COLUMN IF NOT EXISTS "source_upload_id" TEXT;
