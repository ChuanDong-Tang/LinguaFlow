export interface ChatGenerationTaskGuard {
  acquire(userId: string, taskId: string, ttlMs: number): Promise<boolean>;
  renew(userId: string, taskId: string, ttlMs: number): Promise<boolean>;
  release(userId: string, taskId: string): Promise<void>;
}

type InFlightTask = {
  taskId: string;
  expiresAt: number;
};

export class InMemoryChatGenerationTaskGuard implements ChatGenerationTaskGuard {
  private readonly tasks = new Map<string, InFlightTask>();

  async acquire(userId: string, taskId: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const current = this.tasks.get(userId);

    if (current && current.expiresAt > now) {
      return false;
    }

    this.tasks.set(userId, {
      taskId,
      expiresAt: now + ttlMs,
    });
    return true;
  }

  async release(userId: string, taskId: string): Promise<void> {
    const current = this.tasks.get(userId);
    if (current?.taskId === taskId) {
      this.tasks.delete(userId);
    }
  }

  async renew(userId: string, taskId: string, ttlMs: number): Promise<boolean> {
    const current = this.tasks.get(userId);
    if (current?.taskId !== taskId || current.expiresAt <= Date.now()) return false;
    current.expiresAt = Date.now() + ttlMs;
    return true;
  }
}

type RedisLike = {
  set(...args: any[]): Promise<unknown>;
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
};

export class RedisChatGenerationTaskGuard implements ChatGenerationTaskGuard {
  constructor(private readonly redis: RedisLike) {}

  async acquire(userId: string, taskId: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.set(this.keyForUser(userId), taskId, "NX", "PX", ttlMs);
    return result === "OK";
  }

  async release(userId: string, taskId: string): Promise<void> {
    await this.redis.eval(
      `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      end
      return 0
      `,
      1,
      this.keyForUser(userId),
      taskId
    );
  }

  async renew(userId: string, taskId: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.eval(
      `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("PEXPIRE", KEYS[1], ARGV[2])
      end
      return 0
      `,
      1,
      this.keyForUser(userId),
      taskId,
      ttlMs
    );
    return Number(result) === 1;
  }

  private keyForUser(userId: string): string {
    return `chat-generation:inflight:${userId}`;
  }
}
