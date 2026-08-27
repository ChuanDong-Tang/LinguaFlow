import type { AppLocale } from "../ports/repository/UserPreferenceRepository.js";

export const MEMORY_SENTENCE_MEANING_PROMPT_VERSION = "memory-sentence-meaning-v1";

export function buildMemorySentenceMeaningPrompt(input: {
  sentence: string;
  sourceLanguage: string;
  nativeLanguage: AppLocale;
}): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: `Translate one language-learning sentence from ${languageName(input.sourceLanguage)} into ${languageName(input.nativeLanguage)}.
Return only one faithful, natural translation. Preserve the meaning, tone, names, numbers, tense, negation, and uncertainty. Do not explain, label, quote, transliterate, or add alternatives.`,
    userPrompt: `<sentence>${JSON.stringify(input.sentence)}</sentence>`,
  };
}

function languageName(code: string): string {
  if (code.toLowerCase().startsWith("zh-tw")) return "Traditional Chinese";
  if (code.toLowerCase().startsWith("zh")) return "Simplified Chinese";
  if (code.toLowerCase().startsWith("ja")) return "Japanese";
  if (code.toLowerCase().startsWith("ko")) return "Korean";
  if (code.toLowerCase().startsWith("en")) return "English";
  return code;
}
