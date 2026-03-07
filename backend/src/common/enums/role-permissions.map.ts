import { UserRole } from '@prisma/client';
import { Permission } from './permissions.enum';

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.ATTENDANT]: [
    Permission.FLOCK_VIEW, Permission.FLOCK_ENTRY_CREATE, Permission.FLOCK_WEIGHT_LOG,
    Permission.FEED_VIEW, Permission.FEED_INTAKE_LOG, Permission.FEED_STOCK_VIEW,
    Permission.HEALTH_VIEW, Permission.HEALTH_VACCINATION_LOG,
    Permission.PRODUCTION_VIEW, Permission.PRODUCTION_ENTRY_CREATE,
  ],
  [UserRole.SUPERVISOR]: [
    Permission.FLOCK_VIEW, Permission.FLOCK_ENTRY_CREATE, Permission.FLOCK_ENTRY_APPROVE, Permission.FLOCK_WEIGHT_LOG,
    Permission.FEED_VIEW, Permission.FEED_INTAKE_LOG, Permission.FEED_APPROVE, Permission.FEED_STOCK_VIEW,
    Permission.HEALTH_VIEW, Permission.HEALTH_EVENT_LOG, Permission.HEALTH_VACCINATION_LOG, Permission.HEALTH_VISITOR_LOG,
    Permission.PRODUCTION_VIEW, Permission.PRODUCTION_ENTRY_CREATE, Permission.PRODUCTION_ENTRY_APPROVE,
    Permission.INVENTORY_VIEW, Permission.INVENTORY_MANAGE, Permission.INVENTORY_SPOILAGE_LOG,
    Permission.SALES_VIEW, Permission.SALES_ORDER_CREATE, Permission.SALES_CUSTOMER_MANAGE, Permission.SALES_DELIVERY_LOG,
    Permission.INVOICE_VIEW,
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
  ],
  [UserRole.ACCOUNTANT]: [
    Permission.FLOCK_VIEW, Permission.FEED_VIEW, Permission.FEED_STOCK_VIEW,
    Permission.HEALTH_VIEW, Permission.PRODUCTION_VIEW, Permission.INVENTORY_VIEW,
    Permission.SALES_VIEW, Permission.SALES_ORDER_MANAGE, Permission.SALES_CUSTOMER_MANAGE,
    Permission.INVOICE_VIEW, Permission.INVOICE_MANAGE, Permission.INVOICE_PAYMENT_LOG,
    Permission.AR_VIEW, Permission.AR_MANAGE,
    Permission.FINANCE_VIEW, Permission.FINANCE_EXPENSE_LOG, Permission.FINANCE_REPORT_VIEW,
    Permission.FINANCE_EXPORT, Permission.PRICING_MANAGE,
  ],
  [UserRole.OWNER]: Object.values(Permission),
};
