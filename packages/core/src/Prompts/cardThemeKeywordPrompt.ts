import { normalizeGeneratedCardTopic } from "./cardExpressionPrompt.js";
import { CARD_THEME_KEYWORD_MAX_CHARS } from "./cardTopicPrompt.js";

// One-shot backfill for cards made before topic prompt v4: only the short
// life-theme keyword shown by 相关回忆. Topic and headline stay untouched.
// v2: pick the life area the record belongs to (not its point or mood).
export const CARD_THEME_KEYWORD_PROMPT_VERSION = "card_theme_keyword_v2" as const;

export function buildCardThemeKeywordPrompt(input: { text: string; topic?: string | null; appLocale?: string | null }) {
  const language = input.appLocale === "zh-TW" ? "Traditional Chinese" : input.appLocale === "en-US" ? "English" : input.appLocale === "ja-JP" ? "Japanese" : "Simplified Chinese";
  return {
    version: CARD_THEME_KEYWORD_PROMPT_VERSION,
    systemPrompt: `Which area of the user's life does this record belong to? Answer with one short keyword in ${language}.

- Name the life area or activity, so records about the same part of life share the same keyword.
  Good examples: 装修, 工作, 产品开发, 学英语, 美食, 旅行, 恋爱, 家人, 朋友, 健身, 读书, 电影, 游戏, 购物, 宠物, 天气, 通勤, 健康, 理财, 成语故事.
- Prefer a common everyday word like the examples over a new one. Reuse an example when it fits.
- Do not describe the record's opinion, feeling, lesson or conclusion (bad: 认知真实, 产品缺失感, 时间管理意识).
- 2–4 Chinese characters (at most 6), or 1–2 English words. No punctuation, hashtags or emoji. Never copy the summary title.
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
