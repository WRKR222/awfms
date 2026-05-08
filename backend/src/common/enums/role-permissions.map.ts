import { UserRole } from '@prisma/client';
import { Permission } from './permissions.enum';

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.ATTENDANT]: [
    Permission.FLOCK_VIEW, Permission.FLOCK_ENTRY_CREATE, Permission.FLOCK_WEIGHT_LOG,
    Permission.FEED_VIEW, Permission.FEED_INTAKE_LOG, Permission.FEED_STOCK_VIEW,
    Permission.HEALTH_VIEW, Permission.HEALTH_VACCINATION_LOG,
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
    Permission.BOOKINGS_VIEW,
    Permission.BOOKINGS_MANAGE,
    Permission.BREAKAGE_LOG,
    Permission.BREAKAGE_VIEW,
  ],
  [UserRole.STORE]: [
    Permission.FEED_VIEW,
    Permission.FEED_STOCK_VIEW,
    Permission.FEED_INTAKE_LOG,
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
  ],
  [UserRole.SECURITY1]: [
    Permission.VISITOR_LOG_VIEW,
    Permission.VISITOR_LOG_CREATE,
  ],
  [UserRole.SECURITY2]: [
    Permission.VISITOR_LOG_VIEW,
    Permission.VISITOR_LOG_CREATE,
  ],
};
