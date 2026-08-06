import { randomUUID } from "node:crypto";
import type { ResourceKind, ResourcePolicies } from "../../config/resourcePolicies.js";

type RedisLike = {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
};

export type ResourceLimitScope = "user_rate" | "global_rate" | "user_concurrency" | "global_concurrency";

export class ResourceLimitedError extends Error {
  readonly code = "RESOURCE_LIMITED";
  constructor(readonly resource: ResourceKind, readonly scope: ResourceLimitScope, readonly retryAfterMs: number) {
    super(`${resource} resource is temporarily limited`);
  }
}

export type ResourceLease = {
  renew(): Promise<void>;
  release(): Promise<void>;
};

export type ResourceSnapshot = {
  resource: ResourceKind;
  requestsLastMinute: number;
  requestLimit: number;
  currentConcurrency: number;
  concurrencyLimit: number;
  peakConcurrencyLastMinute: number;
  completedLastMinute: number;
  succeededLastMinute: number;
  failedLastMinute: number;
  limitedLastMinute: number;
  averageDurationMs: number | null;
};

type MemoryMetric = { minute: number; completed: number; succeeded: number; failed: number; limited: number; durationSumMs: number; peak: number };

export class ResourceGovernor {
  private readonly memoryRates = new Map<string, { count: number; expiresAt: number }>();
  private readonly memoryLeases = new Map<string, Map<string, number>>();
  private readonly memoryMetrics = new Map<ResourceKind, MemoryMetric>();

  constructor(private readonly policies: ResourcePolicies, private readonly redis?: RedisLike | null) {}

  policy(resource: ResourceKind) {
    return this.policies[resource];
  }

  async enter(resource: ResourceKind, userId: string): Promise<ResourceLease> {
    const policy = this.policies[resource];
    const rateScope = await this.consumeRate(resource, userId);
    if (rateScope) {
      await this.recordLimited(resource).catch(() => undefined);
      throw new ResourceLimitedError(resource, rateScope, 60_000);
    }
    const lease = await this.acquireConcurrency(resource, userId);
    if (!lease) {
      await this.recordLimited(resource).catch(() => undefined);
      throw new ResourceLimitedError(resource, "global_concurrency", Math.min(5_000, policy.leaseMs));
    }
    return lease;
  }

  async consumeRequest(resource: ResourceKind, userId: string): Promise<void> {
    const scope = await this.consumeRate(resource, userId);
    if (scope) {
      await this.recordLimited(resource).catch(() => undefined);
      throw new ResourceLimitedError(resource, scope, 60_000);
    }
  }

  async acquireConcurrency(resource: ResourceKind, userId: string): Promise<ResourceLease | null> {
    return this.acquireLease(resource, userId);
  }

  async execute<T>(resource: ResourceKind, userId: string, task: () => Promise<T>): Promise<T> {
    const lease = await this.enter(resource, userId);
    const renewTimer = setInterval(() => void lease.renew().catch(() => undefined), Math.max(1_000, Math.floor(this.policies[resource].leaseMs / 3)));
    const startedAt = Date.now();
    try {
      const result = await task();
      await this.recordCompletion(resource, Date.now() - startedAt, true).catch(() => undefined);
      return result;
    } catch (error) {
      await this.recordCompletion(resource, Date.now() - startedAt, false).catch(() => undefined);
      throw error;
    }
    finally {
      clearInterval(renewTimer);
      await lease.release().catch(() => undefined);
    }
  }

  async executeConcurrency<T>(resource: ResourceKind, userId: string, task: () => Promise<T>): Promise<T> {
    const lease = await this.acquireConcurrency(resource, userId);
    if (!lease) {
      await this.recordLimited(resource).catch(() => undefined);
      throw new ResourceLimitedError(resource, "global_concurrency", Math.min(5_000, this.policies[resource].leaseMs));
    }
    const renewTimer = setInterval(() => void lease.renew().catch(() => undefined), Math.max(1_000, Math.floor(this.policies[resource].leaseMs / 3)));
    const startedAt = Date.now();
    try {
      const result = await task();
      await this.recordCompletion(resource, Date.now() - startedAt, true).catch(() => undefined);
      return result;
    } catch (error) {
      await this.recordCompletion(resource, Date.now() - startedAt, false).catch(() => undefined);
      throw error;
    }
    finally {
      clearInterval(renewTimer);
      await lease.release().catch(() => undefined);
    }
  }

  async snapshots(): Promise<ResourceSnapshot[]> {
    return Promise.all((Object.keys(this.policies) as ResourceKind[]).map((resource) => this.snapshot(resource)));
  }

  async observeCompletion(resource: ResourceKind, durationMs: number, succeeded: boolean): Promise<void> {
    await this.recordCompletion(resource, durationMs, succeeded);
  }

