import { createHash } from "node:crypto";
import type { MessageRepository } from "@lf/core/ports/repository/MessageRepository.js";
import type { TtsAssetEntity, TtsAssetRepository, TtsSourceKey } from "@lf/core/ports/repository/TtsAssetRepository.js";
import type { TtsRequestLogRepository } from "@lf/core/ports/repository/TtsRequestLogRepository.js";
import type { UserPreferenceRepository } from "@lf/core/ports/repository/UserPreferenceRepository.js";
import { normalizeLearningText } from "@lf/core/text/learningText.js";
import type { RedisClient } from "../../infrastructure/redis/redisClient.js";
import type { ResourceGovernor } from "../resource/ResourceGovernor.js";
import type { EntitlementService } from "../entitlement/EntitlementService.js";
import type { TtsProvider } from "./TtsProvider.js";
import type { TtsStorageProvider } from "./TtsStorageProvider.js";
import { isConfiguredTtsVoice, listTtsVoiceOptions, resolveDefaultTtsVoice } from "./TtsVoiceCatalog.js";
import { segmentLearningSentences } from "../text/learningSentenceSegmenter.js";

export class TtsAccessDeniedError extends Error {
  readonly code = "TTS_ACCESS_DENIED";
  constructor() {
    super("Message not found");
  }
}

export class TtsProRequiredError extends Error {
  readonly code = "PRO_REQUIRED";
  constructor() {
    super("Pro access required");
  }
}

export class TtsSourceTextEmptyError extends Error {
  readonly code = "TTS_SOURCE_EMPTY";
  constructor() {
    super("No text available for TTS");
  }
}

export class TtsRangeInvalidError extends Error {
  readonly code = "TTS_RANGE_INVALID";
  constructor() {
    super("Invalid TTS text range");
  }
}

class TtsSignedUrlFailedError extends Error {
  readonly code = "TTS_SIGNED_URL_FAILED";
  constructor(message: string) {
    super(message);
  }
}

export class TtsGenerationInProgressError extends Error {
  readonly code = "TTS_GENERATION_IN_PROGRESS";
  constructor() {
    super("TTS generation is still in progress");
  }
}

export interface TtsPlaybackRange {
  startMs: number;
  endMs: number;
}

export interface TtsMessageAssetView {
  id: string;
  messageId: string;
  provider: string;
  voiceCode: string;
  languageCode: string;
  sourceKey: TtsSourceKey;
  sourceText: string;
  sourceTextHash: string;
  audioUrl: string;
  audioUrlExpiresAt: string | null;
  durationMs: number | null;
  playbackRange: TtsPlaybackRange | null;
  wordMarks: TtsAssetEntity["wordMarks"];
  sentenceMarks: TtsAssetEntity["sentenceMarks"];
  cached: boolean;
  deduped: boolean;
}

type TtsAssetIdentity = {
  messageId: string;
  provider: string;
  voiceCode: string;
  languageCode: string;
  sourceKey: TtsSourceKey;
  sourceTextHash: string;
};

type TtsGenerationResult = {
  asset: TtsAssetEntity;
  cacheHit: boolean;
  deduped: boolean;
};

type TtsPhaseTimings = {
  preparationMs: number;
  cacheLookupMs: number;
  lockWaitMs: number;
  queueWaitMs: number;
  synthesisMs: number;
  storageMs: number;
  persistenceMs: number;
};

const ttsGenerationLocks = new Map<string, Promise<TtsGenerationResult>>();
const TTS_GENERATION_LOCK_TTL_MS = readPositiveInt(process.env.TTS_GENERATION_LOCK_TTL_MS, 120_000);
const TTS_GENERATION_LOCK_WAIT_MS = readPositiveInt(process.env.TTS_GENERATION_LOCK_WAIT_MS, 120_000);
const TTS_GENERATION_LOCK_POLL_MS = readPositiveInt(process.env.TTS_GENERATION_LOCK_POLL_MS, 500);
const TTS_ASSET_ALGORITHM_VERSION = "tts-v3";

export class TtsService {
  constructor(
    private readonly messageRepository: MessageRepository,
    private readonly userPreferenceRepository: UserPreferenceRepository,
    private readonly ttsAssetRepository: TtsAssetRepository,
    private readonly entitlementService: EntitlementService,
    private readonly ttsProvider: TtsProvider,
    private readonly storageProvider: TtsStorageProvider,
    private readonly ttsRequestLogRepository?: TtsRequestLogRepository,
    private readonly redisClient?: RedisClient | null,
    private readonly resourceGovernor?: ResourceGovernor,
  ) {}

