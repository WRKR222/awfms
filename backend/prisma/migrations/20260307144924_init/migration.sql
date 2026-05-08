-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ATTENDANT', 'SUPERVISOR', 'MANAGER', 'ACCOUNTANT', 'OWNER');

-- CreateEnum
CREATE TYPE "BatchStage" AS ENUM ('BROODING', 'GROWER', 'PRODUCTION', 'CLOSED');

-- CreateEnum
CREATE TYPE "BirdType" AS ENUM ('LAYER_COMMERCIAL', 'KIENYEJI');

-- CreateEnum
CREATE TYPE "MortalityCause" AS ENUM ('DISEASE', 'INJURY', 'HEAT_STRESS', 'PREDATOR', 'CULLED_SICK', 'CULLED_LOW_PRODUCTIVITY', 'CULLED_OVERPOPULATION', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "EntryStatus" AS ENUM ('PENDING', 'APPROVED', 'RETURNED');

-- CreateEnum
CREATE TYPE "EggGrade" AS ENUM ('SMALL', 'MEDIUM', 'LARGE', 'EXTRA_LARGE', 'REJECT');

-- CreateEnum
CREATE TYPE "FeedType" AS ENUM ('CHICK_MASH', 'GROWER_MASH', 'LAYER_MASH', 'KIENYEJI_STARTER', 'KIENYEJI_GROWER', 'KIENYEJI_FINISHER');

-- CreateEnum
CREATE TYPE "HealthEventType" AS ENUM ('DISEASE_OUTBREAK', 'INJURY', 'ROUTINE_CHECKUP', 'MEDICATION', 'QUARANTINE_IMPOSED', 'QUARANTINE_LIFTED');

-- CreateEnum
CREATE TYPE "VaccinationRoute" AS ENUM ('DRINKING_WATER', 'EYE_DROP', 'INJECTION', 'SPRAY', 'WING_WEB');

-- CreateEnum
CREATE TYPE "SalesTier" AS ENUM ('TIER_1', 'TIER_2');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DELIVERED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('FEED_LOW_STOCK', 'MORTALITY_ANOMALY', 'VERIFICATION_PENDING', 'OVERDUE_INVOICE', 'VACCINATION_DUE', 'AI_REPORT_READY', 'ENTRY_RETURNED', 'SYSTEM');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "full_name" TEXT NOT NULL,
    "house_ids" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "old_values" JSONB,
    "new_values" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "houses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "bird_type" "BirdType" NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "houses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" TEXT NOT NULL,
    "batch_code" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "house_id" TEXT NOT NULL,
    "bird_type" "BirdType" NOT NULL,
    "strain" TEXT NOT NULL,
    "quantity_received" INTEGER NOT NULL,
    "current_bird_count" INTEGER NOT NULL,
    "date_of_hatch" TIMESTAMP(3) NOT NULL,
    "date_received" TIMESTAMP(3) NOT NULL,
    "stage" "BatchStage" NOT NULL DEFAULT 'BROODING',
    "vaccination_on_arrival" BOOLEAN NOT NULL DEFAULT false,
    "mortality_on_arrival" INTEGER NOT NULL DEFAULT 0,
    "transport_conditions" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "closed_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flock_daily_entries" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "house_id" TEXT NOT NULL,
    "entry_date" DATE NOT NULL,
    "shift" TEXT NOT NULL DEFAULT 'AM',
    "opening_count" INTEGER NOT NULL,
    "mortality_count" INTEGER NOT NULL DEFAULT 0,
    "mortality_cause" "MortalityCause",
    "culling_count" INTEGER NOT NULL DEFAULT 0,
    "culling_reason" TEXT,
    "closing_count" INTEGER NOT NULL,
    "water_consumption_l" DECIMAL(8,2),
    "temperature_celsius" DECIMAL(4,1),
    "humidity_percent" DECIMAL(4,1),
    "notes" TEXT,
    "status" "EntryStatus" NOT NULL DEFAULT 'PENDING',
    "submitted_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "return_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flock_daily_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bird_weight_samples" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "sample_date" DATE NOT NULL,
    "sample_count" INTEGER NOT NULL,
    "total_weight_g" INTEGER NOT NULL,
    "average_weight_g" DECIMAL(8,2) NOT NULL,
    "age_weeks" INTEGER NOT NULL,
    "notes" TEXT,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bird_weight_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_deliveries" (
    "id" TEXT NOT NULL,
    "feed_type" "FeedType" NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "quantity_kg" DECIMAL(10,2) NOT NULL,
    "price_per_kg" DECIMAL(10,2) NOT NULL,
    "total_cost" DECIMAL(12,2) NOT NULL,
    "delivery_date" DATE NOT NULL,
    "invoice_number" TEXT,
    "notes" TEXT,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_intake_logs" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "house_id" TEXT NOT NULL,
    "feed_type" "FeedType" NOT NULL,
    "entry_date" DATE NOT NULL,
    "quantity_dispensed_kg" DECIMAL(8,2) NOT NULL,
    "wastage_kg" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "recommended_min_kg" DECIMAL(8,2),
    "recommended_max_kg" DECIMAL(8,2),
    "status" "EntryStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "recorded_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "return_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,

    CONSTRAINT "feed_intake_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_stock_snapshots" (
    "id" TEXT NOT NULL,
    "feed_type" "FeedType" NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "stock_kg" DECIMAL(10,2) NOT NULL,
    "avg_daily_usage_kg" DECIMAL(8,2) NOT NULL,
    "days_remaining" DECIMAL(6,1) NOT NULL,
    "alert_fired" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_stock_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaccination_schedule" (
    "id" TEXT NOT NULL,
    "vaccine_name" TEXT NOT NULL,
    "bird_type" "BirdType" NOT NULL,
    "age_weeks" INTEGER NOT NULL,
    "route" "VaccinationRoute" NOT NULL,
    "booster_weeks" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vaccination_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaccination_records" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "schedule_id" TEXT,
    "vaccine_name" TEXT NOT NULL,
    "administered_date" DATE NOT NULL,
    "route" "VaccinationRoute" NOT NULL,
    "batch_size" INTEGER NOT NULL,
    "dosage_units" TEXT,
    "vet_name" TEXT,
    "notes" TEXT,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vaccination_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_events" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "event_type" "HealthEventType" NOT NULL,
    "event_date" DATE NOT NULL,
    "affected_count" INTEGER NOT NULL,
    "symptoms" TEXT,
    "diagnosis" TEXT,
    "treatment" TEXT,
    "outcome" TEXT,
    "is_resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMP(3),
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vet_pdf_reports" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "health_event_id" TEXT,
    "report_date" DATE NOT NULL,
    "vet_name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "r2_key" TEXT NOT NULL,
    "r2_url" TEXT NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vet_pdf_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visitor_log" (
    "id" TEXT NOT NULL,
    "visitor_name" TEXT NOT NULL,
    "organisation" TEXT,
    "purpose" TEXT NOT NULL,
    "check_in_at" TIMESTAMP(3) NOT NULL,
    "check_out_at" TIMESTAMP(3),
    "biosecurity_checks" JSONB NOT NULL,
    "house_id" TEXT,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visitor_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_entries" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "house_id" TEXT NOT NULL,
    "entry_date" DATE NOT NULL,
    "shift" TEXT NOT NULL DEFAULT 'AM',
    "eggs_small" INTEGER NOT NULL DEFAULT 0,
    "eggs_medium" INTEGER NOT NULL DEFAULT 0,
    "eggs_large" INTEGER NOT NULL DEFAULT 0,
    "eggs_extra_large" INTEGER NOT NULL DEFAULT 0,
    "eggs_reject" INTEGER NOT NULL DEFAULT 0,
    "total_eggs" INTEGER NOT NULL,
    "hen_day_percent" DECIMAL(5,2),
    "status" "EntryStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "submitted_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "return_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" TEXT NOT NULL,
    "item_type" TEXT NOT NULL,
    "grade" TEXT,
    "movement_type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reference_id" TEXT,
    "notes" TEXT,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temperature_logs" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "location_type" TEXT NOT NULL,
    "temperature_c" DECIMAL(4,1) NOT NULL,
    "humidity_pct" DECIMAL(4,1),
    "logged_at" TIMESTAMP(3) NOT NULL,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "temperature_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "credit_days" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "egg_price_tiers" (
    "id" TEXT NOT NULL,
    "tier" "SalesTier" NOT NULL,
    "min_trays" INTEGER NOT NULL,
    "max_trays" INTEGER,
    "price_per_tray" DECIMAL(10,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "egg_price_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "order_date" DATE NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "delivery_date" DATE,
    "delivery_address" TEXT,
    "tier" "SalesTier" NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "created_by_id" TEXT NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "item_type" TEXT NOT NULL,
    "grade" TEXT,
    "quantity_trays" INTEGER,
    "quantity_kg" DECIMAL(8,2),
    "unit_price" DECIMAL(10,2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "sales_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "sales_order_id" TEXT,
    "customer_id" TEXT NOT NULL,
    "invoice_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "balance_due" DECIMAL(12,2) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'UNPAID',
    "pdf_r2_key" TEXT,
    "notes" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_payments" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "payment_date" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_method" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ar_entries" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "original_amount" DECIMAL(12,2) NOT NULL,
    "current_balance" DECIMAL(12,2) NOT NULL,
    "due_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ar_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_logs" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "expense_date" DATE NOT NULL,
    "batch_id" TEXT,
    "vendor_name" TEXT,
    "receipt_ref" TEXT,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_reports" (
    "id" TEXT NOT NULL,
    "report_type" TEXT NOT NULL,
    "week_ending" DATE,
    "content" TEXT NOT NULL,
    "raw_data" JSONB NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entity_id" TEXT,
    "entity_type" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "refresh_tokens"("token");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_token_idx" ON "refresh_tokens"("token");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "houses_code_key" ON "houses"("code");

-- CreateIndex
CREATE UNIQUE INDEX "batches_batch_code_key" ON "batches"("batch_code");

-- CreateIndex
CREATE INDEX "batches_house_id_idx" ON "batches"("house_id");

-- CreateIndex
CREATE INDEX "batches_stage_idx" ON "batches"("stage");

-- CreateIndex
CREATE INDEX "batches_is_active_idx" ON "batches"("is_active");

-- CreateIndex
CREATE INDEX "flock_daily_entries_batch_id_entry_date_idx" ON "flock_daily_entries"("batch_id", "entry_date");

-- CreateIndex
CREATE INDEX "flock_daily_entries_status_idx" ON "flock_daily_entries"("status");

-- CreateIndex
CREATE INDEX "flock_daily_entries_submitted_by_id_idx" ON "flock_daily_entries"("submitted_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "flock_daily_entries_batch_id_entry_date_shift_key" ON "flock_daily_entries"("batch_id", "entry_date", "shift");

-- CreateIndex
CREATE INDEX "bird_weight_samples_batch_id_sample_date_idx" ON "bird_weight_samples"("batch_id", "sample_date");

-- CreateIndex
CREATE INDEX "feed_deliveries_feed_type_delivery_date_idx" ON "feed_deliveries"("feed_type", "delivery_date");

-- CreateIndex
CREATE INDEX "feed_intake_logs_batch_id_entry_date_idx" ON "feed_intake_logs"("batch_id", "entry_date");

-- CreateIndex
CREATE INDEX "feed_intake_logs_status_idx" ON "feed_intake_logs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "feed_intake_logs_batch_id_entry_date_feed_type_key" ON "feed_intake_logs"("batch_id", "entry_date", "feed_type");

-- CreateIndex
CREATE INDEX "feed_stock_snapshots_feed_type_snapshot_date_idx" ON "feed_stock_snapshots"("feed_type", "snapshot_date");

-- CreateIndex
CREATE INDEX "vaccination_records_batch_id_idx" ON "vaccination_records"("batch_id");

-- CreateIndex
CREATE INDEX "health_events_batch_id_event_date_idx" ON "health_events"("batch_id", "event_date");

-- CreateIndex
CREATE INDEX "vet_pdf_reports_batch_id_idx" ON "vet_pdf_reports"("batch_id");

-- CreateIndex
CREATE INDEX "visitor_log_check_in_at_idx" ON "visitor_log"("check_in_at");

-- CreateIndex
CREATE INDEX "production_entries_batch_id_entry_date_idx" ON "production_entries"("batch_id", "entry_date");

-- CreateIndex
CREATE INDEX "production_entries_status_idx" ON "production_entries"("status");

-- CreateIndex
CREATE UNIQUE INDEX "production_entries_batch_id_entry_date_shift_key" ON "production_entries"("batch_id", "entry_date", "shift");

-- CreateIndex
CREATE INDEX "inventory_movements_item_type_movement_type_idx" ON "inventory_movements"("item_type", "movement_type");

-- CreateIndex
CREATE INDEX "inventory_movements_created_at_idx" ON "inventory_movements"("created_at");

-- CreateIndex
CREATE INDEX "temperature_logs_location_id_logged_at_idx" ON "temperature_logs"("location_id", "logged_at");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_order_number_key" ON "sales_orders"("order_number");

-- CreateIndex
CREATE INDEX "sales_orders_customer_id_idx" ON "sales_orders"("customer_id");

-- CreateIndex
CREATE INDEX "sales_orders_status_idx" ON "sales_orders"("status");

-- CreateIndex
CREATE INDEX "sales_orders_order_date_idx" ON "sales_orders"("order_date");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");

-- CreateIndex
CREATE INDEX "invoices_customer_id_idx" ON "invoices"("customer_id");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE INDEX "invoices_due_date_idx" ON "invoices"("due_date");

-- CreateIndex
CREATE INDEX "invoice_payments_invoice_id_idx" ON "invoice_payments"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "ar_entries_invoice_id_key" ON "ar_entries"("invoice_id");

-- CreateIndex
CREATE INDEX "ar_entries_customer_id_idx" ON "ar_entries"("customer_id");

-- CreateIndex
CREATE INDEX "ar_entries_due_date_idx" ON "ar_entries"("due_date");

-- CreateIndex
CREATE INDEX "expense_logs_category_expense_date_idx" ON "expense_logs"("category", "expense_date");

-- CreateIndex
CREATE INDEX "expense_logs_batch_id_idx" ON "expense_logs"("batch_id");

-- CreateIndex
CREATE INDEX "ai_reports_report_type_week_ending_idx" ON "ai_reports"("report_type", "week_ending");

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_idx" ON "notifications"("user_id", "is_read");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "system_config_key_key" ON "system_config"("key");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_house_id_fkey" FOREIGN KEY ("house_id") REFERENCES "houses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flock_daily_entries" ADD CONSTRAINT "flock_daily_entries_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flock_daily_entries" ADD CONSTRAINT "flock_daily_entries_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flock_daily_entries" ADD CONSTRAINT "flock_daily_entries_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bird_weight_samples" ADD CONSTRAINT "bird_weight_samples_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_intake_logs" ADD CONSTRAINT "feed_intake_logs_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_intake_logs" ADD CONSTRAINT "feed_intake_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccination_records" ADD CONSTRAINT "vaccination_records_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccination_records" ADD CONSTRAINT "vaccination_records_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "vaccination_schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_events" ADD CONSTRAINT "health_events_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vet_pdf_reports" ADD CONSTRAINT "vet_pdf_reports_health_event_id_fkey" FOREIGN KEY ("health_event_id") REFERENCES "health_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_entries" ADD CONSTRAINT "production_entries_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_entries" ADD CONSTRAINT "production_entries_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_entries" ADD CONSTRAINT "ar_entries_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_entries" ADD CONSTRAINT "ar_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
