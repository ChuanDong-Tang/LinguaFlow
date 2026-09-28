import assert from "node:assert/strict";
import test from "node:test";
import { parseRetryAfterMs } from "./GrokAIProvider.js";

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
