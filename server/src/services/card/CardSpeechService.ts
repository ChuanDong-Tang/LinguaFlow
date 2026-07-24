import { createHash, randomUUID } from "node:crypto";
import type { CardRepository, CardSpeechAssetEntity } from "@lf/core/ports/repository/CardRepository.js";
import type { UserPreferenceRepository } from "@lf/core/ports/repository/UserPreferenceRepository.js";
import { normalizeLearningText } from "@lf/core/text/learningText.js";
import { countGraphemes, isUtf16GraphemeBoundary } from "@lf/core/text/grapheme.js";
import type { EntitlementService } from "../entitlement/EntitlementService.js";
import type { TtsProvider } from "../tts/TtsProvider.js";
import type { TtsStorageProvider } from "../tts/TtsStorageProvider.js";
import { resolveDefaultTtsVoice } from "../tts/TtsVoiceCatalog.js";
import { CardNotFoundError, CardValidationError } from "./CardService.js";
import type { RedisClient } from "../../infrastructure/redis/redisClient.js";

export class CardSpeechProRequiredError extends Error {
  readonly code = "PRO_REQUIRED";
}
export class CardSpeechGenerationInProgressError extends Error {
  readonly code = "TTS_GENERATION_IN_PROGRESS";
}

export type CardSpeechAssetView = {
  id: string;
  entryId: string;
  segmentId: string;
  audioUrl: string;
  audioUrlExpiresAt: string | null;
  durationMs: number | null;
  wordMarks: unknown;
  sentenceMarks: unknown;
  cached: boolean;
};

const generations = new Map<string, Promise<CardSpeechAssetEntity>>();
type GenerateInput = {
  userId: string;
  entryId: string | null;
  segmentId: string | null;
  sourceKind: "review_segment" | "dictation_sentence" | "dictionary_term";
  cacheKey: string;
  provider: string;
  voiceCode: string;
  languageCode: string;
  sourceText: string;
  sourceTextHash: string;
};

export class CardSpeechService {
  constructor(
    private readonly repository: CardRepository,
    private readonly preferenceRepository: UserPreferenceRepository,
    private readonly entitlementService: EntitlementService,
    private readonly provider: TtsProvider,
    private readonly storage: TtsStorageProvider,
    private readonly redisClient?: RedisClient | null,
  ) {}

  async getOrCreateSegment(input: {
    userId: string;
    entryId: string;
    segmentId: string;
    sourceKind?: "review_segment" | "dictation_sentence";
    startUtf16?: number;
    endUtf16?: number;
  }): Promise<CardSpeechAssetView> {
    const entitlement = await this.entitlementService.getCurrentEntitlement(input.userId);
    if (!entitlement.features.highQualityTts) throw new CardSpeechProRequiredError();
    const entry = await this.repository.findByIdForUser(input.entryId, input.userId);
    if (!entry || entry.status !== "completed") throw new CardNotFoundError();
    const segment = entry.segments.find((candidate) => candidate.id === input.segmentId);
    if (!segment) throw new CardNotFoundError();
    const hasRange = input.startUtf16 !== undefined || input.endUtf16 !== undefined;
    if (hasRange && (input.startUtf16 === undefined || input.endUtf16 === undefined)) throw new CardValidationError("Invalid speech range");
    const selectedText = hasRange
      ? (() => {
          if (
            input.startUtf16! >= input.endUtf16! ||
            !isUtf16GraphemeBoundary(segment.text, input.startUtf16!) ||
            !isUtf16GraphemeBoundary(segment.text, input.endUtf16!)
          ) throw new CardValidationError("Invalid speech range");
          return segment.text.slice(input.startUtf16, input.endUtf16);
        })()
      : segment.text;
    const sourceText = normalizeLearningText({ text: selectedText, languageCode: entry.languageCode });
    const sourceKind = input.sourceKind ?? "review_segment";
    const maxChars = sourceKind === "dictation_sentence" ? 300 : 800;
    if (!sourceText || countGraphemes(sourceText) > maxChars) throw new CardValidationError("Invalid speech segment");
    const preference = await this.preferenceRepository.getByUserId(input.userId);
    const provider = this.provider.providerName;
    const voiceCode = preference.ttsVoiceCode || resolveDefaultTtsVoice(entry.languageCode, provider);
    const sourceTextHash = sha256(`card-tts-v1\n${sourceText}`);
    const cacheKey = sha256([
      input.userId,
      input.entryId,
      input.segmentId,
      sourceKind,
      provider,
      voiceCode,
      entry.languageCode,
      sourceTextHash,
    ].join("\n"));
    const cached = await this.repository.findReadySpeechAsset(cacheKey);
    if (cached) return this.toView(await this.refreshUrlIfNeeded(cached), true);
    const existing = generations.get(cacheKey);
    if (existing) return this.toView(await existing, true);
    const generation = this.generateWithLock({
      userId: input.userId,
      entryId: input.entryId,
      segmentId: input.segmentId,
      sourceKind,
      cacheKey,
      provider,
      voiceCode,
      languageCode: entry.languageCode,
      sourceText,
      sourceTextHash,
    });
    generations.set(cacheKey, generation);
    try { return this.toView(await generation, false); }
    finally { if (generations.get(cacheKey) === generation) generations.delete(cacheKey); }
  }

