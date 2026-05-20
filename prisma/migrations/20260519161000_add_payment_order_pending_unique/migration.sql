-- 单次月卡同一时间只允许一张待支付订单。
-- 只限制 pending，paid/closed/failed 不受影响：支付完成或关闭后，用户仍可在规则允许时再次购买。
-- 建索引前先收敛历史重复 pending：每个用户/商品/渠道只保留最新一张待支付单。
WITH ranked_pending_orders AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "userId", "productCode", "provider"
      ORDER BY "createdAt" DESC, "id" DESC
    ) AS "rank"
  FROM "payment_orders"
  WHERE "status" = 'pending'
)
UPDATE "payment_orders" AS "order"
SET
  "status" = 'closed',
  "updatedAt" = NOW(),
  "metadata" = COALESCE("order"."metadata", '{}'::jsonb) || jsonb_build_object(
    'closedByMigration', '20260519161000_add_payment_order_pending_unique',
    'closedReason', 'duplicate_pending_before_unique_index'
  )
FROM ranked_pending_orders
WHERE "order"."id" = ranked_pending_orders."id"
  AND ranked_pending_orders."rank" > 1;

CREATE UNIQUE INDEX "payment_orders_pending_user_product_provider_unique"
ON "payment_orders"("userId", "productCode", "provider")
WHERE "status" = 'pending';
