import type { FastifyInstance } from "fastify";
import type { AIProvider } from "@lf/core/ports/ai/AIProvider.js";
import { buildDictionarySystemPrompt, buildDictionaryUserPrompt } from "@lf/core/Prompts/dictionaryLookupPrompt.js";
import type { UserPreferenceRepository } from "@lf/core/ports/repository/UserPreferenceRepository.js";
import type { PrismaDictionaryLookupCacheRepository } from "@lf/server/infrastructure/repository/PrismaDictionaryLookupCacheRepository.js";
import { createHash } from "node:crypto";
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
import type { ChatTextGenerationStreamEvent } from "@lf/core/ports/ai/AIProvider.js";
import { TokenQuotaExceededError, TokenRequestAlreadyExistsError, type UsageV2Service } from "@lf/server/services/usage/UsageV2Service.js";

const FAILED_MODEL_OUTPUT_LOG_MAX_CHARS = 2_000;
const DATAMUSE_TIMEOUT_MS = 4_000;
const DICTIONARY_PROMPT_VERSION = "dictionary-meaning-v3";
const DICTIONARY_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1_000;

export interface DictionaryRouteDeps {
  aiProvider: AIProvider;
  userPreferenceRepository: UserPreferenceRepository;
  cacheRepository: PrismaDictionaryLookupCacheRepository;
  usageV2Service: UsageV2Service;
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
  queryType: "word" | "phrase" | "sentence";
  term: string;
  phonetic: string | null;
  audioUrl: string | null;
  targetMeaning: string;
  nativeMeaning: string;
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
    let aiAttempts = 0;
    let aiRetryReasons: string[] = [];
    let failedModelOutput = "";
    const abortController = new AbortController();
    const abortOnClientClose = () => {
      if (!reply.raw.writableEnded) {
        abortController.abort();
      }
    };
    reply.raw.on("close", abortOnClientClose);
    try {
      const preference = await deps.userPreferenceRepository.getByUserId(userContext.userId);
      const targetLanguage = preference.learningLanguage;
      const uiLanguage = preference.appLocale;
      const normalizedTerm = normalizeLookupTerm(body.term, targetLanguage);
      const context = extractSelectionSentence(body.context, body.selectionStart, body.selectionEnd) ?? body.context.slice(0, 1_400);
      const contextHash = sha256(context);
      const provider = deps.aiProvider.resolveProviderName?.() ?? deps.aiProvider.providerName;
      const model = deps.aiProvider.resolveModelName?.() ?? deps.aiProvider.modelName;
      const cacheKey = sha256([DICTIONARY_PROMPT_VERSION, userContext.userId, provider, model, targetLanguage, uiLanguage, normalizedTerm, contextHash].join("\u0000"));
      const cached = await deps.cacheRepository.find(cacheKey).catch((error) => {
        req.log.warn({ requestId, error }, "dictionary cache read failed");
        return null;
      });
      let data = cached && cached.expiresAt.getTime() > Date.now() ? parseDictionaryResult(cached.result) : null;
      let cacheStatus: "hit" | "miss" | "stale" | "fallback" = data ? "hit" : "miss";

      if (!data) {
        const promptInput = {
          term: body.term,
          context: body.context,
          selectionStart: body.selectionStart,
          selectionEnd: body.selectionEnd,
          targetLanguage,
          uiLanguage,
        };
        const meteredPrompt = `${buildDictionarySystemPrompt(promptInput)}\n${buildDictionaryUserPrompt(promptInput)}`;
        await deps.usageV2Service.reserveTokens({
          userId: userContext.userId,
          requestId,
          feature: "dictionary",
          estimatedTokens: Array.from(meteredPrompt).length + runtimeConfig.dictionaryLookupMaxOutputTokens,
          provider,
          model,
        });
        try {
          const generated = await generateDictionaryLookupWithRetry(deps.aiProvider, {
            userId: userContext.userId,
            term: body.term,
            fallbackTerm: normalizedTerm,
            context: body.context,
            selectionStart: body.selectionStart,
            selectionEnd: body.selectionEnd,
            targetLanguage,
            uiLanguage,
            maxOutputTokens: runtimeConfig.dictionaryLookupMaxOutputTokens,
            signal: abortController.signal,
          }, {
            attemptTimeoutMs: runtimeConfig.dictionaryLookupAiAttemptTimeoutMs,
            maxAttempts: runtimeConfig.dictionaryLookupAiMaxAttempts,
            retryBaseDelayMs: runtimeConfig.dictionaryLookupAiRetryBaseDelayMs,
          });
          aiAttempts = generated.attempts;
          aiRetryReasons = generated.retryReasons;
          // Settle as soon as the model call succeeds. Parsing, moderation or
          // cache persistence failures must not make a completed LLM call free.
          await deps.usageV2Service.settleTokens({
            userId: userContext.userId,
            requestId,
            inputTokens: generated.usage?.inputTokens ?? Math.ceil(Array.from(meteredPrompt).length / 2),
            outputTokens: generated.usage?.outputTokens ?? Math.ceil(Array.from(generated.text).length / 2),
            meteringSource: generated.usage ? "provider" : "tokenizer",
            provider,
            model,
          });
          data = generated.data;
          if (!data) {
            throw Object.assign(new Error("DICTIONARY_MODEL_OUTPUT_INVALID"), {
              code: "DICTIONARY_MODEL_OUTPUT_INVALID",
              modelOutput: generated.text,
              aiAttempts,
              retryReasons: aiRetryReasons,
            });
          }
          await deps.cacheRepository.put({
            cacheKey, userId: userContext.userId, term: normalizedTerm, contextHash, targetLanguage, uiLanguage,
            promptVersion: DICTIONARY_PROMPT_VERSION, provider, model, result: data,
            expiresAt: new Date(Date.now() + DICTIONARY_CACHE_TTL_MS),
          }).catch((error) => req.log.warn({ requestId, error }, "dictionary cache write failed"));
        } catch (modelError) {
          const diagnostics = readDictionaryAiErrorDiagnostics(modelError);
          aiAttempts = Math.max(aiAttempts, diagnostics.aiAttempts);
          aiRetryReasons = diagnostics.retryReasons.length ? diagnostics.retryReasons : aiRetryReasons;
          const finalFailureReason = resolveErrorCode(modelError);
          if (!aiRetryReasons.includes(finalFailureReason)) {
            aiRetryReasons = [...aiRetryReasons, finalFailureReason].slice(-2);
          }
          failedModelOutput = diagnostics.modelOutput;
          await deps.usageV2Service.releaseTokens(userContext.userId, requestId).catch(() => undefined);
          if (abortController.signal.aborted) throw modelError;
          data = cached ? parseDictionaryResult(cached.result) : null;
          if (data) {
            cacheStatus = "stale";
          } else if (targetLanguage === "en-US" && isSingleWord(normalizedTerm)) {
            const fallback = await lookupEnglishDictionary(normalizedTerm, abortController.signal);
            if (!fallback) throw modelError;
            data = attachContextExample(fallback, body);
            cacheStatus = "fallback";
          } else {
            throw modelError;
          }
        }
      }
      if (!data) {
        return reply.status(404).send({ ok: false, request_id: requestId, error: { code: "DICTIONARY_NOT_FOUND", message: "词典中没有找到这个词或短语" } });
      }
      outputChars = JSON.stringify(data).length;
      await writeDictionaryLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        status: "success",
        durationMs: Date.now() - startedAt,
        inputChars: body.context.length + body.term.length,
        outputChars,
        body,
        effectiveLanguages: { targetLanguage, uiLanguage },
        cacheStatus,
        aiAttempts,
        aiRetryReasons,
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
        modelOutput: failedModelOutput || readDictionaryAiErrorDiagnostics(error).modelOutput,
        aiAttempts,
        aiRetryReasons,
      });
      req.log.warn({ requestId, error }, "dictionary lookup failed");
      if (error instanceof TokenQuotaExceededError) {
        return reply.status(402).send({ ok: false, request_id: requestId, error: { code: error.code, message: error.message } });
      }
      if (error instanceof TokenRequestAlreadyExistsError) {
        return reply.status(409).send({ ok: false, request_id: requestId, error: { code: error.code, message: error.message } });
      }
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

