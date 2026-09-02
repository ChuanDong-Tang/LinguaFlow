import type { AutoRenewProductCode, AutoRenewRepository, AutoRenewSubscriptionEntity } from "@lf/core/ports/repository/AutoRenewRepository.js";
import type { PaymentEventRepository } from "@lf/core/ports/repository/PaymentEventRepository.js";
import type { PaymentEntitlementService } from "../../../services/payment/PaymentEntitlementService.js";
import { AutoRenewAccessDeniedError, AutoRenewAlreadyActiveError, AutoRenewNotFoundError, type AutoRenewService } from "../../../services/payment/AutoRenewService.js";
import { getRuntimeConfig } from "../../../config/runtimeConfig.js";
import { AlipayAutoRenewClient } from "./AlipayClient.js";
import type { AlipayFormFields } from "./AlipaySignature.js";
import type { AlipaySubscriptionChanged, AlipaySubscriptionSnapshot, AlipaySubscriptionStatus } from "./AlipayTypes.js";

type AlipayLinkStore = {
  alipayAccountLink: {
    findUnique(args: unknown): Promise<{ userId: string; customerId: string } | null>;
    upsert(args: unknown): Promise<{ userId: string; customerId: string }>;
  };
};

export type AlipayAutoRenewReconcileResult =
  | { status: "skipped"; reason: "not_configured" | "no_current_alipay_subscription" | "customer_link_missing" }
  | {
      status: "checked";
      action: "unchanged" | "paid_period_recorded" | "cancel_scheduled" | "cancel_reverted" | "billing_retry" | "cancelled";
      subscriptionStatus: string;
      currentPeriodEnd: string | null;
      cancelAtPeriodEnd: boolean;
    };

export type AlipayProductQuote = {
  productCode: AutoRenewProductCode;
  priceId: string;
  amount: number;
  currency: "CNY";
};

type AlipayPriceIdentity = { email?: string | null; phone?: string | null };

const ALIPAY_PRICE_CACHE_TTL_MS = 300_000;
const ALIPAY_PRICE_FAILURE_CACHE_TTL_MS = 10_000;

export class AlipayAutoRenewService {
  private readonly priceCache = new Map<string, { quote: AlipayProductQuote; expiresAt: number }>();
  private readonly priceFailureCache = new Map<string, { error: Error; expiresAt: number }>();
  private readonly priceQueries = new Map<string, Promise<AlipayProductQuote>>();

  constructor(
    private readonly store: AlipayLinkStore,
    private readonly repository: AutoRenewRepository,
    private readonly autoRenewService: AutoRenewService,
    private readonly entitlementService: PaymentEntitlementService,
    private readonly client?: AlipayAutoRenewClient,
    private readonly paymentEventRepository?: PaymentEventRepository,
  ) {}

  isConfigured(): boolean { return Boolean(this.client); }

  async getProductQuote(productCode: AutoRenewProductCode, identity?: AlipayPriceIdentity): Promise<AlipayProductQuote> {
    if (!this.client) throw new Error("ALIPAY_AUTORENEW_NOT_CONFIGURED");
    const priceId = resolvePriceId(productCode, identity);
    const cacheKey = `${productCode}:${priceId}`;
    const cached = this.priceCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.quote;
    const recentFailure = this.priceFailureCache.get(cacheKey);
    if (recentFailure && recentFailure.expiresAt > Date.now()) throw recentFailure.error;
    const inFlight = this.priceQueries.get(cacheKey);
    if (inFlight) return inFlight;

    const query = this.loadProductQuote(productCode, priceId, cacheKey);
    this.priceQueries.set(cacheKey, query);
    try {
      return await query;
    } finally {
      this.priceQueries.delete(cacheKey);
    }
  }

