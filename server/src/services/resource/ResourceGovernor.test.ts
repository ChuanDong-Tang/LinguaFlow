import assert from "node:assert/strict";
import test from "node:test";
import { ResourceGovernor, ResourceLimitedError } from "./ResourceGovernor.js";
import type { ResourcePolicies } from "../../config/resourcePolicies.js";

const policy = { userRequestsPerMinute: 2, globalRequestsPerMinute: 3, userConcurrency: 1, globalConcurrency: 2, leaseMs: 10_000 };
const policies: ResourcePolicies = { llm: policy, stt: policy, tts: policy, embedding: policy };

test("resource governor enforces per-user request limits", async () => {
  const governor = new ResourceGovernor(policies);
  await governor.consumeRequest("llm", "user-1");
  await governor.consumeRequest("llm", "user-1");
  await assert.rejects(() => governor.consumeRequest("llm", "user-1"), (error) => {
    assert.ok(error instanceof ResourceLimitedError);
    assert.equal(error.scope, "user_rate");
    return true;
  });
});

test("resource governor releases concurrency leases", async () => {
  const governor = new ResourceGovernor(policies);
  const first = await governor.acquireConcurrency("tts", "user-1");
  assert.ok(first);
  assert.equal(await governor.acquireConcurrency("tts", "user-1"), null);
  await first.release();
  assert.ok(await governor.acquireConcurrency("tts", "user-1"));
});

test("resource governor reports completions, failures, peaks and limits", async () => {
  const governor = new ResourceGovernor(policies);
  await governor.execute("embedding", "user-1", async () => "ok");
  await assert.rejects(() => governor.execute("embedding", "user-1", async () => { throw new Error("failed"); }));
  await assert.rejects(() => governor.consumeRequest("embedding", "user-1"));
  const snapshot = (await governor.snapshots()).find((item) => item.resource === "embedding");
  assert.ok(snapshot);
  assert.equal(snapshot.completedLastMinute, 2);
  assert.equal(snapshot.succeededLastMinute, 1);
  assert.equal(snapshot.failedLastMinute, 1);
  assert.equal(snapshot.limitedLastMinute, 1);
  assert.equal(snapshot.peakConcurrencyLastMinute, 1);
});
