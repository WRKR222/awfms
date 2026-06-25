-- ============================================================================
-- Migration: Brooder weight sample location (row + level)
-- ----------------------------------------------------------------------------
-- Allows a bird weight sample to be tied to a specific occupied brooder
-- row + level (cage map), not just the batch in general. This lets weight
-- be logged from any occupied row/level and compared against the HyLine
-- weekly min/max band for that exact location.
-- All DDL is idempotent (IF NOT EXISTS).
-- ============================================================================

ALTER TABLE "bird_weight_samples"
  ADD COLUMN IF NOT EXISTS "row_id"   TEXT,
  ADD COLUMN IF NOT EXISTS "level_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "bird_weight_samples"
    ADD CONSTRAINT "bird_weight_samples_row_id_fkey"
    FOREIGN KEY ("row_id") REFERENCES "brooder_rows"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "bird_weight_samples"
    ADD CONSTRAINT "bird_weight_samples_level_id_fkey"
    FOREIGN KEY ("level_id") REFERENCES "brooder_levels"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "bird_weight_samples_level_id_sample_date_idx"
  ON "bird_weight_samples" ("level_id", "sample_date");
