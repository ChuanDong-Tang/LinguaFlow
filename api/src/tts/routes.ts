import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { TtsSourceKey } from "@lf/core/ports/repository/TtsAssetRepository.js";
import type { TtsService } from "@lf/server/services/tts/TtsService.js";
import type { CardSpeechService } from "@lf/server/services/card/CardSpeechService.js";
import {
  CardSpeechGenerationInProgressError,
  CardSpeechProRequiredError,
} from "@lf/server/services/card/CardSpeechService.js";
import { CardNotFoundError, CardValidationError } from "@lf/server/services/card/CardService.js";
import type { ChatGenerationRateLimiter } from "@lf/server/services/chat/ChatGenerationRateLimiter.js";
import { getRuntimeConfig } from "@lf/server/config/runtimeConfig.js";
import {
  TtsAccessDeniedError,
  TtsGenerationInProgressError,
  TtsProRequiredError,
  TtsRangeInvalidError,
  TtsSourceTextEmptyError,
} from "@lf/server/services/tts/TtsService.js";
import {
  AccountDisabledError,
  AccountPendingDeleteError,
  resolveActiveUserContext,
  UnauthorizedError,
} from "../auth/userContext.js";
import { resolveRequestId } from "../lib/httpResult.js";
import type { SystemEventLogWriter } from "../lib/systemEventLog.js";
import { writeSystemEventLog } from "../lib/systemEventLog.js";
import { ResourceLimitedError, type ResourceGovernor } from "@lf/server/services/resource/ResourceGovernor.js";
import type { TtsStreamingCoordinator } from "@lf/server/services/tts/TtsStreamingCoordinator.js";
import { once } from "node:events";

export interface TtsRouteDeps {
  ttsService: TtsService;
  cardSpeechService: CardSpeechService;
  ttsStreamingCoordinator?: TtsStreamingCoordinator;
  rateLimiter?: ChatGenerationRateLimiter;
  resourceGovernor?: ResourceGovernor;
  userRepository: {
    findById: (userId: string) => Promise<{
      id: string;
      status: "active" | "disabled" | "pending_delete";
    } | null>;
  };
  systemEventLogRepository?: SystemEventLogWriter;
}

type TtsMessageParams = {
  messageId?: string;
};

type TtsMessageQuery = {
  sourceKey?: string;
  textStart?: string | number;
  textEnd?: string | number;
};

type TtsMessageBody = {
  sourceKey?: string;
  textStart?: string | number;
  textEnd?: string | number;
};

