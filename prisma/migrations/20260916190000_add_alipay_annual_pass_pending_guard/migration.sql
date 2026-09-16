-- 支付宝年卡属于一次性支付，Plus/Pro 之间也不允许同时存在两张待支付订单。
-- 上线前已只读确认生产库不存在这类 pending 订单，因此迁移只增加约束，不改写业务数据。
CREATE UNIQUE INDEX "payment_orders_pending_alipay_annual_user_unique"
ON "payment_orders"("userId")
WHERE "status" = 'pending'
  AND "provider" = 'alipay'
  AND "productCode" IN ('plus_yearly', 'pro_yearly');
