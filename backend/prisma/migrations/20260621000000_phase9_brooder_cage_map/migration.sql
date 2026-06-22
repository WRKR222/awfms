-- Migration: phase9_brooder_cage_map
-- Adds a fixed 6-row x 4-level brooder cage map so every chick can be
-- accounted for from the brooder through to the production house, plus
-- per-row heat source tracking (charcoal qty or heat-bulb on/off timer)
-- and per-level feed logging against the required-feed standard.

-- 1. New enum for brooder heat source type
DO $$ BEGIN
  CREATE TYPE "HeatSourceType" AS ENUM ('CHARCOAL', 'HEAT_BULB');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. brooder_rows — the 6 fixed rows/decks
CREATE TABLE IF NOT EXISTS "brooder_rows" (
  "id"         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "row_number" INTEGER NOT NULL UNIQUE,
  "label"      TEXT NOT NULL,
  "is_active"  BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP NOT NULL DEFAULT now()
);

-- 3. brooder_levels — 4 fixed levels (bottom..top) per row
CREATE TABLE IF NOT EXISTS "brooder_levels" (
  "id"           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "row_id"       TEXT NOT NULL REFERENCES "brooder_rows"("id") ON DELETE CASCADE,
  "level_number" INTEGER NOT NULL,
  "label"        TEXT NOT NULL,
  "is_active"    BOOLEAN NOT NULL DEFAULT true,
  "created_at"   TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "brooder_levels_row_id_level_number_key" UNIQUE ("row_id", "level_number")
);

-- 4. brooder_level_assignments — which batch (and how many chicks) sits on a level
CREATE TABLE IF NOT EXISTS "brooder_level_assignments" (
  "id"             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "level_id"       TEXT NOT NULL UNIQUE REFERENCES "brooder_levels"("id") ON DELETE CASCADE,
  "batch_id"       TEXT NOT NULL REFERENCES "batches"("id"),
  "bird_count"     INTEGER NOT NULL DEFAULT 0,
  "placed_date"    DATE NOT NULL,
  "notes"          TEXT,
  "assigned_by_id" TEXT NOT NULL REFERENCES "users"("id"),
  "created_at"     TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "brooder_level_assignments_batch_id_idx" ON "brooder_level_assignments"("batch_id");

-- 5. brooder_heat_logs — charcoal qty or heat-bulb timer, per row per day
CREATE TABLE IF NOT EXISTS "brooder_heat_logs" (
  "id"              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "row_id"          TEXT NOT NULL REFERENCES "brooder_rows"("id") ON DELETE CASCADE,
  "log_date"        DATE NOT NULL,
  "source_type"     "HeatSourceType" NOT NULL,
  "charcoal_kg"     DOUBLE PRECISION,
  "bulb_started_at" TIMESTAMP,
  "bulb_stopped_at" TIMESTAMP,
  "bulb_minutes_on" INTEGER,
  "bulb_count"      INTEGER,
  "notes"           TEXT,
  "logged_by_id"    TEXT NOT NULL REFERENCES "users"("id"),
  "created_at"      TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "brooder_heat_logs_row_id_log_date_idx" ON "brooder_heat_logs"("row_id", "log_date");
CREATE INDEX IF NOT EXISTS "brooder_heat_logs_source_type_idx" ON "brooder_heat_logs"("source_type");

-- 6. brooder_level_feed_logs — feed dispensed per level vs required standard
CREATE TABLE IF NOT EXISTS "brooder_level_feed_logs" (
  "id"                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "level_id"              TEXT NOT NULL REFERENCES "brooder_levels"("id") ON DELETE CASCADE,
  "feed_type"             TEXT NOT NULL,
  "entry_date"            DATE NOT NULL,
  "quantity_dispensed_kg" DOUBLE PRECISION NOT NULL,
  "required_kg_for_week"  DOUBLE PRECISION,
  "notes"                 TEXT,
  "logged_by_id"          TEXT NOT NULL REFERENCES "users"("id"),
  "created_at"            TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "brooder_level_feed_logs_level_id_entry_date_idx" ON "brooder_level_feed_logs"("level_id", "entry_date");

-- 7. Pinpoint columns on brooder_logs — optional row/level reference so an
--    entry can describe one cell instead of the whole batch. Nullable;
--    existing rows are unaffected.
ALTER TABLE "brooder_logs"
  ADD COLUMN IF NOT EXISTS "row_id"   TEXT REFERENCES "brooder_rows"("id"),
  ADD COLUMN IF NOT EXISTS "level_id" TEXT REFERENCES "brooder_levels"("id");

CREATE INDEX IF NOT EXISTS "brooder_logs_row_id_idx"   ON "brooder_logs"("row_id");
CREATE INDEX IF NOT EXISTS "brooder_logs_level_id_idx" ON "brooder_logs"("level_id");

-- 8. Seed the fixed 6 rows x 4 levels grid (idempotent)
INSERT INTO "brooder_rows" ("id", "row_number", "label")
SELECT gen_random_uuid()::text, n, 'Row ' || n
FROM generate_series(1, 6) AS n
WHERE NOT EXISTS (SELECT 1 FROM "brooder_rows" WHERE "row_number" = n);

INSERT INTO "brooder_levels" ("id", "row_id", "level_number", "label")
SELECT gen_random_uuid()::text, r."id", lvl,
  CASE lvl
    WHEN 1 THEN 'Level 1 (Bottom)'
    WHEN 4 THEN 'Level 4 (Top)'
    ELSE 'Level ' || lvl
  END
FROM "brooder_rows" r
CROSS JOIN generate_series(1, 4) AS lvl
WHERE NOT EXISTS (
  SELECT 1 FROM "brooder_levels" bl WHERE bl."row_id" = r."id" AND bl."level_number" = lvl
);
