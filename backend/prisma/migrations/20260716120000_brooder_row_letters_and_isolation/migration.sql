-- Relabel the 6 fixed brooder rows from "Row 1".."Row 6" to "Row A".."Row F".
-- rowNumber (1-6) is kept as the stable sort/identity key; only the
-- human-facing label changes. CHR(64 + n) -> A for 1, B for 2, ... F for 6.
UPDATE "brooder_rows"
SET "label" = 'Row ' || CHR(64 + "row_number")
WHERE "row_number" BETWEEN 1 AND 6;

-- Shorten cage labels from the old "Row 1 · Level 1 · Cage 07" form to just
-- "Cage 07". Every UI that shows a cage already shows its row and level
-- alongside it, so the old label duplicated that context inside dropdowns
-- (e.g. "Row 1 · Level 1 (Bottom) · Row 1 · Level 1 · Cage 07"). Full
-- row/level/cage paths are now composed at render time from the three
-- separate labels instead of being baked into one string.
UPDATE "brooder_cages"
SET "label" = 'Cage ' || lpad("cage_number"::text, 2, '0');

-- Isolation support: a cage assignment can be flagged as holding birds
-- deliberately separated from the rest of their batch (sick, injured,
-- under observation, etc.), with a required reason.
ALTER TABLE "brooder_cage_assignments"
  ADD COLUMN IF NOT EXISTS "is_isolation"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "isolation_reason" TEXT;