  private async snapshot(resource: ResourceKind): Promise<ResourceSnapshot> {
    const policy = this.policies[resource];
    let values: number[];
    if (this.redis) {
      const raw = await this.redis.eval(
        SNAPSHOT_SCRIPT,
        3,
        `resource:{${resource}}:rate:global`,
        `resource:{${resource}}:active:global`,
        this.metricKey(resource),
      ) as Array<string | number | null>;
      values = raw.map((value) => Number(value ?? 0));
    } else {
      const now = Date.now();
      const rate = this.currentMemoryRate(`${resource}:global`, now);
      const active = this.currentMemoryLeases(`resource:{${resource}}:active:global`, now).size;
      const metric = this.currentMemoryMetric(resource);
      values = [rate.count, active, metric.peak, metric.completed, metric.succeeded, metric.failed, metric.limited, metric.durationSumMs];
    }
    const [requests, current, peak, completed, succeeded, failed, limited, durationSum] = values;
    return {
      resource,
      requestsLastMinute: requests,
      requestLimit: policy.globalRequestsPerMinute,
      currentConcurrency: current,
      concurrencyLimit: policy.globalConcurrency,
      peakConcurrencyLastMinute: peak,
      completedLastMinute: completed,
      succeededLastMinute: succeeded,
      failedLastMinute: failed,
      limitedLastMinute: limited,
      averageDurationMs: completed > 0 ? Math.round(durationSum / completed) : null,
    };
  }

  private async recordCompletion(resource: ResourceKind, durationMs: number, succeeded: boolean): Promise<void> {
    if (this.redis) {
      await this.redis.eval(METRIC_SCRIPT, 1, this.metricKey(resource), succeeded ? 1 : 0, Math.max(0, Math.round(durationMs)));
      return;
    }
    const metric = this.currentMemoryMetric(resource);
    metric.completed += 1;
    metric.succeeded += succeeded ? 1 : 0;
    metric.failed += succeeded ? 0 : 1;
    metric.durationSumMs += Math.max(0, Math.round(durationMs));
  }

  private async recordLimited(resource: ResourceKind): Promise<void> {
    if (this.redis) {
      await this.redis.eval(LIMITED_SCRIPT, 1, this.metricKey(resource));
      return;
    }
    this.currentMemoryMetric(resource).limited += 1;
  }

  private async recordPeak(resource: ResourceKind, active: number): Promise<void> {
    if (this.redis) {
      await this.redis.eval(PEAK_SCRIPT, 1, this.metricKey(resource), active);
      return;
    }
    const metric = this.currentMemoryMetric(resource);
    metric.peak = Math.max(metric.peak, active);
  }

  private metricKey(resource: ResourceKind): string {
    return `resource:{${resource}}:metrics:${Math.floor(Date.now() / 60_000)}`;
  }

  private currentMemoryMetric(resource: ResourceKind): MemoryMetric {
    const minute = Math.floor(Date.now() / 60_000);
    const current = this.memoryMetrics.get(resource);
    if (current?.minute === minute) return current;
    const next = { minute, completed: 0, succeeded: 0, failed: 0, limited: 0, durationSumMs: 0, peak: 0 };
    this.memoryMetrics.set(resource, next);
    return next;
  }

  private async consumeRate(resource: ResourceKind, userId: string): Promise<"user_rate" | "global_rate" | null> {
    const policy = this.policies[resource];
    if (this.redis) {
      const result = Number(await this.redis.eval(
        RATE_SCRIPT,
        2,
        `resource:{${resource}}:rate:global`,
        `resource:{${resource}}:rate:user:${userId}`,
        60_000,
        policy.globalRequestsPerMinute,
        policy.userRequestsPerMinute,
      ));
      return result === 1 ? "global_rate" : result === 2 ? "user_rate" : null;
    }
    const now = Date.now();
    const globalKey = `${resource}:global`;
    const userKey = `${resource}:user:${userId}`;
    const global = this.currentMemoryRate(globalKey, now);
    const user = this.currentMemoryRate(userKey, now);
    if (global.count >= policy.globalRequestsPerMinute) return "global_rate";
    if (user.count >= policy.userRequestsPerMinute) return "user_rate";
    global.count += 1;
    user.count += 1;
    return null;
  }

  private currentMemoryRate(key: string, now: number) {
    const current = this.memoryRates.get(key);
    if (current && current.expiresAt > now) return current;
    const next = { count: 0, expiresAt: now + 60_000 };
    this.memoryRates.set(key, next);
    return next;
  }

