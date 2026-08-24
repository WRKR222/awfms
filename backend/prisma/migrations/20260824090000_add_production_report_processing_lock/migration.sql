-- Per-batch mutex for StoreProductionReport reconciliation passes.
-- See ProductionReportProcessingLock in schema.prisma for why this is a
-- separate table instead of a column on store_production_reports.
CREATE TABLE "production_report_processing_locks" (
    "batch_id" TEXT NOT NULL,
    "processing_started_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_report_processing_locks_pkey" PRIMARY KEY ("batch_id")
);
