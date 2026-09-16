import type {
  EntitlementGrantMode,
  GrantEntitlementInput,
  PaymentChannel,
  PrepaidLimitMode,
} from "./PaymentEntitlementService.js";
import type { PaymentProductCode } from "@lf/core/ports/payment/PaymentTypes.js";
import type { SubscriptionGrantProvider } from "@lf/core/ports/repository/SubscriptionRepository.js";

export type EntitlementGrantSnapshot = Pick<
  GrantEntitlementInput,
  "grantMode" | "periodStart" | "periodEnd" | "prepaidLimit" | "syncAutoRenewBilling"
>;

export interface ReplacedEntitlementSnapshot {
  sourceOrderId: string;
  provider: SubscriptionGrantProvider;
  supersededAt: Date;
}

export function createEntitlementGrantPayload(input: {
  fallbackReason: string;
  source: string;
  grant: EntitlementGrantSnapshot;
  replacedEntitlement?: ReplacedEntitlementSnapshot | null;
}): Record<string, unknown> {
  return {
    fallbackReason: input.fallbackReason,
    source: input.source,
    grant: {
      grantMode: input.grant.grantMode,
      periodStart: input.grant.periodStart?.toISOString() ?? null,
      periodEnd: input.grant.periodEnd?.toISOString() ?? null,
      prepaidLimit: input.grant.prepaidLimit ?? null,
      syncAutoRenewBilling: input.grant.syncAutoRenewBilling ?? null,
    },
    ...(input.replacedEntitlement
      ? {
          replacedEntitlement: {
            sourceOrderId: input.replacedEntitlement.sourceOrderId,
            provider: input.replacedEntitlement.provider,
            supersededAt: input.replacedEntitlement.supersededAt.toISOString(),
          },
        }
      : {}),
  };
}

export function resolveReplacedEntitlementFromBenefitPayload(
  payload: unknown,
): ReplacedEntitlementSnapshot | null {
  const raw = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).replacedEntitlement
    : null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.sourceOrderId !== "string" || !value.sourceOrderId.trim()) return null;
  if (!isSubscriptionGrantProvider(value.provider)) return null;
  const supersededAt = readOptionalDate(value.supersededAt);
  if (!supersededAt) return null;
  return {
    sourceOrderId: value.sourceOrderId.trim(),
    provider: value.provider,
    supersededAt,
  };
}

export function resolveGrantInputFromBenefitPayload(input: {
  userId: string;
  sourceOrderId: string;
  productCode: PaymentProductCode;
  channel: PaymentChannel;
  payload: unknown;
}): GrantEntitlementInput {
  const grant = readGrantSnapshot(input.payload);
  return {
    userId: input.userId,
    sourceOrderId: input.sourceOrderId,
    productCode: input.productCode,
    channel: input.channel,
    grantMode: grant.grantMode,
    periodStart: grant.periodStart,
    periodEnd: grant.periodEnd,
    prepaidLimit: grant.prepaidLimit,
    syncAutoRenewBilling: grant.syncAutoRenewBilling,
  };
}

function readGrantSnapshot(payload: unknown): EntitlementGrantSnapshot & {
  grantMode: EntitlementGrantMode;
  periodStart: Date | null;
  periodEnd: Date | null;
  prepaidLimit: PrepaidLimitMode;
} {
  const rawGrant =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>).grant
      : null;
  const grant =
    rawGrant && typeof rawGrant === "object" && !Array.isArray(rawGrant)
      ? (rawGrant as Record<string, unknown>)
      : {};
  const grantMode = readGrantMode(grant.grantMode);
  return {
    grantMode,
    periodStart: readOptionalDate(grant.periodStart),
    periodEnd: readOptionalDate(grant.periodEnd),
    prepaidLimit: readPrepaidLimit(grant.prepaidLimit, grantMode),
    syncAutoRenewBilling: readOptionalBoolean(grant.syncAutoRenewBilling),
  };
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readGrantMode(value: unknown): EntitlementGrantMode {
  return value === "subscription_period" ? "subscription_period" : "fixed_duration";
}

function readPrepaidLimit(
  value: unknown,
  grantMode: EntitlementGrantMode
): PrepaidLimitMode {
  if (value === "enforce" || value === "skip") return value;
  return grantMode === "subscription_period" ? "skip" : "enforce";
}

function readOptionalDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isSubscriptionGrantProvider(value: unknown): value is SubscriptionGrantProvider {
  return value === "wechat" || value === "alipay" || value === "apple" || value === "google_play";
}
