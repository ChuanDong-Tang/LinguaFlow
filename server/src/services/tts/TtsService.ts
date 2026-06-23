import { createHash } from "node:crypto";
import type { MessageRepository } from "@lf/core/ports/repository/MessageRepository.js";
import type { TtsAssetEntity, TtsAssetRepository, TtsSourceKey } from "@lf/core/ports/repository/TtsAssetRepository.js";
import type { TtsRequestLogRepository } from "@lf/core/ports/repository/TtsRequestLogRepository.js";
import type { UserPreferenceRepository } from "@lf/core/ports/repository/UserPreferenceRepository.js";
import { normalizeLearningText, segmentLearningSentences } from "@lf/core/text/learningText.js";
import type { RedisClient } from "../../infrastructure/redis/redisClient.js";
import type { EntitlementService } from "../entitlement/EntitlementService.js";
import type { TtsProvider } from "./TtsProvider.js";
import type { TtsStorageProvider } from "./TtsStorageProvider.js";
import { isConfiguredTtsVoice, listTtsVoiceOptions, resolveDefaultTtsVoice } from "./TtsVoiceCatalog.js";

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

const ttsGenerationLocks = new Map<string, Promise<TtsGenerationResult>>();
const TTS_GENERATION_LOCK_TTL_MS = readPositiveInt(process.env.TTS_GENERATION_LOCK_TTL_MS, 120_000);
const TTS_GENERATION_LOCK_WAIT_MS = readPositiveInt(process.env.TTS_GENERATION_LOCK_WAIT_MS, 120_000);
const TTS_GENERATION_LOCK_POLL_MS = readPositiveInt(process.env.TTS_GENERATION_LOCK_POLL_MS, 500);