  async getOrCreateMessageAsset(input: {
    userId: string;
    messageId: string;
    sourceKey?: TtsSourceKey;
    textStart?: number;
    textEnd?: number;
    requestId?: string | null;
  }): Promise<TtsMessageAssetView> {
    const startedAt = Date.now();
    const timings = createTtsPhaseTimings();
    const [entitlement, message, preference] = await Promise.all([
      this.entitlementService.getCurrentEntitlement(input.userId),
      this.messageRepository.findById(input.messageId),
      this.userPreferenceRepository.getByUserId(input.userId),
    ]);
    if (!entitlement.features.highQualityTts) throw new TtsProRequiredError();

    if (!message || message.userId !== input.userId || message.status !== "success") {
      throw new TtsAccessDeniedError();
    }

    const sourceKey = input.sourceKey ?? "rewrite";
    const rawSourceText = extractTtsLearningText(message.content, sourceKey);
    const languageCode = message.languageCode ?? "en-US";
    const sourceText = normalizeLearningText({ text: rawSourceText, languageCode });
    if (!sourceText) throw new TtsSourceTextEmptyError();
    const requestedRange = resolveRequestedRange(input, sourceText.length);
    const sourceTextHash = sha256(`${TTS_ASSET_ALGORITHM_VERSION}\n${sourceText}`);
    const provider = preference.ttsProvider || this.ttsProvider.providerName;
    const voiceCode = resolveVoiceCode({
      provider,
      languageCode,
      preferredVoiceCode: preference.ttsVoiceCode,
    });

    const assetIdentity = {
      messageId: message.id,
      provider,
      voiceCode,
      languageCode,
      sourceKey,
      sourceTextHash,
    };
    timings.preparationMs = Date.now() - startedAt;
    let cached: TtsAssetEntity | null;
    const cacheLookupStartedAt = Date.now();
    try {
      cached = await this.findReadyAsset(assetIdentity);
      timings.cacheLookupMs += Date.now() - cacheLookupStartedAt;
    } catch (error) {
      timings.cacheLookupMs += Date.now() - cacheLookupStartedAt;
      this.queueRequestLog({
        requestId: input.requestId,
        userId: input.userId,
        messageId: message.id,
        provider,
        voiceCode,
        languageCode,
        sourceTextHash,
        sourceTextChars: sourceText.length,
        cacheHit: true,
        deduped: false,
        status: "failed",
        durationMs: Date.now() - startedAt,
        ...timings,
        errorCode: getTtsRequestErrorCode(error),
        errorMessage: toErrorMessage(error),
      });
      throw error;
    }
    if (cached) {
      this.queueRequestLog({
        requestId: input.requestId,
        userId: input.userId,
        messageId: message.id,
        assetId: cached.id,
        provider,
        voiceCode,
        languageCode,
        sourceTextHash,
        sourceTextChars: sourceText.length,
        cacheHit: true,
        deduped: false,
        status: "success",
        durationMs: Date.now() - startedAt,
        ...timings,
      });
      return this.toView(cached, true, false, requestedRange);
    }

    const lockKey = buildGenerationLockKey(assetIdentity);
    const existingGeneration = ttsGenerationLocks.get(lockKey);
    if (existingGeneration) {
      const lockWaitStartedAt = Date.now();
      try {
        const result = await existingGeneration;
        timings.lockWaitMs += Date.now() - lockWaitStartedAt;
        this.queueRequestLog({
          requestId: input.requestId,
          userId: input.userId,
          messageId: message.id,
          assetId: result.asset.id,
          provider,
          voiceCode,
          languageCode,
          sourceTextHash,
          sourceTextChars: sourceText.length,
          cacheHit: false,
          deduped: true,
          status: "success",
          durationMs: Date.now() - startedAt,
          ...timings,
        });
        return this.toView(result.asset, result.cacheHit, true, requestedRange);
      } catch (error) {
        timings.lockWaitMs += Date.now() - lockWaitStartedAt;
        this.queueRequestLog({
          requestId: input.requestId,
          userId: input.userId,
          messageId: message.id,
          provider,
          voiceCode,
          languageCode,
          sourceTextHash,
          sourceTextChars: sourceText.length,
          cacheHit: false,
          deduped: true,
          status: "failed",
          durationMs: Date.now() - startedAt,
          ...timings,
          errorCode: getTtsRequestErrorCode(error),
          errorMessage: toErrorMessage(error),
        });
        throw error;
      }
    }

    const generation = this.createReadyAssetWithLock({
      userId: input.userId,
      messageId: message.id,
      provider,
      voiceCode,
      languageCode,
      sourceKey,
      sourceText,
      sourceTextHash,
    }, timings);
    ttsGenerationLocks.set(lockKey, generation);
    try {
      const result = await generation;
      this.queueRequestLog({
        requestId: input.requestId,
        userId: input.userId,
        messageId: message.id,
        assetId: result.asset.id,
        provider,
        voiceCode,
        languageCode,
        sourceTextHash,
        sourceTextChars: sourceText.length,
        cacheHit: result.cacheHit,
        deduped: result.deduped,
        status: "success",
        durationMs: Date.now() - startedAt,
        ...timings,
      });
      return this.toView(result.asset, result.cacheHit, result.deduped, requestedRange);
    } catch (error) {
      if (error instanceof TtsSignedUrlFailedError) {
        this.queueRequestLog({
          requestId: input.requestId,
          userId: input.userId,
          messageId: message.id,
          provider,
          voiceCode,
          languageCode,
          sourceTextHash,
          sourceTextChars: sourceText.length,
          cacheHit: true,
          deduped: false,
          status: "failed",
          durationMs: Date.now() - startedAt,
          ...timings,
          errorCode: error.code,
          errorMessage: error.message,
        });
        throw error;
      }
      if (error instanceof TtsGenerationInProgressError) {
        this.queueRequestLog({
          requestId: input.requestId,
          userId: input.userId,
          messageId: message.id,
          provider,
          voiceCode,
          languageCode,
          sourceTextHash,
          sourceTextChars: sourceText.length,
          cacheHit: false,
          deduped: true,
          status: "failed",
          durationMs: Date.now() - startedAt,
          ...timings,
          errorCode: error.code,
          errorMessage: error.message,
        });
        throw error;
      }
      const errorMessage = toErrorMessage(error);
      const persistenceStartedAt = Date.now();
      let failed: TtsAssetEntity;
      try {
        failed = await this.ttsAssetRepository.createFailed({
          userId: input.userId,
          messageId: message.id,
          provider,
          voiceCode,
          languageCode,
          sourceKey,
          sourceText,
          sourceTextHash,
          format: "mp3",
          objectKey: buildObjectKey({
            userId: input.userId,
            messageId: message.id,
            provider,
            voiceCode,
            sourceKey,
            sourceTextHash,
            format: "mp3",
          }),
          errorMessage,
        });
      } finally {
        timings.persistenceMs += Date.now() - persistenceStartedAt;
      }
      this.queueRequestLog({
        requestId: input.requestId,
        userId: input.userId,
        messageId: message.id,
        assetId: failed.id,
        provider,
        voiceCode,
        languageCode,
        sourceTextHash,
        sourceTextChars: sourceText.length,
        cacheHit: false,
        deduped: false,
        status: "failed",
        durationMs: Date.now() - startedAt,
        ...timings,
        errorCode: "TTS_SYNTHESIS_FAILED",
        errorMessage,
      });
      throw error;
    } finally {
      if (ttsGenerationLocks.get(lockKey) === generation) {
        ttsGenerationLocks.delete(lockKey);
      }
    }
  }