export function registerTtsRoutes(app: FastifyInstance, deps: TtsRouteDeps): void {
  app.route({
    method: ["GET", "HEAD"],
    url: "/tts/stream/:generationId",
    handler: async (req, reply) => {
      const coordinator = deps.ttsStreamingCoordinator;
      const params = req.params as { generationId?: unknown };
      const query = req.query as { ticket?: unknown };
      const generationId = String(params.generationId ?? "");
      const ticket = typeof query.ticket === "string" ? query.ticket : "";
      const payload = coordinator?.verifyTicket(ticket);
      if (!coordinator || !payload || payload.generationId !== generationId) {
        return reply.status(401).send({ ok: false, error: { code: "TTS_STREAM_TICKET_INVALID", message: "Invalid or expired stream ticket" } });
      }
      const generation = await coordinator.getGeneration(generationId);
      if (!generation || generation.userId !== payload.userId || generation.cacheKey !== payload.cacheKey) {
        return reply.status(404).send({ ok: false, error: { code: "TTS_STREAM_NOT_FOUND", message: "Stream not found" } });
      }
      if (generation.status === "ready" && generation.audioUrl) return reply.redirect(generation.audioUrl);
      if (generation.status === "failed") {
        return reply.status(503).send({ ok: false, error: { code: generation.errorCode ?? "TTS_STREAM_FAILED", message: "Speech generation failed" } });
      }
      reply.header("Content-Type", "audio/mpeg");
      reply.header("Cache-Control", "no-store, no-transform");
      reply.header("X-Accel-Buffering", "no");
      reply.header("Accept-Ranges", "none");
      if (req.method === "HEAD") return reply.status(200).send();

      reply.hijack();
      reply.raw.writeHead(200, reply.getHeaders() as Record<string, string>);
      const reader = coordinator.duplicateRedis();
      const streamStartedAt = Date.now();
      const requestId = resolveRequestId(req.headers["x-request-id"]);
      let cursor = "0-0";
      let closed = false;
      let sentBytes = 0;
      let firstByteAt: number | null = null;
      let terminalKind: "end" | "error" | null = null;
      reply.raw.once("close", () => { closed = true; });
      try {
        while (!closed) {
          const raw = await (reader as any).xreadBuffer(
            "COUNT", 32, "BLOCK", 5_000, "STREAMS", coordinator.audioStreamKey(generationId), cursor,
          );
          const entries = parseAudioStreamEntries(raw);
          if (!entries.length) {
            const current = await coordinator.getGeneration(generationId);
            if (current?.status === "failed") break;
            if (current?.status === "ready") {
              const tail = await (reader as any).xreadBuffer(
                "COUNT", 32, "STREAMS", coordinator.audioStreamKey(generationId), cursor,
              );
              const tailEntries = parseAudioStreamEntries(tail);
              if (!tailEntries.length) break;
              entries.push(...tailEntries);
            }
          }
          let ended = false;
          for (const entry of entries) {
            cursor = entry.id;
            if (entry.kind === "audio" && entry.data) {
              firstByteAt ??= Date.now();
              sentBytes += entry.data.length;
              if (!reply.raw.write(entry.data)) await once(reply.raw, "drain");
            } else if (entry.kind === "end" || entry.kind === "error") {
              terminalKind = entry.kind;
              ended = true;
              break;
            }
          }
          if (ended) break;
        }
      } finally {
        reader.disconnect();
        if (!reply.raw.destroyed) reply.raw.end();
        void writeSystemEventLog(deps.systemEventLogRepository, {
          requestId,
          userId: payload.userId,
          module: "tts",
          event: "tts.streaming.delivery",
          level: terminalKind === "error" ? "warn" : "info",
          status: terminalKind === "error" ? "failed" : "success",
          errorCode: terminalKind === "error" ? "TTS_STREAM_INTERRUPTED" : null,
          metadata: {
            generationId,
            sentBytes,
            firstByteMs: firstByteAt === null ? null : firstByteAt - streamStartedAt,
            durationMs: Date.now() - streamStartedAt,
            terminalKind,
            clientDisconnected: closed && terminalKind === null,
          },
        });
      }
    },
  });

  app.post("/tts/text", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    try {
      const userId = (await resolveActiveUserContext({ authorization: req.headers.authorization, userRepository: deps.userRepository })).userId;
      const body = req.body as { text?: unknown; languageCode?: unknown } | null;
      if (typeof body?.text !== "string" || !body.text.trim()) throw new CardValidationError("发音内容不能为空");
      const rateLimitResult = await consumeTtsRateLimit(deps.rateLimiter, userId, deps.resourceGovernor);
      if (!rateLimitResult.allowed) return reply.status(429).send({ ok: false, request_id: requestId, error: { code: rateLimitResult.code, message: "发音请求过于频繁，请稍后再试" } });
      const data = await deps.cardSpeechService.getOrCreateDictionaryTerm({ userId, term: body.text, languageCode: typeof body.languageCode === "string" ? body.languageCode : "en-US" });
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      if (error instanceof ResourceLimitedError) return resourceLimitedReply(reply, requestId);
      if (error instanceof UnauthorizedError) return reply.status(401).send({ ok: false, request_id: requestId, error: { code: error.code, message: error.message } });
      if (error instanceof AccountDisabledError || error instanceof AccountPendingDeleteError) return reply.status(403).send({ ok: false, request_id: requestId, error: { code: error.code, message: error.message } });
      if (error instanceof CardSpeechProRequiredError) return reply.status(403).send({ ok: false, request_id: requestId, error: { code: error.code, message: "需要 Plus 或 Pro 才能使用高质量发音" } });
      if (error instanceof CardValidationError) return reply.status(400).send({ ok: false, request_id: requestId, error: { code: error.code, message: error.message } });
      if (error instanceof CardSpeechGenerationInProgressError) return reply.status(202).send({ ok: false, request_id: requestId, error: { code: error.code, message: "发音仍在生成，请稍后重试" } });
      throw error;
    }
  });
  app.post("/tts/dictionary", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    try {
      const userId = (await resolveActiveUserContext({ authorization: req.headers.authorization, userRepository: deps.userRepository })).userId;
      const body = req.body as { term?: unknown; languageCode?: unknown } | null;
      if (typeof body?.term !== "string" || !body.term.trim()) throw new CardValidationError("Invalid dictionary term");
      const rateLimitResult = await consumeTtsRateLimit(deps.rateLimiter, userId, deps.resourceGovernor);
      if (!rateLimitResult.allowed) return reply.status(429).send({ ok: false, request_id: requestId, error: { code: rateLimitResult.code, message: "发音请求过于频繁，请稍后再试" } });
      const data = await deps.cardSpeechService.getOrCreateDictionaryTerm({ userId, term: body.term, languageCode: typeof body.languageCode === "string" ? body.languageCode : "en-US" });
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      if (error instanceof ResourceLimitedError) return resourceLimitedReply(reply, requestId);
      if (error instanceof UnauthorizedError) return reply.status(401).send({ ok: false, request_id: requestId, error: { code: error.code, message: error.message } });
      if (error instanceof AccountDisabledError || error instanceof AccountPendingDeleteError) return reply.status(403).send({ ok: false, request_id: requestId, error: { code: error.code, message: error.message } });
      if (error instanceof CardSpeechProRequiredError) return reply.status(403).send({ ok: false, request_id: requestId, error: { code: error.code, message: "需要 Plus 或 Pro 才能使用高质量发音" } });
      if (error instanceof CardValidationError) return reply.status(400).send({ ok: false, request_id: requestId, error: { code: error.code, message: error.message } });
      if (error instanceof CardSpeechGenerationInProgressError) return reply.status(202).send({ ok: false, request_id: requestId, error: { code: error.code, message: "发音仍在生成，请稍后重试" } });
      throw error;
    }
  });
  async function handleTtsMessageRequest(req: FastifyRequest, reply: FastifyReply) {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    let userContext;
    try {
      userContext = await resolveActiveUserContext({
        authorization: req.headers.authorization,
        userRepository: deps.userRepository,
      });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return reply.status(401).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }
      if (error instanceof AccountDisabledError || error instanceof AccountPendingDeleteError) {
        await writeSystemEventLog(deps.systemEventLogRepository, {
          requestId,
          module: "auth",
          event: "auth.account_unavailable",
          level: "warn",
          status: "failed",
          errorCode: error.code,
          metadata: { path: "/tts/messages/:messageId" },
        });
        return reply.status(403).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }
      throw error;
    }

    const { messageId } = req.params as TtsMessageParams;
    if (!messageId) {
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: "messageId is required" },
      });
    }

    const rangeResult = parseRange(req);
    if (rangeResult.ok === false) {
      await writeTtsRangeRejectedLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        messageId,
        reason: rangeResult.message,
        rawInput: readTtsRangeRawInput(req),
      });
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: rangeResult.message },
      });
    }

    const rateLimitResult = await consumeTtsRateLimit(deps.rateLimiter, userContext.userId, deps.resourceGovernor);
    if (rateLimitResult.allowed === false) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "tts",
        event: "tts.message.rate_limited",
        level: "warn",
        status: "failed",
        errorCode: rateLimitResult.code,
        metadata: {
          path: "/tts/messages/:messageId",
          messageId,
          scope: rateLimitResult.scope,
        },
      });
      return reply.status(429).send({
        ok: false,
        request_id: requestId,
        error: { code: rateLimitResult.code, message: "Too many TTS requests. Please try again later." },
      });
    }

    try {
      const asset = await deps.ttsService.getOrCreateMessageAsset({
        userId: userContext.userId,
        messageId,
        sourceKey: rangeResult.sourceKey,
        textStart: rangeResult.textStart,
        textEnd: rangeResult.textEnd,
        requestId,
      });
      return reply.status(200).send({
        ok: true,
        request_id: requestId,
        data: asset,
      });
    } catch (error) {
      if (error instanceof ResourceLimitedError) return resourceLimitedReply(reply, requestId);
      if (error instanceof TtsProRequiredError) {
        return reply.status(403).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }
      if (error instanceof TtsAccessDeniedError) {
        return reply.status(404).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }
      if (error instanceof TtsSourceTextEmptyError) {
        return reply.status(400).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }
      if (error instanceof TtsRangeInvalidError) {
        await writeTtsRangeRejectedLog(deps.systemEventLogRepository, {
          requestId,
          userId: userContext.userId,
          messageId,
          reason: error.message,
          sourceKey: rangeResult.sourceKey,
          textStart: rangeResult.textStart,
          textEnd: rangeResult.textEnd,
        });
        return reply.status(400).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }
      if (error instanceof TtsGenerationInProgressError) {
        return reply.status(202).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }
      throw error;
    }
  }

  app.get("/tts/voices", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    try {
      await resolveActiveUserContext({
        authorization: req.headers.authorization,
        userRepository: deps.userRepository,
      });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return reply.status(401).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }
      if (error instanceof AccountDisabledError || error instanceof AccountPendingDeleteError) {
        return reply.status(403).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }
      throw error;
    }

    const query = req.query as Record<string, unknown>;
    const languageCode = typeof query.languageCode === "string" ? query.languageCode.trim() : undefined;
    return reply.status(200).send({
      ok: true,
      request_id: requestId,
      data: deps.ttsService.listVoiceOptions({ languageCode }),
    });
  });

  app.get("/tts/messages/:messageId", handleTtsMessageRequest);
  app.post("/tts/messages/:messageId", handleTtsMessageRequest);
  app.get("/tts/cards/:entryId/segments/:segmentId", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    let userId: string;
    try {
      userId = (await resolveActiveUserContext({
        authorization: req.headers.authorization,
        userRepository: deps.userRepository,
      })).userId;
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return reply.status(401).send({ ok: false, request_id: requestId, error: { code: error.code, message: error.message } });
      }
      if (error instanceof AccountDisabledError || error instanceof AccountPendingDeleteError) {
        return reply.status(403).send({ ok: false, request_id: requestId, error: { code: error.code, message: error.message } });
      }
      throw error;
    }
    const params = req.params as { entryId?: unknown; segmentId?: unknown };
    const query = req.query as { sourceKind?: unknown; start?: unknown; end?: unknown; contentType?: unknown; contentVersion?: unknown; streaming?: unknown };
    const rateLimitResult = await consumeTtsRateLimit(deps.rateLimiter, userId, deps.resourceGovernor);
    if (!rateLimitResult.allowed) {
      return reply.status(429).send({ ok: false, request_id: requestId, error: { code: rateLimitResult.code, message: "发音请求过于频繁，请稍后再试" } });
    }
    try {
      const segmentId = String(params.segmentId ?? "");
      const contentType = query.contentType as "original" | "rewrite" | "reply" | undefined;
      const contentVersion = typeof query.contentVersion === "string" ? query.contentVersion : undefined;
      const articleInput = {
        userId,
        entryId: String(params.entryId ?? ""),
        contentType: contentType ?? "rewrite",
        contentVersion: contentVersion ?? "",
      };
      const wantsStreaming = query.streaming === "1" || query.streaming === "true";
      const prepared = segmentId === "__article__" && deps.ttsStreamingCoordinator
        ? await deps.cardSpeechService.prepareArticle(articleInput)
        : null;
      const threshold = prepared ? streamingThreshold(prepared.generation.languageCode) : Number.POSITIVE_INFINITY;
      const activeStreamingGeneration = prepared && !prepared.cached
        ? await deps.ttsStreamingCoordinator!.findActiveByCacheKey(prepared.generation.cacheKey)
        : null;
      const streamingAvailable = Boolean(
        prepared
        && wantsStreaming
        && !prepared.cached
        && prepared.graphemeCount > threshold
        && await deps.ttsStreamingCoordinator!.hasOnlineWorker()
      );
      if (activeStreamingGeneration && (!wantsStreaming || prepared!.graphemeCount <= threshold || !streamingAvailable)) {
        if (!streamingAvailable && activeStreamingGeneration.status === "queued") {
          await deps.ttsStreamingCoordinator!.markFailed(activeStreamingGeneration.generationId, "TTS_STREAMING_WORKER_UNAVAILABLE");
        } else {
          throw new CardSpeechGenerationInProgressError();
        }
      }
      const data = prepared && streamingAvailable
        ? await (async () => {
            const created = await deps.ttsStreamingCoordinator!.createOrReuse(prepared.generation);
            const ticket = deps.ttsStreamingCoordinator!.createTicket({
              generationId: created.generation.generationId,
              cacheKey: created.generation.cacheKey,
              userId,
            });
            return {
              id: created.generation.generationId,
              entryId: articleInput.entryId,
              segmentId: "__article__",
              provider: prepared.generation.provider,
              voiceCode: prepared.generation.voiceCode,
              audioUrl: `/tts/stream/${encodeURIComponent(created.generation.generationId)}?ticket=${encodeURIComponent(ticket)}`,
              audioUrlExpiresAt: new Date(Date.now() + 90_000).toISOString(),
              durationMs: null,
              wordMarks: null,
              sentenceMarks: null,
              cached: false,
              deliveryMode: "streaming" as const,
              generationId: created.generation.generationId,
              generationReused: created.reused,
            };
          })()
        : prepared?.cached
          ? { ...prepared.cached, deliveryMode: "buffered" as const }
          : segmentId === "__article__"
            ? { ...(await deps.cardSpeechService.getOrCreateArticle(articleInput)), deliveryMode: "buffered" as const }
        : await deps.cardSpeechService.getOrCreateSegment({
            userId,
            entryId: String(params.entryId ?? ""),
            segmentId,
            sourceKind: query.sourceKind === "dictation_sentence" ? "dictation_sentence" : "review_segment",
            startUtf16: query.start === undefined ? undefined : Number(query.start),
            endUtf16: query.end === undefined ? undefined : Number(query.end),
            contentType,
            contentVersion,
          });
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      if (error instanceof ResourceLimitedError) return resourceLimitedReply(reply, requestId);
      if (error instanceof CardSpeechProRequiredError) {
        return reply.status(403).send({ ok: false, request_id: requestId, error: { code: error.code, message: "当前内容的发音或听写需要 Pro" } });
      }
      if (error instanceof CardNotFoundError) {
        return reply.status(404).send({ ok: false, request_id: requestId, error: { code: error.code, message: "记录不存在" } });
      }
      if (error instanceof CardValidationError) {
        return reply.status(400).send({ ok: false, request_id: requestId, error: { code: error.code, message: error.message } });
      }
      if (error instanceof CardSpeechGenerationInProgressError) {
        return reply.status(202).send({ ok: false, request_id: requestId, error: { code: error.code, message: "发音仍在生成，请稍后重试" } });
      }
      throw error;
    }
  });

  app.post("/tts/cards/:entryId/selection", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    let userId: string;
    try {
      userId = (await resolveActiveUserContext({
        authorization: req.headers.authorization,
        userRepository: deps.userRepository,
      })).userId;
    } catch (error) {
      if (error instanceof UnauthorizedError) return reply.status(401).send({ ok: false, request_id: requestId, error: { code: error.code, message: error.message } });
      if (error instanceof AccountDisabledError || error instanceof AccountPendingDeleteError) return reply.status(403).send({ ok: false, request_id: requestId, error: { code: error.code, message: error.message } });
      throw error;
    }
    const rateLimitResult = await consumeTtsRateLimit(deps.rateLimiter, userId, deps.resourceGovernor);
    if (!rateLimitResult.allowed) return reply.status(429).send({ ok: false, request_id: requestId, error: { code: rateLimitResult.code, message: "发音请求过于频繁，请稍后再试" } });
    const params = req.params as { entryId?: unknown };
    const body = req.body as {
      segmentId?: unknown;
      start?: unknown;
      end?: unknown;
      startUtf16?: unknown;
      endUtf16?: unknown;
      contentType?: unknown;
      contentVersion?: unknown;
    } | null;
    try {
      const data = await deps.cardSpeechService.getOrCreateSelection({
        userId,
        entryId: String(params.entryId ?? ""),
        segmentId: String(body?.segmentId ?? ""),
        startUtf16: Number(body?.startUtf16 ?? body?.start),
        endUtf16: Number(body?.endUtf16 ?? body?.end),
        contentType: body?.contentType as "original" | "rewrite" | "reply" | undefined,
        contentVersion: typeof body?.contentVersion === "string" ? body.contentVersion : undefined,
      });
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      if (error instanceof ResourceLimitedError) return resourceLimitedReply(reply, requestId);
      if (error instanceof CardSpeechProRequiredError) return reply.status(403).send({ ok: false, request_id: requestId, error: { code: error.code, message: "当前内容的发音或听写需要 Pro" } });
      if (error instanceof CardNotFoundError) return reply.status(404).send({ ok: false, request_id: requestId, error: { code: error.code, message: "记录不存在" } });
      if (error instanceof CardValidationError) return reply.status(400).send({ ok: false, request_id: requestId, error: { code: error.code, message: error.message } });
      if (error instanceof CardSpeechGenerationInProgressError) return reply.status(202).send({ ok: false, request_id: requestId, error: { code: error.code, message: "发音仍在生成，请稍后重试" } });
      throw error;
    }
  });
}

