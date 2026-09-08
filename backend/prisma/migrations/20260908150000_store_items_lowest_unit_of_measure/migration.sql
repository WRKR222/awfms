-- Records everything in the LOWEST unit of measure: kilograms -> grams,
-- litres -> millilitres. Scope: StoreItem stock/cost fields for VACCINE,
-- SUPPLEMENT, MEDICATION (treatment) and general/other categories — the
-- single source of truth every vaccine/supplement/treatment `quantityUsed`
-- is denominated against via the `unit` snapshot taken at log time.
--
-- Attendant-recorded quantities keep their everyday units by explicit
-- request: feed stays in kilograms, water stays in litres. Only
-- vaccines/supplements/treatments (drawn from StoreItem stock, see above)
-- are recorded in millilitres/grams. So brooder_logs.water_consumption_l is
-- NOT touched by this migration — it stays litres, as it always was.
--
-- FEED is deliberately EXCLUDED from this conversion. Feed's "kg" isn't
-- just a StoreItem label — it's the base unit of an entire, already-working
-- subsystem (the HyLine ration schedule, daily/weekly required-feed
-- calculations, over-issuance wastage tracking and alerts — see
-- feed-standard.util.ts, feed-wastage.service.ts and every
-- `...FeedKg`/`dailyRationKg`/`requiredKgFor...` function and field built on
-- top of it, plus a large surface of frontend displays that compare actual
-- dispensed feed directly against that kg-denominated schedule). Converting
-- feed's stock unit without also rescaling that entire schedule/wastage
-- engine would silently corrupt those comparisons (an amount entered in
-- grams compared against a schedule still expressed in kilograms). Doing
-- that safely is a separate, larger piece of work — flagged to the user
-- rather than attempted as a drive-by unit change here.
--
-- unitCostKes is cost PER UNIT, so it scales inversely to the quantity
-- scale (kg->g is x1000 on quantity, so cost-per-unit is /1000; same for
-- L->mL).

-- ── Kilograms -> grams (all categories except FEED) ─────────────────────
UPDATE "store_items"
SET
  "unit"          = 'g',
  "current_stock" = "current_stock" * 1000,
  "reorder_level" = CASE WHEN "reorder_level" >= 0 THEN "reorder_level" * 1000 ELSE "reorder_level" END,
  "unit_cost_kes" = "unit_cost_kes" / 1000
WHERE lower(trim("unit")) IN ('kg', 'kgs', 'kilogram', 'kilograms', 'kilo', 'kilos')
  AND "category" != 'FEED';

-- ── Litres -> millilitres (all categories except FEED) ──────────────────
UPDATE "store_items"
SET
  "unit"          = 'ml',
  "current_stock" = "current_stock" * 1000,
  "reorder_level" = CASE WHEN "reorder_level" >= 0 THEN "reorder_level" * 1000 ELSE "reorder_level" END,
  "unit_cost_kes" = "unit_cost_kes" / 1000
WHERE lower(trim("unit")) IN ('l', 'ltr', 'ltrs', 'litre', 'litres', 'liter', 'liters')
  AND "category" != 'FEED';
