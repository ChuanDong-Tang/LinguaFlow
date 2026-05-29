import type { FastifyReply, FastifyRequest } from "fastify";
import { getRedisClient } from "@lf/server/infrastructure/redis/redisClient.js";
import type { SystemEventLogWriter } from "./systemEventLog.js";
import { writeSystemEventLog } from "./systemEventLog.js";

export function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function resolveClientIp(req: FastifyRequest): string {
  return req.ip ?? "unknown";
}

export async function checkIpPathRateLimit(input: {
  req: FastifyRequest;
  reply: FastifyReply;
  requestId?: string;
  systemEventLogRepository?: SystemEventLogWriter;
  module: string;
  routeKey: string;
  path: string;
  limit: number;
  windowSec: number;
  keyPrefix: string;
  exceededEvent: string;
  redisUnavailableEvent: string;
  onExceeded: () => Promise<void>;
}): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return true;

  const ip = resolveClientIp(input.req);
  const nowSec = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(nowSec / input.windowSec) * input.windowSec;
  const key = `${input.keyPrefix}:${input.routeKey}:${ip}:${windowStart}`;

  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, input.windowSec);
    } else {
      const ttl = await redis.ttl(key);
      if (ttl < 0) {
        await redis.expire(key, input.windowSec);
      }
    }

    if (count > input.limit) {
      await writeSystemEventLog(input.systemEventLogRepository, {
        requestId: input.requestId ?? null,
        module: input.module,
        event: input.exceededEvent,
        level: "warn",
        status: "failed",
        errorCode: "RATE_LIMITED",
        metadata: {
          path: input.path,
          ip,
          routeKey: input.routeKey,
          limit: input.limit,
          windowSec: input.windowSec,
          count,
        },
      });
      await input.onExceeded();
      return false;
    }

    return true;
  } catch (error) {
    await writeSystemEventLog(input.systemEventLogRepository, {
      requestId: input.requestId ?? null,
      module: input.module,
      event: input.redisUnavailableEvent,
      level: "error",
      status: "failed",
      errorCode: "RATE_LIMIT_REDIS_UNAVAILABLE",
      errorMessage: error instanceof Error ? error.message : String(error),
      metadata: {
        path: input.path,
        ip,
        routeKey: input.routeKey,
      },
    });
    return true;
  }
}
