-- Migration: 20260731000000_brooder_feed_wastage
--
-- Context:
--   The whole-brooder ("general population") feed log is advisory-only —
--   unlike the per-row/per-level path, it is never hard-blocked from
--   exceeding the HyLine daily ration (see Req 3 note in
--   BrooderService.createLevelFeedLog). That means a day's feed can be
--   over-issued (e.g. 322kg dispensed against a 321kg ration) with nothing
--   surfaced to the Director. This migration adds a dedicated ledger table
--   so BrooderService can record every such over-issuance event — with the
--   excess kg and, where the feed was linked to a specific store item, the
--   cost of that excess — and a matching notification type so the Director
--   is alerted immediately and can pull daily/weekly/monthly wastage totals.

CREATE TABLE IF NOT EXISTS "brooder_feed_wastage_logs" (
  "id"                   TEXT      NOT NULL DEFAULT gen_random_uuid()::text,
  "batch_id"             TEXT      NOT NULL REFERENCES "batches"("id"),
  "batch_code"           TEXT      NOT NULL,
  "general_feed_log_id"  TEXT      NOT NULL,
  "feed_type"            TEXT      NOT NULL,
  "store_item_id"        TEXT,
  "store_item_name"      TEXT,
  "entry_date"           DATE      NOT NULL,
  "required_kg_for_day"  DOUBLE PRECISION NOT NULL,
  "dispensed_kg_total"   DOUBLE PRECISION NOT NULL,
  "excess_kg"            DOUBLE PRECISION NOT NULL,
  "unit_cost_kes"        DECIMAL(10,2),
  "excess_cost_kes"      DECIMAL(12,2),
  "logged_by_id"         TEXT      NOT NULL REFERENCES "users"("id"),
  "created_at"           TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "brooder_feed_wastage_logs_batch_id_entry_date_idx"
  ON "brooder_feed_wastage_logs"("batch_id", "entry_date");

CREATE INDEX IF NOT EXISTS "brooder_feed_wastage_logs_entry_date_idx"
  ON "brooder_feed_wastage_logs"("entry_date");

COMMENT ON TABLE "brooder_feed_wastage_logs" IS
  'One row per whole-brooder feed entry that pushed a batch''s day total past its HyLine daily ration. excess_kg is the incremental amount added by that entry (not a running cumulative), so summing excess_kg across a day gives the true daily total even with multiple entries.';

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BROODER_FEED_WASTAGE';
