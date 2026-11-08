import { CARD_TOPIC_MAX_CHARS, normalizeGeneratedCardTopic, type CardTopicLocale } from "./cardExpressionPrompt.js";

// v3: one call returns both a factual summary title (<topic>, used for
// relations and search) and a catchy display headline (<headline>).
export const CARD_TOPIC_PROMPT_VERSION = "card_topic_v3" as const;

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
    systemPrompt: `Write two short titles in ${language} for a user's real-life record.

1. <topic>: a factual summary of the specific event, thought, or realization (not a broad category). It is used to find related memories.
2. <headline>: the title shown on the card. Make it catchy and personal, like a good social-media post title that makes the user want to open it again: a vivid detail, a feeling, a small twist, or a question. It must stay true to the record — no invented facts, no clickbait exaggeration, no hashtags, at most one emoji.

Rules for both:
- Preserve the user's facts and meaning. Do not invent context.
- No ending punctuation except ? or !.
- Keep each within ${topicMaxChars} characters.
- Use ${language} only.
- Return exactly <topic>…</topic><headline>…</headline>, with no markdown or explanation.`,
    userPrompt: `<user_text>${input.text}</user_text>`,
  };
}

/** Parse the v3 output; the headline is optional (older outputs lack it). */
export function parseCardTitlesOutput(value: string, topicMaxChars = CARD_TOPIC_MAX_CHARS): { topic: string; headline: string | null } {
  const topic = parseCardTopicOutput(value, topicMaxChars);
  const headline = normalizeGeneratedCardTopic(/<headline>\s*([\s\S]*?)\s*<\/headline>/i.exec(value)?.[1] ?? "", topicMaxChars);
  return { topic, headline: headline && headline !== topic ? headline : null };
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
