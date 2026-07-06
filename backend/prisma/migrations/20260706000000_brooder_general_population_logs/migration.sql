-- Migration: 20260706000000_brooder_general_population_logs
--
-- Context:
--   All brooder feed and mortality logging so far requires pinpointing a
--   specific Row + Level. That works well when the batch is split across
--   the cage map, but a Lead Attendant who cannot break the count down by
--   individual row/level (e.g. a single shared trough, a small batch not
--   yet split across levels, or a day where per-level tracking wasn't
--   practical) had no way to record feed/mortality at all.
--
--   Fix: two new "general population" tables, scoped to the whole Batch
--   rather than a level. The application layer enforces mutual exclusion
--   per (batch, date): a general entry is refused if a row/level-specific
--   entry already exists for that batch on that date, and vice versa, so
--   totals are never double-counted. Both support backdating like their
--   row/level counterparts.
--
-- Fix (2026-07-06): all primary keys and foreign keys in this project are
-- TEXT (Prisma `String @id @default(uuid())`, no `@db.Uuid`), not native
-- Postgres UUID — see brooder_treatment_logs in
-- 20260626000000_brooder_daily_log_v2 for the established pattern. The
-- original version of this migration used native UUID columns, which
-- cannot form a foreign key against the TEXT-typed batches.id/users.id/
-- store_items.id columns (Postgres error 42804). Corrected to TEXT below.

CREATE TABLE IF NOT EXISTS "brooder_general_feed_logs" (
  "id"                     TEXT             NOT NULL DEFAULT gen_random_uuid()::text,
  "batch_id"               TEXT             NOT NULL REFERENCES "batches"("id"),
  "feed_type"              "FeedType"       NOT NULL,
  "store_item_id"          TEXT             REFERENCES "store_items"("id") ON DELETE SET NULL,
  "unit"                   TEXT,
  "entry_date"             DATE             NOT NULL,
  "quantity_dispensed_kg"  DOUBLE PRECISION NOT NULL,
  "required_kg_for_day"    DOUBLE PRECISION,
  "notes"                  TEXT,
  "logged_by_id"           TEXT             NOT NULL REFERENCES "users"("id"),
  "created_at"             TIMESTAMP        NOT NULL DEFAULT now(),
  "updated_at"             TIMESTAMP        NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "brooder_general_feed_logs_batch_id_entry_date_idx"
  ON "brooder_general_feed_logs"("batch_id", "entry_date");
CREATE INDEX IF NOT EXISTS "brooder_general_feed_logs_store_item_id_entry_date_idx"
  ON "brooder_general_feed_logs"("store_item_id", "entry_date");

COMMENT ON TABLE "brooder_general_feed_logs" IS
  'Batch-wide feed log used when the Lead Attendant cannot break feed dispensed down by individual row/level. Mutually exclusive with brooder_level_feed_logs on a (batch, date) basis — enforced in BrooderService, not by a DB constraint, since level logs are keyed by level_id rather than batch_id.';

CREATE TABLE IF NOT EXISTS "brooder_general_mortality_logs" (
  "id"              TEXT      NOT NULL DEFAULT gen_random_uuid()::text,
  "batch_id"        TEXT      NOT NULL REFERENCES "batches"("id"),
  "log_date"        DATE      NOT NULL,
  "mortality_count" INTEGER   NOT NULL DEFAULT 0,
  "culling_count"   INTEGER   NOT NULL DEFAULT 0,
  "cause"           TEXT,
  "notes"           TEXT,
  "logged_by_id"    TEXT      NOT NULL REFERENCES "users"("id"),
  "created_at"      TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "brooder_general_mortality_logs_batch_id_log_date_idx"
  ON "brooder_general_mortality_logs"("batch_id", "log_date");

COMMENT ON TABLE "brooder_general_mortality_logs" IS
  'Batch-wide mortality/culling log used when the Lead Attendant cannot break the count down by individual row/level. Mutually exclusive with brooder_level_mortality_logs on a (batch, date) basis — enforced in BrooderService.';
