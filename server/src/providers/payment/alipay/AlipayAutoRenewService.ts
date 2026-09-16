import type { AutoRenewProductCode, AutoRenewRepository, AutoRenewSubscriptionEntity } from "@lf/core/ports/repository/AutoRenewRepository.js";
import type { PaymentEventRepository } from "@lf/core/ports/repository/PaymentEventRepository.js";
import type { PaymentOrderRepository } from "@lf/core/ports/repository/PaymentOrderRepository.js";
import type { PaymentEntitlementService } from "../../../services/payment/PaymentEntitlementService.js";
import type { SubscriptionService } from "../../../services/subscription/SubscriptionService.js";
import { AutoRenewAccessDeniedError, AutoRenewAlreadyActiveError, AutoRenewNotFoundError, AutoRenewPlanAlreadyCurrentError, type AutoRenewService } from "../../../services/payment/AutoRenewService.js";
import { getRuntimeConfig } from "../../../config/runtimeConfig.js";
import { AlipayApiError, AlipayAutoRenewClient } from "./AlipayClient.js";
import type { AlipayFormFields } from "./AlipaySignature.js";
import type { AlipaySubscriptionChanged, AlipaySubscriptionSnapshot, AlipaySubscriptionStatus } from "./AlipayTypes.js";
import {
  AccountDeletionRenewalError,
  resolveAlipayAccountDeletionAction,
  type AccountDeletionRenewalResult,
} from "../AccountDeletionRenewal.js";

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

