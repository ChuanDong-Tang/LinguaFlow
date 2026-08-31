import type { AutoRenewProductCode, AutoRenewRepository } from "@lf/core/ports/repository/AutoRenewRepository.js";
import type { PaymentEntitlementService } from "../../../services/payment/PaymentEntitlementService.js";
import { AutoRenewAccessDeniedError, AutoRenewAlreadyActiveError, AutoRenewNotFoundError, type AutoRenewService } from "../../../services/payment/AutoRenewService.js";
import { getRuntimeConfig } from "../../../config/runtimeConfig.js";
import { AlipayAutoRenewClient } from "./AlipayClient.js";
import type { AlipayFormFields } from "./AlipaySignature.js";
import type { AlipaySubscriptionChanged, AlipaySubscriptionSnapshot } from "./AlipayTypes.js";

type AlipayLinkStore = {
  alipayAccountLink: {
    findUnique(args: unknown): Promise<{ userId: string; customerId: string } | null>;
    upsert(args: unknown): Promise<{ userId: string; customerId: string }>;
  };
};

export class AlipayAutoRenewService {
  constructor(
    private readonly store: AlipayLinkStore,
    private readonly repository: AutoRenewRepository,
    private readonly autoRenewService: AutoRenewService,
    private readonly entitlementService: PaymentEntitlementService,
    private readonly client?: AlipayAutoRenewClient,
  ) {}

  isConfigured(): boolean { return Boolean(this.client); }

  async create(input: { userId: string; nickname?: string | null; email?: string | null; phone?: string | null; productCode: AutoRenewProductCode }) {
    if (!this.client) throw new Error("ALIPAY_AUTORENEW_NOT_CONFIGURED");
    await this.entitlementService.assertCanStartNewProPurchase(input.userId);
    const active = await this.repository.findActiveByUserId(input.userId);
    if (active) throw new AutoRenewAlreadyActiveError(active.provider);
    const foreignPending = await this.repository.findPendingByUserId(input.userId);
    if (foreignPending && foreignPending.provider !== "alipay") {
      throw new AutoRenewAlreadyActiveError(foreignPending.provider);
    }
    const existingPending = foreignPending;
    if (existingPending?.provider === "alipay") {
      const metadata = objectValue(existingPending.metadata);
      const jumpSchema = stringValue(metadata.jumpSchema);
      const expiresAt = parseDate(metadata.schemaEffectiveEnd);
      if (jumpSchema && (!expiresAt || expiresAt > new Date())) return { subscription: existingPending, jumpSchema, reused: true };
      await this.repository.cancelSubscription({ id: existingPending.id, cancelledAt: new Date(), metadata: { ...metadata, cancelSource: "expired_jump_schema" } });
    }
    const customerId = await this.resolveCustomer(input);
    const priceId = resolvePriceId(input.productCode);
    const created = await this.client.createSubscription({ customerId, priceId, title: titleFor(input.productCode), metadata: { userId: input.userId, productCode: input.productCode } });
    const subscription = await this.autoRenewService.register({
      userId: input.userId, provider: "alipay", productCode: input.productCode, providerAgreementId: created.subscriptionId,
      status: "pending", metadata: { source: "alipay_ai_subscription", customerId, orderNo: created.orderNo, jumpSchema: created.jumpSchema, schemaEffectiveEnd: created.schemaEffectiveEnd, createRaw: created.raw },
    });
    return { subscription, jumpSchema: created.jumpSchema, reused: false };
  }

  async handleNotification(fields: AlipayFormFields): Promise<"processed" | "ignored"> {
    if (!this.client) throw new Error("ALIPAY_AUTORENEW_NOT_CONFIGURED");
    const event = this.client.parseAndVerifyNotification(fields);
    const subscription = await this.repository.findByProviderAgreement({ provider: "alipay", providerAgreementId: event.subscription.subscription_id });
    if (!subscription) throw new Error("ALIPAY_SUBSCRIPTION_NOT_FOUND");
    const eventTime = parseDate(event.changeDate);
    const metadata = objectValue(subscription.metadata);
    const lastChangeAt = parseDate(metadata.lastAlipayChangeAt);
    const stale = Boolean(eventTime && lastChangeAt && eventTime < lastChangeAt);
    if (event.changeType === "active" || event.changeType === "period_extend") {
      const chargeId = event.tradeNo ?? event.orderNo;
      if (!chargeId) throw new Error("ALIPAY_PAID_EVENT_MISSING_CHARGE_ID");
      const periodStart = parseDate(event.subscription.current_period_start);
      const periodEnd = parseDate(event.subscription.current_period_end);
      if (!periodEnd) throw new Error("ALIPAY_PAID_EVENT_MISSING_PERIOD_END");
      assertPaidEventMatchesProduct(event, subscription.productCode);
      await this.autoRenewService.recordPaidCharge({
        userId: subscription.userId, provider: "alipay", productCode: subscription.productCode,
        providerAgreementId: subscription.providerAgreementId, providerChargeId: chargeId,
        periodKey: `${event.subscription.current_period_start ?? ""}:${event.subscription.current_period_end ?? ""}`,
        amount: event.payAmount, currency: "CNY", periodStart, periodEnd,
        paidAt: parseDate(event.changeDate) ?? new Date(), rawPayload: sanitizeEvent(event),
      });
      // A paid event must always grant the paid period, even if delivery was delayed
      // until after a newer cancel event. It must not resurrect the agreement in that case.
      if (stale || subscription.status === "cancelled") return "processed";
      await this.repository.updateSubscription({
        id: subscription.id, status: "active", latestTransactionId: chargeId,
        currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, nextBillingAt: null,
        cancelledAt: null, allowReactivation: true,
        metadata: { ...metadata, lastAlipayNotifyId: event.notifyId, lastAlipayChangeAt: event.changeDate, lastAlipayChangeType: event.changeType, cancelAtPeriodEnd: Boolean(event.subscription.cancel_at_period_end) },
      });
      return "processed";
    }
    if (event.changeType === "cancel") {
      if (stale) return "ignored";
      await this.repository.cancelSubscription({ id: subscription.id, cancelledAt: eventTime ?? new Date(), metadata: { ...metadata, lastAlipayNotifyId: event.notifyId, lastAlipayChangeAt: event.changeDate, lastAlipayChangeType: event.changeType, cancelSource: "alipay_notify", cancelAtPeriodEnd: false } });
      return "processed";
    }
    if (event.changeType === "cancel_at_period_end") {
      if (stale) return "ignored";
      await this.repository.updateSubscription({ id: subscription.id, metadata: { ...metadata, lastAlipayNotifyId: event.notifyId, lastAlipayChangeAt: event.changeDate, lastAlipayChangeType: event.changeType, cancelAtPeriodEnd: true } });
      return "processed";
    }
    return "ignored";
  }