function streamingThreshold(languageCode: string): number {
  const isCjk = /^(zh|ja|ko)(-|$)/iu.test(languageCode);
  const raw = isCjk ? process.env.TTS_STREAMING_CJK_MIN_CHARS : process.env.TTS_STREAMING_DEFAULT_MIN_CHARS;
  const fallback = isCjk ? 100 : 200;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

function parseAudioStreamEntries(raw: unknown): Array<{ id: string; kind: string; data: Buffer | null }> {
  if (!Array.isArray(raw) || !Array.isArray(raw[0]) || !Array.isArray(raw[0][1])) return [];
  return raw[0][1].flatMap((row: unknown) => {
    if (!Array.isArray(row) || !Buffer.isBuffer(row[0]) || !Array.isArray(row[1])) return [];
    let kind = "";
    let data: Buffer | null = null;
    for (let index = 0; index < row[1].length; index += 2) {
      const key = row[1][index];
      const value = row[1][index + 1];
      const keyText = Buffer.isBuffer(key) ? key.toString("utf8") : String(key);
      if (keyText === "kind") kind = Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
      if (keyText === "data" && Buffer.isBuffer(value)) data = value;
    }
    return [{ id: row[0].toString("utf8"), kind, data }];
  });
}

function resourceLimitedReply(reply: FastifyReply, requestId: string) {
  return reply.status(429).send({ ok: false, request_id: requestId, error: { code: "RESOURCE_LIMITED", message: "发音请求较多，请稍后重试" } });
}

function parseRange(req: FastifyRequest): { ok: true; sourceKey: TtsSourceKey; textStart?: number; textEnd?: number } | { ok: false; message: string } {
  const query = req.query as TtsMessageQuery;
  const body = isObject(req.body) ? req.body as TtsMessageBody : {};
  const sourceKey = parseSourceKey(query.sourceKey ?? body.sourceKey);
  if (!sourceKey) {
    return { ok: false, message: "sourceKey must be rewrite, reply, or full" };
  }
  const textStart = parseOptionalIndex(query.textStart ?? body.textStart);
  const textEnd = parseOptionalIndex(query.textEnd ?? body.textEnd);
  if (textStart === null || textEnd === null) {
    return { ok: false, message: "textStart and textEnd must be non-negative integers" };
  }
  if ((textStart === undefined) !== (textEnd === undefined)) {
    return { ok: false, message: "textStart and textEnd must be provided together" };
  }
  if (textStart !== undefined && textEnd !== undefined && textEnd <= textStart) {
    return { ok: false, message: "textEnd must be greater than textStart" };
  }
  return { ok: true, sourceKey, textStart, textEnd };
}

function parseSourceKey(value: string | undefined): TtsSourceKey | null {
  if (value === undefined || value.trim() === "") return "rewrite";
  const trimmed = value.trim();
  if (trimmed === "rewrite" || trimmed === "reply" || trimmed === "full") return trimmed;
  return null;
}

function parseOptionalIndex(value: string | number | undefined): number | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function consumeTtsRateLimit(
  rateLimiter: ChatGenerationRateLimiter | undefined,
  userId: string,
  resourceGovernor?: ResourceGovernor,
): Promise<
  | { allowed: true }
  | { allowed: false; scope: "global" | "user"; code: "TTS_GLOBAL_RATE_LIMITED" | "TTS_USER_RATE_LIMITED" }
> {
  if (resourceGovernor) {
    try {
      await resourceGovernor.consumeRequest("tts", userId);
      return { allowed: true };
    } catch (error) {
      if (error instanceof ResourceLimitedError) {
        const userLimited = error.scope === "user_rate";
        return { allowed: false, scope: userLimited ? "user" : "global", code: userLimited ? "TTS_USER_RATE_LIMITED" : "TTS_GLOBAL_RATE_LIMITED" };
      }
      throw error;
    }
  }
  if (!rateLimiter) return { allowed: true };
  const config = getRuntimeConfig();
  const globalAllowed = await rateLimiter.consume(
    "tts:messages:global",
    config.ttsMessagesGlobalRateLimit,
    config.ttsMessagesGlobalRateWindowMs
  );
  if (!globalAllowed) {
    return { allowed: false, scope: "global", code: "TTS_GLOBAL_RATE_LIMITED" };
  }

  const userAllowed = await rateLimiter.consume(
    `tts:messages:user:${userId}`,
    config.resourcePolicies.tts.userRequestsPerMinute,
    config.ttsMessagesGlobalRateWindowMs,
  );
  if (!userAllowed) return { allowed: false, scope: "user", code: "TTS_USER_RATE_LIMITED" };

  return { allowed: true };
}

function readTtsRangeRawInput(req: FastifyRequest): Record<string, unknown> {
  const query = req.query as TtsMessageQuery;
  const body = isObject(req.body) ? req.body as TtsMessageBody : {};
  return {
    query: {
      sourceKey: query.sourceKey,
      textStart: query.textStart,
      textEnd: query.textEnd,
    },
    body: {
      sourceKey: body.sourceKey,
      textStart: body.textStart,
      textEnd: body.textEnd,
    },
  };
}

async function writeTtsRangeRejectedLog(
  writer: SystemEventLogWriter | undefined,
  input: {
    requestId: string;
    userId: string;
    messageId: string;
    reason: string;
    sourceKey?: TtsSourceKey;
    textStart?: number;
    textEnd?: number;
    rawInput?: Record<string, unknown>;
  }
): Promise<void> {
  await writeSystemEventLog(writer, {
    requestId: input.requestId,
    userId: input.userId,
    module: "tts",
    event: "tts.message.range_rejected",
    level: "warn",
    status: "failed",
    errorCode: "TTS_RANGE_INVALID",
    errorMessage: input.reason,
    metadata: {
      path: "/tts/messages/:messageId",
      messageId: input.messageId,
      sourceKey: input.sourceKey,
      textStart: input.textStart,
      textEnd: input.textEnd,
      rawInput: input.rawInput,
    },
  });
}
