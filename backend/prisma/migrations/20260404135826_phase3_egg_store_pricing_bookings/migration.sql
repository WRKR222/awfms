-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FULFILLED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'EGG_TALLY_TRIGGERED';
ALTER TYPE "NotificationType" ADD VALUE 'STOCK_LOCKED_BOOKING';
ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_CANCELLED';

-- CreateTable
CREATE TABLE "egg_collection_sessions" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "house_id" TEXT NOT NULL,
    "session_date" DATE NOT NULL,
    "shift" TEXT NOT NULL,
    "collected_by_id" TEXT NOT NULL,
    "opening_pop" INTEGER NOT NULL,
    "mortalities" INTEGER NOT NULL DEFAULT 0,
    "closing_stock" INTEGER NOT NULL,
    "row_data" JSONB NOT NULL,
    "total_full_trays" INTEGER NOT NULL,
    "total_loose_eggs" INTEGER NOT NULL,
    "total_broken_eggs" INTEGER NOT NULL DEFAULT 0,
    "total_soft_shell" INTEGER NOT NULL DEFAULT 0,
    "total_deformed" INTEGER NOT NULL DEFAULT 0,
    "total_weight_kg" DECIMAL(8,2) NOT NULL,
    "total_good_eggs" INTEGER NOT NULL,
    "hen_day_percent" DECIMAL(5,2),
    "vaccine_given" TEXT,
    "daily_feed_kg" DECIMAL(8,2),
    "remarks" TEXT,
    "status" "EntryStatus" NOT NULL DEFAULT 'PENDING',
    "return_reason" TEXT,
    "verified_by_id" TEXT,
    "verified_at" TIMESTAMP(3),
    "store_signed_by_id" TEXT,
    "store_signed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "egg_collection_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_egg_intakes" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "house_id" TEXT NOT NULL,
    "intake_date" DATE NOT NULL,
    "shift" TEXT NOT NULL,
    "received_by_id" TEXT NOT NULL,
    "row_data" JSONB NOT NULL,
    "total_full_trays" INTEGER NOT NULL,
    "total_loose_eggs" INTEGER NOT NULL,
    "total_good_eggs" INTEGER NOT NULL,
    "total_weight_kg" DECIMAL(8,2) NOT NULL,
    "has_discrepancy" BOOLEAN NOT NULL DEFAULT false,
    "discrepancy_note" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_egg_intakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_egg_prices" (
    "id" TEXT NOT NULL,
    "price_date" DATE NOT NULL,
    "price_per_egg" DECIMAL(8,4) NOT NULL,
    "expected_revenue" DECIMAL(12,2),
    "notes" TEXT,
    "set_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_egg_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advance_bookings" (
    "id" TEXT NOT NULL,
    "booking_ref" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "requested_date" DATE NOT NULL,
    "booking_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quantity_trays" INTEGER NOT NULL,
    "quantity_eggs" INTEGER NOT NULL,
    "price_per_egg_kes" DECIMAL(8,4) NOT NULL,
    "estimated_total" DECIMAL(12,2) NOT NULL,
    "stock_locked" BOOLEAN NOT NULL DEFAULT true,
    "locked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlocked_at" TIMESTAMP(3),
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "cancellation_reason" TEXT,
    "sales_order_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advance_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "egg_collection_sessions_house_id_session_date_idx" ON "egg_collection_sessions"("house_id", "session_date");

-- CreateIndex
CREATE INDEX "egg_collection_sessions_status_idx" ON "egg_collection_sessions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "egg_collection_sessions_batch_id_house_id_session_date_shif_key" ON "egg_collection_sessions"("batch_id", "house_id", "session_date", "shift");

-- CreateIndex
CREATE UNIQUE INDEX "store_egg_intakes_session_id_key" ON "store_egg_intakes"("session_id");

-- CreateIndex
CREATE INDEX "store_egg_intakes_house_id_intake_date_idx" ON "store_egg_intakes"("house_id", "intake_date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_egg_prices_price_date_key" ON "daily_egg_prices"("price_date");

-- CreateIndex
CREATE INDEX "daily_egg_prices_price_date_idx" ON "daily_egg_prices"("price_date");

-- CreateIndex
CREATE UNIQUE INDEX "advance_bookings_booking_ref_key" ON "advance_bookings"("booking_ref");

-- CreateIndex
CREATE UNIQUE INDEX "advance_bookings_sales_order_id_key" ON "advance_bookings"("sales_order_id");

-- CreateIndex
CREATE INDEX "advance_bookings_status_idx" ON "advance_bookings"("status");

-- CreateIndex
CREATE INDEX "advance_bookings_requested_date_idx" ON "advance_bookings"("requested_date");

-- CreateIndex
CREATE INDEX "advance_bookings_customer_id_idx" ON "advance_bookings"("customer_id");

-- AddForeignKey
ALTER TABLE "egg_collection_sessions" ADD CONSTRAINT "egg_collection_sessions_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_egg_intakes" ADD CONSTRAINT "store_egg_intakes_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "egg_collection_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_egg_prices" ADD CONSTRAINT "daily_egg_prices_set_by_id_fkey" FOREIGN KEY ("set_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_bookings" ADD CONSTRAINT "advance_bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_bookings" ADD CONSTRAINT "advance_bookings_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
