import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { RedisClient } from "../../infrastructure/redis/redisClient.js";
import type { CardSpeechGenerateInput } from "../card/CardSpeechService.js";

const JOB_STREAM = "tts:streaming:jobs";
const JOB_GROUP = "tts-streaming-workers";
const CACHE_MAPPING_PREFIX = "tts:streaming:cache:";
const GENERATION_PREFIX = "tts:streaming:generation:";
const AUDIO_STREAM_PREFIX = "tts:streaming:audio:";
const WORKER_HEARTBEATS_KEY = "tts:streaming:workers";
const METRICS_PREFIX = "tts:streaming:metrics:";

export type TtsStreamingGenerationStatus = "queued" | "running" | "ready" | "failed";

export type TtsStreamingGeneration = {
  generationId: string;
  cacheKey: string;
  userId: string;
  status: TtsStreamingGenerationStatus;
  job: CardSpeechGenerateInput;
  attempt: number;
  createdAt: number;
  startedAt: number | null;
  firstChunkAt: number | null;
  completedAt: number | null;
  assetId: string | null;
  audioUrl: string | null;
  errorCode: string | null;
};

export type TtsStreamTicketPayload = {
  generationId: string;
  cacheKey: string;
  userId: string;
  expiresAt: number;
};

export type TtsStreamingSnapshot = {
  enabled: true;
  windowMinutes: number;
  queued: number;
  running: number;
  onlineWorkers: number;
  oldestRunningAgeMs: number | null;
  created: number;
  reused: number;
  started: number;
  succeeded: number;
  failed: number;
  averageQueueWaitMs: number | null;
  averageFirstChunkMs: number | null;
  averageDurationMs: number | null;
};

export class TtsStreamingCoordinator {
  private groupReady: Promise<void> | null = null;
  private claimRedis: RedisClient | null = null;

  constructor(
    private readonly redis: RedisClient,
    private readonly options: {
      ticketSecret?: string;
      generationTtlSeconds?: number;
      audioStreamTtlSeconds?: number;
      workerLeaseMs?: number;
    },
  ) {}

  async createOrReuse(job: CardSpeechGenerateInput): Promise<{ generation: TtsStreamingGeneration; reused: boolean }> {
    await this.ensureGroup();
    const mappingKey = cacheMappingKey(job.cacheKey);
    const existingId = await this.redis.get(mappingKey);
    if (existingId) {
      const existing = await this.getGeneration(existingId);
      if (existing && (existing.status === "queued" || existing.status === "running")) {
        await this.recordMetrics({ reused: 1 }).catch(() => undefined);
        return { generation: existing, reused: true };
      }
      await this.redis.eval(
        `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end return 0`,
        1,
        mappingKey,
        existingId,
      );
    }

    const generationId = randomUUID();
    const now = Date.now();
    const ttl = this.options.generationTtlSeconds ?? 3_600;
    const stateKey = generationKey(generationId);
    const created = await this.redis.eval(
      `
      if redis.call("SET", KEYS[1], ARGV[1], "NX", "EX", ARGV[2]) then
        redis.call("HSET", KEYS[2],
          "generationId", ARGV[1], "cacheKey", ARGV[3], "userId", ARGV[4],
          "status", "queued", "job", ARGV[5], "attempt", "0", "createdAt", ARGV[6])
        redis.call("EXPIRE", KEYS[2], ARGV[2])
        redis.call("XADD", KEYS[3], "MAXLEN", "~", "10000", "*", "generationId", ARGV[1])
        return 1
      end
      return 0
      `,
      3,
      mappingKey,
      stateKey,
      JOB_STREAM,
      generationId,
      String(ttl),
      job.cacheKey,
      job.userId,
      JSON.stringify(job),
      String(now),
    );
    if (Number(created) === 1) {
      await this.recordMetrics({ created: 1 }).catch(() => undefined);
      return {
        generation: {
          generationId,
          cacheKey: job.cacheKey,
          userId: job.userId,
          status: "queued",
          job,
          attempt: 0,
          createdAt: now,
          startedAt: null,
          firstChunkAt: null,
          completedAt: null,
          assetId: null,
          audioUrl: null,
          errorCode: null,
        },
        reused: false,
      };
    }
    const winnerId = await this.redis.get(mappingKey);
    const winner = winnerId ? await this.getGeneration(winnerId) : null;
    if (!winner) throw new Error("TTS_STREAMING_GENERATION_CREATE_RACE");
    await this.recordMetrics({ reused: 1 }).catch(() => undefined);
    return { generation: winner, reused: true };
  }

