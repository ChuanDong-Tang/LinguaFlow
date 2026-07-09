import type {
  EntitlementGrantMode,
  GrantEntitlementInput,
  PaymentChannel,
  PrepaidLimitMode,
} from "./PaymentEntitlementService.js";
import type { PaymentProductCode } from "@lf/core/ports/payment/PaymentTypes.js";

export type EntitlementGrantSnapshot = Pick<
  GrantEntitlementInput,
  "grantMode" | "periodStart" | "periodEnd" | "prepaidLimit"
>;

export function createEntitlementGrantPayload(input: {
  fallbackReason: string;
  source: string;
  grant: EntitlementGrantSnapshot;
}): Record<string, unknown> {
  return {
    fallbackReason: input.fallbackReason,
    source: input.source,
    grant: {
      grantMode: input.grant.grantMode,
      periodStart: input.grant.periodStart?.toISOString() ?? null,
      periodEnd: input.grant.periodEnd?.toISOString() ?? null,
      prepaidLimit: input.grant.prepaidLimit ?? null,
    },
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
  };
}

function readGrantSnapshot(payload: unknown): Required<EntitlementGrantSnapshot> {
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
  };
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
