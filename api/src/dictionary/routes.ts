import type { FastifyInstance } from "fastify";
import type { AIProvider } from "@lf/core/ports/ai/AIProvider.js";
import type { ChatGenerationRateLimiter } from "@lf/server/services/chat/ChatGenerationRateLimiter.js";
import {
  AccountDisabledError,
  AccountPendingDeleteError,
  resolveActiveUserContext,
  UnauthorizedError,
} from "../auth/userContext.js";
import { resolveRequestId } from "../lib/httpResult.js";
import type { SystemEventLogWriter } from "../lib/systemEventLog.js";
import { writeSystemEventLog } from "../lib/systemEventLog.js";
import { getRuntimeConfig } from "@lf/server/config/runtimeConfig.js";

const FAILED_MODEL_OUTPUT_LOG_MAX_CHARS = 12_000;

export interface DictionaryRouteDeps {
  aiProvider: AIProvider;
  rateLimiter?: ChatGenerationRateLimiter;
  userRepository: {
    findById: (userId: string) => Promise<{
      id: string;
      status: "active" | "disabled" | "pending_delete";
    } | null>;
  };
  systemEventLogRepository?: SystemEventLogWriter;
}

type DictionaryLookupBody = {
  term: string;
  context: string;
  selectionStart: number;
  selectionEnd: number;
  targetLanguage: string;
  uiLanguage: string;
  contactId: string;
  messageId?: string | null;
};

type DictionaryLookupResult = {
  term: string;
  phonetic: string | null;
  audioUrl: string | null;
  meanings: Array<{
    partOfSpeech: string;
    definitions: Array<{ definition: string; example: string | null }>;
  }>;
  source: null;
  target: { meaning: string; example: string; sourceNote: null; scenario: string };
  ui: { meaning: string; example: string; sourceNote: null; scenario: string };
};

