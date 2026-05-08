-- Phase 5: Visitor gate logs (security check-in/check-out at gates)
CREATE TABLE "visitor_gate_logs" (
    "id"              TEXT NOT NULL,
    "visitor_id"      TEXT NOT NULL,
    "gate"            TEXT NOT NULL,
    "action"          TEXT NOT NULL,
    "timestamp"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recorded_by_id"  TEXT NOT NULL,
    "notes"           TEXT,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "visitor_gate_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visitor_gate_logs_visitor_id_idx" ON "visitor_gate_logs"("visitor_id");
CREATE INDEX "visitor_gate_logs_gate_timestamp_idx" ON "visitor_gate_logs"("gate", "timestamp");