  private async acquireLease(resource: ResourceKind, userId: string): Promise<ResourceLease | null> {
    const policy = this.policies[resource];
    const token = randomUUID();
    const globalKey = `resource:{${resource}}:active:global`;
    const userKey = `resource:{${resource}}:active:user:${userId}`;
    if (this.redis) {
      const result = Number(await this.redis.eval(ACQUIRE_SCRIPT, 2, globalKey, userKey, token, policy.leaseMs, policy.globalConcurrency, policy.userConcurrency));
      if (result !== 0) return null;
      const active = Number(await this.redis.eval(ACTIVE_COUNT_SCRIPT, 1, globalKey));
      await this.recordPeak(resource, active).catch(() => undefined);
      return {
        renew: async () => { await this.redis!.eval(RENEW_SCRIPT, 2, globalKey, userKey, token, policy.leaseMs); },
        release: async () => { await this.redis!.eval(RELEASE_SCRIPT, 2, globalKey, userKey, token); },
      };
    }
    const now = Date.now();
    const global = this.currentMemoryLeases(globalKey, now);
    const user = this.currentMemoryLeases(userKey, now);
    if (global.size >= policy.globalConcurrency || user.size >= policy.userConcurrency) return null;
    global.set(token, now + policy.leaseMs);
    user.set(token, now + policy.leaseMs);
    await this.recordPeak(resource, global.size).catch(() => undefined);
    return {
      renew: async () => {
        const expiresAt = Date.now() + policy.leaseMs;
        global.set(token, expiresAt);
        user.set(token, expiresAt);
      },
      release: async () => { global.delete(token); user.delete(token); },
    };
  }

  private currentMemoryLeases(key: string, now: number): Map<string, number> {
    const leases = this.memoryLeases.get(key) ?? new Map<string, number>();
    for (const [token, expiresAt] of leases) if (expiresAt <= now) leases.delete(token);
    this.memoryLeases.set(key, leases);
    return leases;
  }
}

const RATE_SCRIPT = `
local global_current = tonumber(redis.call("GET", KEYS[1]) or "0")
local user_current = tonumber(redis.call("GET", KEYS[2]) or "0")
if global_current >= tonumber(ARGV[2]) then return 1 end
if user_current >= tonumber(ARGV[3]) then return 2 end
global_current = redis.call("INCR", KEYS[1])
user_current = redis.call("INCR", KEYS[2])
if global_current == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end
if user_current == 1 then redis.call("PEXPIRE", KEYS[2], ARGV[1]) end
return 0
`;

const ACQUIRE_SCRIPT = `
local redis_time = redis.call("TIME")
local now = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now)
redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", now)
if redis.call("ZCARD", KEYS[1]) >= tonumber(ARGV[3]) then return 1 end
if redis.call("ZCARD", KEYS[2]) >= tonumber(ARGV[4]) then return 2 end
local expires_at = now + tonumber(ARGV[2])
redis.call("ZADD", KEYS[1], expires_at, ARGV[1])
redis.call("ZADD", KEYS[2], expires_at, ARGV[1])
redis.call("PEXPIRE", KEYS[1], tonumber(ARGV[2]) * 2)
redis.call("PEXPIRE", KEYS[2], tonumber(ARGV[2]) * 2)
return 0
`;

const RENEW_SCRIPT = `
local redis_time = redis.call("TIME")
local now = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
local expires_at = now + tonumber(ARGV[2])
if redis.call("ZSCORE", KEYS[1], ARGV[1]) then redis.call("ZADD", KEYS[1], "XX", expires_at, ARGV[1]) end
if redis.call("ZSCORE", KEYS[2], ARGV[1]) then redis.call("ZADD", KEYS[2], "XX", expires_at, ARGV[1]) end
return 1
`;

const RELEASE_SCRIPT = `
redis.call("ZREM", KEYS[1], ARGV[1])
redis.call("ZREM", KEYS[2], ARGV[1])
return 1
`;

const ACTIVE_COUNT_SCRIPT = `
local redis_time = redis.call("TIME")
local now = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now)
return redis.call("ZCARD", KEYS[1])
`;

const METRIC_SCRIPT = `
redis.call("HINCRBY", KEYS[1], "completed", 1)
redis.call("HINCRBY", KEYS[1], ARGV[1] == "1" and "succeeded" or "failed", 1)
redis.call("HINCRBY", KEYS[1], "duration_sum_ms", ARGV[2])
redis.call("EXPIRE", KEYS[1], 7200)
return 1
`;

const LIMITED_SCRIPT = `
redis.call("HINCRBY", KEYS[1], "limited", 1)
redis.call("EXPIRE", KEYS[1], 7200)
return 1
`;

const PEAK_SCRIPT = `
local current = tonumber(redis.call("HGET", KEYS[1], "peak") or "0")
if tonumber(ARGV[1]) > current then redis.call("HSET", KEYS[1], "peak", ARGV[1]) end
redis.call("EXPIRE", KEYS[1], 7200)
return 1
`;

const SNAPSHOT_SCRIPT = `
local redis_time = redis.call("TIME")
local now = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", now)
local metrics = redis.call("HMGET", KEYS[3], "peak", "completed", "succeeded", "failed", "limited", "duration_sum_ms")
return {
  redis.call("GET", KEYS[1]) or "0",
  redis.call("ZCARD", KEYS[2]),
  metrics[1] or "0",
  metrics[2] or "0",
  metrics[3] or "0",
  metrics[4] or "0",
  metrics[5] or "0",
  metrics[6] or "0"
}
`;
