-- ============================================================
-- AWFMS Phase 5 Migration
-- Health Checklists + Biosecurity Logs + Visitor Advance Notice
-- ============================================================

-- ─── DAILY HEALTH CHECKLIST ──────────────────────────────────────────────────
-- Attendant submits once per shift per house.
-- checks: JSON { itemId: "pass" | "fail" | "na" }
-- itemNotes: JSON { itemId: "description of issue" }

CREATE TABLE "health_checklists" (
    "id"               TEXT NOT NULL,
    "check_date"       DATE NOT NULL,
    "shift"            TEXT NOT NULL DEFAULT 'AM',
    "house_id"         TEXT,
    "submitted_by_id"  TEXT NOT NULL,
    "checks"           JSONB NOT NULL DEFAULT '{}',
    "item_notes"       JSONB NOT NULL DEFAULT '{}',
    "overall_notes"    TEXT,
    "fail_count"       INTEGER NOT NULL DEFAULT 0,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "health_checklists_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "health_checklists_check_date_idx" ON "health_checklists"("check_date");
CREATE INDEX "health_checklists_submitted_by_id_idx" ON "health_checklists"("submitted_by_id");

-- ─── BIOSECURITY CHECKPOINT LOGS ─────────────────────────────────────────────
-- Manager logs biosecurity checkpoint pass/fail for main gate and farm gate.
-- checkpoint_type: "MAIN_GATE" | "FARM_GATE"
-- checks: JSON { checkId: "pass" | "fail" | "na" }

CREATE TABLE "biosecurity_logs" (
    "id"               TEXT NOT NULL,
    "log_date"         DATE NOT NULL,
    "checkpoint_type"  TEXT NOT NULL,
    "logged_by_id"     TEXT NOT NULL,
    "checks"           JSONB NOT NULL DEFAULT '{}',
    "item_notes"       JSONB NOT NULL DEFAULT '{}',
    "overall_notes"    TEXT,
    "fail_count"       INTEGER NOT NULL DEFAULT 0,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "biosecurity_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "biosecurity_logs_log_date_idx" ON "biosecurity_logs"("log_date");
CREATE INDEX "biosecurity_logs_checkpoint_type_idx" ON "biosecurity_logs"("checkpoint_type");

-- ─── VISITOR ADVANCE NOTICE ───────────────────────────────────────────────────
-- Manager pre-registers expected visitors; Director approves/rejects.
-- status: "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED"

CREATE TABLE "visitor_advance_notices" (
    "id"               TEXT NOT NULL,
    "expected_date"    DATE NOT NULL,
    "visitor_name"     TEXT NOT NULL,
    "organisation"     TEXT,
    "purpose"          TEXT NOT NULL,
    "expected_count"   INTEGER NOT NULL DEFAULT 1,
    "house_ids"        TEXT[] NOT NULL DEFAULT '{}',
    "requested_by_id"  TEXT NOT NULL,
    "status"           TEXT NOT NULL DEFAULT 'PENDING',
    "director_note"    TEXT,
    "approved_by_id"   TEXT,
    "approved_at"      TIMESTAMP(3),
    "visitor_log_id"   TEXT,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "visitor_advance_notices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visitor_advance_notices_expected_date_idx" ON "visitor_advance_notices"("expected_date");
CREATE INDEX "visitor_advance_notices_status_idx" ON "visitor_advance_notices"("status");

-- ─── VISITOR LOG — add checkout support columns ───────────────────────────────
-- checkOutAt already exists in schema — no new column needed.
-- Add advance_notice_id foreign key link.
ALTER TABLE "visitor_log" ADD COLUMN IF NOT EXISTS "advance_notice_id" TEXT;
