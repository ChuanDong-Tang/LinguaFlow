import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerGoogleBillingDiagnostics } from "./clientDiagnostics.js";


test("authenticated event uses server identity; rejects invalid data; writer outage is nonblocking", async () => {
  const app = Fastify(); const events: any[] = [];
  registerGoogleBillingDiagnostics(app, {
    authorize: async (req, reply) => { if (!req.headers.authorization) { reply.code(401).send(); return null; } return { userId: "server-user" }; },
    allowed: async (_req, reply) => { if (_req.headers['x-test-limit']) {reply.code(429).send(); return false;} return true; },
    writer: { create: async input => { events.push(input); if ((input.metadata as Record<string, unknown>)?.code === "FAIL") throw new Error("down"); } },
  });
  try {
    const send = (payload: any, headers: any = { authorization: "test" }) => app.inject({ method: "POST", url: "/payment/google-play/client-error", headers, payload });
    assert.equal((await send({ stage: "callback" }, {})).statusCode, 401);
    assert.equal((await send({ stage: "callback" }, { authorization: "test", 'x-test-limit': 'yes' })).statusCode, 429);
    assert.equal(events.length, 0);
    assert.equal((await send({ stage: "bad" })).statusCode, 400);
    assert.equal((await send({ stage: "callback", responseCode: 4, userId: "spoof", purchaseToken: "secret" })).statusCode, 202);
    assert.equal(events[0].userId, "server-user");
    assert.ok(!JSON.stringify(events).includes("secret"));
    assert.equal((await send({ stage: "request", code: "FAIL" })).statusCode, 202);
    assert.equal((await send({ stage: "request", message: "x".repeat(5000) })).statusCode, 413);
  } finally { await app.close(); }
});
