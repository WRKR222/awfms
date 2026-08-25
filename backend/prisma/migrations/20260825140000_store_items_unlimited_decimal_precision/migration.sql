-- Allow unlimited decimal places on every numeric parameter involved with
-- store items: item catalog (reorder level, current stock, unit cost),
-- stock-in, stock-out, issuance plan lines, PM requisition lines, and the
-- simple stock request flow. Postgres `numeric` with no declared
-- precision/scale accepts any number of digits and decimal places.

-- StoreItem
ALTER TABLE "store_items"
  ALTER COLUMN "reorder_level" TYPE numeric,
  ALTER COLUMN "current_stock" TYPE numeric,
  ALTER COLUMN "unit_cost_kes" TYPE numeric;

-- StoreStockIn
ALTER TABLE "store_stock_ins"
  ALTER COLUMN "quantity_in" TYPE numeric,
  ALTER COLUMN "unit_cost_kes" TYPE numeric,
  ALTER COLUMN "total_cost_kes" TYPE numeric;

-- StoreStockOut
ALTER TABLE "store_stock_outs"
  ALTER COLUMN "quantity_out" TYPE numeric,
  ALTER COLUMN "unit_cost_kes" TYPE numeric,
  ALTER COLUMN "total_cost_kes" TYPE numeric;

-- IssuancePlanItem
ALTER TABLE "issuance_plan_items"
  ALTER COLUMN "quantity_planned" TYPE numeric,
  ALTER COLUMN "unit_price_kes" TYPE numeric,
  ALTER COLUMN "quantity_issued" TYPE numeric,
  ALTER COLUMN "quantity_approved" TYPE numeric;

-- PMItemRequisitionItem
ALTER TABLE "pm_item_requisition_items"
  ALTER COLUMN "quantity_needed" TYPE numeric;

-- SimpleStockRequestItem
ALTER TABLE "simple_stock_request_items"
  ALTER COLUMN "quantity_requested" TYPE numeric,
  ALTER COLUMN "quantity_issued" TYPE numeric;
