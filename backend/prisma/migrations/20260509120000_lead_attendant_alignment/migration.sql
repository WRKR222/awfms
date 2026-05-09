-- Migration: lead_attendant_alignment
-- Aligns the egg_collection_sessions table with the Lead Attendant flow
-- described in changes.pdf and the Anza Whole Foods Management System Summary.
--
-- Changes:
--   • Renames per-row counters via JSON convention (no column rename for rowData)
--   • Adds rolled-up totals for starter eggs, broken-unsellable, broken-sellable
--   • Adds session-bundled feed (kg + type), environmental (water L, temp °C)
--     and vaccines/supplements JSON
--   • Adds block column (defaults to BLOCK1; BLOCK2 is under construction)

ALTER TABLE "egg_collection_sessions"
  ADD COLUMN IF NOT EXISTS "block" TEXT NOT NULL DEFAULT 'BLOCK1',
  ADD COLUMN IF NOT EXISTS "total_starter_eggs"      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "total_broken_unsellable" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "total_broken_sellable"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "feed_kg"         DECIMAL(8, 2),
  ADD COLUMN IF NOT EXISTS "feed_type_name"  TEXT,
  ADD COLUMN IF NOT EXISTS "water_liters"    DECIMAL(8, 2),
  ADD COLUMN IF NOT EXISTS "house_temp_c"    DECIMAL(5, 2),
  ADD COLUMN IF NOT EXISTS "vaccines_given"  JSONB;

-- Backfill rolled-up totals from existing rowData using the legacy field names.
-- (Old rows used emptyBroken / fullBroken; treat them as unsellable / sellable.)
UPDATE "egg_collection_sessions" s
SET    "total_broken_unsellable" = COALESCE((
         SELECT SUM( (elem->>'emptyBroken')::int )
         FROM   jsonb_array_elements(s."row_data") elem
       ), 0),
       "total_broken_sellable"   = COALESCE((
         SELECT SUM( (elem->>'fullBroken')::int )
         FROM   jsonb_array_elements(s."row_data") elem
       ), 0)
WHERE  s."row_data" IS NOT NULL
  AND  jsonb_typeof(s."row_data") = 'array';
