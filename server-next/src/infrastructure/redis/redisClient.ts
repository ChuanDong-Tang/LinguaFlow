import { Redis } from "ioredis";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";

export type RedisClient = Redis;

let redisClient: RedisClient | null = null;

export function getRedisClient(): RedisClient | null {
  const config = getRuntimeConfig();
  const redisUrl = config.redisUrl;

  if (!redisUrl) {
    if (config.requireRedis) {
      throw new Error("REDIS_URL is required when LF_REQUIRE_REDIS=true or NODE_ENV=production");
    }
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
