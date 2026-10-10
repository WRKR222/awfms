-- Production house Block 2 goes live, per-cage production cage map,
-- per-block egg collection sessions, and auto-logged accountant expenses.

-- ── Auto-logged expenses: link each one to the record that produced it ──
ALTER TABLE "expense_logs" ADD COLUMN IF NOT EXISTS "source_type" TEXT;
ALTER TABLE "expense_logs" ADD COLUMN IF NOT EXISTS "source_id" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "expense_logs_source_type_source_id_key"
  ON "expense_logs"("source_type", "source_id");

-- ── Batch lineage for partial brooder → production transfers ──
ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "parent_batch_id" TEXT;

-- ── Egg collection sessions are recorded per production house (block) ──
ALTER TABLE "egg_collection_sessions" ADD COLUMN IF NOT EXISTS "block" TEXT NOT NULL DEFAULT 'BLOCK1';
ALTER TABLE "egg_collection_sessions" ADD COLUMN IF NOT EXISTS "mortality_cages_json" JSONB;
ALTER TABLE "egg_collection_sessions" ADD COLUMN IF NOT EXISTS "mortalities_applied_at" TIMESTAMP(3);
-- Postgres truncates identifiers to 63 chars, so the old (batch, house, date,
-- shift) unique index is named "..._shif_key"; the new one takes the same name
-- (what Prisma derives for the 5-column unique).
ALTER TABLE "egg_collection_sessions" DROP CONSTRAINT IF EXISTS "egg_collection_sessions_batch_id_house_id_session_date_shif_key";
DROP INDEX IF EXISTS "egg_collection_sessions_batch_id_house_id_session_date_shif_key";
DROP INDEX IF EXISTS "egg_collection_sessions_batch_id_house_id_session_date_shift_key";
CREATE UNIQUE INDEX "egg_collection_sessions_batch_id_house_id_session_date_shif_key"
  ON "egg_collection_sessions"("batch_id", "house_id", "session_date", "shift", "block");
CREATE INDEX IF NOT EXISTS "egg_collection_sessions_block_session_date_shift_idx"
  ON "egg_collection_sessions"("block", "session_date", "shift");

-- ── Block layout dimensions ──
-- (updated_at is declared on FarmBlock in schema.prisma but was never created
-- by a migration — added here so Prisma writes to farm_blocks stop failing.)
ALTER TABLE "farm_blocks" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "farm_blocks" ADD COLUMN IF NOT EXISTS "levels_per_row" INTEGER NOT NULL DEFAULT 4;
ALTER TABLE "farm_blocks" ADD COLUMN IF NOT EXISTS "tiers_per_level" INTEGER NOT NULL DEFAULT 24;
ALTER TABLE "farm_blocks" ADD COLUMN IF NOT EXISTS "cages_per_tier" INTEGER NOT NULL DEFAULT 4;
ALTER TABLE "farm_blocks" ADD COLUMN IF NOT EXISTS "birds_per_cage" INTEGER NOT NULL DEFAULT 4;
ALTER TABLE "farm_blocks" ADD COLUMN IF NOT EXISTS "isolation_cage_count" INTEGER NOT NULL DEFAULT 8;

