-- Production report workbooks: weight-track tab + kept upload files.
--
-- batch_weight_track_points: the "Weight track" tab of a batch's current
--   production report (expected band/average vs. actual average weight, in
--   grams) — drives the PM/Director weight-track graph.
-- production_report_files: the spreadsheet behind the CURRENT version of a
--   batch's report and the one before it (PREVIOUS), so a rollback can put
--   the previous upload back into effect instead of leaving nothing.

CREATE TABLE IF NOT EXISTS "production_report_files" (
  "id"             TEXT         NOT NULL,
  "report_id"      TEXT         NOT NULL,
  "slot"           TEXT         NOT NULL,
  "file_name"      TEXT         NOT NULL,
  "column_mapping" JSONB        NOT NULL,
  "data"           BYTEA        NOT NULL,
  "uploaded_by_id" TEXT         NOT NULL,
  "uploaded_at"    TIMESTAMP(3) NOT NULL,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "production_report_files_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "production_report_files_report_id_fkey" FOREIGN KEY ("report_id")
    REFERENCES "store_production_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "production_report_files_report_id_slot_key"
  ON "production_report_files"("report_id", "slot");

CREATE TABLE IF NOT EXISTS "batch_weight_track_points" (
  "id"             TEXT          NOT NULL,
  "batch_id"       TEXT          NOT NULL,
  "report_id"      TEXT          NOT NULL,
  "sample_date"    DATE          NOT NULL,
  "week_number"    INTEGER,
  "day_number"     INTEGER,
  "min_expected_g" DECIMAL(8,2),
  "max_expected_g" DECIMAL(8,2),
  "avg_expected_g" DECIMAL(8,2),
  "avg_actual_g"   DECIMAL(8,2),
  "created_at"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "batch_weight_track_points_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "batch_weight_track_points_batch_id_fkey" FOREIGN KEY ("batch_id")
    REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "batch_weight_track_points_report_id_fkey" FOREIGN KEY ("report_id")
    REFERENCES "store_production_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "batch_weight_track_points_batch_id_sample_date_key"
  ON "batch_weight_track_points"("batch_id", "sample_date");
CREATE INDEX IF NOT EXISTS "batch_weight_track_points_report_id_idx"
  ON "batch_weight_track_points"("report_id");
