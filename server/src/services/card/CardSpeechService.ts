import { createHash, randomUUID } from "node:crypto";
import type { CardRepository, CardSpeechAssetEntity, CardLearningContentType, CardEntryEntity } from "@lf/core/ports/repository/CardRepository.js";
import type { UserPreferenceRepository } from "@lf/core/ports/repository/UserPreferenceRepository.js";
import { inferLearningTextLanguage, normalizeLearningText } from "@lf/core/text/learningText.js";
import { countGraphemes, isUtf16GraphemeBoundary } from "@lf/core/text/grapheme.js";
import { DEFAULT_CARD_CONTENT_MAX_CHARS } from "@lf/core/text/cardText.js";
import type { EntitlementService } from "../entitlement/EntitlementService.js";
import type { SynthesizeSpeechResult, TtsProvider } from "../tts/TtsProvider.js";
import type { TtsStorageProvider } from "../tts/TtsStorageProvider.js";
import { isConfiguredTtsVoice, resolveDefaultTtsVoice } from "../tts/TtsVoiceCatalog.js";
import { CardNotFoundError, CardValidationError } from "./CardService.js";
import type { RedisClient } from "../../infrastructure/redis/redisClient.js";
import type { ResourceGovernor } from "../resource/ResourceGovernor.js";
import { segmentLearningSentences } from "../text/learningSentenceSegmenter.js";

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
  provider: string;
  voiceCode: string;
  audioUrl: string;
  audioUrlExpiresAt: string | null;
  durationMs: number | null;
  wordMarks: unknown;
  sentenceMarks: unknown;
  cached: boolean;
};

const generations = new Map<string, Promise<CardSpeechAssetEntity>>();
export type CardSpeechGenerateInput = {
  userId: string;
  entryId: string | null;
  segmentId: string | null;
  sourceKind: "review_segment" | "review_article" | "dictation_sentence" | "dictionary_term";
  cacheKey: string;
  provider: string;
  voiceCode: string;
  languageCode: string;
  sourceText: string;
  sourceTextHash: string;
  sentenceSegments?: Array<{ text: string; textStart: number; textEnd: number }>;
};

export type PreparedCardArticleSpeech = {
  cached: CardSpeechAssetView | null;
  generation: CardSpeechGenerateInput;
  graphemeCount: number;
};

export class CardSpeechService {
  constructor(
    private readonly repository: CardRepository,
    private readonly preferenceRepository: UserPreferenceRepository,
    private readonly entitlementService: EntitlementService,
    private readonly provider: TtsProvider,
    private readonly storage: TtsStorageProvider,
    private readonly redisClient?: RedisClient | null,
    private readonly resourceGovernor?: ResourceGovernor,
    private readonly articleMaxChars = DEFAULT_CARD_CONTENT_MAX_CHARS,
  ) {}

  async getOrCreateSegment(input: {
    userId: string;
    entryId: string;
    segmentId: string;
    sourceKind?: "review_segment" | "dictation_sentence";
    startUtf16?: number;
    endUtf16?: number;
    contentType?: CardLearningContentType;
    contentVersion?: string;
  }): Promise<CardSpeechAssetView> {
    const entry = await this.repository.findByIdForUser(input.entryId, input.userId);
    if (!entry || entry.status !== "completed") throw new CardNotFoundError();
    const binding = resolveSpeechBinding(input.contentType, input.contentVersion);
    const entitlement = await this.entitlementService.getCurrentEntitlement(input.userId);
    const effectiveContentType = binding?.contentType ?? (entry.rewrittenText ? "rewrite" : "original");
    if (input.sourceKind === "dictation_sentence" && !entitlement.isPro) throw new CardSpeechProRequiredError();
    if (effectiveContentType === "original" && !entitlement.isPro) throw new CardSpeechProRequiredError();
    const segment = binding
      ? entry.contentSegments.find((candidate) => candidate.id === input.segmentId && candidate.contentType === binding.contentType && candidate.contentVersion === binding.contentVersion)
      : entry.segments.find((candidate) => candidate.id === input.segmentId);
    if (!segment) throw new CardNotFoundError();
    const languageCode = binding ? contentLanguageCode(entry, binding.contentType) : entry.languageCode;
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
    const sourceText = normalizeLearningText({ text: selectedText, languageCode });
    const sourceKind = input.sourceKind ?? "review_segment";
    const maxChars = sourceKind === "dictation_sentence" ? 300 : 800;
    if (!sourceText || countGraphemes(sourceText) > maxChars) throw new CardValidationError("Invalid speech segment");
    const preference = await this.preferenceRepository.getByUserId(input.userId);
    const provider = this.provider.providerName;
    const voiceCode = preference.ttsVoiceCode && isConfiguredTtsVoice({ provider, languageCode, voiceCode: preference.ttsVoiceCode })
      ? preference.ttsVoiceCode
      : resolveDefaultTtsVoice(languageCode, provider);
    const sourceTextHash = sha256(`card-tts-v1\n${sourceText}`);
    const cacheKey = sha256([
      input.userId,
      input.entryId,
      input.segmentId,
      binding?.contentType ?? "legacy",
      binding?.contentVersion ?? "legacy",
      sourceKind,
      provider,
      voiceCode,
      languageCode,
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
      languageCode,
      sourceText,
      sourceTextHash,
    });
    generations.set(cacheKey, generation);
    try { return this.toView(await generation, false); }
    finally { if (generations.get(cacheKey) === generation) generations.delete(cacheKey); }
  }

