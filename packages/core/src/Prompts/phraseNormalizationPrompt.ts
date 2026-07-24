import { isTargetLanguageCode, type TargetLanguageCode } from "../language/targetLanguages.js";

export const PHRASE_NORMALIZATION_PROMPT_VERSION = "phrase_normalization_v1" as const;

const LANGUAGE_RULES: Record<TargetLanguageCode, string> = {
  "en-US": "Return the dictionary/base form for the exact expression and only its grammatical inflections or spelling/case variants. Example: paid off -> pay off; variants may include pays off, paid off, paying off.",
  "ja-JP": "Return the dictionary form for the exact Japanese expression and only common inflections of that same expression. Preserve particles when they are essential to the selected expression. Do not replace it with a synonym.",
};

export function buildPhraseNormalizationPrompt(input: {
  surfaceText: string;
  languageCode: string;
}): { systemPrompt: string; userPrompt: string; version: typeof PHRASE_NORMALIZATION_PROMPT_VERSION } {
  if (!isTargetLanguageCode(input.languageCode)) {
    const error = new Error(`Unsupported phrase language: ${input.languageCode}`) as Error & { code: string };
    error.code = "PHRASE_LANGUAGE_UNSUPPORTED";
    throw error;
  }
  return {
    version: PHRASE_NORMALIZATION_PROMPT_VERSION,
    systemPrompt: `You normalize one selected language-learning phrase.

${LANGUAGE_RULES[input.languageCode]}

Hard rules:
- Keep exactly the same lexical meaning. Never add synonyms, translations, explanations, examples, or related expressions.
- A variant must be a form that could be matched literally in text.
- Return at most 20 unique variants.
- Do not output markdown or text outside the required tags.

Return exactly:
<canonical>dictionary or canonical form</canonical>
<variant>literal variant 1</variant>
<variant>literal variant 2</variant>`,
    userPrompt: `<phrase>${input.surfaceText}</phrase>`,
  };
}

export function parsePhraseNormalizationOutput(text: string): { canonicalText: string; variants: string[] } {
  const canonicalText = extractOne(text, "canonical");
  if (!canonicalText) throw new Error("PHRASE_CANONICAL_EMPTY");
  const variants = Array.from(text.matchAll(/<variant>\s*([\s\S]*?)\s*<\/variant>/gi))
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean);
  return { canonicalText, variants: Array.from(new Set([canonicalText, ...variants])).slice(0, 20) };
}

function extractOne(text: string, tag: "canonical"): string {
  return new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, "i").exec(text)?.[1]?.trim() ?? "";
}
