import assert from "node:assert/strict";
import test from "node:test";
import type { AutoRenewSubscriptionEntity } from "@lf/core/ports/repository/AutoRenewRepository.js";
import { AlipayAutoRenewService } from "./AlipayAutoRenewService.js";
import type { AlipaySubscriptionChanged, AlipaySubscriptionSnapshot } from "./AlipayTypes.js";

process.env.ALIPAY_PLUS_MONTHLY_PRICE_ID = "price-plus";
process.env.ALIPAY_PRO_MONTHLY_PRICE_ID = "price-pro";

function createLocalSubscription(overrides: Partial<AutoRenewSubscriptionEntity> = {}): AutoRenewSubscriptionEntity {
  const now = new Date("2026-09-01T04:00:00.000Z");
  return {
    id: "local-subscription-1",
    userId: "user-1",
    provider: "alipay",
    productCode: "plus_monthly",
    status: "pending",
    providerAgreementId: "subscription-1",
    latestTransactionId: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    nextBillingAt: null,
    cancelledAt: null,
    metadata: { customerId: "customer-1" },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createActiveSnapshot(overrides: Partial<AlipaySubscriptionSnapshot> = {}): AlipaySubscriptionSnapshot {
  return {
    subscription_id: "subscription-1",
    customer_id: "customer-1",
    subscription_status: "ACTIVE",
    current_period_start: "2026-09-01 12:00:00",
    current_period_end: "2026-10-01 12:00:00",
    cancel_at_period_end: false,
    items: [{ price: { id: "price-plus", product_id: "product-plus", unit_amount: 1500 } }],
    ...overrides,
  };
}

test("Alipay reconcile restores a paid period when the notification was missed", async () => {
  const local = createLocalSubscription();
  const recordedCharges: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const service = new AlipayAutoRenewService(
    { alipayAccountLink: { findUnique: async () => ({ userId: "user-1", customerId: "customer-1" }), upsert: async () => ({ userId: "user-1", customerId: "customer-1" }) } } as never,
    {
      updateSubscription: async (input: Record<string, unknown>) => { updates.push(input); return { ...local, ...input }; },
    } as never,
    {
      getCurrent: async () => ({ subscription: local }),
      recordPaidCharge: async (input: Record<string, unknown>) => { recordedCharges.push(input); return { charge: {}, alreadyApplied: false }; },
    } as never,
    { assertCanStartNewProPurchase: async () => undefined } as never,
    { querySubscription: async () => createActiveSnapshot() } as never,
  );

  const result = await service.reconcileCurrentAutoRenewForUser("user-1");

  assert.equal(result.status, "checked");
  assert.equal(result.status === "checked" ? result.action : null, "paid_period_recorded");
  assert.equal(recordedCharges.length, 1);
  assert.equal(recordedCharges[0]?.providerChargeId, "subscription-1:2026-09-01 12:00:00:2026-10-01 12:00:00");
  assert.equal(recordedCharges[0]?.amount, 1500);
  assert.equal(updates[0]?.status, "active");
  assert.equal((updates[0]?.currentPeriodEnd as Date).toISOString(), "2026-10-01T04:00:00.000Z");
});

test("Alipay reconcile cancels a local subscription that is no longer active remotely", async () => {
  const local = createLocalSubscription({ status: "active" });
  const cancellations: Array<Record<string, unknown>> = [];
  const service = new AlipayAutoRenewService(
    { alipayAccountLink: { findUnique: async () => ({ userId: "user-1", customerId: "customer-1" }), upsert: async () => ({ userId: "user-1", customerId: "customer-1" }) } } as never,
    {
      cancelSubscription: async (input: Record<string, unknown>) => { cancellations.push(input); return { ...local, status: "cancelled" }; },
    } as never,
    { getCurrent: async () => ({ subscription: local }) } as never,
    { assertCanStartNewProPurchase: async () => undefined } as never,
    { querySubscription: async () => createActiveSnapshot({ subscription_status: "CANCELED", canceled_date: "2026-09-15 12:00:00" }) } as never,
  );

  const result = await service.reconcileCurrentAutoRenewForUser("user-1");

  assert.equal(result.status, "checked");
  assert.equal(result.status === "checked" ? result.action : null, "cancelled");
  assert.equal(cancellations.length, 1);
  assert.equal((cancellations[0]?.cancelledAt as Date).toISOString(), "2026-09-15T04:00:00.000Z");
});

test("Alipay notification is recorded once and duplicate notify_id is ignored", async () => {
  const local = createLocalSubscription();
  const recordedCharges: Array<Record<string, unknown>> = [];
  let storedStatus: "received" | "processed" | "ignored" | "failed" | null = null;
  const event: AlipaySubscriptionChanged = {
    notifyId: "notify-1",
    appId: "app-1",
    changeType: "active",
    changeDate: "2026-09-01 12:00:00",
    tradeNo: "trade-1",
    orderNo: "order-1",
    outTradeNo: null,
    payAmount: 1500,
    subscription: createActiveSnapshot(),
    raw: { sign: "secret", biz_content: "raw" },
  };
  const service = new AlipayAutoRenewService(
    { alipayAccountLink: { findUnique: async () => ({ userId: "user-1", customerId: "customer-1" }), upsert: async () => ({ userId: "user-1", customerId: "customer-1" }) } } as never,
    {
      findByProviderAgreement: async () => local,
      updateSubscription: async (input: Record<string, unknown>) => ({ ...local, ...input }),
    } as never,
    {
      recordPaidCharge: async (input: Record<string, unknown>) => { recordedCharges.push(input); return { charge: {}, alreadyApplied: false }; },
    } as never,
    { assertCanStartNewProPurchase: async () => undefined } as never,
    { parseAndVerifyNotification: () => event } as never,
    {
      findByProviderEventId: async () => storedStatus ? {
        id: "event-1", provider: "alipay", providerEventId: "notify-1", providerOrderId: "trade-1",
        eventType: "alipay.trade.subscription.changed", status: storedStatus, rawPayload: {}, errorMessage: null,
        createdAt: new Date(), processedAt: null,
      } : null,
      findOrCreate: async () => {
        storedStatus = "received";
        return {
          id: "event-1", provider: "alipay", providerEventId: "notify-1", providerOrderId: "trade-1",
          eventType: "alipay.trade.subscription.changed", status: "received", rawPayload: {}, errorMessage: null,
          createdAt: new Date(), processedAt: null,
        };
      },
      updateDetails: async () => null,
      markProcessed: async () => { storedStatus = "processed"; return null; },
      markIgnored: async () => null,
      markFailed: async () => null,
    } as never,
  );

  assert.equal(await service.handleNotification({}), "processed");
  assert.equal(await service.handleNotification({}), "ignored");
  assert.equal(recordedCharges.length, 1);
  assert.equal(recordedCharges[0]?.providerChargeId, "subscription-1:2026-09-01 12:00:00:2026-10-01 12:00:00");
});

test("Alipay account deletion stops renewal before local account cleanup", async () => {
  const local = createLocalSubscription({ status: "active" });
  const cancelledAgreements: string[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const service = new AlipayAutoRenewService(
    { alipayAccountLink: { findUnique: async () => null, upsert: async () => ({ userId: "user-1", customerId: "customer-1" }) } } as never,
    {
      findByProviderAgreement: async () => local,
      updateSubscription: async (input: Record<string, unknown>) => { updates.push(input); return { ...local, ...input }; },
    } as never,
    {} as never,
    {} as never,
    { cancelAtPeriodEnd: async (id: string) => { cancelledAgreements.push(id); } } as never,
  );

  assert.equal(await service.stopSubscriptionRenewalForAccountDeletion("subscription-1"), "cancelled");
  assert.deepEqual(cancelledAgreements, ["subscription-1"]);
  assert.equal((updates[0]?.metadata as Record<string, unknown>).cancelSource, "account_deletion");
  assert.equal((updates[0]?.metadata as Record<string, unknown>).cancelAtPeriodEnd, true);
});
