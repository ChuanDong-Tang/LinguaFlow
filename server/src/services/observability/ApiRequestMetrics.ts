const BUCKET_UPPER_BOUNDS_MS = [50, 100, 200, 300, 500, 750, 1_000, 1_500, 2_000, 3_000, 5_000, 10_000, 30_000, Number.POSITIVE_INFINITY] as const;
const METRIC_TTL_SECONDS = 7_200;

type RedisLike = {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string>>;
};

type MinuteMetric = Record<string, number>;

export type ApiRequestMetricInput = {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
};

export type ApiRequestMetricsSnapshot = {
  generatedAt: string;
  windowMinutes: number;
  redisShared: boolean;
  summary: ApiMetricSummary;
  routes: ApiRouteMetricSummary[];
};

export type ApiMetricSummary = {
  requests: number;
  clientErrors: number;
  serverErrors: number;
  slowRequests: number;
  averageDurationMs: number | null;
  p50DurationMs: number | null;
  p95DurationMs: number | null;
  p99DurationMs: number | null;
};

export type ApiRouteMetricSummary = ApiMetricSummary & {
  method: string;
  route: string;
  slowThresholdMs: number;
};

export class ApiRequestMetrics {
  private readonly memory = new Map<number, MinuteMetric>();

  constructor(
    private readonly redis?: RedisLike | null,
    private readonly defaultSlowThresholdMs = 1_000,
  ) {}

  async observe(input: ApiRequestMetricInput): Promise<void> {
    const minute = Math.floor(Date.now() / 60_000);
    const bucket = bucketIndex(input.durationMs);
    const routeKey = encodeURIComponent(`${input.method.toUpperCase()} ${input.route}`);
    const clientError = input.statusCode >= 400 && input.statusCode < 500 ? 1 : 0;
    const serverError = input.statusCode >= 500 ? 1 : 0;
    const slowThresholdMs = resolveApiSlowRequestThresholdMs(
      input.method,
      input.route,
      this.defaultSlowThresholdMs,
    );
    const slow = input.durationMs >= slowThresholdMs ? 1 : 0;
    const duration = Math.max(0, Math.round(input.durationMs));

    if (this.redis) {
      await this.redis.eval(
        OBSERVE_SCRIPT,
        1,
        metricKey(minute),
        routeKey,
        bucket,
        duration,
        clientError,
        serverError,
        slow,
        METRIC_TTL_SECONDS,
      );
      return;
    }

    const metric = this.memory.get(minute) ?? {};
    increment(metric, "g|requests", 1);
    increment(metric, "g|duration", duration);
    increment(metric, "g|4xx", clientError);
    increment(metric, "g|5xx", serverError);
    increment(metric, "g|slow", slow);
    increment(metric, `g|bucket|${bucket}`, 1);
    incrementRoute(metric, routeKey, bucket, duration, clientError, serverError, slow);
    this.memory.set(minute, metric);
    for (const storedMinute of this.memory.keys()) {
      if (storedMinute < minute - 120) this.memory.delete(storedMinute);
    }
  }

  async snapshot(windowMinutes = 15): Promise<ApiRequestMetricsSnapshot> {
    const minutes = Math.max(1, Math.min(120, Math.floor(windowMinutes)));
    const currentMinute = Math.floor(Date.now() / 60_000);
    const minuteKeys = Array.from({ length: minutes }, (_, index) => currentMinute - index);
    const rows = this.redis
      ? await Promise.all(minuteKeys.map((minute) => this.redis!.hgetall(metricKey(minute))))
      : minuteKeys.map((minute) => this.memory.get(minute) ?? {});
    const aggregate: MinuteMetric = {};
    for (const row of rows) {
      for (const [field, rawValue] of Object.entries(row)) increment(aggregate, field, Number(rawValue) || 0);
    }

    const routeKeys = new Set<string>();
    for (const field of Object.keys(aggregate)) {
      const match = /^r\|([^|]+)\|requests$/u.exec(field);
      if (match?.[1]) routeKeys.add(match[1]);
    }

    const routes = [...routeKeys].map((key) => {
      const decoded = decodeURIComponent(key);
      const separator = decoded.indexOf(" ");
      return {
        method: separator > 0 ? decoded.slice(0, separator) : "UNKNOWN",
        route: separator > 0 ? decoded.slice(separator + 1) : decoded,
        slowThresholdMs: resolveApiSlowRequestThresholdMs(
          separator > 0 ? decoded.slice(0, separator) : "UNKNOWN",
          separator > 0 ? decoded.slice(separator + 1) : decoded,
          this.defaultSlowThresholdMs,
        ),
        ...summarize(aggregate, `r|${key}|`),
      };
    }).sort((left, right) => right.p95DurationMs! - left.p95DurationMs! || right.requests - left.requests);

    return {
      generatedAt: new Date().toISOString(),
      windowMinutes: minutes,
      redisShared: Boolean(this.redis),
      summary: summarize(aggregate, "g|"),
      routes,
    };
  }
}