  listVoiceOptions(input: { languageCode?: string } = {}) {
    return listTtsVoiceOptions({
      provider: this.ttsProvider.providerName,
      languageCode: input.languageCode,
    });
  }

  private toView(
    asset: TtsAssetEntity,
    cached: boolean,
    deduped: boolean,
    requestedRange: RequestedTextRange | null
  ): TtsMessageAssetView {
    if (!asset.objectUrl) throw new Error("TTS asset URL is missing");
    return {
      id: asset.id,
      messageId: asset.messageId,
      provider: asset.provider,
      voiceCode: asset.voiceCode,
      languageCode: asset.languageCode,
      sourceKey: asset.sourceKey,
      sourceText: asset.sourceText,
      sourceTextHash: asset.sourceTextHash,
      audioUrl: asset.objectUrl,
      audioUrlExpiresAt: asset.objectUrlExpiresAt?.toISOString() ?? null,
      durationMs: asset.durationMs,
      playbackRange: resolvePlaybackRange(asset, requestedRange),
      wordMarks: asset.wordMarks,
      sentenceMarks: asset.sentenceMarks,
      cached,
      deduped,
    };
  }

  private async findReadyAsset(input: TtsAssetIdentity): Promise<TtsAssetEntity | null> {
    const cached = await this.ttsAssetRepository.findReady(input);
    if (!cached) return null;
    if (cached.objectUrl && (!cached.objectUrlExpiresAt || cached.objectUrlExpiresAt.getTime() > Date.now() + 60_000)) {
      return cached;
    }
    let refreshedUrl: Awaited<ReturnType<TtsStorageProvider["getObjectUrl"]>>;
    try {
      refreshedUrl = await this.storageProvider.getObjectUrl(cached.objectKey);
    } catch (error) {
      throw new TtsSignedUrlFailedError(toErrorMessage(error));
    }
    return {
      ...cached,
      objectUrl: refreshedUrl.objectUrl,
      objectUrlExpiresAt: refreshedUrl.objectUrlExpiresAt,
    };
  }

