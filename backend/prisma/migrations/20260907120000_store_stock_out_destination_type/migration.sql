-- Adds an explicit Brooder vs Production House destination to batch-targeted
-- stock-out records. A Batch id alone doesn't say which building actually
-- received the stock, since the same batch moves from the brooder
-- (BROODING/GROWER stage) into the production house (PRODUCTION stage) over
-- its life — this column is set at issuance time so the record itself never
-- becomes ambiguous even after the batch later changes stage.
ALTER TABLE "store_stock_outs" ADD COLUMN "issued_to_type" TEXT;
