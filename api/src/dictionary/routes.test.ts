import assert from "node:assert/strict";
import test from "node:test";
import type { AIProvider } from "@lf/core/ports/ai/AIProvider.js";
import { generateDictionaryLookupWithRetry } from "./routes.js";

test("dictionary attempts run through the supplied foreground resource executor", async () => {
  let executions = 0;
  const provider = {
    providerName: "test",
    modelName: "test-model",
    async generateChatTextStream(_input: unknown, onEvent: (event: { type: "delta"; text: string }) => void) {
      onEvent({
        type: "delta",
        text: JSON.stringify({
          queryType: "phrase",
          term: "take a break",
          phonetic: null,
          targetMeaning: "to rest briefly",
          nativeMeaning: "短暂休息",
        }),
      });
    },
  } as unknown as AIProvider;
  const result = await generateDictionaryLookupWithRetry(provider, {
    userId: "user-1",
    term: "take a break",
    fallbackTerm: "take a break",
    context: "I should take a break.",
    selectionStart: 9,
    selectionEnd: 21,
    targetLanguage: "en-US",
    uiLanguage: "zh-CN",
    maxOutputTokens: 180,
    signal: new AbortController().signal,
  }, {
    attemptTimeoutMs: 1_000,
    maxAttempts: 2,
    retryBaseDelayMs: 1,
    async executeAttempt(attempt) {
      executions += 1;
      return attempt();
    },
  });

  assert.equal(executions, 1);
  assert.equal(result.attempts, 1);
  assert.equal(result.data?.nativeMeaning, "短暂休息");
});
