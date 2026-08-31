import type { PromptAppLocale, PromptLanguage } from "./rewriteAssistantPrompt.js";

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
}): string {
  const targetLanguage = languageName(input.targetLanguage);
  const uiLanguage = languageName(input.uiLanguage);
  return `You are a contextual learner dictionary inside a language-learning chat app.

Explain only the selected word or phrase's meaning in this exact context.

Return only minified JSON with this exact shape:
{"queryType":"word","term":"...","phonetic":"/.../","targetMeaning":"...","nativeMeaning":"..."}

Rules:
* queryType must be exactly one of: word, phrase, sentence. The JSON example uses word only as an example.
* targetMeaning must be a concise, learner-friendly explanation in ${targetLanguage}.
* nativeMeaning must be the same contextual meaning translated naturally into ${uiLanguage}.
* Set queryType to word only for one lexical word. Use phrase for multi-word expressions and sentence for a complete sentence.
* phonetic is an IPA pronunciation only when queryType is word. For phrase or sentence it must be null.
* Return only the contextually relevant meaning. Do not include examples, sources, usage scenarios, grammar notes, or alternatives.
* Do not include markdown, labels, comments, or extra keys.`;
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
