import type { AIProvider, ChatTextGenerationStreamEvent } from "@lf/core/ports/ai/AIProvider.js";
import {
  buildProgressPhraseDetectionPrompt,
  parseProgressPhraseDetectionOutput,
  PROGRESS_PHRASE_DETECTION_PROMPT_VERSION,
} from "@lf/core/Prompts/progressPhraseDetectionPrompt.js";
import { findPhraseMatches } from "@lf/core/text/phraseMatching.js";
import { normalizePhraseSurface, PHRASE_NORMALIZER_VERSION } from "@lf/core/text/phraseNormalization.js";
import { getTargetLanguageProfile } from "@lf/core/language/targetLanguages.js";
import type { ResourceGovernor } from "../resource/ResourceGovernor.js";
import type { UsageV2Service } from "../usage/UsageV2Service.js";
import { reserveLlmTokenUsage, settleLlmTokenUsage, settleOrReleaseFailedLlmUsage } from "../usage/LlmTokenMeter.js";

export interface DetectedProgressPhrase {
  surfaceText: string;
  normalizedText: string;
  occurrences: Array<{ startUtf16: number; endUtf16: number; surfaceText: string }>;
}

/** Stateless extraction. Persistence and history matching stay in the caller's data boundary. */
export class ProgressPhraseDetectionService {
  constructor(
    private readonly aiProvider: AIProvider,
    private readonly resourceGovernor?: ResourceGovernor,
    private readonly usageV2Service?: UsageV2Service,
  ) {}

  async detect(input: { userId: string; requestId: string; originalText: string; languageCode: string; tokenMetered?: boolean }): Promise<{
    phrases: DetectedProgressPhrase[];
    promptVersion: string;
    normalizerVersion: string;
  }> {
    const originalText = input.originalText.trim();
    if (!originalText || originalText.length > 12_000) throw validationError();
    getTargetLanguageProfile(input.languageCode);
    if (!hasTargetLanguageSignal(originalText, input.languageCode)) {
      return {
        phrases: [],
        promptVersion: PROGRESS_PHRASE_DETECTION_PROMPT_VERSION,
        normalizerVersion: PHRASE_NORMALIZER_VERSION,
      };
    }
    const prompt = buildProgressPhraseDetectionPrompt({ originalText, languageCode: input.languageCode });
    const meteredPrompt = `${prompt.systemPrompt}\n${prompt.userPrompt}`;
    let rawOutput = "";
    let tokenUsage: Extract<ChatTextGenerationStreamEvent, { type: "done" }>["usage"];
    const tokenMetered = input.tokenMetered !== false;
    if (tokenMetered && !this.usageV2Service) throw new Error("V2 usage is unavailable");
    if (tokenMetered) await reserveLlmTokenUsage({
      usageService: this.usageV2Service!,
      userId: input.userId,
      requestId: input.requestId,
      feature: "organization",
      prompt: meteredPrompt,
      maxOutputTokens: 500,
      provider: this.aiProvider,
    });
    const generate = () => this.aiProvider.generateChatTextStream({
      userId: input.userId,
      text: prompt.userPrompt,
      languageCode: input.languageCode,
      systemPrompt: prompt.systemPrompt,
      rawUserPrompt: true,
      maxOutputTokens: 500,
    }, (event) => {
      if (event.type === "delta") rawOutput += event.text;
      if (event.type === "done") tokenUsage = event.usage;
    });
    try {
      if (this.resourceGovernor) await this.resourceGovernor.execute("llm", input.userId, generate);
      else await generate();
      if (tokenMetered) await settleLlmTokenUsage({
        usageService: this.usageV2Service!,
        userId: input.userId,
        requestId: input.requestId,
        prompt: meteredPrompt,
        output: rawOutput,
        usage: tokenUsage,
        provider: this.aiProvider,
      });
    } catch (error) {
      if (tokenMetered) await settleOrReleaseFailedLlmUsage({
        usageService: this.usageV2Service!,
        userId: input.userId,
        requestId: input.requestId,
        prompt: meteredPrompt,
        output: rawOutput,
        usage: tokenUsage,
        provider: this.aiProvider,
      });
      throw error;
    }
    const phrases = parseProgressPhraseDetectionOutput(rawOutput).flatMap((surfaceText) => {
      const normalizedText = normalizePhraseSurface(surfaceText, input.languageCode);
      const occurrences = findPhraseMatches(originalText, [surfaceText], input.languageCode);
      return normalizedText && occurrences.length ? [{ surfaceText, normalizedText, occurrences }] : [];
    });
    return {
      phrases: dedupeDetected(phrases),
      promptVersion: PROGRESS_PHRASE_DETECTION_PROMPT_VERSION,
      normalizerVersion: PHRASE_NORMALIZER_VERSION,
    };
  }
}

export function hasTargetLanguageSignal(text: string, languageCode: string): boolean {
  if (languageCode === "en-US") return /[A-Za-z]{2,}/.test(text);
  if (languageCode === "ja-JP") return /[\u3040-\u30ff]/u.test(text);
  return false;
}

function dedupeDetected(phrases: DetectedProgressPhrase[]): DetectedProgressPhrase[] {
  const seen = new Set<string>();
  return phrases.filter((phrase) => !seen.has(phrase.normalizedText) && Boolean(seen.add(phrase.normalizedText)));
}

function validationError(): Error {
  const error = new Error("Invalid progress phrase input") as Error & { code: string };
  error.code = "CARD_VALIDATION_FAILED";
  return error;
}