export class TtsService {
  constructor(
    private readonly messageRepository: MessageRepository,
    private readonly userPreferenceRepository: UserPreferenceRepository,
    private readonly ttsAssetRepository: TtsAssetRepository,
    private readonly entitlementService: EntitlementService,
    private readonly ttsProvider: TtsProvider,
    private readonly storageProvider: TtsStorageProvider,
    private readonly ttsRequestLogRepository?: TtsRequestLogRepository,
    private readonly redisClient?: RedisClient | null
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
    const entitlement = await this.entitlementService.getCurrentEntitlement(input.userId);
    if (!entitlement.isPro) throw new TtsProRequiredError();

    const message = await this.messageRepository.findById(input.messageId);
    if (!message || message.userId !== input.userId || message.status !== "success") {
      throw new TtsAccessDeniedError();
    }

    const preference = await this.userPreferenceRepository.getByUserId(input.userId);
    const languageCode = message.languageCode ?? preference.learningLanguage;
    const sourceKey = input.sourceKey ?? "rewrite";
    const sourceText = resolveSourceText(message.content, languageCode, sourceKey);
    if (!sourceText) throw new TtsSourceTextEmptyError();
    const requestedRange = resolveRequestedRange(input, sourceText.length);
    const sourceTextHash = sha256(sourceText);
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
    let cached: TtsAssetEntity | null;
    try {
      cached = await this.findReadyAsset(assetIdentity);
    } catch (error) {
      await this.writeRequestLog({
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
        errorCode: getTtsRequestErrorCode(error),
        errorMessage: toErrorMessage(error),
      });
      throw error;
    }
    if (cached) {
      await this.writeRequestLog({
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
      });
      return this.toView(cached, true, false, requestedRange);
    }

    const lockKey = buildGenerationLockKey(assetIdentity);
    const existingGeneration = ttsGenerationLocks.get(lockKey);
    if (existingGeneration) {
      try {
        const result = await existingGeneration;
        await this.writeRequestLog({
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
        });
        return this.toView(result.asset, result.cacheHit, true, requestedRange);
      } catch (error) {
        await this.writeRequestLog({
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
    });
    ttsGenerationLocks.set(lockKey, generation);
    try {
      const result = await generation;
      await this.writeRequestLog({
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
      });
      return this.toView(result.asset, result.cacheHit, result.deduped, requestedRange);
    } catch (error) {
      if (error instanceof TtsSignedUrlFailedError) {
        await this.writeRequestLog({
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
          errorCode: error.code,
          errorMessage: error.message,
        });
        throw error;
      }
      if (error instanceof TtsGenerationInProgressError) {
        await this.writeRequestLog({
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
          errorCode: error.code,
          errorMessage: error.message,
        });
        throw error;
      }
      const errorMessage = toErrorMessage(error);
      const failed = await this.ttsAssetRepository.createFailed({
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
      await this.writeRequestLog({
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
  }): Promise<TtsGenerationResult> {
    const cached = await this.findReadyAsset(input);
    if (cached) return { asset: cached, cacheHit: true, deduped: false };

    const sentenceSegments = segmentLearningSentences({
      text: input.sourceText,
      languageCode: input.languageCode,
      minSegmentChars: 1,
    });
    const synthesized = await withRetry(
      () => this.ttsProvider.synthesize({
        text: input.sourceText,
        languageCode: input.languageCode,
        voiceCode: input.voiceCode,
        sentenceSegments,
      }),
      readPositiveInt(process.env.TTS_SYNTHESIS_MAX_ATTEMPTS, 2)
    );
    const objectKey = buildObjectKey({
      userId: input.userId,
      messageId: input.messageId,
      provider: input.provider,
      voiceCode: input.voiceCode,
      sourceKey: input.sourceKey,
      sourceTextHash: input.sourceTextHash,
      format: synthesized.format,
    });
    const uploaded = await withRetry(
      () => this.storageProvider.upload({
        key: objectKey,
        body: synthesized.audio,
        contentType: synthesized.contentType,
      }),
      readPositiveInt(process.env.TTS_STORAGE_MAX_ATTEMPTS, 2)
    );
    const asset = await this.ttsAssetRepository.createReady({
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
  }): Promise<TtsGenerationResult> {
    if (!this.redisClient) {
      return this.createReadyAsset(input);
    }

    const lockKey = `lock:tts:generation:${sha256(buildGenerationLockKey(input))}`;
    const lockValue = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const deadline = Date.now() + TTS_GENERATION_LOCK_WAIT_MS;

    while (Date.now() <= deadline) {
      const locked = await (this.redisClient.set as any)(
        lockKey,
        lockValue,
        "NX",
        "PX",
        TTS_GENERATION_LOCK_TTL_MS
      );
      if (locked === "OK") {
        try {
          return await this.createReadyAsset(input);
        } finally {
          await this.releaseGenerationLock(lockKey, lockValue);
        }
      }

      const cached = await this.findReadyAsset(input);
      if (cached) {
        return { asset: cached, cacheHit: false, deduped: true };
      }
      await sleep(TTS_GENERATION_LOCK_POLL_MS);
    }

    const cached = await this.findReadyAsset(input);
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

  private async writeRequestLog(input: Parameters<TtsRequestLogRepository["create"]>[0]): Promise<void> {
    if (!this.ttsRequestLogRepository) return;
    try {
      await this.ttsRequestLogRepository.create(input);
    } catch (error) {
      console.error("[tts] write request log failed", error);
    }
  }
}

function resolveSourceText(
  rawText: string,
  languageCode: string,
  sourceKey: TtsSourceKey
): string {
  const base = extractTtsLearningText(rawText, sourceKey);
  return normalizeLearningText({ text: base, languageCode });
}

function extractTtsLearningText(rawText: string, sourceKey: TtsSourceKey): string {
  if (sourceKey === "reply") {
    return extractTagContent(rawText, "reply").trim();
  }

  const rewrite = extractTagContent(rawText, "rewrite").trim() || extractTagContent(rawText, "en").trim();
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
    return padPlaybackRange({
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
    return padPlaybackRange({
      startMs: first.startMs,
      endMs: last.startMs + last.durationMs,
      durationMs: asset.durationMs,
    });
  }

  const overlappingSentence = asset.sentenceMarks?.find((mark) =>
    mark.textEnd > textStart && mark.textStart < textEnd
  );
  if (overlappingSentence) {
    return padPlaybackRange({
      startMs: overlappingSentence.startMs,
      endMs: overlappingSentence.startMs + overlappingSentence.durationMs,
      durationMs: asset.durationMs,
    });
  }

  const sourceLength = Math.max(
    1,
    ...(asset.sentenceMarks ?? []).map((mark) => mark.textEnd),
    textEnd
  );
  return padPlaybackRange({
    startMs: Math.round(textStart / sourceLength * asset.durationMs),
    endMs: Math.round(textEnd / sourceLength * asset.durationMs),
    durationMs: asset.durationMs,
  });
}

function padPlaybackRange(input: { startMs: number; endMs: number; durationMs: number }): TtsPlaybackRange {
  const startMs = Math.max(0, Math.floor(input.startMs - 80));
  const endMs = Math.min(input.durationMs, Math.ceil(input.endMs + 120));
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
