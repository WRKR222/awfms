-- Migration: 20260702000000_brooder_store_item_residual_links
--
-- Context:
--   The Lead Attendant's feed / vaccine / supplement / treatment logging
--   forms let the attendant type any free-text name. This meant a feed
--   type or drug could be logged that was never actually issued out of
--   the store, and there was no way to tell how much of what WAS issued
--   is still sitting unused in the brooder (residual), which both the
--   Store (to avoid over-issuing next week) and the attendant (to avoid
--   wastage) need visibility into.
--
--   Fix: link brooder-level feed logs and treatment logs directly to the
--   StoreItem they were dispensed from. Vaccine/supplement entries
--   (stored as JSONB arrays on brooder_logs.vaccines_json /
--   supplements_json) get the same `storeItemId` + `quantityUsed` keys
--   added at the application layer — no column changes needed there
--   since they're already JSONB.
--
--   Residual for a given store item + week is then simply:
--     SUM(store_stock_outs.quantity_out for that item this week)
--   minus
--     SUM(quantity dispensed/used against that item this week, from
--         brooder_level_feed_logs.quantity_dispensed_kg,
--         brooder_treatment_logs.quantity_used, and the storeItemId-
--         tagged entries inside vaccines_json / supplements_json)

ALTER TABLE brooder_level_feed_logs
  ADD COLUMN IF NOT EXISTS store_item_id UUID REFERENCES store_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit TEXT;

CREATE INDEX IF NOT EXISTS idx_brooder_level_feed_logs_store_item
  ON brooder_level_feed_logs (store_item_id, entry_date);

COMMENT ON COLUMN brooder_level_feed_logs.store_item_id IS
  'The StoreItem this feed was actually issued as (via store stock-out). NULL for legacy rows logged before this link existed. Used to compute weekly residual = issued - dispensed.';
COMMENT ON COLUMN brooder_level_feed_logs.unit IS
  'Snapshot of the linked StoreItem''s stock unit (e.g. "KG", "BAG") at log time, set server-side from storeItem.unit — never trusted from the client. Lets quantity_dispensed_kg be diffed directly against store_stock_outs.quantity_out for residual tracking regardless of the item''s actual stock unit.';

ALTER TABLE brooder_treatment_logs
  ADD COLUMN IF NOT EXISTS store_item_id UUID REFERENCES store_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quantity_used DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS quantity_used_unit TEXT;

CREATE INDEX IF NOT EXISTS idx_brooder_treatment_logs_store_item
  ON brooder_treatment_logs (store_item_id, treatment_date);

COMMENT ON COLUMN brooder_treatment_logs.store_item_id IS
  'The StoreItem this treatment drug was actually issued as (via store stock-out). NULL for legacy rows logged before this link existed.';
COMMENT ON COLUMN brooder_treatment_logs.quantity_used IS
  'Quantity deducted from the linked store item''s stock, in that item''s stock unit. Distinct from `dose`, which remains a free-text clinical dosage description (e.g. "5ml/L water"). Used to compute weekly residual = issued - dispensed.';
COMMENT ON COLUMN brooder_treatment_logs.quantity_used_unit IS
  'Snapshot of the linked StoreItem''s stock unit at log time, set server-side from storeItem.unit — never trusted from the client. Distinct from dose_unit, which is the clinical per-bird/per-litre dosage unit.';
