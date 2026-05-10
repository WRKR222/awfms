-- Migration: 20260510000000_oo_fixes
-- NOTE: SOLD/DISCARDED BatchStage values, sold_at, and discarded_at are handled
--       by the 20260511000000_phase8_batch_lifecycle_fields migration.
--       This migration only adds bird_count to batch_cage_assignments,
--       which tracks how many birds are assigned to each production-house row.

ALTER TABLE "batch_cage_assignments"
  ADD COLUMN IF NOT EXISTS "bird_count" INTEGER NOT NULL DEFAULT 0;
