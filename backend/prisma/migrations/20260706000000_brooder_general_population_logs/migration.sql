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

CREATE TABLE IF NOT EXISTS brooder_general_feed_logs (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id               UUID NOT NULL REFERENCES batches(id),
  feed_type              "FeedType" NOT NULL,
  store_item_id          UUID REFERENCES store_items(id) ON DELETE SET NULL,
  unit                   TEXT,
  entry_date             DATE NOT NULL,
  quantity_dispensed_kg  DOUBLE PRECISION NOT NULL,
  required_kg_for_day    DOUBLE PRECISION,
  notes                  TEXT,
  logged_by_id           UUID NOT NULL REFERENCES users(id),
  created_at             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_brooder_general_feed_logs_batch_date
  ON brooder_general_feed_logs (batch_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_brooder_general_feed_logs_store_item
  ON brooder_general_feed_logs (store_item_id, entry_date);

COMMENT ON TABLE brooder_general_feed_logs IS
  'Batch-wide feed log used when the Lead Attendant cannot break feed dispensed down by individual row/level. Mutually exclusive with brooder_level_feed_logs on a (batch, date) basis — enforced in BrooderService, not by a DB constraint, since level logs are keyed by level_id rather than batch_id.';

CREATE TABLE IF NOT EXISTS brooder_general_mortality_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        UUID NOT NULL REFERENCES batches(id),
  log_date        DATE NOT NULL,
  mortality_count INTEGER NOT NULL DEFAULT 0,
  culling_count   INTEGER NOT NULL DEFAULT 0,
  cause           TEXT,
  notes           TEXT,
  logged_by_id    UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_brooder_general_mortality_logs_batch_date
  ON brooder_general_mortality_logs (batch_id, log_date);

COMMENT ON TABLE brooder_general_mortality_logs IS
  'Batch-wide mortality/culling log used when the Lead Attendant cannot break the count down by individual row/level. Mutually exclusive with brooder_level_mortality_logs on a (batch, date) basis — enforced in BrooderService.';
