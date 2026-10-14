import assert from 'node:assert/strict';
import test from 'node:test';
import { AlipayAutoRenewClient } from './AlipayClient.ts';
import { AlipayAutoRenewService } from './AlipayAutoRenewService.ts';
import { PrismaAutoRenewRepository } from '../../../infrastructure/repository/PrismaAutoRenewRepository.ts';

test('plan changes omit cancellation field; cancellation keeps it', async () => {
  const client = new AlipayAutoRenewClient({});
  const requests = [];
  client.call = async (method, body) => {
    requests.push({ method, body });
    return { subscription_id: 'sub', alipay_jump_schema: 'test://confirmation' };
  };
  for (const mode of ['upgrade', 'period_end']) {
    await client.modifyPlan({ subscriptionId: 'sub', itemId: 'item', targetPriceId: 'price', mode });
  }
  assert.equal(requests[0].body.modify_type, 'UPGRADE');
  assert.equal(requests[0].body.preserve_billing_cycle, true);
  assert.equal(requests[1].body.modify_type, 'DOWNGRADE');
  for (const { body } of requests) {
    assert.equal('cancel_at_period_end' in body, false);
    assert.deepEqual(body.items, [{ item_id: 'item', price_id: 'price' }]);
  }
  // Test the cancellation path separately from downgrade.
  await client.cancelAtPeriodEnd('sub');
  assert.equal(requests.at(-1).body.cancel_at_period_end, true);
});

function fixture({ sparse = true, wrongPrice = false, queryError = false, stale = false } = {}) {
  const end = new Date(Date.now() + 86400000);
  const current = { id: 'local', userId: 'user', provider: 'alipay', providerAgreementId: 'sub',
    productCode: 'pro_monthly', status: 'active', currentPeriodEnd: end,
    metadata: { customerId: 'customer', alipayPriceId: 'price', alipayUnitAmount: 100,
      cancelAtPeriodEnd: true, ...(stale ? { lastAlipayChangeAt: '2030-01-01T00:00:00Z' } : {}) } };
  const event = { notifyId: 'notify', changeType: 'item_cancel_revert', changeDate: '2026-10-12T00:00:00Z',
    subscription: { subscription_id: 'sub', ...(sparse ? {} : { items: [{ price: { id: wrongPrice ? 'wrong' : 'price' } }] }) }, raw: {} };
  let queryCount = 0, grants = 0, storedEvent = null;
  const updates = [];
  const client = { parseAndVerifyNotification: () => event, querySubscription: async (input) => {
    queryCount++;
    assert.deepEqual(input, { customerId: 'customer', subscriptionId: 'sub' });
    if (queryError) throw new Error('QUERY_FAILED');
    return { subscription_id: 'sub', subscription_status: 'ACTIVE', current_period_end: end.toISOString(),
      cancel_at_period_end: false, items: [{ price: { id: wrongPrice ? 'wrong' : 'price', unit_amount: 100 } }] };
  } };
  const repository = { findByProviderAgreement: async () => current, findById: async () => current,
    updateSubscription: async (value) => { updates.push(value); return { ...current, ...value }; } };
  const auto = { recordPaidCharge: async () => { grants++; }, reconcileRevertedScheduledPlanChange: async () => {}, recoverStaleUnconfirmedPlanChange: async () => {} };
  const events = { findByProviderEventId: async () => storedEvent,
    updateDetails: async () => {},
    findOrCreate: async () => (storedEvent = { id: 'event', status: 'received' }),
    markProcessed: async () => { storedEvent.status = 'processed'; },
    markIgnored: async () => { storedEvent.status = 'ignored'; },
    markFailed: async () => { storedEvent.status = 'failed'; } };
  const service = new AlipayAutoRenewService({ alipayAccountLink: { findUnique: async () => null } }, repository, auto, {}, client, events);
  return { service, event, updates, get queryCount() { return queryCount; }, get grants() { return grants; } };
}

test('sparse resume queries and verifies current state without duplicate paid grant', async () => {
  const f = fixture();
  assert.equal(await f.service.handleNotification({}), 'processed');
  assert.equal(f.queryCount, 1);
  assert.equal(f.updates.at(-1).metadata.cancelAtPeriodEnd, false);
  assert.equal(f.grants, 0);
  assert.equal(await f.service.handleNotification({}), 'ignored');
  assert.equal(f.queryCount, 1);
});

for (const sparse of [true, false]) {
  test(`resume rejects wrong price (sparse=${sparse})`, async () => {
    const f = fixture({ sparse, wrongPrice: true });
    await assert.rejects(f.service.handleNotification({}), /ALIPAY_NOTIFY_PRICE_ID_MISMATCH/);
    assert.equal(f.updates.length, 0);
    assert.equal(f.grants, 0);
  });
}

test('query failure preserves local state and permits callback retry', async () => {
  const f = fixture({ queryError: true });
  await assert.rejects(f.service.handleNotification({}), /QUERY_FAILED/);
  await assert.rejects(f.service.handleNotification({}), /QUERY_FAILED/);
  assert.equal(f.queryCount, 2);
  assert.equal(f.updates.length, 0);
});