  private async createReadyAsset(input: {
    userId: string;
    messageId: string;
    provider: string;
    voiceCode: string;
    languageCode: string;
    sourceKey: TtsSourceKey;
    sourceText: string;
    sourceTextHash: string;
  }, timings: TtsPhaseTimings): Promise<TtsGenerationResult> {
    const cacheLookupStartedAt = Date.now();
    let cached: TtsAssetEntity | null;
    try {
      cached = await this.findReadyAsset(input);
    } finally {
      timings.cacheLookupMs += Date.now() - cacheLookupStartedAt;
    }
    if (cached) return { asset: cached, cacheHit: true, deduped: false };

    const sentenceSegments = segmentLearningSentences({
      text: input.sourceText,
      languageCode: input.languageCode,
      minSegmentChars: 1,
    });
    const synthesize = async () => {
      const synthesisStartedAt = Date.now();
      try {
        return await withRetry(
          () => this.ttsProvider.synthesize({
            text: input.sourceText,
            languageCode: input.languageCode,
            voiceCode: input.voiceCode,
            sentenceSegments,
          }),
          readPositiveInt(process.env.TTS_SYNTHESIS_MAX_ATTEMPTS, 2)
        );
      } finally {
        timings.synthesisMs += Date.now() - synthesisStartedAt;
      }
    };
    const governedStartedAt = Date.now();
    const synthesisBefore = timings.synthesisMs;
    let synthesized: Awaited<ReturnType<TtsProvider["synthesize"]>>;
    try {
      synthesized = this.resourceGovernor
        ? await this.resourceGovernor.executeConcurrency("tts", input.userId, synthesize)
        : await synthesize();
    } finally {
      const synthesisElapsed = timings.synthesisMs - synthesisBefore;
      timings.queueWaitMs += Math.max(0, Date.now() - governedStartedAt - synthesisElapsed);
    }
    const objectKey = buildObjectKey({
      userId: input.userId,
      messageId: input.messageId,
      provider: input.provider,
      voiceCode: input.voiceCode,
      sourceKey: input.sourceKey,
      sourceTextHash: input.sourceTextHash,
      format: synthesized.format,
    });
    const storageStartedAt = Date.now();
    let uploaded: Awaited<ReturnType<TtsStorageProvider["upload"]>>;
    try {
      uploaded = await withRetry(
        () => this.storageProvider.upload({
          key: objectKey,
          body: synthesized.audio,
          contentType: synthesized.contentType,
        }),
        readPositiveInt(process.env.TTS_STORAGE_MAX_ATTEMPTS, 2)
      );
    } finally {
      timings.storageMs += Date.now() - storageStartedAt;
    }
    const persistenceStartedAt = Date.now();
    let asset: TtsAssetEntity;
    try {
      asset = await this.ttsAssetRepository.createReady({
        userId: input.userId,
        messageId: input.messageId,
        provider: input.provider,
        voiceCode: input.voiceCode,
        languageCode: input.languageCode,
        sourceKey: input.sourceKey,
        sourceText: input.sourceText,
        sourceTextHash: input.sourceTextHash,
        format: synthesized.format,
        objectKey: uploaded.objectKey,
        objectUrl: uploaded.objectUrl,
        objectUrlExpiresAt: uploaded.objectUrlExpiresAt,
        durationMs: synthesized.durationMs,
        wordMarks: synthesized.wordMarks,
        sentenceMarks: synthesized.sentenceMarks,
      });
    } finally {
      timings.persistenceMs += Date.now() - persistenceStartedAt;
    }
    return { asset, cacheHit: false, deduped: false };
  }