export function registerDictionaryRoutes(app: FastifyInstance, deps: DictionaryRouteDeps): void {
  const runtimeConfig = getRuntimeConfig();
  app.post("/dictionary/lookup", async (req, reply) => {
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
          metadata: { path: "/dictionary/lookup" },
        });
        return reply.status(403).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }
      throw error;
    }

    const body = req.body as unknown;
    if (!isDictionaryLookupBody(body)) {
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: "Invalid dictionary lookup payload" },
      });
    }

    const rateLimit = await consumeDictionaryRateLimit(deps.rateLimiter, userContext.userId, {
      globalLimit: runtimeConfig.dictionaryLookupGlobalRateLimit,
      userLimit: runtimeConfig.dictionaryLookupUserRateLimit,
      windowMs: runtimeConfig.dictionaryLookupRateWindowMs,
    });
    if (rateLimit.allowed === false) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "dictionary",
        event: "dictionary.lookup.rate_limited",
        level: "warn",
        status: "failed",
        errorCode: rateLimit.code,
        metadata: {
          path: "/dictionary/lookup",
          scope: rateLimit.scope,
          messageId: body.messageId ?? null,
          contactId: body.contactId,
        },
      });
      return reply.status(429).send({
        ok: false,
        request_id: requestId,
        error: { code: rateLimit.code, message: "Too many dictionary lookups. Please try again later." },
      });
    }

    const startedAt = Date.now();
    let outputChars = 0;
    const abortController = new AbortController();
    const abortOnClientClose = () => {
      if (!reply.raw.writableEnded) {
        abortController.abort();
      }
    };
    reply.raw.on("close", abortOnClientClose);
    try {
      if (body.targetLanguage !== "en-US") {
        return reply.status(404).send({ ok: false, request_id: requestId, error: { code: "DICTIONARY_NOT_FOUND", message: "词典中没有找到这个词或短语" } });
      }
      const upstream = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(body.term.trim())}`, {
        headers: { Accept: "application/json" },
        signal: abortController.signal,
      });
      if (upstream.status === 404) {
        return reply.status(404).send({ ok: false, request_id: requestId, error: { code: "DICTIONARY_NOT_FOUND", message: "词典中没有找到这个词或短语" } });
      }
      if (!upstream.ok) throw new Error(`DICTIONARY_UPSTREAM_${upstream.status}`);
      const upstreamBody = await upstream.json() as unknown;
      outputChars = JSON.stringify(upstreamBody).length;
      const data = normalizeFreeDictionaryResult(upstreamBody, body.term);
      await writeDictionaryLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        status: "success",
        durationMs: Date.now() - startedAt,
        inputChars: body.context.length + body.term.length,
        outputChars,
        body,
      });
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      if (abortController.signal.aborted) {
        req.log.info({ requestId, outputChars }, "dictionary lookup aborted");
        return;
      }
      await writeDictionaryLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        status: "failed",
        durationMs: Date.now() - startedAt,
        inputChars: body.context.length + body.term.length,
        outputChars,
        body,
        error,
      });
      req.log.warn({ requestId, error }, "dictionary lookup failed");
      return reply.status(502).send({
        ok: false,
        request_id: requestId,
        error: { code: "DICTIONARY_LOOKUP_FAILED", message: "Dictionary lookup failed" },
      });
    } finally {
      reply.raw.off("close", abortOnClientClose);
    }
  });
}

function isDictionaryLookupBody(value: unknown): value is DictionaryLookupBody {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.term === "string" &&
    body.term.trim().length > 0 &&
    body.term.length <= 160 &&
    typeof body.context === "string" &&
    body.context.trim().length > 0 &&
    body.context.length <= 8000 &&
    Number.isInteger(body.selectionStart) &&
    Number.isInteger(body.selectionEnd) &&
    Number(body.selectionStart) >= 0 &&
    Number(body.selectionEnd) > Number(body.selectionStart) &&
    Number(body.selectionEnd) <= body.context.length &&
    isSupportedLearningLanguage(body.targetLanguage) &&
    isSupportedAppLocale(body.uiLanguage) &&
    typeof body.contactId === "string" &&
    body.contactId.trim().length > 0 &&
    (body.messageId === undefined || body.messageId === null || typeof body.messageId === "string")
  );
}

function normalizeFreeDictionaryResult(value: unknown, fallbackTerm: string): DictionaryLookupResult {
  const entries = Array.isArray(value) ? value.filter(isRecord) : [];
  const entry = entries[0];
  if (!entry) throw new Error("DICTIONARY_RESULT_EMPTY");
  const phonetics = Array.isArray(entry.phonetics) ? entry.phonetics.filter(isRecord) : [];
  const phonetic = readString(entry.phonetic) || phonetics.map((item) => readString(item.text)).find(Boolean) || null;
  const rawAudio = phonetics.map((item) => readString(item.audio)).find(Boolean) || null;
  const audioUrl = rawAudio?.startsWith("//") ? `https:${rawAudio}` : rawAudio;
  const meanings = (Array.isArray(entry.meanings) ? entry.meanings.filter(isRecord) : []).map((meaning) => ({
    partOfSpeech: readString(meaning.partOfSpeech),
    definitions: (Array.isArray(meaning.definitions) ? meaning.definitions.filter(isRecord) : []).slice(0, 3).map((definition) => ({
      definition: readString(definition.definition),
      example: readString(definition.example) || null,
    })).filter((definition) => definition.definition),
  })).filter((meaning) => meaning.definitions.length > 0);
  if (!meanings.length) throw new Error("DICTIONARY_RESULT_EMPTY");
  const firstDefinition = meanings[0]!.definitions[0]!;
  const legacyContent = {
    meaning: meanings.flatMap((meaning) => meaning.definitions.map((definition) => definition.definition)).slice(0, 3).join("\n"),
    example: firstDefinition.example ?? "No example available.",
    sourceNote: null,
    scenario: meanings.map((meaning) => meaning.partOfSpeech).filter(Boolean).join(", ") || "Dictionary entry",
  };
  return { term: readString(entry.word) || fallbackTerm.trim(), phonetic, audioUrl, meanings, source: null, target: legacyContent, ui: legacyContent };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isSupportedLearningLanguage(value: unknown): value is "en-US" | "ja-JP" {
  return value === "en-US" || value === "ja-JP";
}

function isSupportedAppLocale(value: unknown): value is "zh-CN" | "zh-TW" | "en-US" | "ja-JP" {
  return value === "zh-CN" || value === "zh-TW" || value === "en-US" || value === "ja-JP";
}

async function consumeDictionaryRateLimit(
  rateLimiter: ChatGenerationRateLimiter | undefined,
  userId: string,
  config: {
    globalLimit: number;
    userLimit: number;
    windowMs: number;
  }
): Promise<
  | { allowed: true }
  | { allowed: false; scope: "global" | "user"; code: "DICTIONARY_GLOBAL_RATE_LIMITED" | "DICTIONARY_USER_RATE_LIMITED" }
> {
  if (!rateLimiter) return { allowed: true };
  const bucket = Math.floor(Date.now() / config.windowMs);
  const globalAllowed = await rateLimiter.consume(
    `dictionary:lookup:global:${bucket}`,
    config.globalLimit,
    config.windowMs
  );
  if (!globalAllowed) {
    return { allowed: false, scope: "global", code: "DICTIONARY_GLOBAL_RATE_LIMITED" };
  }
  const userAllowed = await rateLimiter.consume(
    `dictionary:lookup:user:${userId}:${bucket}`,
    config.userLimit,
    config.windowMs
  );
  if (!userAllowed) {
    return { allowed: false, scope: "user", code: "DICTIONARY_USER_RATE_LIMITED" };
  }
  return { allowed: true };
}

async function writeDictionaryLog(
  writer: SystemEventLogWriter | undefined,
  input: {
    requestId: string;
    userId: string;
    status: "success" | "failed";
    durationMs: number;
    inputChars: number;
    outputChars: number;
    modelOutput?: string;
    body: DictionaryLookupBody;
    error?: unknown;
  }
): Promise<void> {
  await writeSystemEventLog(writer, {
    requestId: input.requestId,
    userId: input.userId,
    module: "dictionary",
    event: "dictionary.lookup",
    level: input.status === "success" ? "info" : "warn",
    status: input.status,
    errorCode: input.error ? resolveErrorCode(input.error) : null,
    errorMessage: input.error instanceof Error ? input.error.message : input.error ? String(input.error) : null,
    metadata: {
      path: "/dictionary/lookup",
      messageId: input.body.messageId ?? null,
      contactId: input.body.contactId,
      termLength: input.body.term.length,
      selectionStart: input.body.selectionStart,
      selectionEnd: input.body.selectionEnd,
      targetLanguage: input.body.targetLanguage,
      uiLanguage: input.body.uiLanguage,
      inputChars: input.inputChars,
      outputChars: input.outputChars,
      durationMs: input.durationMs,
      ...(input.status === "failed"
        ? {
            modelOutput: (input.modelOutput ?? "").slice(0, FAILED_MODEL_OUTPUT_LOG_MAX_CHARS),
            modelOutputTruncated: (input.modelOutput?.length ?? 0) > FAILED_MODEL_OUTPUT_LOG_MAX_CHARS,
          }
        : {}),
    },
  });
}

function resolveErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String(error.code);
  }
  if (error instanceof Error && error.message) {
    return error.message.toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 80);
  }
  return "DICTIONARY_LOOKUP_FAILED";
}
