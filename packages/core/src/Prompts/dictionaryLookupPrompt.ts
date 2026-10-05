import type { PromptAppLocale, PromptLanguage } from "./rewriteAssistantPrompt.js";

export type DictionaryLookupPromptInput = {
  term: string;
  context: string;
  selectionStart: number;
  selectionEnd: number;
  targetLanguage: PromptLanguage;
  uiLanguage: PromptAppLocale;
  lookupMode?: "contextual" | "standalone";
};

export function buildDictionarySystemPrompt(input: {
  targetLanguage: PromptLanguage;
  uiLanguage: PromptAppLocale;
  lookupMode?: "contextual" | "standalone";
}): string {
  const targetLanguage = languageName(input.targetLanguage);
  const uiLanguage = languageName(input.uiLanguage);
  const standaloneRules = input.lookupMode === "standalone"
    ? `This is a standalone, bidirectional lookup of a word, phrase, or complete sentence without additional context.
* If the selected text is written in ${uiLanguage} and ${uiLanguage} differs from ${targetLanguage}, targetExpression must be its single most natural equivalent in ${targetLanguage}. Preserve register, intensity, and meaning; do not add alternatives.
* Otherwise, targetExpression must preserve a complete input sentence as written; use natural dictionary form only for words and phrases.
* For a sentence, interpret the whole sentence, including idioms, negation, tense and tone. Never reduce it to a keyword, omit details or add facts. Translate an input sentence into a complete natural ${targetLanguage} sentence when translation is needed.
* targetMeaning must concisely explain targetExpression in ${targetLanguage}.
* nativeMeaning must concisely confirm the same meaning in ${uiLanguage}; for sentences, give a natural full-sentence translation, not commentary about the speaker.`
    : `This is a contextual lookup.
* targetExpression must preserve the selected word or phrase in its natural dictionary form.
* Explain only the selected word or phrase's meaning in this exact context.
* targetMeaning must be a concise, learner-friendly explanation in ${targetLanguage}.
* nativeMeaning must be the same contextual meaning translated naturally into ${uiLanguage}.`;
  return `You are a learner dictionary inside a language-learning app.

${standaloneRules}

Return only minified JSON with this exact shape:
{"queryType":"word","term":"...","targetExpression":"...","phonetic":"/.../","targetMeaning":"...","nativeMeaning":"..."}

Rules:
* queryType must be exactly one of: word, phrase, sentence. The JSON example uses word only as an example.
* term must preserve the selected text.
* targetExpression must contain only one natural ${targetLanguage} ${input.lookupMode === "standalone" ? "word, phrase, or complete sentence matching the input" : "word or phrase"}, never a slash-separated list.
* Set queryType to word only for one lexical word. Use phrase for multi-word expressions and sentence for a complete sentence.
* phonetic is the IPA pronunciation of targetExpression only when targetExpression is one lexical word. Otherwise it must be null.
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