  async getOrCreateArticle(input: { userId: string; entryId: string; contentType: CardLearningContentType; contentVersion: string }): Promise<CardSpeechAssetView> {
    const prepared = await this.prepareArticle(input);
    if (prepared.cached) return prepared.cached;
    const { generation: generationInput } = prepared;
    const context = { entryId: input.entryId, segmentId: "__article__" };
    const existing = generations.get(generationInput.cacheKey);
    if (existing) return this.toView(await existing, true, context);
    const generation = this.generateWithLock(generationInput);
    generations.set(generationInput.cacheKey, generation);
    try { return this.toView(await generation, false, context); }
    finally { if (generations.get(generationInput.cacheKey) === generation) generations.delete(generationInput.cacheKey); }
  }

  async prepareArticle(input: { userId: string; entryId: string; contentType: CardLearningContentType; contentVersion: string }): Promise<PreparedCardArticleSpeech> {
    const entry = await this.repository.findByIdForUser(input.entryId, input.userId);
    if (!entry || entry.status !== "completed") throw new CardNotFoundError();
    const entitlement = await this.entitlementService.getCurrentEntitlement(input.userId);
    if (input.contentType === "original" && !entitlement.isPro) throw new CardSpeechProRequiredError();
    const segments = entry.contentSegments
      .filter((segment) => segment.contentType === input.contentType && segment.contentVersion === input.contentVersion)
      .sort((left, right) => left.ordinal - right.ordinal);
    if (!segments.length) throw new CardNotFoundError();
    const languageCode = contentLanguageCode(entry, input.contentType);
    const learningText = segments.map((segment) => segment.text.trim()).filter(Boolean).join(" ");
    const sourceText = normalizeLearningText({ text: learningText, languageCode });
    const graphemeCount = countGraphemes(sourceText);
    if (!sourceText || graphemeCount > this.articleMaxChars) throw new CardValidationError("Article speech is too long");
    const preference = await this.preferenceRepository.getByUserId(input.userId);
    const provider = this.provider.providerName;
    const voiceCode = preference.ttsVoiceCode && isConfiguredTtsVoice({ provider, languageCode, voiceCode: preference.ttsVoiceCode })
      ? preference.ttsVoiceCode
      : resolveDefaultTtsVoice(languageCode, provider);
    const sourceTextHash = sha256(`card-article-tts-v1\n${sourceText}`);
    const cacheKey = sha256([input.userId, input.entryId, input.contentType, input.contentVersion, "review_article", provider, voiceCode, languageCode, sourceTextHash].join("\n"));
    const context = { entryId: input.entryId, segmentId: "__article__" };
    const cached = await this.repository.findReadySpeechAsset(cacheKey);
    return {
      cached: cached ? this.toView(await this.refreshUrlIfNeeded(cached), true, context) : null,
      graphemeCount,
      generation: {
        userId: input.userId,
        entryId: input.entryId,
        segmentId: null,
        sourceKind: "review_article",
        cacheKey,
        provider,
        voiceCode,
        languageCode,
        sourceText,
        sourceTextHash,
        sentenceSegments: segmentLearningSentences({ text: sourceText, languageCode, minSegmentChars: 1 }),
      },
    };
  }

