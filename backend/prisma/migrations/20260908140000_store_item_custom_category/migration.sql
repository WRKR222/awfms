-- Lets Store enter a free-text category label when none of the preset
-- StoreItemCategory options fit — the item is still filed under the OTHER
-- enum value (so all existing category-based logic keeps working), with
-- this column carrying the human-entered name for display/search.
ALTER TABLE "store_items" ADD COLUMN "custom_category_label" TEXT;
