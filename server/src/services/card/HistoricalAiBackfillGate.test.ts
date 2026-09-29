import assert from "node:assert/strict";
import test from "node:test";
import { HistoricalAiBackfillGate } from "./HistoricalAiBackfillGate.js";
import { ResourceLimitedError, type ResourceGovernor } from "../resource/ResourceGovernor.js";

test("local backfill limits are cached without repeated governor calls", async () => {
  let calls = 0;
  let now = 1_000;
  const governor = {
    async consumeRequest() {
      calls += 1;
      throw new ResourceLimitedError("llm_backfill", "global_rate", 60_000);
    },
  } as unknown as ResourceGovernor;
  const gate = new HistoricalAiBackfillGate(governor, null, () => now);

  assert.equal(await gate.tryAcquire(), false);
  assert.equal(await gate.tryAcquire(), false);
  assert.equal(calls, 1);
  now += 60_001;
  assert.equal(await gate.tryAcquire(), false);
  assert.equal(calls, 2);
});

test("an upstream 429 opens the shared circuit before another permit is consumed", async () => {
  let calls = 0;
  const state = new Map<string, string>();
  const governor = { async consumeRequest() { calls += 1; } } as unknown as ResourceGovernor;
  const redis = {
    async get(key: string) { return state.get(key) ?? null; },
    async set(key: string, value: string) { state.set(key, value); },
    async del(key: string) { state.delete(key); },
  };
  const gate = new HistoricalAiBackfillGate(governor, redis, () => 10_000);

  assert.equal(await gate.openForUpstreamRateLimit({ code: "UPSTREAM_AI_ERROR", status: 429 }), true);
  assert.equal(await gate.tryAcquire(), false);
  assert.equal(calls, 0);
});