  private async loadProductQuote(
    productCode: AutoRenewProductCode,
    priceId: string,
    cacheKey: string,
  ): Promise<AlipayProductQuote> {
    try {
      const price = await this.client!.queryPrice(priceId);
      if (!price.active) throw new Error("ALIPAY_PRICE_INACTIVE");
      if (
        price.type?.toLowerCase() !== "recurring" ||
        price.recurring?.interval?.toUpperCase() !== "MONTH" ||
        price.recurring.intervalCount !== 1
      ) {
        throw new Error("ALIPAY_MONTHLY_RECURRING_PRICE_REQUIRED");
      }
      const quote: AlipayProductQuote = {
        productCode,
        priceId,
        amount: price.unitAmount,
        currency: "CNY",
      };
      this.priceCache.set(cacheKey, { quote, expiresAt: Date.now() + ALIPAY_PRICE_CACHE_TTL_MS });
      this.priceFailureCache.delete(cacheKey);
      return quote;
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.priceFailureCache.set(cacheKey, {
        error: normalized,
        expiresAt: Date.now() + ALIPAY_PRICE_FAILURE_CACHE_TTL_MS,
      });
      throw normalized;
    }
  }

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
      const storedPriceId = stringValue(metadata.alipayPriceId);
      const currentPriceId = resolvePriceId(input.productCode, input);
      const isSameOffer = existingPending.productCode === input.productCode && (!storedPriceId || storedPriceId === currentPriceId);
      if (isSameOffer && jumpSchema && (!expiresAt || expiresAt > new Date())) {
        return { subscription: existingPending, jumpSchema, reused: true };
      }
      await this.repository.cancelSubscription({
        id: existingPending.id,
        cancelledAt: new Date(),
        metadata: {
          ...metadata,
          cancelSource: isSameOffer ? "expired_jump_schema" : "offer_changed_before_activation",
        },
      });
    }
    const quote = await this.getProductQuote(input.productCode, input);
    const customerId = await this.resolveCustomer(input);
    const created = await this.client.createSubscription({
      customerId,
      priceId: quote.priceId,
    });
    const subscription = await this.autoRenewService.register({
      userId: input.userId, provider: "alipay", productCode: input.productCode, providerAgreementId: created.subscriptionId,
      status: "pending", metadata: {
        source: "alipay_ai_subscription",
        customerId,
        orderNo: created.orderNo,
        jumpSchema: created.jumpSchema,
        schemaEffectiveEnd: created.schemaEffectiveEnd,
        alipayPriceId: quote.priceId,
        alipayUnitAmount: quote.amount,
        alipayCurrency: quote.currency,
        createRaw: created.raw,
      },
    });
    return { subscription, jumpSchema: created.jumpSchema, reused: false };
  }

  async handleNotification(fields: AlipayFormFields): Promise<"processed" | "ignored"> {
    if (!this.client) throw new Error("ALIPAY_AUTORENEW_NOT_CONFIGURED");
    const event = this.client.parseAndVerifyNotification(fields);
    const existingEvent = await this.paymentEventRepository?.findByProviderEventId({
      provider: "alipay",
      providerEventId: event.notifyId,
      eventType: "alipay.trade.subscription.changed",
    });
    if (existingEvent && !["received", "failed"].includes(existingEvent.status)) return "ignored";
    const storedEvent = this.paymentEventRepository
      ? existingEvent ?? await this.paymentEventRepository.findOrCreate({
          provider: "alipay",
          providerEventId: event.notifyId,
          providerOrderId: event.tradeNo ?? event.orderNo ?? event.subscription.subscription_id,
          eventType: "alipay.trade.subscription.changed",
          rawPayload: sanitizeEvent(event),
        })
      : null;

    try {
      const result = await this.processNotification(event);
      if (storedEvent && this.paymentEventRepository) {
        await this.paymentEventRepository.updateDetails({
          id: storedEvent.id,
          providerOrderId: event.tradeNo ?? event.orderNo ?? event.subscription.subscription_id,
          rawPayload: sanitizeEvent(event),
        });
        if (result === "processed") await this.paymentEventRepository.markProcessed(storedEvent.id);
        else await this.paymentEventRepository.markIgnored(storedEvent.id, `change_type:${event.changeType}`);
      }
      return result;
    } catch (error) {
      if (storedEvent && this.paymentEventRepository) {
        await this.paymentEventRepository.markFailed(
          storedEvent.id,
          error instanceof Error ? error.message : String(error),
        );
      }
      throw error;
    }
  }

  private async processNotification(event: AlipaySubscriptionChanged): Promise<"processed" | "ignored"> {
    const subscription = await this.repository.findByProviderAgreement({ provider: "alipay", providerAgreementId: event.subscription.subscription_id });
    if (!subscription) throw new Error("ALIPAY_SUBSCRIPTION_NOT_FOUND");
    const eventTime = parseDate(event.changeDate);
    const metadata = objectValue(subscription.metadata);
    const lastChangeAt = parseDate(metadata.lastAlipayChangeAt);
    const stale = Boolean(eventTime && lastChangeAt && eventTime < lastChangeAt);
    if (event.changeType === "active" || event.changeType === "period_extend") {
      const providerTransactionId = event.tradeNo ?? event.orderNo;
      if (!providerTransactionId) throw new Error("ALIPAY_PAID_EVENT_MISSING_CHARGE_ID");
      const periodStart = parseDate(event.subscription.current_period_start);
      const periodEnd = parseDate(event.subscription.current_period_end);
      if (!periodEnd) throw new Error("ALIPAY_PAID_EVENT_MISSING_PERIOD_END");
      const amount = assertSubscriptionMatchesProduct(
        event.subscription,
        resolveExpectedPrice(subscription),
        event.payAmount,
      );
      const periodKey = createAlipayPeriodKey(event.subscription);
      const chargeId = createAlipayPeriodChargeId(subscription.providerAgreementId, periodKey);
      await this.autoRenewService.recordPaidCharge({
        userId: subscription.userId, provider: "alipay", productCode: subscription.productCode,
        providerAgreementId: subscription.providerAgreementId, providerChargeId: chargeId,
        periodKey,
        amount, currency: "CNY", periodStart, periodEnd,
        paidAt: parseDate(event.changeDate) ?? new Date(), rawPayload: sanitizeEvent(event),
      });
      // A paid event must always grant the paid period. A locally cancelled pending
      // agreement may still complete in Alipay after its jump schema expires, so that
      // specific state can be reactivated. Real provider/user cancellations stay final.
      const canReactivateExpiredJumpSchema = subscription.status === "cancelled"
        && metadata.cancelSource === "expired_jump_schema";
      if (stale || (subscription.status === "cancelled" && !canReactivateExpiredJumpSchema)) {
        return "processed";
      }
      await this.repository.updateSubscription({
        id: subscription.id, status: "active", latestTransactionId: providerTransactionId,
        currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, nextBillingAt: null,
        cancelledAt: null, allowReactivation: true,
        metadata: {
          ...metadata,
          ...(canReactivateExpiredJumpSchema
            ? { cancelSource: null, reactivatedFromCancelSource: "expired_jump_schema" }
            : {}),
          lastAlipayNotifyId: event.notifyId,
          lastAlipayChangeAt: event.changeDate,
          lastAlipayChangeType: event.changeType,
          cancelAtPeriodEnd: Boolean(event.subscription.cancel_at_period_end),
        },
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
    if (event.changeType === "item_cancel_revert") {
      if (stale) return "ignored";
      assertSubscriptionMatchesProduct(event.subscription, resolveExpectedPrice(subscription));
      await this.repository.updateSubscription({
        id: subscription.id,
        status: "active",
        currentPeriodStart: parseDate(event.subscription.current_period_start) ?? subscription.currentPeriodStart,
        currentPeriodEnd: parseDate(event.subscription.current_period_end) ?? subscription.currentPeriodEnd,
        cancelledAt: null,
        allowReactivation: true,
        metadata: {
          ...metadata,
          lastAlipayNotifyId: event.notifyId,
          lastAlipayChangeAt: event.changeDate,
          lastAlipayChangeType: event.changeType,
          cancelAtPeriodEnd: false,
          resumeConfirmedAt: event.changeDate ?? new Date().toISOString(),
        },
      });
      return "processed";
    }
    return "ignored";
  }

  async reconcileCurrentAutoRenewForUser(userId: string): Promise<AlipayAutoRenewReconcileResult> {
    if (!this.client) return { status: "skipped", reason: "not_configured" };
    const current = (await this.autoRenewService.getCurrent(userId)).subscription;
    if (!current || current.provider !== "alipay") {
      return { status: "skipped", reason: "no_current_alipay_subscription" };
    }
    return this.reconcileSubscription(current);
  }

  async reconcileAlipayAutoRenewSubscription(providerAgreementId: string): Promise<AlipayAutoRenewReconcileResult> {
    if (!this.client) return { status: "skipped", reason: "not_configured" };
    const current = await this.repository.findByProviderAgreement({ provider: "alipay", providerAgreementId });
    if (!current) return { status: "skipped", reason: "no_current_alipay_subscription" };
    return this.reconcileSubscription(current);
  }

  private async reconcileSubscription(current: AutoRenewSubscriptionEntity): Promise<AlipayAutoRenewReconcileResult> {
    const metadata = objectValue(current.metadata);
    const storedLink = await this.store.alipayAccountLink.findUnique({ where: { userId: current.userId } });
    const customerId = stringValue(metadata.customerId) ?? storedLink?.customerId ?? null;
    if (!customerId) return { status: "skipped", reason: "customer_link_missing" };

    const snapshot = await this.client!.querySubscription({
      customerId,
      subscriptionId: current.providerAgreementId,
    });
    const subscriptionStatus = normalizeSubscriptionStatus(snapshot.subscription_status);
    const periodStart = parseDate(snapshot.current_period_start);
    const periodEnd = parseDate(snapshot.current_period_end);
    const cancelAtPeriodEnd = snapshot.cancel_at_period_end === true;
    const hadCancelAtPeriodEnd = metadata.cancelAtPeriodEnd === true;
    const now = new Date();

    if (subscriptionStatus === "ACTIVE") {
      if (!periodEnd) throw new Error("ALIPAY_RECONCILE_PERIOD_END_MISSING");
      const amount = assertSubscriptionMatchesProduct(snapshot, resolveExpectedPrice(current));
      const periodIsCurrent = periodEnd > now;
      const periodChanged = current.currentPeriodEnd?.getTime() !== periodEnd.getTime();
      if (periodChanged && periodIsCurrent) {
        const periodKey = createAlipayPeriodKey(snapshot);
        await this.autoRenewService.recordPaidCharge({
          userId: current.userId,
          provider: "alipay",
          productCode: current.productCode,
          providerAgreementId: current.providerAgreementId,
          providerChargeId: createAlipayPeriodChargeId(current.providerAgreementId, periodKey),
          periodKey,
          amount,
          currency: "CNY",
          periodStart,
          periodEnd,
          paidAt: periodStart ?? new Date(),
          rawPayload: { source: "alipay_subscription_reconcile", subscription: snapshot },
        });
      }
      await this.repository.updateSubscription({
        id: current.id,
        status: periodIsCurrent ? "active" : "billing_retry",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        nextBillingAt: null,
        cancelledAt: null,
        allowReactivation: true,
        metadata: {
          ...metadata,
          customerId,
          cancelAtPeriodEnd,
          lastAlipayReconciledAt: new Date().toISOString(),
          lastAlipaySubscriptionStatus: subscriptionStatus,
        },
      });
      return {
        status: "checked",
        action: periodChanged && periodIsCurrent
          ? "paid_period_recorded"
          : !periodIsCurrent && current.status !== "billing_retry"
            ? "billing_retry"
            : cancelAtPeriodEnd && !hadCancelAtPeriodEnd
              ? "cancel_scheduled"
              : !cancelAtPeriodEnd && hadCancelAtPeriodEnd
                ? "cancel_reverted"
              : "unchanged",
        subscriptionStatus,
        currentPeriodEnd: periodEnd.toISOString(),
        cancelAtPeriodEnd,
      };
    }

    if (subscriptionStatus === "CANCELED" || subscriptionStatus === "INCOMPLETE_EXPIRED") {
      if (current.status !== "cancelled") {
        await this.repository.cancelSubscription({
          id: current.id,
          cancelledAt: parseDate(snapshot.canceled_date) ?? new Date(),
          metadata: {
            ...metadata,
            customerId,
            cancelSource: "alipay_reconcile",
            cancelAtPeriodEnd: false,
            lastAlipayReconciledAt: new Date().toISOString(),
            lastAlipaySubscriptionStatus: subscriptionStatus,
          },
        });
      }
      return {
        status: "checked",
        action: "cancelled",
        subscriptionStatus,
        currentPeriodEnd: periodEnd?.toISOString() ?? null,
        cancelAtPeriodEnd: false,
      };
    }

    return {
      status: "checked",
      action: "unchanged",
      subscriptionStatus,
      currentPeriodEnd: periodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd,
    };
  }

  async cancelAtPeriodEnd(input: { userId: string; subscriptionId: string }) {
    if (!this.client) throw new Error("ALIPAY_AUTORENEW_NOT_CONFIGURED");
    const subscription = await this.repository.findById(input.subscriptionId);
    if (!subscription || subscription.provider !== "alipay") throw new AutoRenewNotFoundError();
    if (subscription.userId !== input.userId) throw new AutoRenewAccessDeniedError();
    await this.client.cancelAtPeriodEnd(subscription.providerAgreementId);
    return this.repository.updateSubscription({ id: subscription.id, metadata: { ...objectValue(subscription.metadata), cancelAtPeriodEnd: true, cancelRequestedAt: new Date().toISOString() } });
  }

  async revertCancellation(input: { userId: string; subscriptionId: string }) {
    if (!this.client) throw new Error("ALIPAY_AUTORENEW_NOT_CONFIGURED");
    const subscription = await this.repository.findById(input.subscriptionId);
    if (!subscription || subscription.provider !== "alipay") throw new AutoRenewNotFoundError();
    if (subscription.userId !== input.userId) throw new AutoRenewAccessDeniedError();
    const metadata = objectValue(subscription.metadata);
    if (
      subscription.status !== "active" ||
      metadata.cancelAtPeriodEnd !== true ||
      !subscription.currentPeriodEnd ||
      subscription.currentPeriodEnd <= new Date()
    ) {
      throw new Error("ALIPAY_AUTORENEW_RESUME_NOT_ALLOWED");
    }
    const result = await this.client.revertCancellation(subscription.providerAgreementId);
    const updated = await this.repository.updateSubscription({
      id: subscription.id,
      metadata: {
        ...metadata,
        resumeRequestedAt: new Date().toISOString(),
      },
    });
    return { subscription: updated, jumpSchema: result.jumpSchema };
  }

  async stopSubscriptionRenewalForAccountDeletion(
    providerAgreementId: string,
  ): Promise<"cancelled" | "already_inactive"> {
    if (!this.client) throw new Error("ALIPAY_AUTORENEW_NOT_CONFIGURED");
    const subscription = await this.repository.findByProviderAgreement({ provider: "alipay", providerAgreementId });
    if (!subscription || subscription.status === "cancelled" || objectValue(subscription.metadata).cancelAtPeriodEnd === true) {
      return "already_inactive";
    }
    await this.client.cancelAtPeriodEnd(providerAgreementId);
    await this.repository.updateSubscription({
      id: subscription.id,
      metadata: {
        ...objectValue(subscription.metadata),
        cancelAtPeriodEnd: true,
        cancelSource: "account_deletion",
        cancelRequestedAt: new Date().toISOString(),
      },
    });
    return "cancelled";
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

function resolvePriceId(productCode: AutoRenewProductCode, identity?: AlipayPriceIdentity): string {
  const config = getRuntimeConfig().payment.alipayAutoRenew;
  const isSpecialPro = productCode === "pro_monthly" && matchesSpecialProPriceIdentity(
    identity,
    config.proSpecialPriceIdentifiers,
  );
  const value = productCode === "plus_monthly"
    ? config.plusMonthlyPriceId
    : isSpecialPro
      ? config.proSpecialPriceId
      : config.proMonthlyPriceId;
  if (!value) throw new Error(`ALIPAY_${productCode.toUpperCase()}_PRICE_ID_MISSING`);
  return value;
}

function matchesSpecialProPriceIdentity(
  identity: AlipayPriceIdentity | undefined,
  configuredIdentifiers: string[],
): boolean {
  if (!identity || configuredIdentifiers.length === 0) return false;
  const candidates = new Set(
    [identity.email, identity.phone]
      .map(normalizePriceIdentifier)
      .filter((value): value is string => Boolean(value)),
  );
  return configuredIdentifiers.some((identifier) => candidates.has(normalizePriceIdentifier(identifier) ?? ""));
}

function normalizePriceIdentifier(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  return normalized.includes("@") ? normalized : normalized.replace(/[\s()-]/g, "");
}
function resolveExpectedPrice(subscription: AutoRenewSubscriptionEntity): { priceId: string; unitAmount: number | null } {
  const metadata = objectValue(subscription.metadata);
  return {
    priceId: stringValue(metadata.alipayPriceId) ?? resolvePriceId(subscription.productCode),
    unitAmount: positiveIntegerValue(metadata.alipayUnitAmount),
  };
}
function assertSubscriptionMatchesProduct(
  snapshot: AlipaySubscriptionSnapshot,
  expectedPrice: { priceId: string; unitAmount: number | null },
  paidAmount?: number | null,
): number {
  const expectedPriceId = expectedPrice.priceId;
  const eventPriceIds = (snapshot.items ?? []).map((item) => item.price?.id).filter(Boolean);
  if (eventPriceIds.length === 0 || !eventPriceIds.includes(expectedPriceId)) {
    throw new Error("ALIPAY_NOTIFY_PRICE_ID_MISMATCH");
  }
  const priceAmount = positiveIntegerValue(
    snapshot.items?.find((item) => item.price?.id === expectedPriceId)?.price?.unit_amount,
  );
  if (priceAmount !== null && expectedPrice.unitAmount !== null && priceAmount !== expectedPrice.unitAmount) {
    throw new Error("ALIPAY_PRICE_AMOUNT_MISMATCH");
  }
  const expectedAmount = expectedPrice.unitAmount ?? priceAmount;
  if (expectedAmount === null) throw new Error("ALIPAY_PRICE_AMOUNT_MISSING");
  if (paidAmount !== undefined && (paidAmount === null || paidAmount !== expectedAmount)) {
    throw new Error("ALIPAY_NOTIFY_AMOUNT_MISMATCH");
  }
  return expectedAmount;
}
function normalizeSubscriptionStatus(value: unknown): AlipaySubscriptionStatus | string {
  return stringValue(value)?.toUpperCase() ?? "UNKNOWN";
}
function createAlipayPeriodKey(snapshot: AlipaySubscriptionSnapshot): string {
  return `${snapshot.current_period_start ?? ""}:${snapshot.current_period_end ?? ""}`;
}
function createAlipayPeriodChargeId(subscriptionId: string, periodKey: string): string {
  return `${subscriptionId}:${periodKey}`;
}
function objectValue(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function stringValue(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function positiveIntegerValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
function parseDate(value: unknown): Date | null { const text = stringValue(value); if (!text) return null; const date = new Date(text.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? "" : "+08:00")); return Number.isNaN(date.getTime()) ? null : date; }
function sanitizeEvent(event: AlipaySubscriptionChanged): unknown { return { ...event, raw: { ...event.raw, sign: "[redacted]", biz_content: "[parsed]" } }; }