  async getGeneration(generationId: string): Promise<TtsStreamingGeneration | null> {
    const row = await this.redis.hgetall(generationKey(generationId));
    if (!row.generationId || !row.job) return null;
    try {
      return {
        generationId: row.generationId,
        cacheKey: row.cacheKey ?? "",
        userId: row.userId ?? "",
        status: parseStatus(row.status),
        job: JSON.parse(row.job) as CardSpeechGenerateInput,
        attempt: Number(row.attempt ?? 0),
        createdAt: Number(row.createdAt ?? 0),
        startedAt: optionalNumber(row.startedAt),
        firstChunkAt: optionalNumber(row.firstChunkAt),
        completedAt: optionalNumber(row.completedAt),
        assetId: row.assetId || null,
        audioUrl: row.audioUrl || null,
        errorCode: row.errorCode || null,
      };
    } catch {
      return null;
    }
  }

  async findActiveByCacheKey(cacheKey: string): Promise<TtsStreamingGeneration | null> {
    const generationId = await this.redis.get(cacheMappingKey(cacheKey));
    if (!generationId) return null;
    const generation = await this.getGeneration(generationId);
    return generation && (generation.status === "queued" || generation.status === "running") ? generation : null;
  }

  async claimJob(consumerId: string): Promise<{ streamEntryId: string; generation: TtsStreamingGeneration } | null> {
    await this.ensureGroup();
    this.claimRedis ??= this.redis.duplicate();
    const reclaimed = await (this.claimRedis as any).xautoclaim(
      JOB_STREAM,
      JOB_GROUP,
      consumerId,
      this.options.workerLeaseMs ?? 120_000,
      "0-0",
      "COUNT",
      1,
    );
    const reclaimedEntry = parseClaimedEntry(reclaimed);
    const entry = reclaimedEntry ?? parseReadGroupEntry(await (this.claimRedis as any).xreadgroup(
      "GROUP", JOB_GROUP, consumerId, "COUNT", 1, "BLOCK", 5_000, "STREAMS", JOB_STREAM, ">",
    ));
    if (!entry) return null;
    const generationId = entry.fields.generationId;
    const generation = generationId ? await this.getGeneration(generationId) : null;
    if (!generation || generation.status === "ready" || generation.status === "failed") {
      await this.ackJob(entry.id);
      return null;
    }
    if (generation.status === "running" && generation.firstChunkAt !== null) {
      await this.markFailed(generation.generationId, "TTS_STREAMING_WORKER_LOST_AFTER_OUTPUT").catch(() => undefined);
      await this.ackJob(entry.id);
      return null;
    }
    const startedAt = Date.now();
    await this.redis.hset(generationKey(generation.generationId), {
      status: "running",
      startedAt: String(startedAt),
      attempt: String(generation.attempt + 1),
      errorCode: "",
    });
    await this.recordMetrics({ started: 1, queueWaitMs: Math.max(0, startedAt - generation.createdAt), queueWaitCount: 1 }).catch(() => undefined);
    return {
      streamEntryId: entry.id,
      generation: { ...generation, status: "running", startedAt, attempt: generation.attempt + 1 },
    };
  }

  async appendAudioChunk(generationId: string, chunk: Buffer): Promise<void> {
    const key = audioStreamKey(generationId);
    const stateKey = generationKey(generationId);
    const firstChunkAt = Date.now();
    const first = await this.redis
      .multi()
      .xadd(key, "*", "kind", "audio", "data", chunk)
      .expire(key, this.options.audioStreamTtlSeconds ?? 900)
      .hsetnx(stateKey, "firstChunkAt", String(firstChunkAt))
      .exec();
    if (Number(first?.[2]?.[1] ?? 0) === 1) {
      const generation = await this.getGeneration(generationId);
      if (generation?.startedAt) await this.recordMetrics({ firstChunkMs: Math.max(0, firstChunkAt - generation.startedAt), firstChunkCount: 1 }).catch(() => undefined);
    }
  }

