import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerMeRoutes } from './routes.ts';
import { signSessionToken } from '../../../server/src/services/auth/JwtSessionToken.ts';

test('referral route accepts parser metadata, skip and code but rejects client reward fields', async () => {
  const app = Fastify();
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, raw, done) => {
    try { done(null, Object.assign(JSON.parse(raw), { __rawBody: raw })); }
    catch (error) { done(error); }
  });
  const received = [];
  registerMeRoutes(app, {
    userRepository: { findById: async id => ({ id, status: 'active' }) },
    profileRateLimiter: { consume: async () => true },
    referralService: { complete: async (id, code) => {
      received.push({ id, code });
      return { grantedPoints: code ? 10000 : 0, alreadyClaimed: false };
    } },
  });
  try {
    const headers = { authorization: 'Bearer ' + signSessionToken('referral-route-test') };
    for (const payload of [{ code: 'QA-CODE' }, {}]) {
      const response = await app.inject({ method: 'POST', url: '/me/referral/complete', headers, payload });
      assert.equal(response.statusCode, 200);
    }
    assert.deepEqual(received.map(x => x.code), ['QA-CODE', undefined]);
    const bad = await app.inject({ method: 'POST', url: '/me/referral/complete', headers, payload: { code: 'QA-CODE', grantedPoints: 1000000 } });
    assert.equal(bad.statusCode, 400);
    assert.equal(received.length, 2);
  } finally { await app.close(); }
});