-- ── Production cage tables ──
CREATE TABLE IF NOT EXISTS "production_cages" (
  "id"           TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "block_id"     TEXT         NOT NULL,
  "row_id"       TEXT,
  "level_number" INTEGER,
  "tier_number"  INTEGER,
  "cage_number"  INTEGER      NOT NULL,
  "is_isolation" BOOLEAN      NOT NULL DEFAULT false,
  "code"         TEXT         NOT NULL,
  "label"        TEXT         NOT NULL,
  "capacity"     INTEGER      NOT NULL DEFAULT 4,
  "is_active"    BOOLEAN      NOT NULL DEFAULT true,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "production_cages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "production_cages_code_key" ON "production_cages"("code");
CREATE INDEX IF NOT EXISTS "production_cages_block_id_idx" ON "production_cages"("block_id");
CREATE INDEX IF NOT EXISTS "production_cages_row_id_level_number_idx" ON "production_cages"("row_id", "level_number");
ALTER TABLE "production_cages" ADD CONSTRAINT "production_cages_block_id_fkey"
  FOREIGN KEY ("block_id") REFERENCES "farm_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "production_cages" ADD CONSTRAINT "production_cages_row_id_fkey"
  FOREIGN KEY ("row_id") REFERENCES "farm_rows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "production_cage_assignments" (
  "id"               TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "cage_id"          TEXT         NOT NULL,
  "batch_id"         TEXT         NOT NULL,
  "bird_count"       INTEGER      NOT NULL DEFAULT 0,
  "placed_date"      DATE         NOT NULL,
  "notes"            TEXT,
  "isolation_reason" TEXT,
  "assigned_by_id"   TEXT         NOT NULL,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "production_cage_assignments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "production_cage_assignments_cage_id_key" ON "production_cage_assignments"("cage_id");
CREATE INDEX IF NOT EXISTS "production_cage_assignments_batch_id_idx" ON "production_cage_assignments"("batch_id");
ALTER TABLE "production_cage_assignments" ADD CONSTRAINT "production_cage_assignments_cage_id_fkey"
  FOREIGN KEY ("cage_id") REFERENCES "production_cages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "production_cage_assignments" ADD CONSTRAINT "production_cage_assignments_batch_id_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "production_cage_mortality_logs" (
  "id"             TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "cage_id"        TEXT         NOT NULL,
  "batch_id"       TEXT         NOT NULL,
  "session_id"     TEXT,
  "log_date"       DATE         NOT NULL,
  "count"          INTEGER      NOT NULL,
  "cause"          TEXT,
  "notes"          TEXT,
  "recorded_by_id" TEXT         NOT NULL,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "production_cage_mortality_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "production_cage_mortality_logs_batch_id_log_date_idx" ON "production_cage_mortality_logs"("batch_id", "log_date");
CREATE INDEX IF NOT EXISTS "production_cage_mortality_logs_session_id_idx" ON "production_cage_mortality_logs"("session_id");
ALTER TABLE "production_cage_mortality_logs" ADD CONSTRAINT "production_cage_mortality_logs_cage_id_fkey"
  FOREIGN KEY ("cage_id") REFERENCES "production_cages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "production_cage_reassignments" (
  "id"              TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "block_code"      TEXT         NOT NULL,
  "batch_id"        TEXT,
  "description"     TEXT         NOT NULL,
  "parsed_json"     JSONB,
  "applied"         BOOLEAN      NOT NULL DEFAULT false,
  "applied_summary" TEXT,
  "effective_date"  DATE         NOT NULL,
  "recorded_by_id"  TEXT         NOT NULL,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "production_cage_reassignments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "production_cage_reassignments_block_code_effective_date_idx"
  ON "production_cage_reassignments"("block_code", "effective_date");

-- ── Blocks: Block 1 (24 tiers/level) and Block 2 (38 tiers/level), both live ──
INSERT INTO "farm_blocks" ("id", "code", "name", "is_active", "is_under_construction", "created_at", "updated_at")
SELECT gen_random_uuid()::text, 'BLK1', 'Block 1 — Production House', true, false, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "farm_blocks" WHERE "code" = 'BLK1');
INSERT INTO "farm_blocks" ("id", "code", "name", "is_active", "is_under_construction", "created_at", "updated_at")
SELECT gen_random_uuid()::text, 'BLK2', 'Block 2 — Production House', true, false, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "farm_blocks" WHERE "code" = 'BLK2');

UPDATE "farm_blocks" SET "tiers_per_level" = 24, "is_active" = true, "is_under_construction" = false
WHERE "code" = 'BLK1';
UPDATE "farm_blocks" SET "tiers_per_level" = 38, "is_active" = true, "is_under_construction" = false,
  "name" = 'Block 2 — Production House', "updated_at" = NOW()
WHERE "code" = 'BLK2';

-- Sections A/B/C and rows A1..C2 in both blocks
INSERT INTO "farm_sections" ("id", "block_id", "code", "sort_order")
SELECT gen_random_uuid()::text, b."id", s.code, s.sort_order
FROM "farm_blocks" b
CROSS JOIN (VALUES ('A', 1), ('B', 2), ('C', 3)) AS s(code, sort_order)
WHERE b."code" IN ('BLK1', 'BLK2')
  AND NOT EXISTS (SELECT 1 FROM "farm_sections" fs WHERE fs."block_id" = b."id" AND fs."code" = s.code);