function attachContextExample(result: DictionaryLookupResult, body: DictionaryLookupBody): DictionaryLookupResult {
  void body;
  return result;
}

function extractSelectionSentence(context: string, selectionStart: number, selectionEnd: number): string | null {
  const left = context.slice(0, selectionStart);
  const right = context.slice(selectionEnd);
  const leftBoundary = Math.max(left.lastIndexOf("."), left.lastIndexOf("!"), left.lastIndexOf("?"), left.lastIndexOf("。"), left.lastIndexOf("！"), left.lastIndexOf("？"));
  const rightMatch = right.match(/[.!?。！？]/u);
  const sentenceStart = leftBoundary < 0 ? 0 : leftBoundary + 1;
  const sentenceEnd = rightMatch?.index === undefined ? context.length : selectionEnd + rightMatch.index + 1;
  const sentence = context.slice(sentenceStart, sentenceEnd).trim().replace(/\s+/gu, " ");
  return sentence && sentence.length <= 500 ? sentence : null;
}

async function lookupEnglishDictionary(term: string, clientSignal: AbortSignal): Promise<DictionaryLookupResult | null> {
  if (!term) return null;
  const datamuseBody = await fetchJsonWithTimeout(
    `https://api.datamuse.com/words?sp=${encodeURIComponent(term)}&qe=sp&md=dpr&ipa=1&max=1`,
    DATAMUSE_TIMEOUT_MS,
    clientSignal,
  );
  return datamuseBody === null ? null : normalizeDatamuseResult(datamuseBody, term);
}

