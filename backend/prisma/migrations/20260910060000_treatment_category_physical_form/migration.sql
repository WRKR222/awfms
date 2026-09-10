-- Two additive, non-destructive changes:
--
-- 1. StoreItemCategory: new TREATMENT category, split out of MEDICATION —
--    same pattern as the VACCINE split in
--    20260907090000_brooder_review_vaccine_category_mortality_feed_adjustments.
--    Existing MEDICATION items that are actually treatments/antibiotics/
--    dewormers are NOT auto-reclassified; Store/PM re-tag them into
--    TREATMENT by hand.
--
-- 2. StoreItem.physicalForm (SOLID | LIQUID, nullable): lets Store declare
--    whether a vaccine/supplement/treatment item is tracked in grams or
--    millilitres. StoreInventoryService.resolvePhysicalForm enforces
--    unit = 'G' for SOLID and unit = 'ML' for LIQUID going forward for
--    MEDICATION/SUPPLEMENT/VACCINE/TREATMENT items, so attendant-recorded
--    quantityUsed is always denominated the same way Store issues the
--    item — which is what makes the residual (issued − dispensed) ledger
--    valid once quantities are recorded in grams/millilitres.
--
--    Unlike 20260908150000_store_items_lowest_unit_of_measure (removed
--    from this project after 20260908180000 reverted it), this migration
--    does NOT rewrite any existing item's unit, stock, or cost figures —
--    no UPDATE statements here at all. physical_form is added as NULL for
--    every existing row; Store sets it (and, with it, confirms the G/ML
--    unit) explicitly per item going forward, the same manual re-tag
--    pattern already used for VACCINE above.

-- 1. TREATMENT category
ALTER TYPE "StoreItemCategory" ADD VALUE 'TREATMENT';

-- 2. Physical form
CREATE TYPE "PhysicalForm" AS ENUM ('SOLID', 'LIQUID');

ALTER TABLE "store_items" ADD COLUMN "physical_form" "PhysicalForm";
