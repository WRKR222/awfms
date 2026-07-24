-- ============================================================================
-- Migration: Allow custom (free-text) units on Store Items.
--            Previously "unit" was locked to the fixed StoreItemUnit enum
--            (KG, G, L, ML, PIECE, BOX, BAG, BOTTLE, SACHET, TRAY). Store
--            managers can now type any unit label not in that preset list
--            (e.g. "Roll", "Dozen", "Pair") when creating or editing an item.
-- Idempotent — safe to re-run on any environment.
-- ============================================================================

-- ── 1. Convert store_items.unit from enum to text ──────────────────────────
-- Existing values (KG, G, L, etc.) are preserved as-is, just stored as text
-- instead of the enum type.

ALTER TABLE "store_items"
  ALTER COLUMN "unit" TYPE TEXT USING "unit"::TEXT;

-- ── 2. Drop the now-unused enum type ────────────────────────────────────────
-- StoreItemUnit was only ever referenced by store_items.unit.

DROP TYPE IF EXISTS "StoreItemUnit";
