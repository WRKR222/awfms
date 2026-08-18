// src/common/enums/permissions.enum.ts
// CLEANED UP — HEALTH_VET_PDF_VIEW removed (anyone with HEALTH_VIEW can see vet PDFs).
// Added STOCK_REQUEST_* and TALLY_* keys.

export enum Permission {
  FLOCK_VIEW                   = 'flock:view',
  FLOCK_ENTRY_CREATE           = 'flock:entry:create',
  FLOCK_ENTRY_APPROVE          = 'flock:entry:approve',
  FLOCK_BATCH_MANAGE           = 'flock:batch:manage',
  FLOCK_WEIGHT_LOG             = 'flock:weight:log',

  FEED_VIEW                    = 'feed:view',
  FEED_INTAKE_LOG              = 'feed:intake:log',
  FEED_DELIVERY_LOG            = 'feed:delivery:log',
  FEED_APPROVE                 = 'feed:approve',
  FEED_STOCK_VIEW              = 'feed:stock:view',

  HEALTH_VIEW                  = 'health:view',
  HEALTH_EVENT_LOG             = 'health:event:log',
  HEALTH_VACCINATION_LOG       = 'health:vaccination:log',
  HEALTH_VACCINATION_MANAGE    = 'health:vaccination:manage',
  HEALTH_VET_PDF_UPLOAD        = 'health:vet_pdf:upload', // Manager-only

  HEALTH_VISITOR_LOG           = 'health:visitor:log',
  HEALTH_VISITOR_VIEW          = 'health:visitor:view',
  VISITOR_LOG_VIEW             = 'health:visitor:view',
  VISITOR_LOG_CREATE           = 'health:visitor:create',
  VISITOR_NOTICE_CREATE        = 'visitor:notice:create',
  VISITOR_NOTICE_APPROVE       = 'visitor:notice:approve', // Director/Owner

  // Bird weight standard-band monitoring
  WEIGHT_ALERT_VIEW            = 'weight:alert:view',             // OWNER (+ MANAGER for their own batches)
  WEIGHT_ALERT_MANAGE          = 'weight:alert:manage',           // OWNER only — acknowledge/resolve
  BIRD_WEIGHT_REPORT_UPLOAD    = 'weight:report:upload',          // MANAGER (PM) only

  PRODUCTION_VIEW              = 'production:view',
  PRODUCTION_ENTRY_CREATE      = 'production:entry:create',  // Lead Attendant
  PRODUCTION_ENTRY_APPROVE     = 'production:entry:approve', // Manager (same-evening verify + tally edit)
  PRODUCTION_SESSION_VIEW      = 'production:session:view',
  PRODUCTION_INTAKE_LOG        = 'production:intake:log',

  TALLY_SIGN                   = 'tally:sign',  // PM, Sales, Store
  TALLY_LOCK_VIEW              = 'tally:lock:view',

  INVENTORY_VIEW               = 'inventory:view',
  INVENTORY_MANAGE             = 'inventory:manage',
  INVENTORY_SPOILAGE_LOG       = 'inventory:spoilage:log',

  SALES_VIEW                   = 'sales:view',
  SALES_ORDER_CREATE           = 'sales:order:create',
  SALES_ORDER_MANAGE           = 'sales:order:manage',
  SALES_CUSTOMER_MANAGE        = 'sales:customer:manage',
  SALES_DELIVERY_LOG           = 'sales:delivery:log',

  INVOICE_VIEW                 = 'invoice:view',
  INVOICE_MANAGE               = 'invoice:manage',
  INVOICE_PAYMENT_LOG          = 'invoice:payment:log',
  AR_VIEW                      = 'ar:view',
  AR_MANAGE                    = 'ar:manage',

  FINANCE_VIEW                 = 'finance:view',
  FINANCE_EXPENSE_LOG          = 'finance:expense:log',
  FINANCE_REPORT_VIEW          = 'finance:report:view',
  FINANCE_EXPORT               = 'finance:export',
  PRICING_MANAGE               = 'pricing:manage',

  AI_REPORTS_VIEW              = 'ai:reports:view',
  AI_ALERTS_VIEW               = 'ai:alerts:view',

  USERS_MANAGE                 = 'users:manage',
  SETTINGS_MANAGE              = 'settings:manage',
  AUDIT_LOG_VIEW               = 'audit:view',

  BOOKINGS_VIEW                = 'bookings:view',
  BOOKINGS_MANAGE              = 'bookings:manage',

  // Phase 2 procurement
  PURCHASE_REQUEST_CREATE      = 'purchase_request:create',  // STORE only
  PURCHASE_REQUEST_REVIEW      = 'purchase_request:review',  // ACCOUNTANT
  LPO_MANAGE                   = 'lpo:manage',               // ACCOUNTANT
  LPO_APPROVE                  = 'lpo:approve',              // OWNER (Director)

  // NEW — simple stock request flow (PM/Sales/Accountant → Store)
  STOCK_REQUEST_CREATE         = 'stock_request:create',
  STOCK_REQUEST_VIEW           = 'stock_request:view',
  STOCK_REQUEST_FULFILL        = 'stock_request:fulfill',    // STORE

  // PM weekly item requisition — folded into the Issuance Plan
  PM_REQUISITION_CREATE        = 'pm_requisition:create',    // MANAGER only
  PM_REQUISITION_VIEW          = 'pm_requisition:view',      // MANAGER, STORE, OWNER
  // Delete a requisition line (or its cascaded issuance-plan line) —
  // deliberately separate from PM_REQUISITION_CREATE so any role that can
  // VIEW a requisition (MANAGER, STORE, OWNER) can also remove a line from
  // it, not just the PM who originally created that requisition.
  PM_REQUISITION_ITEM_DELETE   = 'pm_requisition:item_delete', // MANAGER, STORE, OWNER

  HR_VIEW                      = 'hr:view',
  HR_MANAGE                    = 'hr:manage',

  // Construction
  CONSTRUCTION_VIEW            = 'construction:view',
  CONSTRUCTION_LOG             = 'construction:log',
  CONSTRUCTION_LABOR_LOG       = 'construction:labor:log',   // STORE

  // Phase 3 — Egg breakage adjustments
  BREAKAGE_LOG                 = 'breakage:log',
  BREAKAGE_REVIEW              = 'breakage:review',
  BREAKAGE_VIEW                = 'breakage:view',

  // Store production report verification
  PRODUCTION_REPORT_UPLOAD     = 'production_report:upload',    // STORE only
  PRODUCTION_REPORT_VIEW       = 'production_report:view',      // STORE, MANAGER, OWNER
  PRODUCTION_REPORT_REVIEW     = 'production_report:review',    // STORE (self-service), OWNER — approve/reject/rollback discrepancies
}
