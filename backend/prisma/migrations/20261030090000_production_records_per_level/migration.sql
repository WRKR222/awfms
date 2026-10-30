-- Production houses: records are kept per row · level instead of per cage.
-- The physical arrangement (levels × tiers × cages, 4 birds per cage) is
-- unchanged and still drives capacity; each row · level becomes one unit
-- (code BLK1-A1-L4) that may hold several batches. Isolation cages stay
-- individual. Per-cage rows are deactivated, not deleted, so historical
-- mortality logs keep their cage.

ALTER TABLE "production_cages" ADD COLUMN IF NOT EXISTS "is_level" BOOLEAN NOT NULL DEFAULT false;

-- One unit per row · level, capacity = whole level.
INSERT INTO "production_cages"
  ("id", "block_id", "row_id", "level_number", "tier_number", "cage_number", "is_isolation", "is_level", "code", "label", "capacity")
SELECT gen_random_uuid()::text, b."id", fr."id", lvl, NULL, 0, false, true,
       b."code" || '-' || fr."row_code" || '-L' || lvl,
       fr."row_code" || ' · Level ' || lvl ||
         CASE WHEN lvl = 1 THEN ' (Bottom)' WHEN lvl = b."levels_per_row" THEN ' (Top)' ELSE '' END,
       b."tiers_per_level" * b."cages_per_tier" * b."birds_per_cage"
FROM "farm_blocks" b
JOIN "farm_sections" fs ON fs."block_id" = b."id"
JOIN "farm_rows" fr ON fr."section_id" = fs."id"
CROSS JOIN LATERAL generate_series(1, b."levels_per_row") AS lvl
WHERE b."code" IN ('BLK1', 'BLK2')
ON CONFLICT ("code") DO NOTHING;

-- Several batches per unit (a level), one row per batch.
DROP INDEX IF EXISTS "production_cage_assignments_cage_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS "production_cage_assignments_cage_id_batch_id_key"
  ON "production_cage_assignments"("cage_id", "batch_id");
CREATE INDEX IF NOT EXISTS "production_cage_assignments_cage_id_idx"
  ON "production_cage_assignments"("cage_id");

-- Per-cage placements → their level, summed per batch.
INSERT INTO "production_cage_assignments"
  ("id", "cage_id", "batch_id", "bird_count", "placed_date", "notes", "assigned_by_id", "created_at", "updated_at")
SELECT gen_random_uuid()::text, lu."id", pca."batch_id", SUM(pca."bird_count")::int, MIN(pca."placed_date"),
       'Combined from per-cage records', MIN(pca."assigned_by_id"), NOW(), NOW()
FROM "production_cage_assignments" pca
JOIN "production_cages" pc ON pc."id" = pca."cage_id" AND pc."is_isolation" = false AND pc."is_level" = false
JOIN "production_cages" lu ON lu."row_id" = pc."row_id" AND lu."level_number" = pc."level_number" AND lu."is_level" = true
GROUP BY lu."id", pca."batch_id"
ON CONFLICT ("cage_id", "batch_id") DO NOTHING;

DELETE FROM "production_cage_assignments" pca
USING "production_cages" pc
WHERE pc."id" = pca."cage_id" AND pc."is_isolation" = false AND pc."is_level" = false;

UPDATE "production_cages" SET "is_active" = false
WHERE "is_isolation" = false AND "is_level" = false;