  async getOrCreateSelection(input: {
    userId: string;
    entryId: string;
    segmentId: string;
    startUtf16: number;
    endUtf16: number;
  }): Promise<CardSpeechAssetView> {
    const entitlement = await this.entitlementService.getCurrentEntitlement(input.userId);
    if (!entitlement.features.highQualityTts) throw new CardSpeechProRequiredError();
    const entry = await this.repository.findByIdForUser(input.entryId, input.userId);
    if (!entry || entry.status !== "completed") throw new CardNotFoundError();
    const segment = entry.segments.find((candidate) => candidate.id === input.segmentId);
    if (!segment) throw new CardNotFoundError();
    if (
      input.startUtf16 >= input.endUtf16 ||
      !isUtf16GraphemeBoundary(segment.text, input.startUtf16) ||
      !isUtf16GraphemeBoundary(segment.text, input.endUtf16)
    ) throw new CardValidationError("Invalid speech selection");
    const selected = segment.text.slice(input.startUtf16, input.endUtf16);
    if (!selected.trim() || countGraphemes(selected) > 100) throw new CardValidationError("选区需要包含 1 到 100 个字符");
    const sourceText = normalizeLearningText({ text: selected, languageCode: entry.languageCode });
    const preference = await this.preferenceRepository.getByUserId(input.userId);
    const provider = this.provider.providerName;
    const voiceCode = preference.ttsVoiceCode || resolveDefaultTtsVoice(entry.languageCode, provider);
    const sourceTextHash = sha256(`card-selection-tts-v1\n${sourceText}`);
    const cacheKey = sha256([
      input.userId,
      "selection",
      provider,
      voiceCode,
      entry.languageCode,
      sourceTextHash,
    ].join("\n"));
    const context = { entryId: input.entryId, segmentId: input.segmentId };
    const cached = await this.repository.findReadySpeechAsset(cacheKey);
    if (cached) return this.toView(await this.refreshUrlIfNeeded(cached), true, context);
    const existing = generations.get(cacheKey);
    if (existing) return this.toView(await existing, true, context);
    const generation = this.generateWithLock({
      userId: input.userId,
      entryId: null,
      segmentId: null,
      sourceKind: "dictionary_term",
      cacheKey,
      provider,
      voiceCode,
      languageCode: entry.languageCode,
      sourceText,
      sourceTextHash,
    });
    generations.set(cacheKey, generation);
    try { return this.toView(await generation, false, context); }
    finally { if (generations.get(cacheKey) === generation) generations.delete(cacheKey); }
  }