INSERT INTO "farm_rows" ("id", "section_id", "row_code", "is_active")
SELECT gen_random_uuid()::text, fs."id", fs."code" || r.n::text, true
FROM "farm_sections" fs
JOIN "farm_blocks" b ON b."id" = fs."block_id"
CROSS JOIN (VALUES (1), (2)) AS r(n)
WHERE b."code" IN ('BLK1', 'BLK2') AND fs."code" IN ('A', 'B', 'C')
  AND NOT EXISTS (SELECT 1 FROM "farm_rows" fr WHERE fr."section_id" = fs."id" AND fr."row_code" = fs."code" || r.n::text);

-- Regular cages: every row × 4 levels × tiers × 4 cages
INSERT INTO "production_cages" ("id", "block_id", "row_id", "level_number", "tier_number", "cage_number", "is_isolation", "code", "label", "capacity")
SELECT gen_random_uuid()::text, b."id", fr."id", lvl, tier, cage, false,
       b."code" || '-' || fr."row_code" || '-L' || lvl || '-T' || lpad(tier::text, 2, '0') || '-C' || cage,
       fr."row_code" || ' · Level ' || lvl ||
         CASE lvl WHEN 1 THEN ' (Bottom)' WHEN 4 THEN ' (Top)' ELSE '' END ||
         ' · Tier ' || lpad(tier::text, 2, '0') || ' · Cage ' || cage,
       b."birds_per_cage"
FROM "farm_blocks" b
JOIN "farm_sections" fs ON fs."block_id" = b."id"
JOIN "farm_rows" fr ON fr."section_id" = fs."id"
CROSS JOIN LATERAL generate_series(1, b."levels_per_row") AS lvl
CROSS JOIN LATERAL generate_series(1, b."tiers_per_level") AS tier
CROSS JOIN LATERAL generate_series(1, b."cages_per_tier") AS cage
WHERE b."code" IN ('BLK1', 'BLK2')
ON CONFLICT ("code") DO NOTHING;

-- Isolation cages: 8 per house
INSERT INTO "production_cages" ("id", "block_id", "row_id", "level_number", "tier_number", "cage_number", "is_isolation", "code", "label", "capacity")
SELECT gen_random_uuid()::text, b."id", NULL, NULL, NULL, n, true,
       b."code" || '-ISO-' || n, 'Isolation Cage ' || n, b."birds_per_cage"
FROM "farm_blocks" b
CROSS JOIN LATERAL generate_series(1, b."isolation_cage_count") AS n
WHERE b."code" IN ('BLK1', 'BLK2')
ON CONFLICT ("code") DO NOTHING;

-- Existing row-level placements → individual cages, so the new per-cage map
-- starts out matching what each row already holds: 4 birds per cage from the
-- top level down, tier 1 onwards (the last cage takes the remainder).
INSERT INTO "production_cage_assignments"
  ("id", "cage_id", "batch_id", "bird_count", "placed_date", "notes", "assigned_by_id", "created_at", "updated_at")
SELECT gen_random_uuid()::text, x."id", bca."batch_id",
       LEAST(x."capacity", bca."bird_count" - (x.rn - 1) * x."capacity"),
       bca."transfer_date", 'Auto-placed from the row-level assignment', bca."assigned_by_id", NOW(), NOW()
FROM "batch_cage_assignments" bca
JOIN (
  SELECT pc."id", pc."row_id", pc."capacity",
         ROW_NUMBER() OVER (PARTITION BY pc."row_id" ORDER BY pc."level_number" DESC, pc."tier_number", pc."cage_number") AS rn
  FROM "production_cages" pc
  WHERE pc."is_isolation" = false
) x ON x."row_id" = bca."row_id"
WHERE bca."bird_count" - (x.rn - 1) * x."capacity" > 0
  AND NOT EXISTS (
    SELECT 1 FROM "production_cage_assignments" pca
    JOIN "production_cages" pc2 ON pc2."id" = pca."cage_id"
    WHERE pc2."row_id" = bca."row_id"
  )
ON CONFLICT ("cage_id") DO NOTHING;
