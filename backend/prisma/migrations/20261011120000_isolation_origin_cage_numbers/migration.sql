-- Isolation cages record where their birds came from.
ALTER TABLE "production_cage_assignments" ADD COLUMN IF NOT EXISTS "origin" TEXT;

-- Tiers are only physical grouping: label each cage by its number along the
-- level instead, e.g. "A1 · Level 4 (Top) · Cage 37" (was "Tier 10 · Cage 1").
UPDATE "production_cages" pc
SET "label" = fr."row_code" || ' · Level ' || pc."level_number" ||
              CASE pc."level_number" WHEN 1 THEN ' (Bottom)' WHEN 4 THEN ' (Top)' ELSE '' END ||
              ' · Cage ' || ((pc."tier_number" - 1) * b."cages_per_tier" + pc."cage_number")
FROM "farm_rows" fr, "farm_blocks" b
WHERE pc."row_id" = fr."id" AND b."id" = pc."block_id" AND pc."is_isolation" = false;
