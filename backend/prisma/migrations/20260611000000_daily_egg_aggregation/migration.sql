-- Migration: 20260611_daily_egg_aggregate
-- Adds the DailyEggAggregate table for post-tally-lock aggregate egg counts
-- and expected revenue per batch/house/date.
-- Zero-downtime compatible — new table only, no column drops or type changes.

CREATE TABLE "daily_egg_aggregates" (
  "id"                      TEXT        NOT NULL,
  "aggregate_date"          DATE        NOT NULL,
  "batch_id"                TEXT        NOT NULL,
  "house_id"                TEXT        NOT NULL,

  "total_std_eggs"          INTEGER     NOT NULL DEFAULT 0,
  "total_starter_eggs"      INTEGER     NOT NULL DEFAULT 0,
  "total_broken_sellable"   INTEGER     NOT NULL DEFAULT 0,
  "total_broken_unsellable" INTEGER     NOT NULL DEFAULT 0,
  "expected_revenue_kes"    DECIMAL(12,2),

  "created_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"              TIMESTAMP(3) NOT NULL,

  CONSTRAINT "daily_egg_aggregates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_egg_aggregates_batch_id_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "batches"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "daily_egg_aggregates_aggregate_date_batch_id_house_id_key"
    UNIQUE ("aggregate_date", "batch_id", "house_id")
);

CREATE INDEX "daily_egg_aggregates_aggregate_date_idx"
  ON "daily_egg_aggregates"("aggregate_date");

CREATE INDEX "daily_egg_aggregates_batch_id_idx"
  ON "daily_egg_aggregates"("batch_id");
