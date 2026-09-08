-- Reverts the kg->g / L->ml store-item conversion that
-- 20260908150000_store_items_lowest_unit_of_measure would have applied
-- (that migration file was itself removed from this project per a later
-- request — see the store-inventory unit guard removal). This migration
-- exists as a safety net in case that conversion actually reached this
-- database before being removed from the codebase: it undoes the exact
-- same scaling, symmetrically, for anything still sitting in the converted
-- state. If the original conversion never ran here, every WHERE clause
-- below matches zero rows and this is a complete no-op — safe either way.
--
-- Reverted TO uppercase 'KG'/'L', matching the app's actual unit-code
-- convention (the store item form's preset dropdown values are uppercase:
-- 'KG', 'G', 'L', 'ML', 'PIECE', ...), not the lowercase 'g'/'ml' the
-- removed forward migration happened to write.
--
-- unitCostKes is cost PER UNIT, so it scales inversely to the quantity
-- scale — reversing g->kg (quantity /1000) means cost-per-unit *1000; same
-- for ml->l.
--
-- FEED was never touched by the forward conversion (see that migration's
-- own reasoning, preserved in this project's other files) so it's excluded
-- here too, symmetrically — there's nothing to revert for FEED items.

-- ── Grams -> kilograms (undo) ────────────────────────────────────────────
UPDATE "store_items"
SET
  "unit"          = 'KG',
  "current_stock" = "current_stock" / 1000,
  "reorder_level" = CASE WHEN "reorder_level" >= 0 THEN "reorder_level" / 1000 ELSE "reorder_level" END,
  "unit_cost_kes" = "unit_cost_kes" * 1000
WHERE lower(trim("unit")) = 'g'
  AND "category" != 'FEED';

-- ── Millilitres -> litres (undo) ─────────────────────────────────────────
UPDATE "store_items"
SET
  "unit"          = 'L',
  "current_stock" = "current_stock" / 1000,
  "reorder_level" = CASE WHEN "reorder_level" >= 0 THEN "reorder_level" / 1000 ELSE "reorder_level" END,
  "unit_cost_kes" = "unit_cost_kes" * 1000
WHERE lower(trim("unit")) = 'ml'
  AND "category" != 'FEED';