  private async createReadyAssetWithLock(input: {
    userId: string;
    messageId: string;
    provider: string;
    voiceCode: string;
    languageCode: string;
    sourceKey: TtsSourceKey;
    sourceText: string;
    sourceTextHash: string;
  }, timings: TtsPhaseTimings): Promise<TtsGenerationResult> {
    if (!this.redisClient) {
      return this.createReadyAsset(input, timings);
    }

    const lockKey = `lock:tts:generation:${sha256(buildGenerationLockKey(input))}`;
    const lockValue = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const deadline = Date.now() + TTS_GENERATION_LOCK_WAIT_MS;

    while (Date.now() <= deadline) {
      const lockAttemptStartedAt = Date.now();
      const locked = await (this.redisClient.set as any)(
        lockKey,
        lockValue,
        "NX",
        "PX",
        TTS_GENERATION_LOCK_TTL_MS
      );
      timings.lockWaitMs += Date.now() - lockAttemptStartedAt;
      if (locked === "OK") {
        try {
          return await this.createReadyAsset(input, timings);
        } finally {
          await this.releaseGenerationLock(lockKey, lockValue);
        }
      }

      const cacheLookupStartedAt = Date.now();
      let cached: TtsAssetEntity | null;
      try {
        cached = await this.findReadyAsset(input);
      } finally {
        timings.cacheLookupMs += Date.now() - cacheLookupStartedAt;
      }
      if (cached) {
        return { asset: cached, cacheHit: false, deduped: true };
      }
      const sleepStartedAt = Date.now();
      await sleep(TTS_GENERATION_LOCK_POLL_MS);
      timings.lockWaitMs += Date.now() - sleepStartedAt;
    }

    const cacheLookupStartedAt = Date.now();
    let cached: TtsAssetEntity | null;
    try {
      cached = await this.findReadyAsset(input);
    } finally {
      timings.cacheLookupMs += Date.now() - cacheLookupStartedAt;
    }
    if (cached) {
      return { asset: cached, cacheHit: false, deduped: true };
    }
    throw new TtsGenerationInProgressError();
  }

  private async releaseGenerationLock(lockKey: string, lockValue: string): Promise<void> {
    if (!this.redisClient) return;
    try {
      await this.redisClient.eval(
        `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        end
        return 0
        `,
        1,
        lockKey,
        lockValue
      );
    } catch (error) {
      console.error("[tts] release generation lock failed", {
        lockKey,
        errorMessage: toErrorMessage(error),
      });
    }
  }

  private queueRequestLog(input: Parameters<TtsRequestLogRepository["create"]>[0]): void {
    if (!this.ttsRequestLogRepository) return;
    void this.ttsRequestLogRepository.create(input).catch((error) => {
      console.error("[tts] write request log failed", error);
    });
  }
}

function createTtsPhaseTimings(): TtsPhaseTimings {
  return {
    preparationMs: 0,
    cacheLookupMs: 0,
    lockWaitMs: 0,
    queueWaitMs: 0,
    synthesisMs: 0,
    storageMs: 0,
    persistenceMs: 0,
  };
}

function extractTtsLearningText(rawText: string, sourceKey: TtsSourceKey): string {
  if (sourceKey === "reply") {
    return extractTagContent(rawText, "reply").trim();
  }

  const rewrite = extractTagContent(rawText, "rewrite").trim() || extractTagContent(rawText, "en").trim();
  if (sourceKey === "full") {
    const fallbackRewrite = rewrite || (hasKnownRewriteTag(rawText) ? "" : rawText.trim());
    const reply = extractTagContent(rawText, "reply").trim();
    return [fallbackRewrite, reply].filter(Boolean).join("\n\n");
  }
  if (rewrite) return rewrite;

  return hasKnownRewriteTag(rawText) ? "" : rawText;
}

function extractTagContent(text: string, tag: "rewrite" | "reply" | "en"): string {
  const pattern = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, "i");
  return pattern.exec(text)?.[1] ?? "";
}