test('stale sparse notification does not query or reactivate', async () => {
  const f = fixture({ stale: true });
  assert.equal(await f.service.handleNotification({}), 'ignored');
  assert.equal(f.queryCount, 0);
  assert.equal(f.updates.length, 0);
});

test('paid notification with no price still fails closed', async () => {
  const f = fixture();
  Object.assign(f.event, { changeType: 'active', tradeNo: 'trade' });
  f.event.subscription.current_period_end = new Date(Date.now() + 86400000).toISOString();
  await assert.rejects(f.service.handleNotification({}), /ALIPAY_NOTIFY_PRICE_ID_MISMATCH/);
  assert.equal(f.queryCount, 0);
  assert.equal(f.grants, 0);
});

function pendingFixture() {
  const current = { id: 'local', userId: 'user', provider: 'alipay', providerAgreementId: 'sub',
    status: 'pending', productCode: 'pro_monthly', updatedAt: new Date(),
    metadata: { customerId: 'customer', schemaEffectiveEnd: '2020-01-01 12:00:00' } };
  const remote = { subscription_status: 'INCOMPLETE' };
  const expirations = [];
  const repository = { findByProviderAgreement: async () => current,
    expirePendingAlipaySignup: async (input) => { expirations.push(input); current.status = 'expired'; current.metadata = input.metadata; return true; } };
  const client = { querySubscription: async () => remote };
  const service = new AlipayAutoRenewService({ alipayAccountLink: { findUnique: async () => null } }, repository, {}, {}, client);
  return { current, remote, expirations, repository, client, service,
    run: () => service.reconcileAlipayAutoRenewSubscription('sub') };
}

test('verified unpaid signup expires locally, preserving remote status and identity', async () => {
  const f = pendingFixture();
  const result = await f.run();
  assert.equal(result.action, 'signup_expired');
  assert.equal(result.subscriptionStatus, 'INCOMPLETE');
  assert.equal(f.current.status, 'expired');
  assert.equal(f.current.providerAgreementId, 'sub');
  assert.equal(f.current.metadata.signupExpiryReason, 'expired_unpaid_signup');
  assert.equal(f.current.metadata.lastAlipaySubscriptionStatus, 'INCOMPLETE');
  assert.equal((await f.run()).action, 'unchanged');
  assert.equal(f.expirations.length, 1);
});

for (const scenario of ['unexpired', 'missing-expiry', 'invalid-expiry', 'paid-local', 'period-local', 'period-remote', 'not-pending', 'unknown-remote']) {
  test(`signup expiry fails closed: ${scenario}`, async () => {
    const f = pendingFixture();
    if (scenario === 'unexpired') f.current.metadata.schemaEffectiveEnd = '2099-01-01 12:00:00';
    if (scenario === 'missing-expiry') delete f.current.metadata.schemaEffectiveEnd;
    if (scenario === 'invalid-expiry') f.current.metadata.schemaEffectiveEnd = 'invalid';
    if (scenario === 'paid-local') f.current.latestTransactionId = 'paid';
    if (scenario === 'period-local') f.current.currentPeriodStart = new Date();
    if (scenario === 'period-remote') f.remote.current_period_end = '2099-01-01 12:00:00';
    if (scenario === 'not-pending') f.current.status = 'active';
    if (scenario === 'unknown-remote') f.remote.subscription_status = 'UNKNOWN';
    assert.equal((await f.run()).action, 'unchanged');
    assert.equal(f.expirations.length, 0);
  });
}

test('query failure and concurrent payment never expire pending', async () => {
  const f = pendingFixture();
  f.client.querySubscription = async () => { throw new Error('OFFLINE'); };
  await assert.rejects(f.run(), /OFFLINE/);
  assert.equal(f.current.status, 'pending');
  f.client.querySubscription = async () => f.remote;
  f.repository.expirePendingAlipaySignup = async () => false;
  assert.equal((await f.run()).action, 'unchanged');
});

test('repository expiry uses atomic unpaid/version/charge guards, not cancellation', async () => {
  let args;
  const repo = new PrismaAutoRenewRepository({ autoRenewSubscription: {
    updateMany: async (input) => { args = input; return { count: 0 }; },
  } });
  const updatedAt = new Date();
  assert.equal(await repo.expirePendingAlipaySignup({ id: 'local', expectedUpdatedAt: updatedAt, metadata: {} }), false);
  assert.deepEqual(args.where, { id: 'local', provider: 'alipay', status: 'pending', updatedAt,
    latestTransactionId: null, currentPeriodStart: null, currentPeriodEnd: null, charges: { none: {} } });
  assert.equal(args.data.status, 'expired');
  assert.equal('cancelledAt' in args.data, false);
});