  async markReady(input: {
    generationId: string;
    assetId: string;
    audioUrl: string;
    providerTimings?: { firstByteMs: number | null; finishMs: number | null; networkMs: number | null };
  }): Promise<void> {
    const completedAt = Date.now();
    const generation = await this.getGeneration(input.generationId);
    const key = audioStreamKey(input.generationId);
    await this.redis
      .multi()
      .xadd(key, "*", "kind", "end")
      .expire(key, this.options.audioStreamTtlSeconds ?? 900)
      .hset(generationKey(input.generationId), {
        status: "ready",
        completedAt: String(completedAt),
        assetId: input.assetId,
        audioUrl: input.audioUrl,
        providerTimings: JSON.stringify(input.providerTimings ?? null),
      })
      .exec();
    await this.recordMetrics({
      succeeded: 1,
      durationMs: generation?.startedAt ? Math.max(0, completedAt - generation.startedAt) : 0,
      durationCount: generation?.startedAt ? 1 : 0,
    }).catch(() => undefined);
  }

  async markFailed(generationId: string, errorCode: string): Promise<void> {
    const generation = await this.getGeneration(generationId);
    const completedAt = Date.now();
    const key = audioStreamKey(generationId);
    await this.redis
      .multi()
      .xadd(key, "*", "kind", "error", "errorCode", errorCode)
      .expire(key, this.options.audioStreamTtlSeconds ?? 900)
      .hset(generationKey(generationId), {
        status: "failed",
        completedAt: String(completedAt),
        errorCode,
      })
      .exec();
    await this.recordMetrics({
      failed: 1,
      durationMs: generation?.startedAt ? Math.max(0, completedAt - generation.startedAt) : 0,
      durationCount: generation?.startedAt ? 1 : 0,
    }).catch(() => undefined);
  }

  async heartbeatWorker(workerId: string): Promise<void> {
    const now = Date.now();
    await this.redis.multi().zadd(WORKER_HEARTBEATS_KEY, now, workerId).zremrangebyscore(WORKER_HEARTBEATS_KEY, 0, now - 30_000).exec();
  }

  async removeWorker(workerId: string): Promise<void> {
    await this.redis.zrem(WORKER_HEARTBEATS_KEY, workerId);
  }

  async snapshot(windowMinutes: number): Promise<TtsStreamingSnapshot> {
    await this.ensureGroup();
    const minutes = Math.max(1, Math.min(120, Math.floor(windowMinutes)));
    const now = Date.now();
    const minute = Math.floor(now / 60_000);
    await this.redis.zremrangebyscore(WORKER_HEARTBEATS_KEY, 0, now - 30_000);
    const metricKeys = Array.from({ length: minutes }, (_, index) => `${METRICS_PREFIX}${minute - index}`);
    const [pending, groups, onlineWorkers, metricRows] = await Promise.all([
      (this.redis as any).xpending(JOB_STREAM, JOB_GROUP),
      (this.redis as any).xinfo("GROUPS", JOB_STREAM),
      this.redis.zcard(WORKER_HEARTBEATS_KEY),
      Promise.all(metricKeys.map((key) => this.redis.hgetall(key))),
    ]);
    const running = Array.isArray(pending) ? Number(pending[0] ?? 0) : 0;
    const oldestId = Array.isArray(pending) && typeof pending[1] === "string" ? pending[1] : null;
    const group = parseNamedRows(groups).find((row) => row.name === JOB_GROUP);
    const totals = sumMetricRows(metricRows);
    return {
      enabled: true,
      windowMinutes: minutes,
      queued: Number(group?.lag ?? 0),
      running,
      onlineWorkers,
      oldestRunningAgeMs: oldestId ? Math.max(0, now - Number(oldestId.split("-")[0])) : null,
      created: totals.created,
      reused: totals.reused,
      started: totals.started,
      succeeded: totals.succeeded,
      failed: totals.failed,
      averageQueueWaitMs: average(totals.queueWaitMs, totals.queueWaitCount),
      averageFirstChunkMs: average(totals.firstChunkMs, totals.firstChunkCount),
      averageDurationMs: average(totals.durationMs, totals.durationCount),
    };
  }

  async ackJob(streamEntryId: string): Promise<void> {
    await this.redis.xack(JOB_STREAM, JOB_GROUP, streamEntryId);
  }

  async renewJobLease(streamEntryId: string, consumerId: string): Promise<void> {
    await (this.redis as any).xclaim(JOB_STREAM, JOB_GROUP, consumerId, 0, streamEntryId, "JUSTID");
  }

  async hasOnlineWorker(): Promise<boolean> {
    const now = Date.now();
    await this.redis.zremrangebyscore(WORKER_HEARTBEATS_KEY, 0, now - 30_000);
    return (await this.redis.zcard(WORKER_HEARTBEATS_KEY)) > 0;
  }

