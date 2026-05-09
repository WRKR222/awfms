-- Allow Manual LPO line items to be free-typed (no linked store item).
-- Drops NOT NULL on lpo_items.store_item_id so the description field alone can carry the item name.
ALTER TABLE "lpo_items"
  ALTER COLUMN "store_item_id" DROP NOT NULL;