export function resolveApiSlowRequestThresholdMs(method: string, route: string, fallbackMs = 1_000): number {
  const key = `${method.toUpperCase()} ${route}`;
  if (key === "GET /tts/messages/:messageId" || key === "POST /tts/messages/:messageId"
    || key === "GET /tts/cards/:entryId/segments/:segmentId") return 20_000;
  if (key === "POST /cards/:recordId/generate" || key === "POST /cards/generate-preview"
    || key === "POST /chat/generation/stream") return 10_000;
  if (key === "POST /payment/ios/verify-transaction" || key === "GET /payment/autorenew/current") return 5_000;
  if (key === "POST /cards/image-uploads/:uploadId/complete"
    || key === "POST /auth/authing-passcode/send") return 3_000;
  return fallbackMs;
}

function incrementRoute(metric: MinuteMetric, routeKey: string, bucket: number, duration: number, clientError: number, serverError: number, slow: number): void {
  const prefix = `r|${routeKey}|`;
  increment(metric, `${prefix}requests`, 1);
  increment(metric, `${prefix}duration`, duration);
  increment(metric, `${prefix}4xx`, clientError);
  increment(metric, `${prefix}5xx`, serverError);
  increment(metric, `${prefix}slow`, slow);
  increment(metric, `${prefix}bucket|${bucket}`, 1);
}

function increment(metric: MinuteMetric, field: string, amount: number): void {
  metric[field] = (metric[field] ?? 0) + amount;
}

function summarize(metric: MinuteMetric, prefix: string): ApiMetricSummary {
  const requests = metric[`${prefix}requests`] ?? 0;
  const duration = metric[`${prefix}duration`] ?? 0;
  const buckets = BUCKET_UPPER_BOUNDS_MS.map((_, index) => metric[`${prefix}bucket|${index}`] ?? 0);
  return {
    requests,
    clientErrors: metric[`${prefix}4xx`] ?? 0,
    serverErrors: metric[`${prefix}5xx`] ?? 0,
    slowRequests: metric[`${prefix}slow`] ?? 0,
    averageDurationMs: requests ? Math.round(duration / requests) : null,
    p50DurationMs: percentile(buckets, requests, 0.5),
    p95DurationMs: percentile(buckets, requests, 0.95),
    p99DurationMs: percentile(buckets, requests, 0.99),
  };
}

function percentile(buckets: number[], total: number, ratio: number): number | null {
  if (!total) return null;
  const target = Math.ceil(total * ratio);
  let observed = 0;
  for (let index = 0; index < buckets.length; index += 1) {
    observed += buckets[index] ?? 0;
    if (observed >= target) {
      const bound = BUCKET_UPPER_BOUNDS_MS[index];
      return Number.isFinite(bound) ? bound : 30_000;
    }
  }
  return 30_000;
}

function bucketIndex(durationMs: number): number {
  const index = BUCKET_UPPER_BOUNDS_MS.findIndex((bound) => durationMs <= bound);
  return index >= 0 ? index : BUCKET_UPPER_BOUNDS_MS.length - 1;
}

function metricKey(minute: number): string {
  return `api-request-metrics:${minute}`;
}

const OBSERVE_SCRIPT = `
local route_prefix = "r|" .. ARGV[1] .. "|"
redis.call("HINCRBY", KEYS[1], "g|requests", 1)
redis.call("HINCRBY", KEYS[1], "g|duration", ARGV[3])
redis.call("HINCRBY", KEYS[1], "g|4xx", ARGV[4])
redis.call("HINCRBY", KEYS[1], "g|5xx", ARGV[5])
redis.call("HINCRBY", KEYS[1], "g|slow", ARGV[6])
redis.call("HINCRBY", KEYS[1], "g|bucket|" .. ARGV[2], 1)
redis.call("HINCRBY", KEYS[1], route_prefix .. "requests", 1)
redis.call("HINCRBY", KEYS[1], route_prefix .. "duration", ARGV[3])
redis.call("HINCRBY", KEYS[1], route_prefix .. "4xx", ARGV[4])
redis.call("HINCRBY", KEYS[1], route_prefix .. "5xx", ARGV[5])
redis.call("HINCRBY", KEYS[1], route_prefix .. "slow", ARGV[6])
redis.call("HINCRBY", KEYS[1], route_prefix .. "bucket|" .. ARGV[2], 1)
redis.call("EXPIRE", KEYS[1], ARGV[7])
return 1
`;
