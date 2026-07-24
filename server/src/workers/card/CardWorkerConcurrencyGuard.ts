import { randomUUID } from "node:crypto";

type RedisLike = {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
};

export interface CardWorkerConcurrencyGuard {
  runWithLease<T>(
    scope: string,
    limit: number,
    task: () => Promise<T>,
  ): Promise<{ acquired: false } | { acquired: true; value: T }>;
}

export class RedisCardWorkerConcurrencyGuard implements CardWorkerConcurrencyGuard {
  constructor(
    private readonly redis: RedisLike,
    private readonly leaseMs: number,
    private readonly keyPrefix = "card-worker:concurrency",
  ) {}

  async runWithLease<T>(
    scope: string,
    limit: number,
    task: () => Promise<T>,
  ): Promise<{ acquired: false } | { acquired: true; value: T }> {
    const key = `${this.keyPrefix}:${scope}`;
    const token = randomUUID();
    const acquired = Number(await this.redis.eval(
      ACQUIRE_SCRIPT,
      1,
      key,
      token,
      this.leaseMs,
      limit,
    )) === 1;
    if (!acquired) return { acquired: false };

    let renewalError: unknown;
    const renewalTimer = setInterval(() => {
      void this.renew(key, token).catch((error) => {
        renewalError = error;
      });
    }, Math.max(1_000, Math.floor(this.leaseMs / 3)));

    try {
      const value = await task();
      if (renewalError) throw renewalError;
      return { acquired: true, value };
    } finally {
      clearInterval(renewalTimer);
      await this.redis.eval(RELEASE_SCRIPT, 1, key, token);
    }
  }

  private async renew(key: string, token: string): Promise<void> {
    const renewed = Number(await this.redis.eval(
      RENEW_SCRIPT,
      1,
      key,
      token,
      this.leaseMs,
    ));
    if (renewed !== 1) throw new Error("CARD_WORKER_CONCURRENCY_LEASE_LOST");
  }
}

const ACQUIRE_SCRIPT = `
local key = KEYS[1]
local token = ARGV[1]
local lease_ms = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local redis_time = redis.call("TIME")
local now = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
redis.call("ZREMRANGEBYSCORE", key, "-inf", now)
if redis.call("ZCARD", key) >= limit then
  return 0
end
redis.call("ZADD", key, now + lease_ms, token)
redis.call("PEXPIRE", key, lease_ms * 2)
return 1
`;

const RENEW_SCRIPT = `
local key = KEYS[1]
local token = ARGV[1]
local lease_ms = tonumber(ARGV[2])
local redis_time = redis.call("TIME")
local now = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
if redis.call("ZSCORE", key, token) == false then
  return 0
end
redis.call("ZADD", key, "XX", now + lease_ms, token)
redis.call("PEXPIRE", key, lease_ms * 2)
return 1
`;

const RELEASE_SCRIPT = `
return redis.call("ZREM", KEYS[1], ARGV[1])
`;
