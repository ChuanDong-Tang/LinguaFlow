import type { ResourceGovernor } from "../resource/ResourceGovernor.js";
import { ResourceLimitedError } from "../resource/ResourceGovernor.js";

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

type CircuitState = { failures: number; pausedUntilMs: number };

const CIRCUIT_KEY = "linguaflow:card-ai:historical-backfill-circuit:v1";
const BACKOFF_MS = [30 * 60_000, 60 * 60_000, 120 * 60_000] as const;

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
    try {
      await this.governor.consumeRequest("llm_backfill", "historical-card-ai", {
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

  async openForUpstreamRateLimit(error: unknown): Promise<boolean> {
    if (!isUpstreamRateLimit(error)) return false;
    const previous = await this.readCircuit();
    const failures = Math.min(BACKOFF_MS.length, (previous?.failures ?? 0) + 1);
    const pausedUntilMs = this.now() + BACKOFF_MS[failures - 1]!;
    const state = { failures, pausedUntilMs };
    this.memoryCircuit = state;
    if (this.redis) {
      await this.redis.set(CIRCUIT_KEY, JSON.stringify(state), "PX", BACKOFF_MS[failures - 1]!).catch(() => undefined);
    }
    return true;
  }

  async recordHistoricalSuccess(): Promise<void> {
    this.memoryCircuit = null;
    if (this.redis) await this.redis.del(CIRCUIT_KEY).catch(() => undefined);
  }

  private async isCircuitOpen(now: number): Promise<boolean> {
    const state = await this.readCircuit();
    return Boolean(state && state.pausedUntilMs > now);
  }

  private async readCircuit(): Promise<CircuitState | null> {
    if (!this.redis) return this.memoryCircuit;
    try {
      const raw = await this.redis.get(CIRCUIT_KEY);
      if (!raw) return this.memoryCircuit;
      const parsed = JSON.parse(raw) as Partial<CircuitState>;
      if (!Number.isFinite(parsed.failures) || !Number.isFinite(parsed.pausedUntilMs)) return this.memoryCircuit;
      return { failures: Number(parsed.failures), pausedUntilMs: Number(parsed.pausedUntilMs) };
    } catch {
      // Production requires Redis. Fail closed for maintenance work when its shared state is unavailable.
      return { failures: BACKOFF_MS.length, pausedUntilMs: this.now() + 60_000 };
    }
  }
}

export function isUpstreamRateLimit(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; status?: unknown; upstreamCode?: unknown };
  if (Number(candidate.status) === 429) return true;
  const code = `${String(candidate.code ?? "")} ${String(candidate.upstreamCode ?? "")}`.toLowerCase();
  return /(?:^|[^0-9])429(?:[^0-9]|$)|rate.?limit|too.?many.?requests/u.test(code);
}
