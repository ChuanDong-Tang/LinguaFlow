import assert from 'node:assert/strict';
import test from 'node:test';
import { ReferralService, normalizeReferralCode } from './ReferralService.ts';
import { allocatePoints } from './bonusAllocation.ts';

function fixture({ eligible = true, enabled = true, limit = 1, expired = false, completed = false } = {}) {
  let state = { users: { a: { status: 'active', referralEligible: eligible }, b: { status: 'active', referralEligible: true } }, claims: {}, count: 0 };
  let queue = Promise.resolve();
  const db = { $transaction: fn => {
    const run = queue.then(async () => {
      const before = structuredClone(state);
      try {
        return await fn({
          $queryRawUnsafe: async (sql, code) => {
            if (sql.includes('advisory')) return [];
            // Prisma timestamps are UTC even when the database session uses PRC.
            assert.match(sql, /"expiresAt" > \(NOW\(\) AT TIME ZONE 'UTC'\)/);
            if (code !== 'PARTNER' || !enabled || expired || state.count >= limit) return [];
            state.count++; return [{ code }];
          },
          user: { findUnique: async ({ where }) => state.users[where.id], update: async ({ where, data }) => Object.assign(state.users[where.id], data) },
          userPreference: { findUnique: async () => ({ guideState: completed ? { account_onboarding_v1: { completedAt: '2026-01-01' } } : {} }) },
          referralRedemption: { findUnique: async ({ where }) => state.claims[where.userId] ?? null,
            create: async ({ data }) => { if (state.claims[data.userId]) throw new Error('DUPLICATE'); return state.claims[data.userId] = data; } },
        });
      } catch (e) { state = before; throw e; }
    });
    queue = run.catch(() => {}); return run;
  } };
  return { service: new ReferralService(db), get state() { return state; } };
}

test('codes normalize and reject malformed input', () => {
  assert.equal(normalizeReferralCode(' partner '), 'PARTNER');
  for (const value of ['', 'abc', '中文码', 'A'.repeat(33), '<script>']) assert.throws(() => normalizeReferralCode(value));
});
test('concurrent same-account retries grant once even at capacity', async () => {
  const f = fixture();
  const results = await Promise.all([f.service.complete('a', 'partner'), f.service.complete('a', 'PARTNER')]);
  assert.equal(f.state.count, 1);
  assert.equal(f.state.claims.a.grantedPoints, 10000);
  assert.equal(results[1].alreadyClaimed, true);
  await assert.rejects(f.service.complete('a', 'OTHER'), /REFERRAL_ALREADY_CLAIMED/);
});
test('last redemption cannot be granted to two users', async () => {
  const f = fixture();
  const results = await Promise.allSettled([f.service.complete('a', 'PARTNER'), f.service.complete('b', 'PARTNER')]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(f.state.count, 1);
});
for (const options of [{ eligible: false }, { enabled: false }, { expired: true }, { completed: true }, { limit: 0 }]) {
  test(`ineligible/invalid code never grants: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    await assert.rejects(f.service.complete('a', 'PARTNER'), /REFERRAL_/);
    assert.equal(f.state.count, 0);
    assert.deepEqual(f.state.claims, {});
  });
}
test('skip does not grant, closes eligibility, and is repeatable', async () => {
  const f = fixture();
  assert.equal((await f.service.complete('a')).grantedPoints, 0);
  assert.equal((await f.service.complete('a')).grantedPoints, 0);
  await assert.rejects(f.service.complete('a', 'PARTNER'), /REFERRAL_NOT_ELIGIBLE/);
});
test('monthly-first allocation handles exhaustion, renewal, and invalid amounts', () => {
  assert.deepEqual(allocatePoints(30, 100, 10000), { monthly: 30, bonus: 0 });
  assert.deepEqual(allocatePoints(130, 100, 10000), { monthly: 100, bonus: 30 });
  assert.deepEqual(allocatePoints(30, 10000, 9970), { monthly: 30, bonus: 0 });
  assert.throws(() => allocatePoints(100, 0, 99), /INSUFFICIENT/);
  assert.throws(() => allocatePoints(-1, 100, 100), /INVALID/);
});
