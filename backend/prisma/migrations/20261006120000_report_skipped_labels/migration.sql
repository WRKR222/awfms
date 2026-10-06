-- Report names Store chose to skip ("not a store item"), keyed on the name
-- with its amounts removed. Never flagged as unmatched again.
CREATE TABLE IF NOT EXISTS "report_skipped_labels" (
  "id"            TEXT         NOT NULL,
  "skip_key"      TEXT         NOT NULL,
  "raw_label"     TEXT         NOT NULL,
  "created_by_id" TEXT         NOT NULL,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "report_skipped_labels_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "report_skipped_labels_skip_key_key" ON "report_skipped_labels"("skip_key");
