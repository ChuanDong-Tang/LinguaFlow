import type { CardTopicLocale } from "./cardExpressionPrompt.js";

export const CARD_TOPIC_PROMPT_VERSION = "card_topic_v1" as const;

export function buildCardTopicPrompt(input: { text: string; appLocale?: string | null }): {
  systemPrompt: string;
  userPrompt: string;
  version: typeof CARD_TOPIC_PROMPT_VERSION;
} {
  const locale = normalizeTopicLocale(input.appLocale);
  const language = topicLocaleName(locale);
  return {
    version: CARD_TOPIC_PROMPT_VERSION,
    systemPrompt: `Create one short display title in ${language} for a user's real-life record.

Rules:
- Summarize the specific event, thought, or realization rather than a broad category.
- Preserve the user's facts and meaning. Do not invent context.
- Prefer a concise title without ending punctuation.
- Use ${language} only.
- Return only <topic>title</topic>, with no markdown or explanation.`,
    userPrompt: `<user_text>${input.text}</user_text>`,
  };
}

export function parseCardTopicOutput(value: string): string {
  const topic = /<topic>\s*([\s\S]*?)\s*<\/topic>/i.exec(value)?.[1]?.trim() ?? "";
  if (!topic) throw topicError("CARD_TOPIC_EMPTY");
  if ([...topic].length > 100) throw topicError("CARD_TOPIC_TOO_LONG");
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
