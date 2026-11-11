import { CARD_TOPIC_MAX_CHARS, normalizeGeneratedCardTopic, type CardTopicLocale } from "./cardExpressionPrompt.js";

// v3: one call returns both a factual summary title (<topic>, used for
// relations and search) and a catchy display headline (<headline>).
// v4: plus a 2–6 character theme keyword (<keyword>) shown by 相关回忆.
export const CARD_TOPIC_PROMPT_VERSION = "card_topic_v4" as const;
export const CARD_THEME_KEYWORD_MAX_CHARS = 8;

export function buildCardTopicPrompt(input: { text: string; appLocale?: string | null; topicMaxChars?: number }): {
  systemPrompt: string;
  userPrompt: string;
  version: typeof CARD_TOPIC_PROMPT_VERSION;
} {
  const locale = normalizeTopicLocale(input.appLocale);
  const language = topicLocaleName(locale);
  const topicMaxChars = Number.isFinite(input.topicMaxChars) ? Math.max(1, Math.floor(input.topicMaxChars!)) : CARD_TOPIC_MAX_CHARS;
  return {
    version: CARD_TOPIC_PROMPT_VERSION,
    systemPrompt: `Write two short titles and one theme keyword in ${language} for a user's real-life record.

1. <topic>: a factual summary of the specific event, thought, or realization (not a broad category). It is used to find related memories.
2. <headline>: the title shown on the card. Make it catchy and personal, like a good social-media post title that makes the user want to open it again: a vivid detail, a feeling, a small twist, or a question. It must stay true to the record — no invented facts, no clickbait exaggeration, no hashtags, at most one emoji.
3. <keyword>: the life theme this memory belongs to, as a short noun phrase (2–6 Chinese characters or 1–3 words), e.g. 装修, 工作沟通, 健身, 带娃. Broader than the topic, never a copy of the titles, no punctuation or emoji.

Rules for the titles:
- Preserve the user's facts and meaning. Do not invent context.
- No ending punctuation except ? or !.
- Keep each within ${topicMaxChars} characters.
- Use ${language} only.
- Return exactly <topic>…</topic><headline>…</headline><keyword>…</keyword>, with no markdown or explanation.`,
    userPrompt: `<user_text>${input.text}</user_text>`,
  };
}

/** Parse the v4 output; headline and keyword are optional (older outputs lack them). */
export function parseCardTitlesOutput(value: string, topicMaxChars = CARD_TOPIC_MAX_CHARS): { topic: string; headline: string | null; keyword: string | null } {
  const topic = parseCardTopicOutput(value, topicMaxChars);
  const headline = normalizeGeneratedCardTopic(/<headline>\s*([\s\S]*?)\s*<\/headline>/i.exec(value)?.[1] ?? "", topicMaxChars);
  const keyword = normalizeGeneratedCardTopic(/<keyword>\s*([\s\S]*?)\s*<\/keyword>/i.exec(value)?.[1] ?? "", CARD_THEME_KEYWORD_MAX_CHARS)
    .replace(/[#＃。，,.!！?？]/gu, "").trim();
  return { topic, headline: headline && headline !== topic ? headline : null, keyword: keyword && keyword !== topic ? keyword : null };
}

export function parseCardTopicOutput(value: string, topicMaxChars = CARD_TOPIC_MAX_CHARS): string {
  const topic = normalizeGeneratedCardTopic(/<topic>\s*([\s\S]*?)\s*<\/topic>/i.exec(value)?.[1] ?? "", topicMaxChars);
  if (!topic) throw topicError("CARD_TOPIC_EMPTY");
  return topic;
}

function normalizeTopicLocale(value?: string | null): CardTopicLocale {
  if (value === "zh-TW" || value === "en-US" || value === "ja-JP") return value;
  return "zh-CN";
}

function topicLocaleName(locale: CardTopicLocale): string {
  switch (locale) {
    case "zh-TW": return "Traditional Chinese";
    case "en-US": return "English";
    case "ja-JP": return "Japanese";
    default: return "Simplified Chinese";
  }
}

function topicError(code: string): Error {
  const error = new Error(code) as Error & { code: string };
  error.code = code;
  return error;
}