  private async generateWithLock(input: GenerateInput): Promise<CardSpeechAssetEntity> {
    if (!this.redisClient) return this.generate(input);
    const lockKey = `lock:tts:card:${input.cacheKey}`;
    const lockValue = `${process.pid}:${Date.now()}:${randomUUID()}`;
    const deadline = Date.now() + 120_000;
    while (Date.now() <= deadline) {
      const locked = await (this.redisClient.set as any)(lockKey, lockValue, "NX", "PX", 120_000);
      if (locked === "OK") {
        try {
          const cached = await this.repository.findReadySpeechAsset(input.cacheKey);
          if (cached) return this.refreshUrlIfNeeded(cached);
          return await this.generate(input);
        } finally {
          await this.redisClient.eval(
            `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end return 0`,
            1,
            lockKey,
            lockValue,
          ).catch(() => undefined);
        }
      }
      const cached = await this.repository.findReadySpeechAsset(input.cacheKey);
      if (cached) return this.refreshUrlIfNeeded(cached);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new CardSpeechGenerationInProgressError();
  }

  private async generate(input: GenerateInput): Promise<CardSpeechAssetEntity> {
    const synthesized = await this.provider.synthesize({
      text: input.sourceText,
      languageCode: input.languageCode,
      voiceCode: input.voiceCode,
      sentenceSegments: [{ text: input.sourceText, textStart: 0, textEnd: input.sourceText.length }],
    });
    const generationId = randomUUID();
    const objectKey = input.entryId
      ? `tts/card/${input.userId}/${input.entryId}/${input.cacheKey}-${generationId}.mp3`
      : `tts/card/${input.userId}/selections/${input.cacheKey}-${generationId}.mp3`;
    const uploaded = await this.storage.upload({ key: objectKey, body: synthesized.audio, contentType: synthesized.contentType });
    return this.repository.saveReadySpeechAsset({
      userId: input.userId,
      entryId: input.entryId,
      segmentId: input.segmentId,
      sourceKind: input.sourceKind,
      cacheKey: input.cacheKey,
      provider: input.provider,
      voiceCode: input.voiceCode,
      languageCode: input.languageCode,
      sourceText: input.sourceText,
      sourceTextHash: input.sourceTextHash,
      objectKey,
      objectUrl: uploaded.objectUrl,
      objectUrlExpiresAt: uploaded.objectUrlExpiresAt,
      durationMs: synthesized.durationMs,
      wordMarks: synthesized.wordMarks,
      sentenceMarks: synthesized.sentenceMarks,
    });
  }

  private async refreshUrlIfNeeded(asset: CardSpeechAssetEntity): Promise<CardSpeechAssetEntity> {
    if (asset.objectUrl && (!asset.objectUrlExpiresAt || asset.objectUrlExpiresAt.getTime() > Date.now() + 60_000)) return asset;
    const signed = await this.storage.getObjectUrl(asset.objectKey);
    return this.repository.updateSpeechAssetUrl(asset.id, signed.objectUrl, signed.objectUrlExpiresAt);
  }

  private toView(
    asset: CardSpeechAssetEntity,
    cached: boolean,
    context?: { entryId: string; segmentId: string },
  ): CardSpeechAssetView {
    const entryId = asset.entryId ?? context?.entryId;
    const segmentId = asset.segmentId ?? context?.segmentId;
    if (!entryId || !segmentId || !asset.objectUrl) throw new Error("CARD_TTS_SIGNED_URL_FAILED");
    return {
      id: asset.id,
      entryId,
      segmentId,
      audioUrl: asset.objectUrl,
      audioUrlExpiresAt: asset.objectUrlExpiresAt?.toISOString() ?? null,
      durationMs: asset.durationMs,
      wordMarks: asset.wordMarks,
      sentenceMarks: asset.sentenceMarks,
      cached,
    };
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
