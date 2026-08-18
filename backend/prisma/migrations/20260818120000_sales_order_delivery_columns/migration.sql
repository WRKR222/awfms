-- ============================================================================
-- Migration: SalesOrder.deliveryNotes / SalesOrder.deliveredById
-- ----------------------------------------------------------------------------
-- Declared in schema.prisma (delivery_notes, delivered_by_id) but never
-- migrated onto the deployed database. Same drift class as the
-- bird-weight-sample fixes above. Idempotent (IF NOT EXISTS).
-- ============================================================================

ALTER TABLE "sales_orders"
  ADD COLUMN IF NOT EXISTS "delivery_notes" TEXT,
  ADD COLUMN IF NOT EXISTS "delivered_by_id" TEXT;
