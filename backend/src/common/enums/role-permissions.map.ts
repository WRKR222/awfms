import { UserRole } from '@prisma/client';
import { Permission } from './permissions.enum';

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.ATTENDANT]: [
    Permission.FLOCK_VIEW, Permission.FLOCK_ENTRY_CREATE, Permission.FLOCK_WEIGHT_LOG,
    Permission.FEED_VIEW, Permission.FEED_INTAKE_LOG, Permission.FEED_STOCK_VIEW,
    Permission.HEALTH_VIEW, Permission.HEALTH_VACCINATION_LOG, Permission.HEALTH_EVENT_LOG,
    Permission.PRODUCTION_VIEW, Permission.PRODUCTION_ENTRY_CREATE,
  ],
  [UserRole.MANAGER]: [
    Permission.FLOCK_VIEW, Permission.FLOCK_ENTRY_CREATE, Permission.FLOCK_ENTRY_APPROVE,
    Permission.FLOCK_WEIGHT_LOG, Permission.FLOCK_BATCH_MANAGE,
    Permission.FEED_VIEW, Permission.FEED_INTAKE_LOG, Permission.FEED_DELIVERY_LOG,
    Permission.FEED_APPROVE, Permission.FEED_STOCK_VIEW,
    Permission.HEALTH_VIEW, Permission.HEALTH_EVENT_LOG, Permission.HEALTH_VACCINATION_LOG,
    Permission.HEALTH_VACCINATION_MANAGE, Permission.HEALTH_VET_PDF_UPLOAD, Permission.HEALTH_VISITOR_LOG,
    Permission.PRODUCTION_VIEW, Permission.PRODUCTION_ENTRY_CREATE, Permission.PRODUCTION_ENTRY_APPROVE,
    Permission.INVENTORY_VIEW, Permission.INVENTORY_MANAGE, Permission.INVENTORY_SPOILAGE_LOG,
    Permission.SALES_VIEW, Permission.SALES_ORDER_CREATE, Permission.SALES_ORDER_MANAGE,
    Permission.SALES_CUSTOMER_MANAGE, Permission.SALES_DELIVERY_LOG,
    Permission.INVOICE_VIEW, Permission.AI_ALERTS_VIEW,
    Permission.BOOKINGS_VIEW, Permission.BOOKINGS_MANAGE,
    Permission.HR_VIEW,
    Permission.STOCK_REQUEST_CREATE,   // PM can raise stock requests to Store
    Permission.STOCK_REQUEST_VIEW,     // PM can view their stock requests
    // Tally sign-off — Production Manager is a primary signer
    Permission.PRODUCTION_SESSION_VIEW, Permission.TALLY_SIGN, Permission.TALLY_LOCK_VIEW,
  ],
  [UserRole.ACCOUNTANT]: [
    Permission.FLOCK_VIEW, Permission.FEED_VIEW, Permission.FEED_STOCK_VIEW,
    Permission.HEALTH_VIEW, Permission.PRODUCTION_VIEW, Permission.INVENTORY_VIEW,
    Permission.SALES_VIEW, Permission.SALES_ORDER_MANAGE, Permission.SALES_CUSTOMER_MANAGE,
    Permission.INVOICE_VIEW, Permission.INVOICE_MANAGE, Permission.INVOICE_PAYMENT_LOG,
    Permission.AR_VIEW, Permission.AR_MANAGE,
    Permission.FINANCE_VIEW, Permission.FINANCE_EXPENSE_LOG, Permission.FINANCE_REPORT_VIEW,
    Permission.FINANCE_EXPORT, Permission.PRICING_MANAGE,
    // Phase 2: Accountant reviews purchase requests and raises LPOs
    Permission.PURCHASE_REQUEST_REVIEW,
    Permission.LPO_MANAGE,
    // Phase 3: Accountant reviews breakage adjustments (credit notes)
    Permission.BREAKAGE_REVIEW,
    Permission.BREAKAGE_VIEW,
  ],
  [UserRole.OWNER]: Object.values(Permission),
  [UserRole.SALES]: [
    Permission.SALES_VIEW,
    Permission.SALES_ORDER_CREATE,
    Permission.SALES_ORDER_MANAGE,
    Permission.SALES_CUSTOMER_MANAGE,
    Permission.SALES_DELIVERY_LOG,
    Permission.INVOICE_VIEW,
    Permission.INVOICE_MANAGE,
    Permission.INVOICE_PAYMENT_LOG,  // FIX: Sales must be able to log payments via Pay button
    Permission.AR_VIEW,              // FIX: Sales must be able to view AR summary on Invoices tab
    Permission.BOOKINGS_VIEW,
    Permission.BOOKINGS_MANAGE,
    Permission.BREAKAGE_LOG,
    Permission.BREAKAGE_VIEW,
    // Tally sign-off — Sales signs the egg tally
    Permission.PRODUCTION_SESSION_VIEW, Permission.TALLY_SIGN, Permission.TALLY_LOCK_VIEW,
  ],
  [UserRole.STORE]: [
    // FIX: Store needs FLOCK_VIEW to list batches (GET /flock/batches) for the
    // "Recipient (Batch)" dropdown on Stock Out — without it the request 403s
    // and the dropdown silently falls back to an empty list ("— None —" only).
    Permission.FLOCK_VIEW,
    Permission.FEED_VIEW,
    Permission.FEED_STOCK_VIEW,
    Permission.FEED_INTAKE_LOG,
    Permission.FEED_APPROVE,    // Store can issue/approve feed requests from PM
    Permission.FEED_APPROVE,    // Store can issue/approve feed requests from PM
    Permission.INVENTORY_VIEW,
    Permission.INVENTORY_MANAGE,
    Permission.INVENTORY_SPOILAGE_LOG,
    Permission.PRODUCTION_VIEW,
    Permission.PRODUCTION_INTAKE_LOG,
    Permission.BOOKINGS_VIEW,
    Permission.SALES_VIEW,
    Permission.SALES_DELIVERY_LOG,
    // Phase 2: Store creates purchase requests
    Permission.PURCHASE_REQUEST_CREATE,
    Permission.STOCK_REQUEST_VIEW,      // Store can view stock requests
    Permission.STOCK_REQUEST_FULFILL,   // Store can fulfill/issue stock requests
    // Tally sign-off — Store signs the egg tally
    Permission.PRODUCTION_SESSION_VIEW, Permission.TALLY_SIGN, Permission.TALLY_LOCK_VIEW,
  ],
  [UserRole.SECURITY1]: [
    Permission.VISITOR_LOG_VIEW,
    Permission.VISITOR_LOG_CREATE,
    Permission.HEALTH_VISITOR_LOG,  // FIX: required by POST /visitors/gate-log (check-in/out)
    Permission.HEALTH_VISITOR_VIEW, // FIX: required by GET /visitors/approved + /gate-log
  ],
  [UserRole.SECURITY2]: [
    Permission.VISITOR_LOG_VIEW,
    Permission.VISITOR_LOG_CREATE,
    Permission.HEALTH_VISITOR_LOG,  // FIX: required by POST /visitors/gate-log (check-in/out)
    Permission.HEALTH_VISITOR_VIEW, // FIX: required by GET /visitors/approved + /gate-log
  ],
};