function latePaymentFixture({ replacement = false, cancelFails = false } = {}) {
  const f = pendingFixture();
  f.current.status = 'expired';
  f.current.metadata = { ...f.current.metadata, signupExpiryReason: 'expired_unpaid_signup', alipayPriceId: 'price', alipayUnitAmount: 100 };
  const event = { notifyId: 'late', changeType: 'active', tradeNo: 'trade', changeDate: new Date().toISOString(), payAmount: 100,
    subscription: { subscription_id: 'sub', current_period_end: new Date(Date.now() + 86400000).toISOString(),
      items: [{ price: { id: 'price', unit_amount: 100 } }] } };
  let grants = 0, cancels = 0;
  const updates = [];
  Object.assign(f.remote, { subscription_status: 'ACTIVE', cancel_at_period_end: false });
  Object.assign(f.client, { parseAndVerifyNotification: () => event,
    cancelAtPeriodEnd: async () => { cancels++; if (cancelFails) throw new Error('CANCEL_FAILED'); f.remote.cancel_at_period_end = true; } });
  Object.assign(f.repository, { findCurrentByUserId: async () => replacement ? { id: 'new' } : null,
    updateSubscription: async (input) => { updates.push(input); return input; } });
  const service = new AlipayAutoRenewService({ alipayAccountLink: { findUnique: async () => null } }, f.repository,
    { recordPaidCharge: async () => { grants++; } }, {}, f.client);
  return { service, updates, get grants() { return grants; }, get cancels() { return cancels; } };
}

test('late payment reactivates expired signup when no replacement exists', async () => {
  const f = latePaymentFixture();
  assert.equal(await f.service.handleNotification({}), 'processed');
  assert.equal(f.grants, 1);
  assert.equal(f.updates[0].status, 'active');
  assert.equal(f.updates[0].allowReactivation, true);
  assert.equal(f.cancels, 0);
});

test('late payment with replacement grants period but stops old future renewal', async () => {
  const f = latePaymentFixture({ replacement: true });
  assert.equal(await f.service.handleNotification({}), 'processed');
  assert.equal(f.grants, 1);
  assert.equal(f.cancels, 1);
  assert.equal(f.updates[0].status, 'cancelled');
  assert.equal(f.updates[0].metadata.cancelAtPeriodEnd, true);
  assert.equal(f.updates[0].metadata.replacementSubscriptionId, 'new');
});

test('late conflicting payment cancellation failure remains retryable after grant', async () => {
  const f = latePaymentFixture({ replacement: true, cancelFails: true });
  await assert.rejects(f.service.handleNotification({}), /CANCEL_FAILED/);
  assert.equal(f.grants, 1);
  assert.equal(f.updates.length, 0);
});

test('direct create reconciles expired signup before creating a new one', async () => {
  const f = pendingFixture();
  let created = 0;
  Object.assign(f.repository, { findActiveByUserId: async () => null,
    findPendingByUserId: async () => f.current.status === 'pending' ? f.current : null });
  f.client.createSubscription = async () => { created++; return { subscriptionId: 'new', jumpSchema: 'test://new' }; };
  const service = new AlipayAutoRenewService({ alipayAccountLink: { findUnique: async () => null } }, f.repository,
    { getCurrent: async () => ({ subscription: f.current }), register: async (input) => input },
    { assertCanStartNewProPurchase: async () => {} }, f.client);
  service.getProductQuote = async () => ({ priceId: 'price', amount: 100, currency: 'CNY' });
  service.resolveCustomer = async () => 'customer';
  assert.equal((await service.create({ userId: 'user', productCode: 'pro_monthly' })).reused, false);
  assert.equal(f.current.status, 'expired');
  assert.equal(created, 1);
  f.client.querySubscription = async () => { throw new Error('QUERY_FAILED'); };
  await assert.rejects(service.create({ userId: 'user', productCode: 'pro_monthly' }), /QUERY_FAILED/);
  assert.equal(created, 1);
});

test('missed paid callback is recovered by reconciling the locally expired record', async () => {
  const f = pendingFixture();
  f.current.status = 'expired';
  Object.assign(f.current.metadata, { signupExpiryReason: 'expired_unpaid_signup', alipayPriceId: 'price', alipayUnitAmount: 100 });
  Object.assign(f.remote, { subscription_status: 'ACTIVE', current_period_end: new Date(Date.now() + 86400000).toISOString(),
    items: [{ price: { id: 'price', unit_amount: 100 } }] });
  let grants = 0, update;
  Object.assign(f.repository, { findById: async () => f.current, findCurrentByUserId: async () => null,
    updateSubscription: async (input) => { update = input; return input; } });
  const service = new AlipayAutoRenewService({ alipayAccountLink: { findUnique: async () => null } }, f.repository,
    { recordPaidCharge: async () => { grants++; }, reconcileRevertedScheduledPlanChange: async () => {}, recoverStaleUnconfirmedPlanChange: async () => {} }, {}, f.client);
  assert.equal((await service.reconcileAlipayAutoRenewSubscription('sub')).action, 'paid_period_recorded');
  assert.equal(grants, 1);
  assert.equal(update.status, 'active');
});