export type AlipayPlanChangeResult = {
  subscription: AutoRenewSubscriptionEntity;
  targetProductCode: AutoRenewProductCode;
  timing: "immediate" | "period_end";
  effectiveAt: Date | null;
  jumpSchema: string;
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
    private readonly paymentOrderRepository?: PaymentOrderRepository,
    private readonly subscriptionService?: SubscriptionService,
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
      const recurringInterval = price.recurring?.interval?.toUpperCase() ?? null;
      const recurringCount = price.recurring?.intervalCount ?? null;
      const validBillingPeriod = productCode.endsWith("_yearly")
        ? (recurringInterval === "YEAR" && recurringCount === 1)
          || (recurringInterval === "MONTH" && recurringCount === 12)
        : recurringInterval === "MONTH" && recurringCount === 1;
      if (price.type?.toLowerCase() !== "recurring" || !validBillingPeriod) {
        throw new Error(
          productCode.endsWith("_yearly")
            ? "ALIPAY_YEARLY_RECURRING_PRICE_REQUIRED"
            : "ALIPAY_MONTHLY_RECURRING_PRICE_REQUIRED"
        );
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
    assertAlipayMonthlyProduct(input.productCode);
    const [pendingAnnualOrder, currentMembership] = await Promise.all([
      this.paymentOrderRepository?.findPendingByUserProvider({
        userId: input.userId,
        provider: "alipay",
      }) ?? null,
      this.subscriptionService?.getCurrentSubscription(input.userId) ?? null,
    ]);
    if (pendingAnnualOrder) {
      throw new AutoRenewAlreadyActiveError("alipay");
    }
    const paidGrant = currentMembership?.billingSubscription;
    if (
      paidGrant?.sourceProvider === "alipay"
      && paidGrant.plan.endsWith("_yearly")
    ) {
      throw new AutoRenewAlreadyActiveError("alipay");
    }
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

  async changePlan(input: {
    userId: string;
    subscriptionId: string;
    targetProductCode: AutoRenewProductCode;
    requestId: string;
  }): Promise<AlipayPlanChangeResult> {
    if (!this.client) throw new Error("ALIPAY_AUTORENEW_NOT_CONFIGURED");
    assertAlipayMonthlyProduct(input.targetProductCode);
    const current = await this.repository.findById(input.subscriptionId);
    if (!current || current.userId !== input.userId || current.provider !== "alipay") {
      throw new AutoRenewAccessDeniedError();
    }
    if (!["active", "billing_retry"].includes(current.status)) throw new AutoRenewNotFoundError();
    if (current.productCode === input.targetProductCode) {
      throw new AutoRenewPlanAlreadyCurrentError();
    }

    const metadata = objectValue(current.metadata);
    if (metadata.cancelAtPeriodEnd === true) {
      throw new Error("ALIPAY_PLAN_CHANGE_WHILE_CANCEL_SCHEDULED");
    }
    const previousChange = objectValue(metadata.planChange);
    if (current.pendingProductCode) {
      if (current.pendingProductCode !== input.targetProductCode) {
        throw new Error("ALIPAY_PLAN_CHANGE_ALREADY_PENDING");
      }
      const storedJumpSchema = stringValue(previousChange.jumpSchema);
      if (storedJumpSchema) {
        return {
          subscription: current,
          targetProductCode: input.targetProductCode,
          timing: previousChange.timing === "immediate" ? "immediate" : "period_end",
          effectiveAt: current.pendingChangeEffectiveAt,
          jumpSchema: storedJumpSchema,
        };
      }
      throw new Error("ALIPAY_PLAN_CHANGE_CONFIRMATION_PENDING");
    }
    const customerId = stringValue(metadata.customerId);
    if (!customerId) throw new Error("ALIPAY_CUSTOMER_LINK_MISSING");
    const snapshot = await this.client.querySubscription({
      customerId,
      subscriptionId: current.providerAgreementId,
    });
    const itemId = snapshot.items?.[0]?.item_id?.trim();
    if (!itemId) throw new Error("ALIPAY_SUBSCRIPTION_ITEM_ID_MISSING");
    const targetQuote = await this.getProductQuote(input.targetProductCode);
    const timing = isTierUpgrade(current.productCode, input.targetProductCode)
      ? "immediate" as const
      : "period_end" as const;
    const effectiveAt = timing === "period_end" ? current.currentPeriodEnd : null;
    if (timing === "period_end" && !effectiveAt) {
      throw new Error("ALIPAY_CURRENT_PERIOD_END_MISSING");
    }
    const requestedAt = new Date();
    const planChangeMetadata = {
      fromProductCode: current.productCode,
      toProductCode: input.targetProductCode,
      timing,
      requestedAt: requestedAt.toISOString(),
      requestId: input.requestId,
      targetPriceId: targetQuote.priceId,
    };
    const reserved = await this.repository.reservePlanChange({
      id: current.id,
      userId: input.userId,
      pendingProductCode: input.targetProductCode,
      pendingChangeEffectiveAt: effectiveAt,
      pendingChangeRequestedAt: requestedAt,
      metadata: { ...metadata, planChange: planChangeMetadata },
    });
    if (!reserved) {
      throw new Error("ALIPAY_PLAN_CHANGE_ALREADY_PENDING");
    }
    let changed: Awaited<ReturnType<AlipayAutoRenewClient["modifyPlan"]>>;
    try {
      changed = await this.client.modifyPlan({
        subscriptionId: current.providerAgreementId,
        itemId,
        targetPriceId: targetQuote.priceId,
        mode: timing === "immediate" ? "upgrade" : "period_end",
      });
    } catch (error) {
      // A signed Alipay business rejection is definitive. Network timeouts,
      // HTTP failures and unverifiable/malformed success responses are
      // ambiguous: keep the reservation and let reconciliation query Alipay
      // before another modification is allowed.
      if (isDefinitiveAlipayModifyFailure(error)) {
        await this.repository.releasePlanChangeReservation({
          id: current.id,
          pendingChangeRequestedAt: requestedAt,
          metadata: {
            ...metadata,
            planChange: planChangeMetadata,
            planChangeRecovery: {
              reason: "provider_definitive_rejection",
              targetProductCode: input.targetProductCode,
              recoveredAt: new Date().toISOString(),
            },
          },
        });
      }
      throw error;
    }
    const latest = await this.repository.findById(current.id);
    if (!latest) throw new AutoRenewNotFoundError();
    const latestMetadata = objectValue(latest.metadata);
    const subscription = await this.repository.updateSubscription({
      id: current.id,
      metadata: {
        ...latestMetadata,
        planChange: {
          ...planChangeMetadata,
          jumpSchema: changed.jumpSchema,
        },
      },
    });
    return {
      subscription,
      targetProductCode: input.targetProductCode,
      timing,
      effectiveAt,
      jumpSchema: changed.jumpSchema,
    };
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
      const eventProductCode = resolveProductCodeFromSubscriptionSnapshot(event.subscription)
        ?? subscription.productCode;
      const eventPrice = resolveExpectedPriceForProduct(eventProductCode);
      const amount = assertSubscriptionMatchesProduct(
        event.subscription,
        eventPrice,
        event.payAmount,
      );
      const periodKey = createAlipayPeriodKey(event.subscription);
      const chargeId = createAlipayPeriodChargeId(subscription.providerAgreementId, periodKey);
      await this.autoRenewService.recordPaidCharge({
        userId: subscription.userId, provider: "alipay", productCode: eventProductCode,
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
        productCode: eventProductCode,
        currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, nextBillingAt: null,
        ...(subscription.pendingProductCode === eventProductCode
          ? {
              pendingProductCode: null,
              pendingChangeStatus: null,
              pendingChangeEffectiveAt: null,
              pendingChangeRequestedAt: null,
            }
          : {}),
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
          alipayPriceId: eventPrice.priceId,
          alipayUnitAmount: amount,
          alipayCurrency: "CNY",
        },
      });
      return "processed";
    }
    if (event.changeType === "item_update") {
      if (stale) return "ignored";
      const targetProductCode = subscription.pendingProductCode
        ?? resolveProductCodeFromSubscriptionSnapshot(event.subscription);
      if (!targetProductCode) throw new Error("ALIPAY_PLAN_CHANGE_TARGET_MISSING");
      const targetPrice = resolveExpectedPriceForProduct(targetProductCode);
      const expectedAmount = assertSubscriptionMatchesProduct(
        event.subscription,
        targetPrice,
      );
      const providerTransactionId = event.tradeNo ?? event.orderNo;
      if (!providerTransactionId) throw new Error("ALIPAY_UPGRADE_PAYMENT_ID_MISSING");
      const periodStart = parseDate(event.subscription.current_period_start);
      const periodEnd = parseDate(event.subscription.current_period_end);
      if (!periodEnd) throw new Error("ALIPAY_UPGRADE_PERIOD_END_MISSING");
      await this.autoRenewService.recordPaidCharge({
        userId: subscription.userId,
        provider: "alipay",
        productCode: targetProductCode,
        providerAgreementId: subscription.providerAgreementId,
        providerChargeId: providerTransactionId,
        periodKey: `upgrade:${providerTransactionId}`,
        amount: event.payAmount ?? expectedAmount,
        currency: "CNY",
        periodStart,
        periodEnd,
        paidAt: eventTime ?? new Date(),
        rawPayload: sanitizeEvent(event),
      });
      await this.repository.updateSubscription({
        id: subscription.id,
        productCode: targetProductCode,
        status: "active",
        latestTransactionId: providerTransactionId,
        currentPeriodStart: periodStart ?? subscription.currentPeriodStart,
        currentPeriodEnd: periodEnd,
        pendingProductCode: null,
        pendingChangeStatus: null,
        pendingChangeEffectiveAt: null,
        pendingChangeRequestedAt: null,
        metadata: {
          ...metadata,
          lastAlipayNotifyId: event.notifyId,
          lastAlipayChangeAt: event.changeDate,
          lastAlipayChangeType: event.changeType,
          planChangeAppliedAt: event.changeDate ?? new Date().toISOString(),
          alipayPriceId: targetPrice.priceId,
          alipayUnitAmount: expectedAmount,
          alipayCurrency: "CNY",
        },
      });
      return "processed";
    }
    if (event.changeType === "item_downgrade") {
      if (stale) return "ignored";
      const targetProductCode = subscription.pendingProductCode
        ?? resolveProductCodeFromSubscriptionSnapshot(event.subscription, true);
      if (!targetProductCode) throw new Error("ALIPAY_PLAN_CHANGE_TARGET_MISSING");
      assertSubscriptionMatchesProduct(
        event.subscription,
        resolveExpectedPriceForProduct(targetProductCode),
        undefined,
        true,
      );
      await this.repository.updateSubscription({
        id: subscription.id,
        pendingProductCode: targetProductCode,
        pendingChangeStatus: "scheduled",
        pendingChangeEffectiveAt: subscription.pendingChangeEffectiveAt ?? subscription.currentPeriodEnd,
        metadata: {
          ...metadata,
          lastAlipayNotifyId: event.notifyId,
          lastAlipayChangeAt: event.changeDate,
          lastAlipayChangeType: event.changeType,
          planChangeConfirmedAt: event.changeDate ?? new Date().toISOString(),
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
      await this.repository.updateSubscription({
        id: subscription.id,
        pendingProductCode: null,
        pendingChangeStatus: null,
        pendingChangeEffectiveAt: null,
        pendingChangeRequestedAt: null,
        metadata: { ...metadata, lastAlipayNotifyId: event.notifyId, lastAlipayChangeAt: event.changeDate, lastAlipayChangeType: event.changeType, cancelAtPeriodEnd: true },
      });
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
      if (!resolveProductCodeFromPriceItems(event.subscription.pending_items)) {
        await this.autoRenewService.reconcileRevertedScheduledPlanChange({
          provider: "alipay",
          providerAgreementId: subscription.providerAgreementId,
          observedCurrentProductCode: subscription.productCode,
          rawPayload: sanitizeEvent(event),
          reconciledAt: eventTime ?? new Date(),
        });
      }
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
      const providerPendingProductCode = resolveProductCodeFromPriceItems(snapshot.pending_items);
      if (
        current.pendingProductCode &&
        providerPendingProductCode === current.pendingProductCode
      ) {
        await this.autoRenewService.confirmScheduledPlanChange({
          provider: "alipay",
          providerAgreementId: current.providerAgreementId,
          targetProductCode: providerPendingProductCode,
          effectiveAt: current.pendingChangeEffectiveAt ?? current.currentPeriodEnd,
          rawPayload: { source: "alipay_subscription_reconcile", subscription: snapshot },
        });
      }
      const confirmedLocal = await this.repository.findById(current.id);
      const reconciledMetadata = objectValue(confirmedLocal?.metadata ?? current.metadata);
      const reconciledProductCode = resolveProductCodeFromSubscriptionSnapshot(snapshot)
        ?? current.productCode;
      const reconciledPrice = reconciledProductCode === current.productCode
        ? resolveExpectedPrice(current)
        : resolveExpectedPriceForProduct(reconciledProductCode);
      const amount = assertSubscriptionMatchesProduct(snapshot, reconciledPrice);
      const periodIsCurrent = periodEnd > now;
      const periodChanged = current.currentPeriodEnd?.getTime() !== periodEnd.getTime();
      const productChanged = current.productCode !== reconciledProductCode;
      if ((periodChanged || productChanged) && periodIsCurrent) {
        const basePeriodKey = createAlipayPeriodKey(snapshot);
        const periodKey = productChanged
          ? `${basePeriodKey}:${reconciledProductCode}`
          : basePeriodKey;
        await this.autoRenewService.recordPaidCharge({
          userId: current.userId,
          provider: "alipay",
          productCode: reconciledProductCode,
          providerAgreementId: current.providerAgreementId,
          providerChargeId: createAlipayPeriodChargeId(current.providerAgreementId, periodKey),
          periodKey,
          amount: productChanged ? null : amount,
          currency: "CNY",
          periodStart,
          periodEnd,
          paidAt: periodStart ?? new Date(),
          rawPayload: { source: "alipay_subscription_reconcile", subscription: snapshot },
        });
      }
      await this.repository.updateSubscription({
        id: current.id,
        productCode: reconciledProductCode,
        status: periodIsCurrent ? "active" : "billing_retry",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        nextBillingAt: null,
        cancelledAt: null,
        allowReactivation: true,
        ...(cancelAtPeriodEnd || current.pendingProductCode === reconciledProductCode
          ? {
              pendingProductCode: null,
              pendingChangeStatus: null,
              pendingChangeEffectiveAt: null,
              pendingChangeRequestedAt: null,
            }
          : {}),
        metadata: {
          ...reconciledMetadata,
          customerId,
          cancelAtPeriodEnd,
          lastAlipayReconciledAt: new Date().toISOString(),
          lastAlipaySubscriptionStatus: subscriptionStatus,
          alipayPriceId: reconciledPrice.priceId,
          alipayUnitAmount: amount,
          alipayCurrency: "CNY",
        },
      });
      if (!providerPendingProductCode && reconciledProductCode === current.productCode) {
        await this.autoRenewService.reconcileRevertedScheduledPlanChange({
          provider: "alipay",
          providerAgreementId: current.providerAgreementId,
          observedCurrentProductCode: reconciledProductCode,
          rawPayload: { source: "alipay_subscription_reconcile", subscription: snapshot },
        });
      }
      await this.autoRenewService.recoverStaleUnconfirmedPlanChange({
        provider: "alipay",
        providerAgreementId: current.providerAgreementId,
      });
      return {
        status: "checked",
        action: (periodChanged || productChanged) && periodIsCurrent
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
    return this.repository.updateSubscription({
      id: subscription.id,
      pendingProductCode: null,
      pendingChangeStatus: null,
      pendingChangeEffectiveAt: null,
      pendingChangeRequestedAt: null,
      metadata: {
        ...objectValue(subscription.metadata),
        cancelAtPeriodEnd: true,
        cancelRequestedAt: new Date().toISOString(),
      },
    });
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
  ): Promise<AccountDeletionRenewalResult> {
    if (!this.client) throw new Error("ALIPAY_AUTORENEW_NOT_CONFIGURED");
    const subscription = await this.repository.findByProviderAgreement({ provider: "alipay", providerAgreementId });
    if (!subscription) {
      return {
        action: "already_inactive",
        remoteStatus: "LOCAL_SUBSCRIPTION_NOT_FOUND",
        autoRenewEnabled: false,
        currentPeriodEnd: null,
      };
    }

    const metadata = objectValue(subscription.metadata);
    const storedLink = await this.store.alipayAccountLink.findUnique({ where: { userId: subscription.userId } });
    const customerId = stringValue(metadata.customerId) ?? storedLink?.customerId ?? null;
    if (!customerId) {
      return {
        action: "deferred",
        remoteStatus: "CUSTOMER_LINK_MISSING",
        autoRenewEnabled: null,
        currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
        reason: "customer_link_missing",
      };
    }

    const snapshot = await this.client.querySubscription({ customerId, subscriptionId: providerAgreementId });
    const remoteStatus = normalizeSubscriptionStatus(snapshot.subscription_status);
    const cancelAtPeriodEnd = snapshot.cancel_at_period_end === true;
    const authorizationExpiresAt = parseDate(metadata.schemaEffectiveEnd);
    const incompleteAuthorizationExpired = remoteStatus === "INCOMPLETE"
      && Boolean(authorizationExpiresAt && authorizationExpiresAt <= new Date())
      && !snapshot.current_period_start
      && !snapshot.current_period_end
      && !subscription.latestTransactionId
      && !subscription.currentPeriodStart
      && !subscription.currentPeriodEnd;
    const action = resolveAlipayAccountDeletionAction(
      remoteStatus,
      cancelAtPeriodEnd,
      incompleteAuthorizationExpired,
    );
    const currentPeriodEnd = parseDate(snapshot.current_period_end)?.toISOString() ?? null;

    if (action === "defer") {
      return {
        action: "deferred",
        remoteStatus,
        autoRenewEnabled: null,
        currentPeriodEnd,
        reason: "remote_status_not_safe_for_deletion",
      };
    }
    if (action === "already_inactive") {
      if (
        (["CANCELED", "INCOMPLETE_EXPIRED"].includes(remoteStatus) || incompleteAuthorizationExpired)
        && subscription.status !== "cancelled"
      ) {
        await this.repository.cancelSubscription({
          id: subscription.id,
          cancelledAt: parseDate(snapshot.canceled_date) ?? new Date(),
          metadata: {
            ...metadata,
            customerId,
            cancelAtPeriodEnd: false,
            cancelSource: incompleteAuthorizationExpired
              ? "account_deletion_expired_incomplete_authorization"
              : "account_deletion_remote_check",
            lastAlipaySubscriptionStatus: remoteStatus,
          },
        });
      }
      return {
        action,
        remoteStatus,
        autoRenewEnabled: false,
        currentPeriodEnd,
        ...(incompleteAuthorizationExpired ? { reason: "expired_incomplete_authorization" } : {}),
      };
    }

    try {
      await this.client.cancelAtPeriodEnd(providerAgreementId);
    } catch (error) {
      throw new AccountDeletionRenewalError(remoteStatus, error);
    }
    await this.repository.updateSubscription({
      id: subscription.id,
      metadata: {
        ...metadata,
        customerId,
        cancelAtPeriodEnd: true,
        cancelSource: "account_deletion",
        cancelRequestedAt: new Date().toISOString(),
        lastAlipaySubscriptionStatus: remoteStatus,
      },
    });
    return { action: "cancelled", remoteStatus, autoRenewEnabled: false, currentPeriodEnd };
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

function assertAlipayMonthlyProduct(productCode: AutoRenewProductCode): void {
  if (productCode !== "plus_monthly" && productCode !== "pro_monthly") {
    throw new AlipayApiError(
      "ALIPAY_AUTORENEW_MONTHLY_ONLY",
      "Alipay annual passes are one-time purchases and cannot use subscription plan changes",
    );
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
    : productCode === "plus_yearly"
      ? config.plusYearlyPriceId
      : productCode === "pro_yearly"
        ? config.proYearlyPriceId
        : isSpecialPro
          ? config.proSpecialPriceId
          : config.proMonthlyPriceId;
  if (!value) throw new Error(`ALIPAY_${productCode.toUpperCase()}_PRICE_ID_MISSING`);
  return value;
}

function isTierUpgrade(current: AutoRenewProductCode, target: AutoRenewProductCode): boolean {
  return current.startsWith("plus_") && target.startsWith("pro_");
}

function isDefinitiveAlipayModifyFailure(error: unknown): boolean {
  if (!(error instanceof AlipayApiError)) return false;
  return !new Set([
    "ALIPAY_HTTP_ERROR",
    "ALIPAY_RESPONSE_SIGNATURE_INVALID",
    "ALIPAY_SUBSCRIPTION_MODIFY_RESPONSE_INVALID",
  ]).has(error.code);
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
function resolveExpectedPriceForProduct(productCode: AutoRenewProductCode): { priceId: string; unitAmount: number | null } {
  return { priceId: resolvePriceId(productCode), unitAmount: null };
}
function resolveProductCodeFromSubscriptionSnapshot(
  snapshot: AlipaySubscriptionSnapshot,
  includePending = false,
): AutoRenewProductCode | null {
  return resolveProductCodeFromPriceItems([
    ...(includePending ? snapshot.pending_items ?? [] : []),
    ...(snapshot.items ?? []),
  ]);
}
function resolveProductCodeFromPriceItems(
  items: Array<{ price?: { id?: string } }> | undefined,
): AutoRenewProductCode | null {
  const priceIds = new Set((items ?? []).map((item) => item.price?.id).filter(Boolean));
  const candidates: AutoRenewProductCode[] = ["plus_monthly", "plus_yearly", "pro_monthly", "pro_yearly"];
  return candidates.find((productCode) => {
    try { return priceIds.has(resolvePriceId(productCode)); } catch { return false; }
  }) ?? null;
}
function assertSubscriptionMatchesProduct(
  snapshot: AlipaySubscriptionSnapshot,
  expectedPrice: { priceId: string; unitAmount: number | null },
  paidAmount?: number | null,
  includePending = false,
): number {
  const expectedPriceId = expectedPrice.priceId;
  const candidateItems = includePending
    ? [...(snapshot.pending_items ?? []), ...(snapshot.items ?? [])]
    : snapshot.items ?? [];
  const eventPriceIds = candidateItems.map((item) => item.price?.id).filter(Boolean);
  if (eventPriceIds.length === 0 || !eventPriceIds.includes(expectedPriceId)) {
    throw new Error("ALIPAY_NOTIFY_PRICE_ID_MISMATCH");
  }
  const priceAmount = positiveIntegerValue(
    candidateItems.find((item) => item.price?.id === expectedPriceId)?.price?.unit_amount,
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
