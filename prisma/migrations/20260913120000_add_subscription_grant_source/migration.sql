-- Treat membership periods as source-isolated grants. Manual grants may overlap
-- paid periods without changing a provider's billing agreement or entitlement.
CREATE TYPE "SubscriptionGrantSourceType" AS ENUM ('legacy', 'manual', 'payment');

ALTER TABLE "subscriptions"
ADD COLUMN "sourceType" "SubscriptionGrantSourceType" NOT NULL DEFAULT 'legacy',
ADD COLUMN "sourceProvider" "AutoRenewProvider",
ADD COLUMN "revokedAt" TIMESTAMP(3);

UPDATE "subscriptions"
SET "sourceType" = 'manual'
WHERE "sourceOrderId" LIKE 'admin_grant:%';

UPDATE "subscriptions"
SET "sourceType" = 'payment',
    "sourceProvider" = CASE
      WHEN "sourceOrderId" LIKE 'apple_iap:%' OR "sourceOrderId" LIKE 'apple_autorenew:%' THEN 'apple'::"AutoRenewProvider"
      WHEN "sourceOrderId" LIKE 'google_play_iap:%' OR "sourceOrderId" LIKE 'google_play_autorenew:%' THEN 'google_play'::"AutoRenewProvider"
      WHEN "sourceOrderId" LIKE 'alipay_autorenew:%' THEN 'alipay'::"AutoRenewProvider"
      WHEN "sourceOrderId" LIKE 'wechat_autorenew:%' THEN 'wechat'::"AutoRenewProvider"
      ELSE "sourceProvider"
    END
WHERE "sourceOrderId" LIKE 'apple_iap:%'
   OR "sourceOrderId" LIKE 'apple_autorenew:%'
   OR "sourceOrderId" LIKE 'google_play_iap:%'
   OR "sourceOrderId" LIKE 'google_play_autorenew:%'
   OR "sourceOrderId" LIKE 'alipay_autorenew:%'
   OR "sourceOrderId" LIKE 'wechat_autorenew:%';

UPDATE "subscriptions" AS subscription
SET "sourceType" = 'payment',
    "sourceProvider" = CASE
      WHEN payment_order."provider" = 'apple_iap' THEN 'apple'::"AutoRenewProvider"
      WHEN payment_order."provider" = 'google_play_iap' THEN 'google_play'::"AutoRenewProvider"
      WHEN payment_order."provider" = 'alipay' THEN 'alipay'::"AutoRenewProvider"
      WHEN payment_order."provider" = 'wechat' THEN 'wechat'::"AutoRenewProvider"
      ELSE subscription."sourceProvider"
    END
FROM "payment_orders" AS payment_order
WHERE subscription."sourceOrderId" = payment_order."id"
  AND payment_order."provider" IN ('apple_iap', 'google_play_iap', 'alipay', 'wechat');

CREATE INDEX "subscriptions_userId_sourceType_status_expiresAt_idx"
ON "subscriptions"("userId", "sourceType", "status", "expiresAt");