type DictionaryAiInput = {
  userId: string;
  term: string;
  fallbackTerm: string;
  context: string;
  selectionStart: number;
  selectionEnd: number;
  targetLanguage: "en-US" | "ja-JP";
  uiLanguage: "zh-CN" | "zh-TW" | "en-US" | "ja-JP";
  maxOutputTokens: number;
  signal: AbortSignal;
};

type DictionaryAiGenerationResult = {
  text: string;
  usage?: Extract<ChatTextGenerationStreamEvent, { type: "done" }>["usage"];
  data: DictionaryLookupResult | null;
  attempts: number;
  retryReasons: string[];
};

async function generateDictionaryLookupWithRetry(
  aiProvider: AIProvider,
  input: DictionaryAiInput,
  options: {
    attemptTimeoutMs: number;
    maxAttempts: number;
    retryBaseDelayMs: number;
  },
): Promise<DictionaryAiGenerationResult> {
  const retryReasons: string[] = [];
  const maxAttempts = Math.max(1, Math.min(2, options.maxAttempts));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const generated = await generateDictionaryLookupAttempt(aiProvider, input, options.attemptTimeoutMs);
      const data = parseDictionaryResult(parseModelJson(generated.text), input.fallbackTerm);
      if (data || attempt >= maxAttempts) {
        return { ...generated, data, attempts: attempt, retryReasons };
      }
      retryReasons.push("DICTIONARY_MODEL_OUTPUT_INVALID");
      await waitForDictionaryRetry(options.retryBaseDelayMs * attempt, input.signal);
    } catch (error) {
      if (input.signal.aborted) throw attachDictionaryAiDiagnostics(error, attempt, retryReasons);
      const reason = resolveErrorCode(error);
      if (attempt >= maxAttempts || !isRetryableDictionaryAiError(error)) {
        throw attachDictionaryAiDiagnostics(error, attempt, retryReasons);
      }
      retryReasons.push(reason);
      await waitForDictionaryRetry(options.retryBaseDelayMs * attempt, input.signal);
    }
  }
  throw new Error("DICTIONARY_AI_RETRY_EXHAUSTED");
}

async function generateDictionaryLookupAttempt(
  aiProvider: AIProvider,
  input: DictionaryAiInput,
  timeoutMs: number,
): Promise<{ text: string; usage?: Extract<ChatTextGenerationStreamEvent, { type: "done" }>["usage"] }> {
  let output = "";
  let usage: Extract<ChatTextGenerationStreamEvent, { type: "done" }>["usage"];
  const controller = new AbortController();
  let timedOut = false;
  const abortFromClient = () => controller.abort(input.signal.reason);
  if (input.signal.aborted) controller.abort(input.signal.reason);
  else input.signal.addEventListener("abort", abortFromClient, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("DICTIONARY_AI_TIMEOUT"));
  }, Math.max(1, timeoutMs));
  try {
    await aiProvider.generateChatTextStream({
      userId: input.userId,
      text: buildDictionaryUserPrompt(input),
      contactId: "dictionary_lookup",
      languageCode: input.targetLanguage,
      appLocale: input.uiLanguage,
      systemPrompt: buildDictionarySystemPrompt(input),
      rawUserPrompt: true,
      maxOutputTokens: input.maxOutputTokens,
      signal: controller.signal,
    }, (event) => {
      if (event.type === "delta") output += event.text;
      if (event.type === "done") usage = event.usage;
    });
    return { text: output, usage };
  } catch (error) {
    if (timedOut && !input.signal.aborted) {
      throw Object.assign(new Error("DICTIONARY_AI_TIMEOUT"), {
        code: "DICTIONARY_AI_TIMEOUT",
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    input.signal.removeEventListener("abort", abortFromClient);
  }
}

function parseModelJson(value: string): unknown {
  const trimmed = value.replace(/^\uFEFF/u, "").trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  const candidates = [trimmed, start >= 0 && end > start ? trimmed.slice(start, end + 1) : ""];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      try {
        return JSON.parse(candidate.replace(/,\s*([}\]])/gu, "$1")) as unknown;
      } catch {
        // Try the next safely extracted candidate.
      }
    }
  }
  return null;
}

