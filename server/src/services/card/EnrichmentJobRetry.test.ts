import assert from "node:assert/strict";
import test from "node:test";
import { resolveEnrichmentRetry, safeEnrichmentErrorMetadata } from "./EnrichmentJobRetry.js";

test("honors a longer upstream Retry-After while retaining the attempt limit", () => {
  const now = Date.parse("2026-09-28T10:00:00.000Z");
  const error = Object.assign(new Error("UPSTREAM_AI_ERROR"), {
    code: "UPSTREAM_AI_ERROR",
    status: 429,
    retryAfterMs: 120_000,
  });
  assert.equal(resolveEnrichmentRetry(error, 1, 3, now).retryAt?.getTime(), now + 120_000);
  assert.equal(resolveEnrichmentRetry(error, 4, 3, now).retryAt, null);
  assert.equal(safeEnrichmentErrorMetadata(error).retryAfterMs, 120_000);
});

test("keeps the local backoff when Retry-After is shorter", () => {
  const now = Date.parse("2026-09-28T10:00:00.000Z");
  const error = { code: "UPSTREAM_AI_ERROR", status: 429, retryAfterMs: 1_000 };
  assert.equal(resolveEnrichmentRetry(error, 2, 3, now).retryAt?.getTime(), now + 60_000);
});