  createTicket(input: Omit<TtsStreamTicketPayload, "expiresAt">, ttlSeconds = 90): string {
    if (!this.options.ticketSecret) throw new Error("TTS_STREAMING_TICKET_SECRET is required to create stream tickets");
    const payload: TtsStreamTicketPayload = { ...input, expiresAt: Date.now() + ttlSeconds * 1_000 };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${encoded}.${sign(encoded, this.options.ticketSecret)}`;
  }

  verifyTicket(ticket: string): TtsStreamTicketPayload | null {
    if (!this.options.ticketSecret) return null;
    const [encoded, signature] = ticket.split(".");
    if (!encoded || !signature || !safeEqual(signature, sign(encoded, this.options.ticketSecret))) return null;
    try {
      const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as TtsStreamTicketPayload;
      if (!payload.generationId || !payload.cacheKey || !payload.userId || payload.expiresAt <= Date.now()) return null;
      return payload;
    } catch {
      return null;
    }
  }

  duplicateRedis(): RedisClient {
    return this.redis.duplicate();
  }

  closeClaimReader(): void {
    this.claimRedis?.disconnect();
    this.claimRedis = null;
  }

  audioStreamKey(generationId: string): string {
    return audioStreamKey(generationId);
  }

  private ensureGroup(): Promise<void> {
    this.groupReady ??= (async () => {
      try {
        await this.redis.xgroup("CREATE", JOB_STREAM, JOB_GROUP, "0", "MKSTREAM");
      } catch (error) {
        if (!String(error).includes("BUSYGROUP")) throw error;
      }
    })();
    return this.groupReady;
  }

  private async recordMetrics(values: Record<string, number>): Promise<void> {
    const key = `${METRICS_PREFIX}${Math.floor(Date.now() / 60_000)}`;
    const transaction = this.redis.multi();
    for (const [field, value] of Object.entries(values)) {
      if (value) transaction.hincrby(key, field, Math.round(value));
    }
    transaction.expire(key, 3 * 60 * 60);
    await transaction.exec();
  }
}

function parseNamedRows(raw: unknown): Array<Record<string, string | number>> {
  if (!Array.isArray(raw)) return [];
  return raw.filter(Array.isArray).map((values) => {
    const row: Record<string, string | number> = {};
    for (let index = 0; index < values.length; index += 2) {
      if (typeof values[index] === "string") row[values[index]] = values[index + 1] as string | number;
    }
    return row;
  });
}

function sumMetricRows(rows: Array<Record<string, string>>) {
  const fields = ["created", "reused", "started", "succeeded", "failed", "queueWaitMs", "queueWaitCount", "firstChunkMs", "firstChunkCount", "durationMs", "durationCount"] as const;
  return Object.fromEntries(fields.map((field) => [field, rows.reduce((sum, row) => sum + Number(row[field] ?? 0), 0)])) as Record<typeof fields[number], number>;
}

function average(sum: number, count: number): number | null {
  return count > 0 ? Math.round(sum / count) : null;
}

function cacheMappingKey(cacheKey: string): string { return `${CACHE_MAPPING_PREFIX}${cacheKey}`; }
function generationKey(generationId: string): string { return `${GENERATION_PREFIX}${generationId}`; }
function audioStreamKey(generationId: string): string { return `${AUDIO_STREAM_PREFIX}${generationId}`; }

function parseStatus(value: string | undefined): TtsStreamingGenerationStatus {
  return value === "running" || value === "ready" || value === "failed" ? value : "queued";
}

function optionalNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

type StreamEntry = { id: string; fields: Record<string, string> };

function parseClaimedEntry(raw: unknown): StreamEntry | null {
  if (!Array.isArray(raw) || !Array.isArray(raw[1]) || !raw[1][0]) return null;
  return parseEntry(raw[1][0]);
}

function parseReadGroupEntry(raw: unknown): StreamEntry | null {
  if (!Array.isArray(raw) || !Array.isArray(raw[0]) || !Array.isArray(raw[0][1]) || !raw[0][1][0]) return null;
  return parseEntry(raw[0][1][0]);
}

function parseEntry(raw: unknown): StreamEntry | null {
  if (!Array.isArray(raw) || typeof raw[0] !== "string" || !Array.isArray(raw[1])) return null;
  const fields: Record<string, string> = {};
  for (let index = 0; index < raw[1].length; index += 2) {
    const key = raw[1][index];
    const value = raw[1][index + 1];
    if (typeof key === "string" && typeof value === "string") fields[key] = value;
  }
  return { id: raw[0], fields };
}
