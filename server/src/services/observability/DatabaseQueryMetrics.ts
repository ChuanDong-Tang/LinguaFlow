const BUCKETS_MS = [5, 10, 25, 50, 100, 200, 300, 500, 1_000, 2_000, 5_000, Number.POSITIVE_INFINITY] as const;
const TTL_SECONDS = 7_200;

type RedisLike = {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string>>;
};

type Metric = Record<string, number>;

export type DatabaseQuerySnapshot = {
  generatedAt: string;
  windowMinutes: number;
  redisShared: boolean;
  slowThresholdMs: number;
  summary: DatabaseQuerySummary;
  operations: Array<DatabaseQuerySummary & { operation: string; tables: string[] }>;
};

export type DatabaseQuerySummary = {
  queries: number;
  errors: number;
  slowQueries: number;
  averageDurationMs: number | null;
  p50DurationMs: number | null;
  p95DurationMs: number | null;
  p99DurationMs: number | null;
};

export class DatabaseQueryMetrics {
  private readonly memory = new Map<number, Metric>();

  constructor(
    private readonly redis?: RedisLike | null,
    readonly slowThresholdMs = readPositiveInt(process.env.LF_DB_SLOW_QUERY_MS, 250),
  ) {}

  async observeQuery(input: { query: string; durationMs: number }): Promise<void> {
    const minute = Math.floor(Date.now() / 60_000);
    const duration = Math.max(0, Math.round(input.durationMs));
    const bucket = bucketIndex(duration);
    const classification = classifyQuery(input.query);
    const operationKey = encodeURIComponent(`${classification.operation}:${classification.tables.join(",") || "unknown"}`);
    const slow = duration >= this.slowThresholdMs ? 1 : 0;
    if (this.redis) {
      await this.redis.eval(OBSERVE_QUERY_SCRIPT, 1, metricKey(minute), operationKey, bucket, duration, slow, TTL_SECONDS);
      return;
    }
    const metric = this.memory.get(minute) ?? {};
    incrementQuery(metric, "g|", bucket, duration, slow);
    incrementQuery(metric, `o|${operationKey}|`, bucket, duration, slow);
    this.storeMemory(minute, metric);
  }

  async observeError(): Promise<void> {
    const minute = Math.floor(Date.now() / 60_000);
    if (this.redis) {
      await this.redis.eval(OBSERVE_ERROR_SCRIPT, 1, metricKey(minute), TTL_SECONDS);
      return;
    }
    const metric = this.memory.get(minute) ?? {};
    increment(metric, "g|errors", 1);
    this.storeMemory(minute, metric);
  }

  async snapshot(windowMinutes = 15): Promise<DatabaseQuerySnapshot> {
    const minutes = Math.max(1, Math.min(120, Math.floor(windowMinutes)));
    const current = Math.floor(Date.now() / 60_000);
    const minuteKeys = Array.from({ length: minutes }, (_, index) => current - index);
    const rows = this.redis
      ? await Promise.all(minuteKeys.map((minute) => this.redis!.hgetall(metricKey(minute))))
      : minuteKeys.map((minute) => this.memory.get(minute) ?? {});
    const aggregate: Metric = {};
    rows.forEach((row) => Object.entries(row).forEach(([field, value]) => increment(aggregate, field, Number(value) || 0)));
    const keys = new Set<string>();
    Object.keys(aggregate).forEach((field) => {
      const match = /^o\|([^|]+)\|queries$/u.exec(field);
      if (match?.[1]) keys.add(match[1]);
    });
    const operations = [...keys].map((key) => {
      const decoded = decodeURIComponent(key);
      const separator = decoded.indexOf(":");
      const tables = separator >= 0 ? decoded.slice(separator + 1).split(",").filter((table) => table !== "unknown") : [];
      return {
        operation: separator >= 0 ? decoded.slice(0, separator) : decoded,
        tables,
        ...summarize(aggregate, `o|${key}|`),
      };
    }).sort((left, right) => (right.p95DurationMs ?? 0) - (left.p95DurationMs ?? 0) || right.queries - left.queries);
    return {
      generatedAt: new Date().toISOString(),
      windowMinutes: minutes,
      redisShared: Boolean(this.redis),
      slowThresholdMs: this.slowThresholdMs,
      summary: summarize(aggregate, "g|"),
      operations,
    };
  }

