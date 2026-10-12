import assert from 'node:assert/strict';
import test from 'node:test';
import { AlipayAutoRenewClient } from './AlipayClient.ts';
import { AlipayAutoRenewService } from './AlipayAutoRenewService.ts';

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
