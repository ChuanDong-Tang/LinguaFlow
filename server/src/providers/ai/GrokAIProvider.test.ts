import assert from "node:assert/strict";
import test from "node:test";
import { GrokAIProvider, parseRetryAfterMs } from "./GrokAIProvider.js";

function headers(values: Record<string, string | undefined>): Pick<Headers, "get"> {
  return { get(name: string) { return values[name.toLowerCase()] ?? null; } };
}

test("parses provider retry timing without exceeding the safety cap", () => {
  assert.equal(parseRetryAfterMs(headers({ "retry-after-ms": "2500" })), 2500);
  assert.equal(parseRetryAfterMs(headers({ "retry-after": "90" })), 90_000);
  assert.equal(parseRetryAfterMs(headers({ "retry-after": "99999" })), 3_600_000);
});

test("parses HTTP-date Retry-After and ignores invalid values", () => {
  const now = Date.parse("2026-09-28T10:00:00.000Z");
  assert.equal(parseRetryAfterMs(headers({ "retry-after": "Sun, 28 Sep 2026 10:02:00 GMT" }), now), 120_000);
  assert.equal(parseRetryAfterMs(headers({ "retry-after": "not-a-date" }), now), undefined);
});

test("sends the configured reasoning effort to Grok", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response([
      'data: {"choices":[{"delta":{"content":"ok"}}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n"), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  };

  try {
    const provider = new GrokAIProvider({
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      model: "grok-4.3",
      reasoningEffort: "none",
    });
    await provider.generateChatTextStream({
      userId: "test-user",
      text: "probe",
      rawUserPrompt: true,
    }, () => {});
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requestBody?.model, "grok-4.3");
  assert.equal(requestBody?.reasoning_effort, "none");
});

test("omits reasoning effort for non-reasoning Grok models", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response([
      'data: {"choices":[{"delta":{"content":"ok"}}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n"), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  };

  try {
    const provider = new GrokAIProvider({
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      model: "grok-4-20-non-reasoning",
      reasoningEffort: "none",
    });
    await provider.generateChatTextStream({
      userId: "test-user",
      text: "probe",
      rawUserPrompt: true,
    }, () => {});
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requestBody?.model, "grok-4-20-non-reasoning");
  assert.equal(Object.hasOwn(requestBody ?? {}, "reasoning_effort"), false);
});
