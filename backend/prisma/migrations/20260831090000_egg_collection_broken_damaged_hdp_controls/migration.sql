-- Egg collection: attendant records a single "Broken" + "Damaged" count per
-- row instead of separately classifying Broken Sellable / Broken Unsellable.
-- That sellable/unsellable classification now happens later, at the
-- three-party tally sign-off, entered by Sales (see EggTallyVerification
-- broken_sellable_qty / broken_unsellable_qty below).
--
-- Also: feed/vaccine/supplement store-item linkage for egg collection
-- (mirrors the brooder module's residual-ledger-gated logging), unlimited
-- decimal precision for feed-dispensed quantities, and the new PM-uploaded
-- HDP% control curve.

-- EggCollectionSession: new "damaged" total, store-linked feed, unlimited
-- decimal precision on feed quantities.
ALTER TABLE "egg_collection_sessions"
  ADD COLUMN "total_damaged" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "feed_store_item_id" TEXT;

ALTER TABLE "egg_collection_sessions"
  ALTER COLUMN "feed_kg" TYPE numeric,
  ALTER COLUMN "daily_feed_kg" TYPE numeric;

-- FeedIntakeLog: store-item linkage + unlimited decimal precision on the
-- dispensed quantity.
ALTER TABLE "feed_intake_logs"
  ADD COLUMN "store_item_id" TEXT;

ALTER TABLE "feed_intake_logs"
  ALTER COLUMN "quantity_dispensed_kg" TYPE numeric;

-- VaccinationRecord: store-item linkage + actual quantity dispensed, so
-- vaccines/supplements given during egg collection draw against what Store
-- actually issued (same as the brooder module).
ALTER TABLE "vaccination_records"
  ADD COLUMN "store_item_id" TEXT,
  ADD COLUMN "quantity_used" numeric;

-- EggTallyVerification: Sales's actual broken-egg sellable/unsellable split,
-- entered at tally sign-off.
ALTER TABLE "egg_tally_verifications"
  ADD COLUMN "broken_sellable_qty" INTEGER,
  ADD COLUMN "broken_unsellable_qty" INTEGER,
  ADD COLUMN "broken_split_set_by_id" TEXT,
  ADD COLUMN "broken_split_set_at" TIMESTAMP(3);

-- HDP% controls: PM-uploaded target curve (PDF / Excel / Word), parsed into
-- (period, target %) points and compared against actual production HDP.
CREATE TYPE "HdpControlGranularity" AS ENUM ('DAILY', 'WEEKLY');
CREATE TYPE "HdpControlSourceFormat" AS ENUM ('PDF', 'XLSX', 'DOCX');

CREATE TABLE "hdp_control_uploads" (
  "id" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "source_format" "HdpControlSourceFormat" NOT NULL,
  "granularity" "HdpControlGranularity" NOT NULL,
  "notes" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "uploaded_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "hdp_control_uploads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hdp_control_points" (
  "id" TEXT NOT NULL,
  "upload_id" TEXT NOT NULL,
  "period_index" INTEGER NOT NULL,
  "target_hdp_percent" DECIMAL(5,2) NOT NULL,

  CONSTRAINT "hdp_control_points_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "hdp_control_uploads_is_active_idx" ON "hdp_control_uploads"("is_active");

CREATE UNIQUE INDEX "hdp_control_points_upload_id_period_index_key" ON "hdp_control_points"("upload_id", "period_index");

ALTER TABLE "hdp_control_points" ADD CONSTRAINT "hdp_control_points_upload_id_fkey"
  FOREIGN KEY ("upload_id") REFERENCES "hdp_control_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
