export type CardGeneratedContentTarget = "expression" | "translation" | "reply";

export function buildCardContentGenerationPrompt(input: {
  target: CardGeneratedContentTarget;
  sourceText: string;
  languageCode: string;
  appLocale: string;
  difficulty: string;
}): { systemPrompt: string; userPrompt: string } {
  const task = input.target === "expression"
    ? `Rewrite the record as natural everyday ${languageName(input.languageCode)}. Preserve its meaning, facts, tone, emotion, and point of view.`
    : input.target === "translation"
      ? `Restate and organize the user's record as clear, natural ${languageName(input.appLocale)} for the app UI. The input may mix languages, but the output must use ${languageName(input.appLocale)} as its primary language. Preserve meaning, facts, tone, emotion, and point of view. Preserve intentional foreign terms only where natural.`
      : `Write one natural, empathetic reply in ${languageName(input.languageCode)} to the content. The reply must use ${languageName(input.languageCode)} regardless of the input language; do not switch to the input language unless it is already ${languageName(input.languageCode)}. Do not invent facts or give unsolicited advice.`;
  return {
    systemPrompt: `${task}\nReturn only the generated content. Do not use markdown, labels, quotation marks, or explanations.${input.difficulty === "simple" ? " Use common, clear vocabulary." : ""}`,
    userPrompt: `<card_content>${input.sourceText}</card_content>`,
  };
}

function languageName(code: string): string {
  if (code === "zh-CN") return "Simplified Chinese";
  if (code === "zh-TW") return "Traditional Chinese";
  if (code === "ja-JP") return "Japanese";
  return "American English";
}
