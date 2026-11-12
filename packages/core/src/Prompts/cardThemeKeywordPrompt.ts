import { normalizeGeneratedCardTopic } from "./cardExpressionPrompt.js";
import { CARD_THEME_KEYWORD_MAX_CHARS } from "./cardTopicPrompt.js";

// One-shot backfill for cards made before topic prompt v4: only the short
// life-theme keyword shown by 相关回忆. Topic and headline stay untouched.
export const CARD_THEME_KEYWORD_PROMPT_VERSION = "card_theme_keyword_v1" as const;

export function buildCardThemeKeywordPrompt(input: { text: string; topic?: string | null; appLocale?: string | null }) {
  const language = input.appLocale === "zh-TW" ? "Traditional Chinese" : input.appLocale === "en-US" ? "English" : input.appLocale === "ja-JP" ? "Japanese" : "Simplified Chinese";
  return {
    version: CARD_THEME_KEYWORD_PROMPT_VERSION,
    systemPrompt: `Name the life theme of a user's real-life record as one short keyword in ${language}.

- A short noun phrase: 2–6 Chinese characters or 1–3 words, e.g. 装修, 工作沟通, 健身, 带娃.
- Broader than the specific event; never copy the summary title; no punctuation, hashtags or emoji.
- Use ${language} only.
- Return exactly <keyword>…</keyword>, with no markdown or explanation.`,
    userPrompt: `${input.topic ? `<summary>${input.topic}</summary>\n` : ""}<user_text>${input.text}</user_text>`,
  };
}

export function parseCardThemeKeywordOutput(value: string, topic?: string | null): string {
  const keyword = normalizeGeneratedCardTopic(/<keyword>\s*([\s\S]*?)\s*<\/keyword>/i.exec(value)?.[1] ?? "", CARD_THEME_KEYWORD_MAX_CHARS)
    .replace(/[#＃。，,.!！?？]/gu, "").trim();
  if (!keyword || keyword === topic?.trim()) {
    const error = new Error("CARD_THEME_KEYWORD_EMPTY") as Error & { code: string };
    error.code = "CARD_THEME_KEYWORD_EMPTY";
    throw error;
  }
  return keyword;
}
