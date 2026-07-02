-- Migration: 20260702020000_add_reorder_alert_notification_type
--
-- Fixes a bug identical in shape to 20260702010000_add_weekly_plan_early_reminder:
-- StoreInventoryService.recordStockOut() (GAP-05 reorder-level alert) creates a
-- Notification with type: 'REORDER_ALERT' as any, but 'REORDER_ALERT' was never
-- added to the NotificationType enum. Every stock-out that brings an item's
-- currentStock at or below its reorderLevel throws an unhandled Prisma error
-- AFTER the stock-out transaction has already committed, so the stock-out
-- itself succeeds (item created, stock decremented) but the request still
-- returns a 500 to the client.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REORDER_ALERT';