function hasKnownRewriteTag(text: string): boolean {
  return /<\/?(rewrite|note|reply|en|zh|cn)>/i.test(text);
}

type RequestedTextRange = {
  textStart: number;
  textEnd: number;
};

function resolveRequestedRange(
  input: { textStart?: number; textEnd?: number },
  sourceTextLength: number
): RequestedTextRange | null {
  if (input.textStart === undefined && input.textEnd === undefined) return null;
  if (input.textStart === undefined || input.textEnd === undefined) throw new TtsRangeInvalidError();
  const textStart = input.textStart;
  const textEnd = input.textEnd;
  if (
    !Number.isInteger(textStart) ||
    !Number.isInteger(textEnd) ||
    textStart < 0 ||
    textEnd <= textStart ||
    textEnd > sourceTextLength
  ) {
    throw new TtsRangeInvalidError();
  }
  return { textStart, textEnd };
}

function resolvePlaybackRange(
  asset: Pick<TtsAssetEntity, "durationMs" | "sentenceMarks" | "wordMarks">,
  requestedRange: RequestedTextRange | null
): TtsPlaybackRange | null {
  if (!requestedRange || !asset.durationMs) return null;
  const { textStart, textEnd } = requestedRange;
  const sentenceMark = asset.sentenceMarks?.find((mark) =>
    mark.textStart === textStart && mark.textEnd === textEnd
  );
  if (sentenceMark) {
    return clampPlaybackRange({
      startMs: sentenceMark.startMs,
      endMs: sentenceMark.startMs + sentenceMark.durationMs,
      durationMs: asset.durationMs,
    });
  }

  const wordMarks = asset.wordMarks?.filter((mark) =>
    typeof mark.textStart === "number" &&
    typeof mark.textEnd === "number" &&
    mark.textEnd > textStart &&
    mark.textStart < textEnd
  ) ?? [];
  if (wordMarks.length > 0) {
    const first = wordMarks[0];
    const last = wordMarks[wordMarks.length - 1];
    return clampPlaybackRange({
      startMs: first.startMs,
      endMs: last.startMs + last.durationMs,
      durationMs: asset.durationMs,
    });
  }

  const sourceLength = Math.max(
    1,
    ...(asset.sentenceMarks ?? []).map((mark) => mark.textEnd),
    textEnd
  );
  return clampPlaybackRange({
    startMs: Math.round(textStart / sourceLength * asset.durationMs),
    endMs: Math.round(textEnd / sourceLength * asset.durationMs),
    durationMs: asset.durationMs,
  });
}

function clampPlaybackRange(input: { startMs: number; endMs: number; durationMs: number }): TtsPlaybackRange {
  const startMs = Math.max(0, Math.floor(input.startMs));
  const endMs = Math.min(input.durationMs, Math.ceil(input.endMs));
  return {
    startMs,
    endMs: Math.max(startMs, endMs),
  };
}

function buildObjectKey(input: {
  userId: string;
  messageId: string;
  provider: string;
  voiceCode: string;
  sourceKey: string;
  sourceTextHash: string;
  format: string;
}): string {
  return [
    "tts",
    safePathPart(input.userId),
    safePathPart(input.messageId),
    safePathPart(input.provider),
    safePathPart(input.voiceCode),
    safePathPart(input.sourceKey),
    `${input.sourceTextHash}.${input.format}`,
  ].join("/");
}

function buildGenerationLockKey(input: TtsAssetIdentity): string {
  return [
    input.messageId,
    input.provider,
    input.voiceCode,
    input.languageCode,
    input.sourceKey,
    input.sourceTextHash,
  ].join("|");
}

function resolveVoiceCode(input: {
  provider: string;
  languageCode: string;
  preferredVoiceCode: string | null;
}): string {
  if (
    input.preferredVoiceCode &&
    isConfiguredTtsVoice({
      provider: input.provider,
      languageCode: input.languageCode,
      voiceCode: input.preferredVoiceCode,
    })
  ) {
    return input.preferredVoiceCode;
  }
  return resolveDefaultTtsVoice(input.languageCode, input.provider);
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      await sleep(Math.min(1000 * attempt, 3000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getTtsRequestErrorCode(error: unknown): string {
  if (error instanceof TtsSignedUrlFailedError) return error.code;
  if (error instanceof TtsGenerationInProgressError) return error.code;
  return "TTS_SYNTHESIS_FAILED";
}

function safePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
