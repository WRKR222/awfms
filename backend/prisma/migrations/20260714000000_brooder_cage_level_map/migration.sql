-- Migration: brooder_cage_level_map
-- Adds individual physical cages under each brooder row+level, and makes
-- population, mortality/culling, reassignment, and weighing recordable
-- per cage instead of per level.
--
-- Row 1, 2, 4, 5 have 44 cages per level; Rows 3 and 6 have 42 cages per level
-- (physical constraint of that deck). Cage counts are seeded below and also
-- mirrored in prisma/seed.ts for `prisma db seed` / local resets.
--
-- BrooderLevelAssignment (population) and BrooderLevelMortalityLog (deaths/
-- cullings) are KEPT as level-level rollups so the existing feed-schedule
-- and dashboard code (which reads at level granularity) is unaffected —
-- the application service now maintains them as the sum of their cages'
-- figures on every cage-level write, instead of being written directly.

-- 1. brooder_cages — physical cages within a level
CREATE TABLE IF NOT EXISTS "brooder_cages" (
  "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "level_id"    TEXT NOT NULL REFERENCES "brooder_levels"("id") ON DELETE CASCADE,
  "cage_number" INTEGER NOT NULL,
  "label"       TEXT NOT NULL,
  "is_active"   BOOLEAN NOT NULL DEFAULT true,
  "created_at"  TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "brooder_cages_level_id_cage_number_key" UNIQUE ("level_id", "cage_number")
);
CREATE INDEX IF NOT EXISTS "brooder_cages_level_id_idx" ON "brooder_cages"("level_id");

-- 2. brooder_cage_assignments — which batch (and how many chicks) sits in a cage
CREATE TABLE IF NOT EXISTS "brooder_cage_assignments" (
  "id"             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "cage_id"        TEXT NOT NULL UNIQUE REFERENCES "brooder_cages"("id") ON DELETE CASCADE,
  "batch_id"       TEXT NOT NULL REFERENCES "batches"("id"),
  "bird_count"     INTEGER NOT NULL DEFAULT 0,
  "placed_date"    DATE NOT NULL,
  "notes"          TEXT,
  "assigned_by_id" TEXT NOT NULL REFERENCES "users"("id"),
  "created_at"     TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "brooder_cage_assignments_batch_id_idx" ON "brooder_cage_assignments"("batch_id");

-- 3. Add cage_id to the existing per-level mortality log
ALTER TABLE "brooder_level_mortality_logs"
  ADD COLUMN IF NOT EXISTS "cage_id" TEXT REFERENCES "brooder_cages"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "brooder_level_mortality_logs_cage_id_log_date_idx"
  ON "brooder_level_mortality_logs"("cage_id", "log_date");

-- 4. Add cage_id to the existing weight sample table
ALTER TABLE "bird_weight_samples"
  ADD COLUMN IF NOT EXISTS "cage_id" TEXT REFERENCES "brooder_cages"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "bird_weight_samples_cage_id_sample_date_idx"
  ON "bird_weight_samples"("cage_id", "sample_date");

-- 5. Seed the fixed cage grid for every existing row + level.
--    Rows 3 and 6 = 42 cages/level; every other row = 44 cages/level.
DO $$
DECLARE
  lvl RECORD;
  cage_count INTEGER;
  i INTEGER;
BEGIN
  FOR lvl IN
    SELECT bl.id AS level_id, bl.level_number, br.row_number, br.label AS row_label
    FROM "brooder_levels" bl
    JOIN "brooder_rows" br ON br.id = bl.row_id
  LOOP
    cage_count := CASE WHEN lvl.row_number IN (3, 6) THEN 42 ELSE 44 END;
    FOR i IN 1..cage_count LOOP
      INSERT INTO "brooder_cages" ("level_id", "cage_number", "label")
      VALUES (
        lvl.level_id,
        i,
        lvl.row_label || ' · Level ' || lvl.level_number || ' · Cage ' || lpad(i::text, 2, '0')
      )
      ON CONFLICT ("level_id", "cage_number") DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

-- 6. Data backfill: for every level that currently has an ACTIVE population
--    (an existing brooder_level_assignments row for THIS batch only), split
--    its bird_count evenly across that level's cages, remainder (if any)
--    going to the first N cages in cage_number order. This applies only to
--    whatever batch is already on the map today — batches assigned from now
--    on go straight to a specific row+level+cage via the application.
DO $$
DECLARE
  a RECORD;
  cage_ids TEXT[];
  n_cages INTEGER;
  base_count INTEGER;
  remainder INTEGER;
  idx INTEGER;
BEGIN
  FOR a IN
    SELECT level_id, batch_id, bird_count, placed_date, notes, assigned_by_id
    FROM "brooder_level_assignments"
  LOOP
    SELECT array_agg(id ORDER BY cage_number) INTO cage_ids
    FROM "brooder_cages" WHERE level_id = a.level_id;

    n_cages := COALESCE(array_length(cage_ids, 1), 0);
    IF n_cages = 0 OR a.bird_count <= 0 THEN
      CONTINUE;
    END IF;

    base_count := a.bird_count / n_cages;
    remainder  := a.bird_count % n_cages;

    FOR idx IN 1..n_cages LOOP
      INSERT INTO "brooder_cage_assignments"
        ("cage_id", "batch_id", "bird_count", "placed_date", "notes", "assigned_by_id")
      VALUES (
        cage_ids[idx],
        a.batch_id,
        base_count + CASE WHEN idx <= remainder THEN 1 ELSE 0 END,
        a.placed_date,
        'Auto-split evenly across cages from existing level population (migration backfill).',
        a.assigned_by_id
      )
      ON CONFLICT ("cage_id") DO NOTHING;
    END LOOP;
  END LOOP;
END $$;
