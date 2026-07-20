import type { FastifyInstance } from "fastify";
import type { AIProvider } from "@lf/core/ports/ai/AIProvider.js";
import { buildDictionarySystemPrompt, buildDictionaryUserPrompt } from "@lf/core/Prompts/dictionaryLookupPrompt.js";
import type { PromptAppLocale, PromptLanguage } from "@lf/core/Prompts/rewriteAssistantPrompt.js";
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
  source?: {
    type: string;
    title: string;
  } | null;
  target: {
    meaning: string;
    example: string;
    sourceNote?: string | null;
    scenario: string;
  };
  ui: {
    meaning: string;
    example: string;
    sourceNote?: string | null;
    scenario: string;
  };
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
    let output = "";
    const abortController = new AbortController();
    const abortOnClientClose = () => {
      if (!reply.raw.writableEnded) {
        abortController.abort();
      }
    };
    reply.raw.on("close", abortOnClientClose);
    try {
      const targetLanguage = normalizeLearningLanguage(body.targetLanguage);
      const uiLanguage = normalizeAppLocale(body.uiLanguage);
      const prompt = buildDictionaryUserPrompt({
        term: body.term,
        context: body.context,
        selectionStart: body.selectionStart,
        selectionEnd: body.selectionEnd,
        targetLanguage,
        uiLanguage,
      });
      await deps.aiProvider.generateChatTextStream(
        {
          userId: userContext.userId,
          text: prompt,
          contactId: body.contactId,
          languageCode: targetLanguage,
          appLocale: uiLanguage,
          systemPrompt: buildDictionarySystemPrompt({
            targetLanguage,
            uiLanguage,
          }),
          rawUserPrompt: true,
          maxOutputTokens: runtimeConfig.dictionaryLookupMaxOutputTokens,
          signal: abortController.signal,
        },
        (event) => {
          if (event.type === "delta") output += event.text;
        }
      );
      const data = normalizeDictionaryResult(parseDictionaryJson(output), body.term);
      await writeDictionaryLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        status: "success",
        durationMs: Date.now() - startedAt,
        inputChars: body.context.length + body.term.length,
        outputChars: output.length,
        body,
      });
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      if (abortController.signal.aborted) {
        req.log.info({ requestId, outputChars: output.length }, "dictionary lookup aborted");
        return;
      }
      await writeDictionaryLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        status: "failed",
        durationMs: Date.now() - startedAt,
        inputChars: body.context.length + body.term.length,
        outputChars: output.length,
        modelOutput: output,
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

function parseDictionaryJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("DICTIONARY_JSON_PARSE_FAILED");
  }
}

function normalizeDictionaryResult(value: unknown, fallbackTerm: string): DictionaryLookupResult {
  const root = isRecord(value) ? value : {};
  const target = isRecord(root.target) ? root.target : {};
  const ui = isRecord(root.ui) ? root.ui : {};
  const source = normalizeDictionarySource(root.source);
  const result = {
    term: readString(root.term) || fallbackTerm,
    source,
    target: {
      meaning: readString(target.meaning),
      example: readString(target.example),
      sourceNote: readString(target.sourceNote) || null,
      scenario: readString(target.scenario),
    },
    ui: {
      meaning: readString(ui.meaning),
      example: readString(ui.example),
      sourceNote: readString(ui.sourceNote) || null,
      scenario: readString(ui.scenario),
    },
  };
  if (
    !result.target.meaning ||
    !result.target.example ||
    !result.target.scenario ||
    !result.ui.meaning ||
    !result.ui.example ||
    !result.ui.scenario
  ) {
    throw new Error("DICTIONARY_JSON_INCOMPLETE");
  }
  return result;
}

function normalizeDictionarySource(value: unknown): DictionaryLookupResult["source"] {
  if (!isRecord(value)) return null;
  const title = readString(value.title);
  if (!title) return null;
  const type = normalizeSourceType(readString(value.type));
  return { type, title };
}

function normalizeSourceType(value: string): string {
  if (value === "movie" || value === "book" || value === "quote" || value === "speech" || value === "song") {
    return value;
  }
  return "other";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLearningLanguage(value: string): PromptLanguage {
  return value === "ja-JP" ? "ja-JP" : "en-US";
}

function isSupportedLearningLanguage(value: unknown): value is PromptLanguage {
  return value === "en-US" || value === "ja-JP";
}

function normalizeAppLocale(value: string): PromptAppLocale {
  if (value === "zh-TW" || value === "en-US" || value === "ja-JP") return value;
  return "zh-CN";
}

function isSupportedAppLocale(value: unknown): value is PromptAppLocale {
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
