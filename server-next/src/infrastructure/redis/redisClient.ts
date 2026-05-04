import { Redis } from "ioredis";

export type RedisClient = Redis;

let redisClient: RedisClient | null = null;

export function getRedisClient(): RedisClient | null {
  const redisUrl = process.env.REDIS_URL?.trim();

  if (!redisUrl) {
    return null;
  }

  if (redisClient) {
    return redisClient;
  }

  redisClient = new Redis(redisUrl, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
  });

  return redisClient;
}
