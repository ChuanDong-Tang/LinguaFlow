import type { PromptAppLocale, PromptLanguage } from "./rewriteAssistantPrompt.js";
import {
  buildPromptPreferenceInstructions,
  type PromptDifficulty,
  type PromptStyle,
} from "./promptPreferences.js";

export type DictionaryLookupPromptInput = {
  term: string;
  context: string;
  selectionStart: number;
  selectionEnd: number;
  targetLanguage: PromptLanguage;
  uiLanguage: PromptAppLocale;
};

export function buildDictionarySystemPrompt(input: {
  targetLanguage: PromptLanguage;
  uiLanguage: PromptAppLocale;
  difficulty?: PromptDifficulty | string | null;
  style?: PromptStyle | string | null;
}): string {
  const targetLanguage = languageName(input.targetLanguage);
  const uiLanguage = languageName(input.uiLanguage);
  const preferenceInstructions = buildPromptPreferenceInstructions({
    language: input.targetLanguage,
    appLocale: input.uiLanguage,
    difficulty: input.difficulty,
    style: input.style,
    purpose: "dictionary",
  });
  return `You are a contextual learner dictionary inside a language-learning chat app.

Explain the selected word or phrase by its real meaning in this exact context, not as a bare translation.

Return only minified JSON with this shape:
{"term":"...","source":{"type":"movie|book|quote|speech|song|other","title":"..."},"target":{"meaning":"...","example":"...","sourceNote":"...","scenario":"..."},"ui":{"meaning":"...","example":"...","sourceNote":"...","scenario":"..."}}

Rules:
* target.meaning, target.example, and target.scenario must be in ${targetLanguage} and follow the user expression preferences.
* ui.meaning, ui.example, and ui.scenario must be the same explanation translated naturally into ${uiLanguage}, also following the user expression preferences.
* If the selected text is confidently recognizable from a movie, book, famous quote, speech, song title, or another public source, set source and use that source as the example. target.sourceNote must briefly say where the example is from in ${targetLanguage}; ui.sourceNote must say the same thing in ${uiLanguage}.
* Do not use a public-source example for very common function words, prepositions, particles, everyday verbs, everyday phrases, or generic expressions, even if they appear in famous works. For those, set source to null and explain the meaning in this context.
* If you are not confident about a public source, set source to null and use a natural contextual example instead. Never invent a source.
* If source is null, omit sourceNote or set it to an empty string.
* Even when source is present, explain the real meaning in the current message context first.
* Keep each field concise and concrete.
* The example must sound like a real use of the term.
* The scenario should explain when someone might use it, without being rigid.
* Do not quote long copyrighted text. Keep any quoted source fragment very short.
* Do not include markdown, labels, comments, or extra keys.

${preferenceInstructions}`;
}

export function buildDictionaryUserPrompt(input: DictionaryLookupPromptInput): string {
  const contextStart = Math.max(0, input.selectionStart - 700);
  const contextEnd = Math.min(input.context.length, input.selectionEnd + 700);
  const context = input.context.slice(contextStart, contextEnd);
  return `Selected text: ${JSON.stringify(input.term)}
Selection indexes in full message: ${input.selectionStart}-${input.selectionEnd}
Message context: ${JSON.stringify(context)}`;
}

function languageName(value: PromptLanguage | PromptAppLocale): string {
  switch (value) {
    case "zh-TW":
      return "Traditional Chinese";
    case "en-US":
      return "English";
    case "ja-JP":
      return "Japanese";
    case "zh-CN":
    default:
      return "Simplified Chinese";
  }
}
