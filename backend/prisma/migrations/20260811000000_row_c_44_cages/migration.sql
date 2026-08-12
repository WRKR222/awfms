-- Migration: row_c_44_cages
-- Row C (row_number = 3) was seeded with only 42 cages per level, alongside
-- Row F (row_number = 6), under the assumption both decks shared the same
-- physical constraint. That assumption was wrong for Row C — it has the
-- standard 44-cage deck like rows A, B, D, E. Row F keeps its 42-cage limit.
--
-- Adds cages 43 and 44 to every level of Row C. Idempotent (ON CONFLICT DO
-- NOTHING) so it's safe to run against a database that was seeded either
-- before or after this fix.

DO $$
DECLARE
  lvl RECORD;
BEGIN
  FOR lvl IN
    SELECT bl.id AS level_id, bl.level_number, br.label AS row_label
    FROM "brooder_levels" bl
    JOIN "brooder_rows" br ON br.id = bl.row_id
    WHERE br.row_number = 3
  LOOP
    INSERT INTO "brooder_cages" ("level_id", "cage_number", "label")
    VALUES
      (lvl.level_id, 43, lvl.row_label || ' · Level ' || lvl.level_number || ' · Cage 43'),
      (lvl.level_id, 44, lvl.row_label || ' · Level ' || lvl.level_number || ' · Cage 44')
    ON CONFLICT ("level_id", "cage_number") DO NOTHING;
  END LOOP;
END $$;

-- Brooder cage reassignment — Director notification for over-capacity layouts
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BROODER_CAGE_REASSIGN_OVER_CAPACITY';
