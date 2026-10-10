-- Issuance plan quantities: weekly totals were summed from the daily
-- breakdown in floating point, so some saved totals carry noise far past
-- what Store typed (12.345 stored as 12.345000000000001). Trim every past
-- and current plan's quantities to 6 decimal places — the values Store
-- actually entered are unchanged; only the noise is removed.
UPDATE "issuance_plan_items"
SET "quantity_planned" = round("quantity_planned", 6)
WHERE "quantity_planned" <> round("quantity_planned", 6);

UPDATE "issuance_plan_items"
SET "quantity_approved" = round("quantity_approved", 6)
WHERE "quantity_approved" IS NOT NULL AND "quantity_approved" <> round("quantity_approved", 6);

UPDATE "issuance_plan_items"
SET "quantity_issued" = round("quantity_issued", 6)
WHERE "quantity_issued" <> round("quantity_issued", 6);
