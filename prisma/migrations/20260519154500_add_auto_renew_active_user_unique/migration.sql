-- 同一个账号同一时间只能有一条有效自动续费关系。
-- 这里只限制 pending / active / billing_retry，允许 cancelled / expired / paused 后重新开通。
CREATE UNIQUE INDEX "auto_renew_subscriptions_active_user_unique"
ON "auto_renew_subscriptions"("userId")
WHERE "status" IN ('pending', 'active', 'billing_retry');
