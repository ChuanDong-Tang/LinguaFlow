import type { AIProvider } from "@lf/core/ports/ai/AIProvider.js";
import {
  buildProgressPhraseDetectionPrompt,
  parseProgressPhraseDetectionOutput,
  PROGRESS_PHRASE_DETECTION_PROMPT_VERSION,
} from "@lf/core/Prompts/progressPhraseDetectionPrompt.js";
import { findPhraseMatches } from "@lf/core/text/phraseMatching.js";
import { normalizePhraseSurface, PHRASE_NORMALIZER_VERSION } from "@lf/core/text/phraseNormalization.js";
import { getTargetLanguageProfile } from "@lf/core/language/targetLanguages.js";

export interface DetectedProgressPhrase {
  surfaceText: string;
  normalizedText: string;
  occurrences: Array<{ startUtf16: number; endUtf16: number; surfaceText: string }>;
}

/** Stateless extraction. Persistence and history matching stay in the caller's data boundary. */
export class ProgressPhraseDetectionService {
  constructor(private readonly aiProvider: AIProvider) {}

  async detect(input: { userId: string; originalText: string; languageCode: string }): Promise<{
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
    let rawOutput = "";
    await this.aiProvider.generateChatTextStream({
      userId: input.userId,
      text: prompt.userPrompt,
      languageCode: input.languageCode,
      systemPrompt: prompt.systemPrompt,
      rawUserPrompt: true,
      maxOutputTokens: 500,
    }, (event) => {
      if (event.type === "delta") rawOutput += event.text;
    });
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