  async generateStreaming(
    input: CardSpeechGenerateInput,
    generationId: string,
    onAudioChunk: (chunk: Buffer) => void,
  ): Promise<{ asset: CardSpeechAssetEntity; synthesis: SynthesizeSpeechResult }> {
    const cached = await this.repository.findReadySpeechAsset(input.cacheKey);
    if (cached) return { asset: await this.refreshUrlIfNeeded(cached), synthesis: emptySynthesisResult() };
    if (!this.provider.synthesizeStreaming) throw new Error("TTS_STREAMING_NOT_SUPPORTED");
    const synthesize = () => this.provider.synthesizeStreaming!({
      text: input.sourceText,
      languageCode: input.languageCode,
      voiceCode: input.voiceCode,
      sentenceSegments: input.sentenceSegments ?? [{ text: input.sourceText, textStart: 0, textEnd: input.sourceText.length }],
    }, { onAudioChunk });
    const synthesized = this.resourceGovernor
      ? await this.resourceGovernor.executeConcurrency("tts", input.userId, synthesize)
      : await synthesize();
    return { asset: await this.persistSynthesis(input, synthesized, generationId), synthesis: synthesized };
  }

  async getOrCreateSelection(input: {
    userId: string;
    entryId: string;
    segmentId: string;
    startUtf16: number;
    endUtf16: number;
    contentType?: CardLearningContentType;
    contentVersion?: string;
  }): Promise<CardSpeechAssetView> {
    const entitlement = await this.entitlementService.getCurrentEntitlement(input.userId);
    if (!entitlement.features.highQualityTts) throw new CardSpeechProRequiredError();
    const entry = await this.repository.findByIdForUser(input.entryId, input.userId);
    if (!entry || entry.status !== "completed") throw new CardNotFoundError();
    const binding = resolveSpeechBinding(input.contentType, input.contentVersion);
    const segment = binding
      ? entry.contentSegments.find((candidate) => candidate.id === input.segmentId && candidate.contentType === binding.contentType && candidate.contentVersion === binding.contentVersion)
      : entry.segments.find((candidate) => candidate.id === input.segmentId);
    if (!segment) throw new CardNotFoundError();
    const languageCode = binding ? contentLanguageCode(entry, binding.contentType) : entry.languageCode;
    if (
      input.startUtf16 >= input.endUtf16 ||
      !isUtf16GraphemeBoundary(segment.text, input.startUtf16) ||
      !isUtf16GraphemeBoundary(segment.text, input.endUtf16)
    ) throw new CardValidationError("Invalid speech selection");
    const selected = segment.text.slice(input.startUtf16, input.endUtf16);
    if (!selected.trim() || countGraphemes(selected) > 100) throw new CardValidationError("选区需要包含 1 到 100 个字符");
    const sourceText = normalizeLearningText({ text: selected, languageCode });
    const preference = await this.preferenceRepository.getByUserId(input.userId);
    const provider = this.provider.providerName;
    const voiceCode = preference.ttsVoiceCode && isConfiguredTtsVoice({ provider, languageCode, voiceCode: preference.ttsVoiceCode })
      ? preference.ttsVoiceCode
      : resolveDefaultTtsVoice(languageCode, provider);
    const sourceTextHash = sha256(`card-selection-tts-v1\n${sourceText}`);
    const cacheKey = sha256([
      input.userId,
      "selection",
      provider,
      voiceCode,
      languageCode,
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
      languageCode,
      sourceText,
      sourceTextHash,
    });
    generations.set(cacheKey, generation);
    try { return this.toView(await generation, false, context); }
    finally { if (generations.get(cacheKey) === generation) generations.delete(cacheKey); }
  }