  private storeMemory(minute: number, metric: Metric): void {
    this.memory.set(minute, metric);
    for (const storedMinute of this.memory.keys()) if (storedMinute < minute - 120) this.memory.delete(storedMinute);
  }
}

function classifyQuery(query: string): { operation: string; tables: string[] } {
  const normalized = query.trim();
  const operation = (/^(SELECT|INSERT|UPDATE|DELETE|UPSERT|WITH)\b/iu.exec(normalized)?.[1] ?? "OTHER").toUpperCase();
  const tables = new Set<string>();
  const quoted = /\b(?:FROM|JOIN|INTO|UPDATE|DELETE\s+FROM)\s+(?:"[^"]+"\.)?"([A-Za-z_][A-Za-z0-9_]*)"/giu;
  const plain = /\b(?:FROM|JOIN|INTO|UPDATE|DELETE\s+FROM)\s+([A-Za-z_][A-Za-z0-9_]*)/giu;
  for (const match of normalized.matchAll(quoted)) if (match[1]) tables.add(match[1]);
  if (!tables.size) for (const match of normalized.matchAll(plain)) if (match[1]) tables.add(match[1]);
  return { operation, tables: [...tables].sort().slice(0, 4) };
}

function incrementQuery(metric: Metric, prefix: string, bucket: number, duration: number, slow: number): void {
  increment(metric, `${prefix}queries`, 1);
  increment(metric, `${prefix}duration`, duration);
  increment(metric, `${prefix}slow`, slow);
  increment(metric, `${prefix}bucket|${bucket}`, 1);
}

function summarize(metric: Metric, prefix: string): DatabaseQuerySummary {
  const queries = metric[`${prefix}queries`] ?? 0;
  const duration = metric[`${prefix}duration`] ?? 0;
  const buckets = BUCKETS_MS.map((_, index) => metric[`${prefix}bucket|${index}`] ?? 0);
  return {
    queries,
    errors: metric[`${prefix}errors`] ?? 0,
    slowQueries: metric[`${prefix}slow`] ?? 0,
    averageDurationMs: queries ? Math.round(duration / queries) : null,
    p50DurationMs: percentile(buckets, queries, 0.5),
    p95DurationMs: percentile(buckets, queries, 0.95),
    p99DurationMs: percentile(buckets, queries, 0.99),
  };
}

function percentile(buckets: number[], total: number, ratio: number): number | null {
  if (!total) return null;
  const target = Math.ceil(total * ratio);
  let count = 0;
  for (let index = 0; index < buckets.length; index += 1) {
    count += buckets[index] ?? 0;
    if (count >= target) {
      const bound = BUCKETS_MS[index];
      return Number.isFinite(bound) ? bound : 5_000;
    }
  }
  return 5_000;
}

function bucketIndex(durationMs: number): number {
  const index = BUCKETS_MS.findIndex((bound) => durationMs <= bound);
  return index >= 0 ? index : BUCKETS_MS.length - 1;
}

function increment(metric: Metric, field: string, amount: number): void {
  metric[field] = (metric[field] ?? 0) + amount;
}

function metricKey(minute: number): string {
  return `database-query-metrics:${minute}`;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const OBSERVE_QUERY_SCRIPT = `
local prefix = "o|" .. ARGV[1] .. "|"
redis.call("HINCRBY", KEYS[1], "g|queries", 1)
redis.call("HINCRBY", KEYS[1], "g|duration", ARGV[3])
redis.call("HINCRBY", KEYS[1], "g|slow", ARGV[4])
redis.call("HINCRBY", KEYS[1], "g|bucket|" .. ARGV[2], 1)
redis.call("HINCRBY", KEYS[1], prefix .. "queries", 1)
redis.call("HINCRBY", KEYS[1], prefix .. "duration", ARGV[3])
redis.call("HINCRBY", KEYS[1], prefix .. "slow", ARGV[4])
redis.call("HINCRBY", KEYS[1], prefix .. "bucket|" .. ARGV[2], 1)
redis.call("EXPIRE", KEYS[1], ARGV[5])
return 1
`;

const OBSERVE_ERROR_SCRIPT = `
redis.call("HINCRBY", KEYS[1], "g|errors", 1)
redis.call("EXPIRE", KEYS[1], ARGV[1])
return 1
`;
