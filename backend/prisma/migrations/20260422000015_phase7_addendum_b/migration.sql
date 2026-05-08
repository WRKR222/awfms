-- Phase 7 Addendum B: Cage Map, Stores Issuance, Data Upload, Accountant Export

-- FarmBlock
CREATE TABLE "farm_blocks" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "is_under_construction" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "farm_blocks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "farm_blocks_code_key" ON "farm_blocks"("code");

CREATE TABLE "farm_sections" (
  "id" TEXT NOT NULL,
  "block_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "farm_sections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "farm_sections_block_id_code_key" ON "farm_sections"("block_id","code");

CREATE TABLE "farm_rows" (
  "id" TEXT NOT NULL,
  "section_id" TEXT NOT NULL,
  "row_code" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "farm_rows_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "farm_rows_section_id_row_code_key" ON "farm_rows"("section_id","row_code");

CREATE TABLE "batch_cage_assignments" (
  "id" TEXT NOT NULL,
  "row_id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "transfer_date" DATE NOT NULL,
  "notes" TEXT,
  "assigned_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "batch_cage_assignments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "batch_cage_assignments_row_id_key" ON "batch_cage_assignments"("row_id");

ALTER TABLE "farm_sections" ADD CONSTRAINT "farm_sections_block_id_fkey" FOREIGN KEY ("block_id") REFERENCES "farm_blocks"("id");
ALTER TABLE "farm_rows" ADD CONSTRAINT "farm_rows_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "farm_sections"("id");
ALTER TABLE "batch_cage_assignments" ADD CONSTRAINT "batch_cage_assignments_row_id_fkey" FOREIGN KEY ("row_id") REFERENCES "farm_rows"("id");

CREATE TABLE "store_issuances" (
  "id" TEXT NOT NULL,
  "issuance_date" DATE NOT NULL,
  "particulars" TEXT NOT NULL,
  "balance_brought_down" DECIMAL(12,3) NOT NULL DEFAULT 0,
  "quantities_in" DECIMAL(12,3) NOT NULL DEFAULT 0,
  "unit_measure" TEXT,
  "total" DECIMAL(12,3) NOT NULL DEFAULT 0,
  "received_by_name" TEXT,
  "supplier_name" TEXT,
  "quantity_issued" DECIMAL(12,3) NOT NULL DEFAULT 0,
  "issued_to_name" TEXT,
  "department" TEXT,
  "issued_by_name" TEXT,
  "balance_carried_down" DECIMAL(12,3) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "store_issuances_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "store_issuances_issuance_date_idx" ON "store_issuances"("issuance_date");

CREATE TABLE "named_upload_templates" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "column_mapping" JSONB NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "named_upload_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "historical_upload_logs" (
  "id" TEXT NOT NULL,
  "template_id" TEXT,
  "upload_type" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "records_imported" INTEGER NOT NULL DEFAULT 0,
  "date_from" DATE,
  "date_to" DATE,
  "uploaded_by_id" TEXT NOT NULL,
  "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "historical_upload_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "historical_production_records" (
  "id" TEXT NOT NULL, "upload_log_id" TEXT NOT NULL,
  "date" DATE NOT NULL, "good_eggs" INTEGER NOT NULL,
  "broken_eggs" INTEGER NOT NULL DEFAULT 0, "bird_count" INTEGER NOT NULL,
  "mortality" INTEGER NOT NULL DEFAULT 0, "batch_code" TEXT, "notes" TEXT,
  CONSTRAINT "historical_production_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "historical_sales_records" (
  "id" TEXT NOT NULL, "upload_log_id" TEXT NOT NULL,
  "invoice_date" DATE NOT NULL, "invoice_number" TEXT NOT NULL,
  "customer_name" TEXT NOT NULL, "quantity_trays" INTEGER NOT NULL,
  "total_kes" DECIMAL(12,2) NOT NULL, "unit_price_kes" DECIMAL(10,2),
  "payment_method" TEXT, "payment_date" DATE, "payment_reference" TEXT,
  CONSTRAINT "historical_sales_records_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "historical_sales_records_invoice_number_key" ON "historical_sales_records"("invoice_number");

CREATE TABLE "historical_cost_records" (
  "id" TEXT NOT NULL, "upload_log_id" TEXT NOT NULL,
  "date" DATE NOT NULL, "category" TEXT NOT NULL, "description" TEXT NOT NULL,
  "total_cost_kes" DECIMAL(12,2) NOT NULL, "quantity" DECIMAL(12,3),
  "unit" TEXT, "unit_cost_kes" DECIMAL(10,2), "supplier" TEXT, "batch_code" TEXT,
  CONSTRAINT "historical_cost_records_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "historical_upload_logs" ADD CONSTRAINT "historical_upload_logs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "named_upload_templates"("id") ON DELETE SET NULL;
ALTER TABLE "historical_production_records" ADD CONSTRAINT "historical_production_records_upload_log_id_fkey" FOREIGN KEY ("upload_log_id") REFERENCES "historical_upload_logs"("id");
ALTER TABLE "historical_sales_records" ADD CONSTRAINT "historical_sales_records_upload_log_id_fkey" FOREIGN KEY ("upload_log_id") REFERENCES "historical_upload_logs"("id");
ALTER TABLE "historical_cost_records" ADD CONSTRAINT "historical_cost_records_upload_log_id_fkey" FOREIGN KEY ("upload_log_id") REFERENCES "historical_upload_logs"("id");

CREATE TABLE "accountant_export_layouts" (
  "id" TEXT NOT NULL, "layout_config" JSONB NOT NULL,
  "uploaded_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accountant_export_layouts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "accountant_qb_expense_uploads" (
  "id" TEXT NOT NULL, "month" TEXT NOT NULL, "category" TEXT NOT NULL,
  "amount_kes" DECIMAL(12,2) NOT NULL, "description" TEXT,
  "uploaded_by_id" TEXT NOT NULL,
  "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accountant_qb_expense_uploads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "accountant_price_references" (
  "id" TEXT NOT NULL, "ref_date" DATE NOT NULL, "competitor_name" TEXT NOT NULL,
  "price_per_tray_kes" DECIMAL(10,2) NOT NULL, "market" TEXT,
  "uploaded_by_id" TEXT NOT NULL,
  "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accountant_price_references_pkey" PRIMARY KEY ("id")
);
