/**
 * Internal event name constants shared between NotificationsService and EventsGateway.
 * NotificationsService emits these via EventEmitter2 (global).
 * EventsGateway listens with @OnEvent and forwards to WebSocket clients.
 * This file is intentionally constants-only — no class, no providers.
 */
export const NOTIFICATION_CREATED_EVENT = 'notification.created';
export const DASHBOARD_REFRESH_EVENT    = 'dashboard.refresh';
/** A brooder batch (or part of it) moved to a production house —
 *  payload { batchId (production batch), sourceBatchId, transferDate, userId }. */
export const BATCH_TRANSFERRED_EVENT    = 'batch.transferred';