export function parseDictionaryResult(value: unknown, fallbackTerm = ""): DictionaryLookupResult | null {
  const root = Array.isArray(value) ? value.find(isRecord) : value;
  if (!isRecord(root)) return null;
  const candidate = isRecord(root.data) ? root.data : isRecord(root.result) ? root.result : root;
  const term = readFirstString(candidate.term, candidate.word, candidate.phrase) || fallbackTerm.trim();
  const queryType = normalizeDictionaryQueryType(candidate.queryType ?? candidate.query_type, term);
  const targetMeaning = readFirstString(candidate.targetMeaning, candidate.target_meaning, candidate.definition, candidate.meaning);
  const nativeMeaning = readFirstString(candidate.nativeMeaning, candidate.native_meaning, candidate.translation, candidate.nativeTranslation);
  if (!queryType || !term || !targetMeaning || !nativeMeaning) return null;
  const phonetic = queryType === "word"
    ? readFirstString(candidate.phonetic, candidate.ipa, candidate.pronunciation) || null
    : null;
  return { queryType, term, phonetic, audioUrl: null, targetMeaning, nativeMeaning };
}

function normalizeDictionaryQueryType(
  value: unknown,
  term: string,
): DictionaryLookupResult["queryType"] | null {
  const normalized = readString(value).toLowerCase().replace(/[\s-]+/gu, "_");
  if (normalized === "word" || normalized === "single_word" || normalized === "singleword") return "word";
  if (["phrase", "expression", "idiom", "multi_word", "multiword"].includes(normalized)) return "phrase";
  if (["sentence", "full_sentence", "clause"].includes(normalized)) return "sentence";
  if (normalized !== "word|phrase|sentence" || !term) return null;
  if (isSingleWord(term)) return "word";
  return /[.!?。！？]$/u.test(term) ? "sentence" : "phrase";
}

function isRetryableDictionaryAiError(error: unknown): boolean {
  const code = resolveErrorCode(error);
  if (code === "DICTIONARY_AI_TIMEOUT") return true;
  const status = readNumberProperty(error, "status");
  if (code === "UPSTREAM_AI_ERROR") {
    return status === null || status === 408 || status === 429 || status >= 500;
  }
  if (error instanceof TypeError) return true;
  return ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"].includes(code);
}

async function waitForDictionaryRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw signal.reason ?? new Error("DICTIONARY_LOOKUP_ABORTED");
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      reject(signal.reason ?? new Error("DICTIONARY_LOOKUP_ABORTED"));
    };
    timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, delayMs));
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function attachDictionaryAiDiagnostics(error: unknown, aiAttempts: number, retryReasons: string[]): Error {
  const target = error instanceof Error ? error : new Error(String(error ?? "DICTIONARY_AI_ERROR"));
  try {
    Object.assign(target, { aiAttempts, retryReasons: [...retryReasons] });
    return target;
  } catch {
    return Object.assign(new Error(target.message), {
      code: resolveErrorCode(error),
      cause: error,
      aiAttempts,
      retryReasons: [...retryReasons],
    });
  }
}

function readDictionaryAiErrorDiagnostics(error: unknown): {
  aiAttempts: number;
  retryReasons: string[];
  modelOutput: string;
  upstreamStatus: number | null;
  upstreamCode: string | null;
} {
  if (!error || typeof error !== "object") {
    return { aiAttempts: 0, retryReasons: [], modelOutput: "", upstreamStatus: null, upstreamCode: null };
  }
  const value = error as Record<string, unknown>;
  const aiAttempts = typeof value.aiAttempts === "number" && Number.isFinite(value.aiAttempts)
    ? Math.max(0, Math.trunc(value.aiAttempts))
    : 0;
  return {
    aiAttempts,
    retryReasons: Array.isArray(value.retryReasons)
      ? value.retryReasons.filter((item): item is string => typeof item === "string").slice(0, 2)
      : [],
    modelOutput: typeof value.modelOutput === "string" ? value.modelOutput : "",
    upstreamStatus: typeof value.status === "number" && Number.isFinite(value.status) ? value.status : null,
    upstreamCode: typeof value.upstreamCode === "string" ? value.upstreamCode.slice(0, 120) : null,
  };
}

function readNumberProperty(value: unknown, key: string): number | null {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
}

