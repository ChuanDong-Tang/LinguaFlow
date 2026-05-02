export interface RewriteTaskGuard {
  acquire(userId: string, taskId: string, ttlMs: number): Promise<boolean>;
  release(userId: string, taskId: string): Promise<void>;
}

type InFlightTask = {
  taskId: string;
  expiresAt: number;
};

export class InMemoryRewriteTaskGuard implements RewriteTaskGuard {
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
}

type RedisLike = {
  set(...args: any[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
};

export class RedisRewriteTaskGuard implements RewriteTaskGuard {
  constructor(private readonly redis: RedisLike) {}

  async acquire(userId: string, taskId: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.set(this.keyForUser(userId), taskId, "NX", "PX", ttlMs);
    return result === "OK";
  }

  async release(userId: string, taskId: string): Promise<void> {
    const key = this.keyForUser(userId);
    const currentTaskId = await this.redis.get(key);

    if (currentTaskId === taskId) {
      await this.redis.del(key);
    }
  }

  private keyForUser(userId: string): string {
    return `rewrite:inflight:${userId}`;
  }
}
