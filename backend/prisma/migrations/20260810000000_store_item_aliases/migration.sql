-- ============================================================================
-- Migration: Store item aliases (manual production-report item matching)
--
-- Production-report reconciliation matches free-text feed/vaccine/supplement
-- labels to StoreItem by fuzzy substring match, and flags anything it can't
-- match as a discrepancy for Store to resolve. This table lets Store record
-- "this exact sheet wording means THIS store item" once — reconciliation
-- checks it (by normalised text) BEFORE the fuzzy matcher, so the same
-- unmatched label never needs re-resolving on future reports.
-- Idempotent — safe to re-run on any environment.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "store_item_aliases" (
  "id"                TEXT      NOT NULL DEFAULT gen_random_uuid()::text,
  "store_item_id"     TEXT      NOT NULL REFERENCES "store_items"("id") ON DELETE CASCADE,
  "normalised_alias"  TEXT      NOT NULL,
  "raw_alias"         TEXT      NOT NULL,
  "created_by_id"     TEXT      NOT NULL REFERENCES "users"("id"),
  "created_at"        TIMESTAMP NOT NULL DEFAULT now(),

  CONSTRAINT "store_item_aliases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "store_item_aliases_normalised_alias_key" ON "store_item_aliases"("normalised_alias");
CREATE INDEX IF NOT EXISTS "store_item_aliases_store_item_id_idx" ON "store_item_aliases"("store_item_id");
