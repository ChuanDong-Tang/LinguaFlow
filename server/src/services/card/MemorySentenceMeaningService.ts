import { createHash } from "node:crypto";
import { buildMemorySentenceMeaningPrompt, MEMORY_SENTENCE_MEANING_PROMPT_VERSION } from "@lf/core/Prompts/memorySentenceMeaningPrompt.js";
import type { AIProvider, ChatTextGenerationStreamEvent } from "@lf/core/ports/ai/AIProvider.js";
import type { UserPreferenceRepository } from "@lf/core/ports/repository/UserPreferenceRepository.js";
import type { PrismaMemorySentenceMeaningCacheRepository } from "../../infrastructure/repository/PrismaMemorySentenceMeaningCacheRepository.js";
import type { UsageV2Service } from "../usage/UsageV2Service.js";

const MAX_SENTENCE_CHARS = 1_000;
const MAX_OUTPUT_TOKENS = 600;
const MAX_MEANING_CHARS = 2_000;

type MeaningResolution = {
  meaning: string | null;
  nativeLanguage: string;
  cacheStatus: "hit" | "miss" | "same_language";
};

export class MemorySentenceMeaningService {
  private readonly inFlight = new Map<string, Promise<MeaningResolution>>();

  constructor(
    private readonly aiProvider: AIProvider,
    private readonly preferences: UserPreferenceRepository,
    private readonly cache: PrismaMemorySentenceMeaningCacheRepository,
    private readonly usage: UsageV2Service,
  ) {}

  async resolve(input: { userId: string; requestId: string; sentence: string; sourceLanguage: string }): Promise<MeaningResolution> {
    const sentence = input.sentence.normalize("NFKC").trim();
    if (!sentence || Array.from(sentence).length > MAX_SENTENCE_CHARS) throw new Error("MEMORY_MEANING_INVALID_SENTENCE");
    const preference = await this.preferences.getByUserId(input.userId);
    const nativeLanguage = preference.appLocale;
    if (sameLanguage(input.sourceLanguage, nativeLanguage)) return { meaning: null, nativeLanguage, cacheStatus: "same_language" };
    const provider = this.aiProvider.resolveProviderName?.() ?? this.aiProvider.providerName;
    const model = this.aiProvider.resolveModelName?.() ?? this.aiProvider.modelName;
    const sentenceHash = sha256(sentence);
    const cacheKey = sha256([MEMORY_SENTENCE_MEANING_PROMPT_VERSION, input.userId, provider, model, input.sourceLanguage, nativeLanguage, sentenceHash].join("\u0000"));
    const cached = await this.cache.find(cacheKey).catch(() => null);
    if (cached?.meaning.trim()) return { meaning: cached.meaning.trim(), nativeLanguage, cacheStatus: "hit" };

    // A fast double tap (or two mounted views) should share one generation and
    // one usage reservation instead of charging twice for the same cache key.
    const pending = this.inFlight.get(cacheKey);
    if (pending) return pending;
    const resolution = this.generateMeaning({
      ...input,
      sentence,
      nativeLanguage,
      provider,
      model,
      sentenceHash,
      cacheKey,
      preference,
    }).finally(() => {
      if (this.inFlight.get(cacheKey) === resolution) this.inFlight.delete(cacheKey);
    });
    this.inFlight.set(cacheKey, resolution);
    return resolution;
  }

  private async generateMeaning(input: {
    userId: string;
    requestId: string;
    sentence: string;
    sourceLanguage: string;
    nativeLanguage: string;
    provider: string;
    model: string;
    sentenceHash: string;
    cacheKey: string;
    preference: Awaited<ReturnType<UserPreferenceRepository["getByUserId"]>>;
  }): Promise<MeaningResolution> {
    const prompt = buildMemorySentenceMeaningPrompt({ sentence: input.sentence, sourceLanguage: input.sourceLanguage, nativeLanguage: input.preference.appLocale });
    const meteredPrompt = `${prompt.systemPrompt}\n${prompt.userPrompt}`;
    await this.usage.reserveTokens({ userId: input.userId, requestId: input.requestId, feature: "organization", estimatedTokens: Array.from(meteredPrompt).length + MAX_OUTPUT_TOKENS, provider: input.provider, model: input.model });
    let output = "";
    let tokenUsage: Extract<ChatTextGenerationStreamEvent, { type: "done" }>["usage"];
    try {
      await this.aiProvider.generateChatTextStream({
        userId: input.userId,
        text: prompt.userPrompt,
        languageCode: input.preference.learningLanguage,
        appLocale: input.preference.appLocale,
        promptDifficulty: input.preference.promptDifficulty,
        companionMode: "rewrite_only",
        systemPrompt: prompt.systemPrompt,
        rawUserPrompt: true,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      }, (event) => {
        if (event.type === "delta") output += event.text;
        if (event.type === "done") tokenUsage = event.usage;
      });
      await this.usage.settleTokens({
        userId: input.userId,
        requestId: input.requestId,
        inputTokens: tokenUsage?.inputTokens ?? Math.ceil(Array.from(meteredPrompt).length / 2),
        outputTokens: tokenUsage?.outputTokens ?? Math.ceil(Array.from(output).length / 2),
        meteringSource: tokenUsage ? "provider" : "tokenizer",
        provider: input.provider,
        model: input.model,
      });
    } catch (error) {
      await this.usage.releaseTokens(input.userId, input.requestId).catch(() => undefined);
      throw error;
    }
    const meaning = normalizeMeaning(output);
    if (!meaning) throw new Error("MEMORY_MEANING_EMPTY");
    await this.cache.put({ cacheKey: input.cacheKey, userId: input.userId, sentenceHash: input.sentenceHash, sourceLanguage: input.sourceLanguage, nativeLanguage: input.nativeLanguage, promptVersion: MEMORY_SENTENCE_MEANING_PROMPT_VERSION, provider: input.provider, model: input.model, meaning }).catch(() => undefined);
    return { meaning, nativeLanguage: input.nativeLanguage, cacheStatus: "miss" };
  }
}

function normalizeMeaning(value: string): string {
  const meaning = value.trim().replace(/^(["'“‘])|(["'”’])$/gu, "").replace(/\s+/gu, " ").trim();
  return Array.from(meaning).length <= MAX_MEANING_CHARS ? meaning : "";
}

function sameLanguage(left: string, right: string): boolean {
  return left.toLowerCase().split("-")[0] === right.toLowerCase().split("-")[0];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