  async getOrCreateDictionaryTerm(input: { userId: string; term: string; languageCode?: string }): Promise<CardSpeechAssetView> {
    const languageCode = input.languageCode === "ja-JP" ? "ja-JP" : "en-US";
    const sourceText = normalizeLearningText({ text: input.term, languageCode });
    if (!sourceText || countGraphemes(sourceText) > 3_000) throw new CardValidationError("发音内容需要包含 1 到 3000 个字符");
    const preference = await this.preferenceRepository.getByUserId(input.userId);
    const provider = this.provider.providerName;
    const voiceCode = preference.ttsVoiceCode || resolveDefaultTtsVoice(languageCode, provider);
    const sourceTextHash = sha256(`dictionary-term-tts-v1\n${sourceText}`);
    const globallyShareable = isShortDictionaryExpression(sourceText);
    const cacheKey = sha256([
      globallyShareable ? "shared" : input.userId,
      "dictionary-term",
      provider,
      voiceCode,
      languageCode,
      sourceTextHash,
    ].join("\n"));
    const context = { entryId: "dictionary", segmentId: sourceTextHash };
    const cached = await this.repository.findReadySpeechAsset(cacheKey);
    if (cached) return this.toView(await this.refreshUrlIfNeeded(cached), true, context);
    const existing = generations.get(cacheKey);
    if (existing) return this.toView(await existing, true, context);
    const generation = this.generateWithLock({ userId: input.userId, entryId: null, segmentId: null, sourceKind: "dictionary_term", cacheKey, provider, voiceCode, languageCode, sourceText, sourceTextHash });
    generations.set(cacheKey, generation);
    try { return this.toView(await generation, false, context); }
    finally { if (generations.get(cacheKey) === generation) generations.delete(cacheKey); }
  }

  private async generateWithLock(input: CardSpeechGenerateInput): Promise<CardSpeechAssetEntity> {
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

  private async generate(input: CardSpeechGenerateInput): Promise<CardSpeechAssetEntity> {
    const synthesize = () => this.provider.synthesize({
      text: input.sourceText,
      languageCode: input.languageCode,
      voiceCode: input.voiceCode,
      sentenceSegments: input.sentenceSegments ?? [{ text: input.sourceText, textStart: 0, textEnd: input.sourceText.length }],
    });
    const synthesized = this.resourceGovernor
      ? await this.resourceGovernor.executeConcurrency("tts", input.userId, synthesize)
      : await synthesize();
    return this.persistSynthesis(input, synthesized, randomUUID());
  }

  private async persistSynthesis(
    input: CardSpeechGenerateInput,
    synthesized: SynthesizeSpeechResult,
    generationId: string,
  ): Promise<CardSpeechAssetEntity> {
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
      provider: asset.provider,
      voiceCode: asset.voiceCode,
      audioUrl: asset.objectUrl,
      audioUrlExpiresAt: asset.objectUrlExpiresAt?.toISOString() ?? null,
      durationMs: asset.durationMs,
      wordMarks: asset.wordMarks,
      sentenceMarks: asset.sentenceMarks,
      cached,
    };
  }
}

function emptySynthesisResult(): SynthesizeSpeechResult {
  return {
    audio: Buffer.alloc(0),
    format: "mp3",
    contentType: "audio/mpeg",
    durationMs: null,
    wordMarks: [],
    sentenceMarks: [],
  };
}

function resolveSpeechBinding(
  contentType: CardLearningContentType | undefined,
  contentVersion: string | undefined,
): { contentType: CardLearningContentType; contentVersion: string } | null {
  if (contentType === undefined && contentVersion === undefined) return null;
  if ((contentType !== "original" && contentType !== "rewrite" && contentType !== "reply") || !contentVersion) {
    throw new CardValidationError("Invalid content binding");
  }
  return { contentType, contentVersion };
}

function contentLanguageCode(entry: CardEntryEntity, contentType: CardLearningContentType): string {
  if (contentType === "original") return inferLearningTextLanguage(entry.originalText ?? "", entry.appLocaleSnapshot);
  if (contentType === "rewrite") return entry.rewrittenLanguageCode ?? entry.languageCode;
  return entry.replyLanguageCode ?? entry.languageCode;
}

function isShortDictionaryExpression(text: string): boolean {
  if (countGraphemes(text) > 60) return false;
  return text.trim().split(/\s+/u).filter(Boolean).length <= 5;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
