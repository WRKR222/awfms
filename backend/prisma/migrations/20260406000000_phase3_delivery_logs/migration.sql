-- Phase 3 Remaining: Delivery Logs (Emali route tracking)
-- CreateTable
CREATE TABLE "delivery_logs" (
    "id"             TEXT NOT NULL,
    "delivery_ref"   TEXT NOT NULL,
    "delivery_date"  DATE NOT NULL,
    "route"          TEXT NOT NULL,
    "destination"    TEXT NOT NULL,
    "customer_id"    TEXT,
    "driver_name"    TEXT,
    "vehicle_plate"  TEXT,
    "quantity_trays" INTEGER NOT NULL,
    "quantity_eggs"  INTEGER NOT NULL,
    "notes"          TEXT,
    "status"         TEXT NOT NULL DEFAULT 'PENDING',
    "failure_reason" TEXT,
    "delivered_at"   TIMESTAMP(3),
    "logged_by_id"   TEXT NOT NULL,
    "sales_order_id" TEXT,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "delivery_logs_delivery_ref_key" ON "delivery_logs"("delivery_ref");
CREATE INDEX "delivery_logs_delivery_date_idx" ON "delivery_logs"("delivery_date");
CREATE INDEX "delivery_logs_status_idx" ON "delivery_logs"("status");
CREATE INDEX "delivery_logs_route_idx" ON "delivery_logs"("route");

-- AddForeignKey
ALTER TABLE "delivery_logs" ADD CONSTRAINT "delivery_logs_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "delivery_logs" ADD CONSTRAINT "delivery_logs_logged_by_id_fkey"
    FOREIGN KEY ("logged_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "delivery_logs" ADD CONSTRAINT "delivery_logs_sales_order_id_fkey"
    FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
