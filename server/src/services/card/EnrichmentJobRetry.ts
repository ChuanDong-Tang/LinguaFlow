import { ResourceLimitedError } from "../resource/ResourceGovernor.js";
import { TokenQuotaExceededError } from "../usage/UsageV2Service.js";

export type EnrichmentRetry = {
  retryAt: Date | null;
  preserveAttempt: boolean;
};

const UPSTREAM_AI_RETRY_DELAYS_MS = [15_000, 60_000, 300_000] as const;

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
  if (isRetryableUpstreamAIError(error)) {
    const maxUpstreamAttempts = Math.max(maxAttempts, UPSTREAM_AI_RETRY_DELAYS_MS.length + 1);
    if (attempts >= maxUpstreamAttempts) return { retryAt: null, preserveAttempt: false };
    const delayIndex = Math.min(Math.max(0, attempts - 1), UPSTREAM_AI_RETRY_DELAYS_MS.length - 1);
    return {
      retryAt: new Date(now + UPSTREAM_AI_RETRY_DELAYS_MS[delayIndex]!),
      preserveAttempt: false,
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

export function safeEnrichmentErrorMetadata(error: unknown): Record<string, string | number | boolean> {
  if (!error || typeof error !== "object") return {};
  const candidate = error as {
    code?: unknown;
    status?: unknown;
    upstreamCode?: unknown;
    failureKind?: unknown;
    name?: unknown;
  };
  const metadata: Record<string, string | number | boolean> = {};
  const status = safeHttpStatus(candidate.status);
  const upstreamCode = safeIdentifier(candidate.upstreamCode);
  const failureKind = safeIdentifier(candidate.failureKind);
  const errorName = safeIdentifier(candidate.name);
  if (status !== null) metadata.upstreamStatus = status;
  if (upstreamCode) metadata.upstreamCode = upstreamCode;
  if (failureKind) metadata.failureKind = failureKind;
  if (errorName) metadata.errorName = errorName;
  if (candidate.code === "UPSTREAM_AI_ERROR") {
    metadata.retryableUpstream = isRetryableUpstreamAIError(error);
  }
  return metadata;
}

export function isRetryableUpstreamAIError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; status?: unknown; upstreamCode?: unknown };
  if (candidate.code !== "UPSTREAM_AI_ERROR") return false;
  const status = safeHttpStatus(candidate.status);
  if (status !== null) {
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
  }
  const upstreamCode = safeIdentifier(candidate.upstreamCode)?.toLowerCase() ?? "";
  if (/invalid|authentication|unauthorized|forbidden|permission|model_not_found|not_found/u.test(upstreamCode)) {
    return false;
  }
  return true;
}

function safeHttpStatus(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599 ? Number(value) : null;
}

function safeIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 100 && /^[A-Za-z0-9_.:-]+$/u.test(normalized) ? normalized : null;
}