function sanitizeFailedModelOutput(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "�");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isSingleWord(value: string): boolean {
  return /^[a-z0-9]+(?:['’-][a-z0-9]+)*$/iu.test(value);
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number, clientSignal: AbortSignal): Promise<unknown | null> {
  const controller = new AbortController();
  const abortFromClient = () => controller.abort(clientSignal.reason);
  clientSignal.addEventListener("abort", abortFromClient, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("DICTIONARY_UPSTREAM_TIMEOUT")), timeoutMs);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`DICTIONARY_UPSTREAM_${response.status}`);
    return await response.json() as unknown;
  } finally {
    clearTimeout(timer);
    clientSignal.removeEventListener("abort", abortFromClient);
  }
}

function normalizeLookupTerm(value: string, languageCode = "en-US"): string {
  const trimmed = value.trim().replace(/\s+/gu, " ");
  return languageCode === "en-US"
    ? trimmed.toLocaleLowerCase("en-US").replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "")
    : trimmed;
}

function normalizeDatamuseResult(value: unknown, fallbackTerm: string): DictionaryLookupResult | null {
  const entry = Array.isArray(value) ? value.find(isRecord) : null;
  if (!entry) return null;
  const definitions = Array.isArray(entry.defs) ? entry.defs.map(readString).filter(Boolean) : [];
  if (!definitions.length) return null;
  const grouped = new Map<string, Array<{ definition: string; example: null }>>();
  for (const raw of definitions) {
    const separator = raw.indexOf("\t");
    const code = separator >= 0 ? raw.slice(0, separator) : "";
    const definition = separator >= 0 ? raw.slice(separator + 1).trim() : raw;
    if (!definition) continue;
    const partOfSpeech = datamusePartOfSpeech(code);
    const rows = grouped.get(partOfSpeech) ?? [];
    if (rows.length < 3) rows.push({ definition, example: null });
    grouped.set(partOfSpeech, rows);
  }
  const meanings = Array.from(grouped, ([partOfSpeech, rows]) => ({ partOfSpeech, definitions: rows }));
  if (!meanings.length) return null;
  const tags = Array.isArray(entry.tags) ? entry.tags.map(readString) : [];
  const ipa = tags.find((tag) => tag.startsWith("ipa_pron:"))?.slice("ipa_pron:".length).trim();
  const fallbackPronunciation = tags.find((tag) => tag.startsWith("pron:"))?.slice("pron:".length).trim();
  const phonetic = ipa ? `/${ipa}/` : fallbackPronunciation || null;
  const firstDefinition = meanings[0]!.definitions[0]!;
  const meaning = meanings.flatMap((item) => item.definitions.map((definition) => definition.definition)).slice(0, 3).join("; ") || firstDefinition.definition;
  return {
    queryType: "word",
    term: readString(entry.defHeadword) || readString(entry.word) || fallbackTerm,
    phonetic,
    audioUrl: null,
    targetMeaning: meaning,
    nativeMeaning: meaning,
  };
}

function datamusePartOfSpeech(code: string): string {
  if (code === "n") return "noun";
  if (code === "v") return "verb";
  if (code === "adj") return "adjective";
  if (code === "adv") return "adverb";
  return code || "other";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readFirstString(...values: unknown[]): string {
  for (const value of values) {
    const text = readString(value);
    if (text) return text;
  }
  return "";
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
    effectiveLanguages?: { targetLanguage: string; uiLanguage: string };
    cacheStatus?: "hit" | "miss" | "stale" | "fallback";
    error?: unknown;
    aiAttempts?: number;
    aiRetryReasons?: string[];
  }
): Promise<void> {
  const diagnostics = readDictionaryAiErrorDiagnostics(input.error);
  const modelOutput = input.modelOutput || diagnostics.modelOutput;
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
      effectiveTargetLanguage: input.effectiveLanguages?.targetLanguage,
      effectiveUiLanguage: input.effectiveLanguages?.uiLanguage,
      cacheStatus: input.cacheStatus,
      inputChars: input.inputChars,
      outputChars: input.outputChars,
      durationMs: input.durationMs,
      promptVersion: DICTIONARY_PROMPT_VERSION,
      aiAttempts: input.aiAttempts ?? diagnostics.aiAttempts,
      aiRetryReasons: input.aiRetryReasons?.length ? input.aiRetryReasons : diagnostics.retryReasons,
      upstreamStatus: diagnostics.upstreamStatus,
      upstreamCode: diagnostics.upstreamCode,
      ...(input.status === "failed"
        ? {
            modelOutput: sanitizeFailedModelOutput(modelOutput).slice(0, FAILED_MODEL_OUTPUT_LOG_MAX_CHARS),
            modelOutputChars: modelOutput.length,
            modelOutputTruncated: modelOutput.length > FAILED_MODEL_OUTPUT_LOG_MAX_CHARS,
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
