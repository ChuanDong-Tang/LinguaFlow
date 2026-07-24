import { isTargetLanguageCode, type TargetLanguageCode } from "../language/targetLanguages.js";

export const PROGRESS_PHRASE_DETECTION_PROMPT_VERSION = "progress_phrase_detection_v1" as const;

const LANGUAGE_RULES: Record<TargetLanguageCode, string> = {
  "en-US": "Extract useful English words or multi-word expressions that the user actually wrote. Prefer reusable lexical expressions over names, punctuation, grammar fragments, or whole sentences.",
  "ja-JP": "Extract useful Japanese words or short expressions that the user actually wrote. Prefer reusable lexical expressions over names, particles alone, punctuation, or whole sentences.",
};

export function buildProgressPhraseDetectionPrompt(input: {
  originalText: string;
  languageCode: string;
}): { systemPrompt: string; userPrompt: string; version: typeof PROGRESS_PHRASE_DETECTION_PROMPT_VERSION } {
  if (!isTargetLanguageCode(input.languageCode)) {
    const error = new Error(`Unsupported progress language: ${input.languageCode}`) as Error & { code: string };
    error.code = "PROGRESS_LANGUAGE_UNSUPPORTED";
    throw error;
  }
  return {
    version: PROGRESS_PHRASE_DETECTION_PROMPT_VERSION,
    systemPrompt: `You extract a small set of target-language expressions from the user's original journal text.

${LANGUAGE_RULES[input.languageCode]}

Hard rules:
- Every output must appear literally and contiguously in the supplied text.
- Preserve the exact spelling and inflected form from the text.
- Never translate, normalize, infer synonyms, or output explanations.
- Return at most 8 unique expressions, ordered by learning value.
- If there is no target-language expression, return no <phrase> tags.
- Do not output markdown or text outside the tags.

Return zero or more:
<phrase>literal expression</phrase>`,
    userPrompt: `<original_json>${JSON.stringify(input.originalText)}</original_json>`,
  };
}

export function parseProgressPhraseDetectionOutput(text: string): string[] {
  return Array.from(text.matchAll(/<phrase>\s*([\s\S]*?)\s*<\/phrase>/gi))
    .map((match) => match[1]?.trim() ?? "")
    .filter((value, index, values) => Boolean(value) && value.length <= 200 && values.indexOf(value) === index)
    .slice(0, 8);
}
