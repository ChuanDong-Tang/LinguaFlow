export interface RewriteRateLimiter {
  consume(key: string, limit: number, windowMs: number): Promise<boolean>;
}

type RateBucket = {
  count: number;
  expiresAt: number;
};

export class InMemoryRewriteRateLimiter implements RewriteRateLimiter {
  private readonly buckets = new Map<string, RateBucket>();

  async consume(key: string, limit: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    const current = this.buckets.get(key);

    if (!current || current.expiresAt <= now) {
      this.buckets.set(key, {
        count: 1,
        expiresAt: now + windowMs,
      });
      return true;
    }

    if (current.count >= limit) {
      return false;
    }

    current.count += 1;
    return true;
  }
}

type RedisLike = {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
};

export class RedisRewriteRateLimiter implements RewriteRateLimiter {
  constructor(private readonly redis: RedisLike) {}

  async consume(key: string, limit: number, windowMs: number): Promise<boolean> {
    const count = await this.redis.eval(
      `
      local current = redis.call("INCR", KEYS[1])
      if current == 1 then
        redis.call("PEXPIRE", KEYS[1], ARGV[1])
      end
      return current
      `,
      1,
      key,
      windowMs
    );

    return Number(count) <= limit;
  }
}


