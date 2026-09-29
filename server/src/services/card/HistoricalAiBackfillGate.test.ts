import assert from "node:assert/strict";
import test from "node:test";
import { HistoricalAiBackfillGate, isForegroundLlmHealthy } from "./HistoricalAiBackfillGate.js";
import { ResourceLimitedError, type ResourceGovernor } from "../resource/ResourceGovernor.js";

test("local backfill limits are cached without repeated governor calls", async () => {
  let calls = 0;
  let now = 1_000;
  const governor = {
    async snapshots() { return []; },
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
  const governor = {
    async snapshots() { return []; },
    async consumeRequest() { calls += 1; },
  } as unknown as ResourceGovernor;
  const redis = {
    async get(key: string) { return state.get(key) ?? null; },
    async set(key: string, value: string) { state.set(key, value); },
    async del(key: string) { state.delete(key); },
  };
  const gate = new HistoricalAiBackfillGate(governor, redis, () => 10_000);

  assert.equal(await gate.recordHistoricalFailure({ code: "UPSTREAM_AI_ERROR", status: 429 }), true);
  assert.equal(await gate.tryAcquire(), false);
  assert.equal(calls, 0);
});

test("two consecutive retryable upstream failures open the shared circuit", async () => {
  let calls = 0;
  const state = new Map<string, string>();
  const governor = {
    async snapshots() { return []; },
    async consumeRequest() { calls += 1; },
  } as unknown as ResourceGovernor;
  const redis = {
    async get(key: string) { return state.get(key) ?? null; },
    async set(key: string, value: string) { state.set(key, value); },
    async del(key: string) { state.delete(key); },
  };
  const gate = new HistoricalAiBackfillGate(governor, redis, () => 10_000);
  const upstream = { code: "UPSTREAM_AI_ERROR", upstreamCode: "AI_PROVIDER_TIMEOUT" };

  assert.equal(await gate.recordHistoricalFailure(upstream), false);
  assert.equal(await gate.tryAcquire(), true);
  assert.equal(await gate.recordHistoricalFailure(upstream), true);
  assert.equal(await gate.tryAcquire(), false);
  assert.equal(calls, 1);
});

test("healthy foreground traffic is required before a historical permit is consumed", async () => {
  let calls = 0;
  const governor = {
    async snapshots() {
      return [{
        resource: "llm", windowMinutes: 5, requestsLastMinute: 10, requestLimit: 1200,
        currentConcurrency: 1, concurrencyLimit: 80, peakConcurrencyLastMinute: 2,
        completedLastMinute: 10, succeededLastMinute: 7, failedLastMinute: 3,
        limitedLastMinute: 0, averageDurationMs: 2_000,
      }];
    },
    async consumeRequest() { calls += 1; },
  } as unknown as ResourceGovernor;
  const gate = new HistoricalAiBackfillGate(governor, null, () => 10_000);

  assert.equal(await gate.tryAcquire(), false);
  assert.equal(calls, 0);
});

test("foreground health fails closed for sparse errors and slow samples", () => {
  const base = {
    resource: "llm" as const, windowMinutes: 5, requestsLastMinute: 5, requestLimit: 1200,
    currentConcurrency: 1, concurrencyLimit: 80, peakConcurrencyLastMinute: 2,
    completedLastMinute: 1, succeededLastMinute: 1, failedLastMinute: 0,
    limitedLastMinute: 0, averageDurationMs: 30_000,
  };
  assert.equal(isForegroundLlmHealthy(base), false);
  assert.equal(isForegroundLlmHealthy({ ...base, averageDurationMs: 3_000 }), true);
  assert.equal(isForegroundLlmHealthy({ ...base, succeededLastMinute: 0, failedLastMinute: 1, averageDurationMs: 3_000 }), false);
});
