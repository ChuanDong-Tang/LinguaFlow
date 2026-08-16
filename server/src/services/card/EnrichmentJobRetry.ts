import { ResourceLimitedError } from "../resource/ResourceGovernor.js";
import { TokenQuotaExceededError } from "../usage/UsageV2Service.js";

export type EnrichmentRetry = {
  retryAt: Date | null;
  preserveAttempt: boolean;
};

export function resolveEnrichmentRetry(
  error: unknown,
  attempts: number,
  maxAttempts: number,
  now = Date.now(),
): EnrichmentRetry {
  if (error instanceof ResourceLimitedError) {
    const retryAfterMs = Math.max(1_000, error.retryAfterMs);
    const jitterMs = Math.floor(Math.random() * Math.min(5_000, Math.max(500, retryAfterMs / 10)));
    return {
      retryAt: new Date(now + retryAfterMs + jitterMs),
      preserveAttempt: true,
    };
  }
  if (error instanceof TokenQuotaExceededError) {
    return {
      retryAt: new Date(Math.max(now + 1_000, error.refreshAt.getTime() + 1_000)),
      preserveAttempt: true,
    };
  }
  return {
    retryAt: attempts >= maxAttempts
      ? null
      : new Date(now + Math.min(60_000, 1_000 * (2 ** Math.max(0, attempts - 1)))),
    preserveAttempt: false,
  };
}

export function safeEnrichmentErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error ?? "unknown")).slice(0, 500);
}
