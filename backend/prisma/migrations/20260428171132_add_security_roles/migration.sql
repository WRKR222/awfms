/*
  Warnings:

  - You are about to drop the column `farm_id` on the `batches` table. All the data in the column will be lost.
  - You are about to drop the column `farm_id` on the `customers` table. All the data in the column will be lost.
  - You are about to drop the column `total_broken_empty` on the `egg_collection_sessions` table. All the data in the column will be lost.
  - You are about to drop the column `total_broken_sellable` on the `egg_collection_sessions` table. All the data in the column will be lost.
  - You are about to drop the column `category` on the `expense_logs` table. All the data in the column will be lost.
  - You are about to drop the column `farm_id` on the `expense_logs` table. All the data in the column will be lost.
  - You are about to drop the column `farm_id` on the `sales_orders` table. All the data in the column will be lost.
  - You are about to drop the column `advance_notice_id` on the `visitor_log` table. All the data in the column will be lost.
  - Added the required column `category_id` to the `expense_logs` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'SECURITY1';
ALTER TYPE "UserRole" ADD VALUE 'SECURITY2';

-- DropForeignKey
ALTER TABLE "batch_cage_assignments" DROP CONSTRAINT "batch_cage_assignments_row_id_fkey";

-- DropForeignKey
ALTER TABLE "farm_rows" DROP CONSTRAINT "farm_rows_section_id_fkey";

-- DropForeignKey
ALTER TABLE "farm_sections" DROP CONSTRAINT "farm_sections_block_id_fkey";

-- DropForeignKey
ALTER TABLE "historical_cost_records" DROP CONSTRAINT "historical_cost_records_upload_log_id_fkey";

-- DropForeignKey
ALTER TABLE "historical_production_records" DROP CONSTRAINT "historical_production_records_upload_log_id_fkey";

-- DropForeignKey
ALTER TABLE "historical_sales_records" DROP CONSTRAINT "historical_sales_records_upload_log_id_fkey";

-- DropForeignKey
ALTER TABLE "historical_upload_logs" DROP CONSTRAINT "historical_upload_logs_template_id_fkey";

-- DropIndex
DROP INDEX "batches_farm_id_idx";

-- DropIndex
DROP INDEX "customers_farm_id_idx";

-- DropIndex
DROP INDEX "expense_logs_category_expense_date_idx";

-- DropIndex
DROP INDEX "expense_logs_farm_id_idx";

-- DropIndex
DROP INDEX "sales_orders_farm_id_idx";

-- AlterTable
ALTER TABLE "accountant_export_layouts" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "batches" DROP COLUMN "farm_id";

-- AlterTable
ALTER TABLE "customers" DROP COLUMN "farm_id";

-- AlterTable
ALTER TABLE "egg_collection_sessions" DROP COLUMN "total_broken_empty",
DROP COLUMN "total_broken_sellable";

-- AlterTable
ALTER TABLE "egg_tally_verifications" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "expense_logs" DROP COLUMN "category",
DROP COLUMN "farm_id",
ADD COLUMN     "category_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "sales_orders" DROP COLUMN "farm_id",
ADD COLUMN     "bank_ref" TEXT,
ADD COLUMN     "mpesa_ref" TEXT;

-- AlterTable
ALTER TABLE "store_equipment_logs" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "store_issuances" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "store_medication_logs" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "store_vet_visit_logs" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "store_worker_assignments" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "visitor_advance_notices" ALTER COLUMN "house_ids" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "visitor_log" DROP COLUMN "advance_notice_id";

-- CreateIndex
CREATE INDEX "expense_logs_category_id_expense_date_idx" ON "expense_logs"("category_id", "expense_date");

-- AddForeignKey
ALTER TABLE "expense_logs" ADD CONSTRAINT "expense_logs_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_sections" ADD CONSTRAINT "farm_sections_block_id_fkey" FOREIGN KEY ("block_id") REFERENCES "farm_blocks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_rows" ADD CONSTRAINT "farm_rows_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "farm_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_cage_assignments" ADD CONSTRAINT "batch_cage_assignments_row_id_fkey" FOREIGN KEY ("row_id") REFERENCES "farm_rows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_upload_logs" ADD CONSTRAINT "historical_upload_logs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "named_upload_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_production_records" ADD CONSTRAINT "historical_production_records_upload_log_id_fkey" FOREIGN KEY ("upload_log_id") REFERENCES "historical_upload_logs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_sales_records" ADD CONSTRAINT "historical_sales_records_upload_log_id_fkey" FOREIGN KEY ("upload_log_id") REFERENCES "historical_upload_logs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_cost_records" ADD CONSTRAINT "historical_cost_records_upload_log_id_fkey" FOREIGN KEY ("upload_log_id") REFERENCES "historical_upload_logs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
