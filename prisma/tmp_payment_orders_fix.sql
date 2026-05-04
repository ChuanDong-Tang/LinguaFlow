ALTER TABLE "payment_orders" ADD COLUMN IF NOT EXISTS "productCode" TEXT;
UPDATE "payment_orders" SET "productCode" = COALESCE("productCode", "module") WHERE "productCode" IS NULL;
ALTER TABLE "payment_orders" ALTER COLUMN "productCode" SET NOT NULL;
DROP INDEX IF EXISTS "payment_orders_module_sourceKey_idx";
CREATE INDEX IF NOT EXISTS "payment_orders_productCode_sourceKey_idx" ON "payment_orders"("productCode", "sourceKey");
ALTER TABLE "payment_orders" DROP COLUMN IF EXISTS "module";
