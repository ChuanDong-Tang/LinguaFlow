import { isRetryableUpstreamAIError } from "./EnrichmentJobRetry.js";
import type { ResourceGovernor, ResourceSnapshot } from "../resource/ResourceGovernor.js";
import { ResourceLimitedError } from "../resource/ResourceGovernor.js";

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

type CircuitReason = "foreground_unhealthy" | "upstream_failure_streak" | "upstream_rate_limit";
type CircuitState = {
  failures: number;
  consecutiveFailures: number;
  pausedUntilMs: number;
  reason?: CircuitReason;
};

const CIRCUIT_KEY = "linguaflow:card-ai:historical-backfill-circuit:v1";
const BACKOFF_MS = [30 * 60_000, 60 * 60_000, 120 * 60_000] as const;
const FAILURE_STREAK_TTL_MS = 10 * 60_000;
const FOREGROUND_PAUSE_MS = 10 * 60_000;
const FOREGROUND_WINDOW_MINUTES = 5;
const FOREGROUND_MAX_FAILURE_RATE = 0.2;
const FOREGROUND_MAX_AVERAGE_DURATION_MS = 12_000;
const FOREGROUND_MAX_CONCURRENCY_RATIO = 0.8;

export const HISTORICAL_AI_RESOURCE_IDENTITY = "historical-card-ai";

export class HistoricalAiBackfillGate {
  private nextPermitAtMs = 0;
  private memoryCircuit: CircuitState | null = null;

  constructor(
    private readonly governor: ResourceGovernor,
    private readonly redis?: RedisLike | null,
    private readonly now: () => number = Date.now,
  ) {}

  async tryAcquire(): Promise<boolean> {
    const now = this.now();
    if (now < this.nextPermitAtMs || await this.isCircuitOpen(now)) return false;
    const snapshot = (await this.governor.snapshots(FOREGROUND_WINDOW_MINUTES))
      .find((item) => item.resource === "llm");
    if (snapshot && !isForegroundLlmHealthy(snapshot)) {
      await this.pauseForForegroundHealth();
      return false;
    }
    try {
      await this.governor.consumeRequest("llm_backfill", HISTORICAL_AI_RESOURCE_IDENTITY, {
        operation: "historical_card_ai_preclaim",
      });
      return true;
    } catch (error) {
      if (!(error instanceof ResourceLimitedError)) throw error;
      this.nextPermitAtMs = now + Math.max(1_000, error.retryAfterMs);
      return false;
    }
  }

  deferForLocalLimit(error: ResourceLimitedError): void {
    this.nextPermitAtMs = Math.max(this.nextPermitAtMs, this.now() + Math.max(1_000, error.retryAfterMs));
  }

  async recordHistoricalFailure(error: unknown): Promise<boolean> {
    const rateLimited = isUpstreamRateLimit(error);
    if (!rateLimited && !isRetryableUpstreamAIError(error)) return false;
    const previous = await this.readCircuit();
    const consecutiveFailures = (previous?.consecutiveFailures ?? 0) + 1;
    if (!rateLimited && consecutiveFailures < 2) {
      await this.writeCircuit({
        failures: previous?.failures ?? 0,
        consecutiveFailures,
        pausedUntilMs: 0,
      }, FAILURE_STREAK_TTL_MS);
      return false;
    }
    const failures = Math.min(BACKOFF_MS.length, (previous?.failures ?? 0) + 1);
    const pauseMs = BACKOFF_MS[failures - 1]!;
    await this.writeCircuit({
      failures,
      consecutiveFailures,
      pausedUntilMs: this.now() + pauseMs,
      reason: rateLimited ? "upstream_rate_limit" : "upstream_failure_streak",
    }, pauseMs);
    return true;
  }

  async recordHistoricalSuccess(): Promise<void> {
    this.memoryCircuit = null;
    if (this.redis) await this.redis.del(CIRCUIT_KEY).catch(() => undefined);
  }

  private async pauseForForegroundHealth(): Promise<void> {
    const previous = await this.readCircuit();
    await this.writeCircuit({
      failures: previous?.failures ?? 0,
      consecutiveFailures: previous?.consecutiveFailures ?? 0,
      pausedUntilMs: this.now() + FOREGROUND_PAUSE_MS,
      reason: "foreground_unhealthy",
    }, FOREGROUND_PAUSE_MS);
  }

  private async isCircuitOpen(now: number): Promise<boolean> {
    const state = await this.readCircuit();
    return Boolean(state && state.pausedUntilMs > now);
  }

  private async writeCircuit(state: CircuitState, ttlMs: number): Promise<void> {
    this.memoryCircuit = state;
    if (this.redis) {
      await this.redis.set(CIRCUIT_KEY, JSON.stringify(state), "PX", ttlMs).catch(() => undefined);
    }
  }

  private async readCircuit(): Promise<CircuitState | null> {
    if (!this.redis) return this.memoryCircuit;
    try {
      const raw = await this.redis.get(CIRCUIT_KEY);
      if (!raw) return this.memoryCircuit;
      const parsed = JSON.parse(raw) as Partial<CircuitState>;
      if (!Number.isFinite(parsed.failures) || !Number.isFinite(parsed.pausedUntilMs)) return this.memoryCircuit;
      return {
        failures: Number(parsed.failures),
        consecutiveFailures: Number.isFinite(parsed.consecutiveFailures) ? Number(parsed.consecutiveFailures) : 0,
        pausedUntilMs: Number(parsed.pausedUntilMs),
        reason: parsed.reason,
      };
    } catch {
      // Production requires Redis. Fail closed for maintenance work when its shared state is unavailable.
      return {
        failures: BACKOFF_MS.length,
        consecutiveFailures: 2,
        pausedUntilMs: this.now() + 60_000,
        reason: "foreground_unhealthy",
      };
    }
  }
}

export function isForegroundLlmHealthy(snapshot: ResourceSnapshot): boolean {
  if (snapshot.limitedLastMinute > 0) return false;
  if (snapshot.concurrencyLimit > 0
    && snapshot.currentConcurrency / snapshot.concurrencyLimit >= FOREGROUND_MAX_CONCURRENCY_RATIO) return false;
  if (snapshot.failedLastMinute > 0 && snapshot.completedLastMinute <= 1) return false;
  if (snapshot.completedLastMinute === 0) return true;
  if (snapshot.failedLastMinute / snapshot.completedLastMinute >= FOREGROUND_MAX_FAILURE_RATE) return false;
  return snapshot.averageDurationMs === null
    || snapshot.averageDurationMs < FOREGROUND_MAX_AVERAGE_DURATION_MS;
}

export function isUpstreamRateLimit(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; status?: unknown; upstreamCode?: unknown };
  if (Number(candidate.status) === 429) return true;
  const code = `${String(candidate.code ?? "")} ${String(candidate.upstreamCode ?? "")}`.toLowerCase();
  return /(?:^|[^0-9])429(?:[^0-9]|$)|rate.?limit|too.?many.?requests/u.test(code);
}
