import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { TtsSourceKey } from "@lf/core/ports/repository/TtsAssetRepository.js";
import type { TtsService } from "@lf/server/services/tts/TtsService.js";
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

export interface TtsRouteDeps {
  ttsService: TtsService;
  rateLimiter?: ChatGenerationRateLimiter;
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

    const rateLimitResult = await consumeTtsRateLimit(deps.rateLimiter);
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
}

function parseRange(req: FastifyRequest): { ok: true; sourceKey: TtsSourceKey; textStart?: number; textEnd?: number } | { ok: false; message: string } {
  const query = req.query as TtsMessageQuery;
  const body = isObject(req.body) ? req.body as TtsMessageBody : {};
  const sourceKey = parseSourceKey(query.sourceKey ?? body.sourceKey);
  if (!sourceKey) {
    return { ok: false, message: "sourceKey must be rewrite or reply" };
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
  if (trimmed === "rewrite" || trimmed === "reply") return trimmed;
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
  rateLimiter: ChatGenerationRateLimiter | undefined
): Promise<
  | { allowed: true }
  | { allowed: false; scope: "global"; code: "TTS_GLOBAL_RATE_LIMITED" }
> {
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
