import type {
  MobilePaymentBillingPeriod,
  MobilePaymentProductCode,
  MobilePaymentTier,
} from "../../services/api/paymentApi";

export type SubscriptionPlanDefinition = {
  productCode: MobilePaymentProductCode;
  tier: MobilePaymentTier;
  billingPeriod: MobilePaymentBillingPeriod;
};

export const SUBSCRIPTION_PLANS: readonly SubscriptionPlanDefinition[] = [
  { productCode: "plus_monthly", tier: "plus", billingPeriod: "month" },
  { productCode: "plus_yearly", tier: "plus", billingPeriod: "year" },
  { productCode: "pro_monthly", tier: "pro", billingPeriod: "month" },
  { productCode: "pro_yearly", tier: "pro", billingPeriod: "year" },
] as const;

export function subscriptionProductCode(
  tier: MobilePaymentTier,
  billingPeriod: MobilePaymentBillingPeriod,
): MobilePaymentProductCode {
  return `${tier}_${billingPeriod === "year" ? "yearly" : "monthly"}`;
}

export function subscriptionTier(productCode: MobilePaymentProductCode): MobilePaymentTier {
  return productCode.startsWith("plus_") ? "plus" : "pro";
}

export function subscriptionBillingPeriod(
  productCode: MobilePaymentProductCode,
): MobilePaymentBillingPeriod {
  return productCode.endsWith("_yearly") ? "year" : "month";
}

export function subscriptionTierLabel(tier: "free" | MobilePaymentTier): string {
  if (tier === "free") return "Free";
  return tier === "plus" ? "Plus" : "Pro";
}
