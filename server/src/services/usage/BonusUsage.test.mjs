import assert from 'node:assert/strict';
import test from 'node:test';
import { UsageV2Service } from './UsageV2Service.ts';

function fixture() {
  let state = { cycle: { id: 'cycle', quotaTokens: 100, usedTokens: 0, reservedTokens: 0 },
    bonus: { grantedPoints: 10000, usedPoints: 0, reservedPoints: 0 }, requests: {} };
  let queue = Promise.resolve();
  const apply = (row, data) => {
    for (const [key, value] of Object.entries(data)) {
      row[key] = value && typeof value === 'object' && !(value instanceof Date) && ('increment' in value || 'decrement' in value)
        ? row[key] + (value.increment ?? 0) - (value.decrement ?? 0) : value;
    }
    return row;
  };
  const db = { $transaction: fn => {
    const run = queue.then(async () => {
      const before = structuredClone(state);
      try { return await fn({
        $queryRawUnsafe: async () => [],
        $executeRawUnsafe: async (sql, a, b) => {
          const c = state.cycle;
          if (sql.includes('"usedTokens" = "usedTokens" + $2')) {
            if (c.reservedTokens < a || c.usedTokens + c.reservedTokens - a + b > c.quotaTokens) return 0;
            c.reservedTokens -= a; c.usedTokens += b;
          } else {
            if (c.usedTokens + c.reservedTokens + a > c.quotaTokens) return 0;
            c.reservedTokens += a;
          }
          return 1;
        },
        aiTokenCycle: { findUnique: async () => ({ ...state.cycle }), update: async ({ data }) => apply(state.cycle, data) },
        referralRedemption: { findUnique: async () => ({ ...state.bonus }), update: async ({ data }) => apply(state.bonus, data) },
        aiTokenTransaction: {
          findUnique: async ({ where }) => state.requests[where.userId_requestId.requestId] ?? null,
          create: async ({ data }) => state.requests[data.requestId] = { id: data.requestId, totalTokens: 0, ...data },
          update: async ({ where, data }) => apply(state.requests[where.id], data),
        },
      }); } catch (e) { state = before; throw e; }
    }); queue = run.catch(() => {}); return run;
  } };
  const service = new UsageV2Service(db, {});
  service.getCurrentUsage = async () => ({ token: { periodStart: '2026-10-01T00:00:00Z', periodEnd: '2026-11-01T00:00:00Z', remaining: 10100 } });
  const reserve = (id, amount, feature = 'rewrite') => service.reserveTokens({ userId: 'u', requestId: id, estimatedTokens: amount, feature });
  const settle = (id, amount) => service.settleTokens({ userId: 'u', requestId: id, inputTokens: 1, outputTokens: 1, billableCharacters: amount, meteringSource: 'provider' });
  return { service, reserve, settle, get state() { return state; } };
}

test('reserve then settle draws monthly first and accounts for bonus exactly once', async () => {
  const f = fixture();
  await f.reserve('a', 150);
  assert.equal(f.state.cycle.reservedTokens, 100);
  assert.equal(f.state.bonus.reservedPoints, 50);
  await f.settle('a', 120);
  assert.equal(f.state.cycle.usedTokens, 100);
  assert.equal(f.state.bonus.usedPoints, 20);
  assert.equal(f.state.bonus.reservedPoints, 0);
  assert.equal(f.state.requests.a.bonusUsedTokens, 20);
  await f.settle('a', 120);
  assert.equal(f.state.bonus.usedPoints, 20);
});
test('failed request releases both balances once', async () => {
  const f = fixture();
  await f.reserve('a', 150);
  await f.service.releaseTokens('u', 'a');
  await f.service.releaseTokens('u', 'a');
  assert.equal(f.state.cycle.reservedTokens, 0);
  assert.equal(f.state.bonus.reservedPoints, 0);
  assert.equal(f.state.bonus.usedPoints, 0);
});
test('actual usage lower than estimate returns all unspent bonus', async () => {
  const f = fixture(); await f.reserve('a', 150); await f.settle('a', 30);
  assert.equal(f.state.cycle.usedTokens, 30);
  assert.equal(f.state.bonus.usedPoints, 0);
  assert.equal(f.state.bonus.reservedPoints, 0);
});
test('concurrent reservations cannot overspend and failed settlement rolls back', async () => {
  const f = fixture();
  const result = await Promise.allSettled([f.reserve('a', 10000), f.reserve('b', 10000)]);
  assert.equal(result.filter(x => x.status === 'fulfilled').length, 1);
  await assert.rejects(f.settle('a', 20000), /INSUFFICIENT/);
  assert.equal(f.state.requests.a.status, 'reserved');
  await f.service.releaseTokens('u', 'a');
  assert.equal(f.state.bonus.reservedPoints, 0);
});
test('monthly renewal does not renew or remove bonus', async () => {
  const f = fixture(); await f.reserve('a', 150); await f.settle('a', 150);
  f.state.cycle = { id: 'next-month', quotaTokens: 100, usedTokens: 0, reservedTokens: 0 };
  await f.reserve('b', 90); await f.settle('b', 90);
  assert.equal(f.state.bonus.usedPoints, 50);
  assert.equal(f.state.cycle.usedTokens, 90);
});
test('free lookup never consumes monthly or bonus points; duplicate reservation rejected', async () => {
  const f = fixture(); await f.reserve('a', 150, 'dictionary'); await f.settle('a', 500);
  assert.equal(f.state.cycle.usedTokens, 0);
  assert.equal(f.state.bonus.usedPoints, 0);
  await assert.rejects(f.reserve('a', 150), /already been processed/);
});
