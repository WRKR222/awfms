-- Migration: add_sold_discarded_batch_states
-- Created: 2026-05-10
-- Adds: SOLD/DISCARDED to BatchStage enum, soldAt/discardedAt to Batch,
--       birdCount to BatchCageAssignment

-- 1. Add new enum values to batch_stage
ALTER TYPE "batch_stage" ADD VALUE IF NOT EXISTS 'SOLD';
ALTER TYPE "batch_stage" ADD VALUE IF NOT EXISTS 'DISCARDED';

-- 2. Add sold_at and discarded_at timestamps to batches
ALTER TABLE "batches"
  ADD COLUMN IF NOT EXISTS "sold_at"      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "discarded_at" TIMESTAMPTZ;

-- 3. Backfill: if isActive=false and there's a BATCH_SOLD HealthEvent, set stage=SOLD + soldAt
UPDATE "batches" b
SET stage = 'SOLD',
    sold_at = he."event_date"
FROM "health_events" he
WHERE he."batch_id" = b.id
  AND he."event_type" = 'BATCH_SOLD'
  AND b.is_active = false
  AND b.stage = 'CLOSED';

-- 4. Backfill: if isActive=false and there's a BATCH_DISCARDED HealthEvent, set stage=DISCARDED
UPDATE "batches" b
SET stage = 'DISCARDED',
    discarded_at = he."event_date"
FROM "health_events" he
WHERE he."batch_id" = b.id
  AND he."event_type" = 'BATCH_DISCARDED'
  AND b.is_active = false
  AND b.stage = 'CLOSED';

-- 5. Add bird_count to batch_cage_assignments
ALTER TABLE "batch_cage_assignments"
  ADD COLUMN IF NOT EXISTS "bird_count" INTEGER NOT NULL DEFAULT 0;
