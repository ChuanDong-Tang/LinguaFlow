import assert from "node:assert/strict";
import test from "node:test";
import { resolveResourcePolicies } from "./resourcePolicies.js";

const legacy = {
  llmUserRpm: 20,
  llmGlobalRpm: 30,
  llmGlobalConcurrency: 4,
  sttUserRpm: 20,
  sttGlobalRpm: 80,
  sttMaxSessionMs: 60_000,
  ttsGlobalRpm: 100,
  embeddingGlobalRpm: 120,
  embeddingGlobalConcurrency: 8,
};

test("resource policies retain legacy values when new settings are absent", () => {
  const policies = resolveResourcePolicies({}, legacy);
  assert.equal(policies.llm.userRequestsPerMinute, 20);
  assert.equal(policies.llm.globalRequestsPerMinute, 30);
  assert.equal(policies.stt.globalRequestsPerMinute, 80);
  assert.equal(policies.tts.globalRequestsPerMinute, 100);
  assert.equal(policies.embedding.globalConcurrency, 8);
});

test("RESOURCE settings take precedence over legacy values", () => {
  const policies = resolveResourcePolicies({
    RESOURCE_LLM_USER_RPM: "42",
    RESOURCE_STT_GLOBAL_CONCURRENCY: "75",
    RESOURCE_TTS_USER_RPM: "150",
    RESOURCE_EMBEDDING_GLOBAL_RPM: "240",
  }, legacy);
  assert.equal(policies.llm.userRequestsPerMinute, 42);
  assert.equal(policies.stt.globalConcurrency, 75);
  assert.equal(policies.tts.userRequestsPerMinute, 150);
  assert.equal(policies.embedding.globalRequestsPerMinute, 240);
});