  async cancelAtPeriodEnd(input: { userId: string; subscriptionId: string }) {
    if (!this.client) throw new Error("ALIPAY_AUTORENEW_NOT_CONFIGURED");
    const subscription = await this.repository.findById(input.subscriptionId);
    if (!subscription || subscription.provider !== "alipay") throw new AutoRenewNotFoundError();
    if (subscription.userId !== input.userId) throw new AutoRenewAccessDeniedError();
    await this.client.cancelAtPeriodEnd(subscription.providerAgreementId);
    return this.repository.updateSubscription({ id: subscription.id, metadata: { ...objectValue(subscription.metadata), cancelAtPeriodEnd: true, cancelRequestedAt: new Date().toISOString() } });
  }

  async reconcile(input: { customerId: string; subscriptionId: string }): Promise<AlipaySubscriptionSnapshot> {
    if (!this.client) throw new Error("ALIPAY_AUTORENEW_NOT_CONFIGURED");
    return this.client.querySubscription(input);
  }

  private async resolveCustomer(input: { userId: string; nickname?: string | null; email?: string | null; phone?: string | null }): Promise<string> {
    const link = await this.store.alipayAccountLink.findUnique({ where: { userId: input.userId } });
    if (link) return link.customerId;
    if (!input.email && !input.phone) throw new Error("ALIPAY_CUSTOMER_CONTACT_REQUIRED");
    const customerId = await this.client!.createCustomer({ name: input.nickname?.trim() || `OIO-${input.userId.slice(0, 8)}`, email: input.email, phone: input.phone });
    await this.store.alipayAccountLink.upsert({ where: { userId: input.userId }, create: { userId: input.userId, customerId }, update: { customerId } });
    return customerId;
  }
}

function resolvePriceId(productCode: AutoRenewProductCode): string {
  const config = getRuntimeConfig().payment.alipayAutoRenew;
  const value = productCode === "plus_monthly" ? config.plusMonthlyPriceId : config.proMonthlyPriceId;
  if (!value) throw new Error(`ALIPAY_${productCode.toUpperCase()}_PRICE_ID_MISSING`);
  return value;
}
function assertPaidEventMatchesProduct(event: AlipaySubscriptionChanged, productCode: AutoRenewProductCode): void {
  const expectedPriceId = resolvePriceId(productCode);
  const eventPriceIds = (event.subscription.items ?? []).map((item) => item.price?.id).filter(Boolean);
  if (eventPriceIds.length === 0 || !eventPriceIds.includes(expectedPriceId)) {
    throw new Error("ALIPAY_NOTIFY_PRICE_ID_MISMATCH");
  }
  const configuredAmount = productCode === "plus_monthly"
    ? getRuntimeConfig().payment.plusMonthlyPriceCents
    : getRuntimeConfig().payment.proMonthlyPriceCents;
  const priceAmount = Number(event.subscription.items?.find((item) => item.price?.id === expectedPriceId)?.price?.unit_amount);
  const expectedAmount = Number.isFinite(priceAmount) && priceAmount > 0 ? priceAmount : configuredAmount;
  if (event.payAmount === null || event.payAmount !== expectedAmount) {
    throw new Error("ALIPAY_NOTIFY_AMOUNT_MISMATCH");
  }
}
function titleFor(productCode: AutoRenewProductCode): string { return productCode === "plus_monthly" ? "OIO Plus 月度会员" : "OIO Pro 月度会员"; }
function objectValue(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function stringValue(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function parseDate(value: unknown): Date | null { const text = stringValue(value); if (!text) return null; const date = new Date(text.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? "" : "+08:00")); return Number.isNaN(date.getTime()) ? null : date; }
function sanitizeEvent(event: AlipaySubscriptionChanged): unknown { return { ...event, raw: { ...event.raw, sign: "[redacted]", biz_content: "[parsed]" } }; }
