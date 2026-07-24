import { isTargetLanguageCode, type TargetLanguageCode } from "../language/targetLanguages.js";

export type CardExpressionLanguage = TargetLanguageCode;
export type CardTopicLocale = "zh-CN" | "zh-TW" | "en-US" | "ja-JP";
export const CARD_EXPRESSION_PROMPT_VERSION = "card_expression_v1" as const;

export interface CardExpressionPrompt {
  systemPrompt: string;
  userPrompt: string;
  version: typeof CARD_EXPRESSION_PROMPT_VERSION;
}

export interface CardExpressionOutput {
  expression: string;
  topic: string;
}

type CardLanguageProfile = {
  expressionLanguage: string;
  rewriteRules: string;
};

const CARD_LANGUAGE_PROFILES: Record<CardExpressionLanguage, CardLanguageProfile> = {
  "en-US": {
    expressionLanguage: "natural everyday American English",
    rewriteRules: "Do not translate word for word or preserve Chinese sentence structure. Prefer the common, concise phrasing an American would naturally use in a message, conversation, or personal life update.",
  },
  "ja-JP": {
    expressionLanguage: "natural everyday Japanese",
    rewriteRules: "Use natural Japanese vocabulary and orthography. The result should normally contain kana. Avoid Chinese-style Japanese wording, unnatural kanji-only output, and literal Chinese syntax. Use casual spoken Japanese unless the source clearly requires another tone.",
  },
};

export function buildCardExpressionPrompt(input: {
  text: string;
  languageCode?: string | null;
  appLocale?: string | null;
  difficulty?: string | null;
}): CardExpressionPrompt {
  const language = resolveCardLanguage(input.languageCode);
  const languageProfile = CARD_LANGUAGE_PROFILES[language];
  const topicLocale = normalizeTopicLocale(input.appLocale);
  const expressionLanguage = languageProfile.expressionLanguage;
  const topicLanguage = topicLocaleName(topicLocale);
  const difficultyRule = input.difficulty === "simple"
    ? "Use common beginner-friendly vocabulary and simple natural grammar without sounding childish."
    : "Choose vocabulary and sentence structure based on the user's actual meaning and tone.";

  return {
    version: CARD_EXPRESSION_PROMPT_VERSION,
    systemPrompt: `You convert a user's real-life record into a personal language-memory card.

Your only tasks are:
1. Rewrite the user's meaning as ${expressionLanguage}.
2. Create one short display title in ${topicLanguage} for this specific life moment.

Expression rules:
- Preserve the user's meaning, facts, emotion, tone, and point of view.
- Sound like a real native speaker, not a translation or an essay.
- You may restructure, combine, shorten, or clarify sentences when that makes the expression more natural.
- Do not add slang, profanity, emotional intensity, or filler words unless the user's original tone calls for them.
- ${languageProfile.rewriteRules}
- ${difficultyRule}

Topic rules:
- Summarize the specific event or realization, not a broad category.
- Do not output tags such as “创业”, “旅行”, or “生活”.
- Prefer a concise title without ending punctuation.
- Use ${topicLanguage} only.

Hard restrictions:
- Do not reply to the user.
- Do not ask a question.
- Do not explain, teach, evaluate, encourage, or add information.
- Do not output markdown or any text outside the two required tags.

Return exactly:
<expression>${expressionLanguage}</expression>
<topic>${topicLanguage} display title</topic>`,
    userPrompt: `Rewrite only the content inside <user_text></user_text> according to the card contract.

<user_text>${input.text}</user_text>`,
  };
}

export function parseCardExpressionOutput(text: string): CardExpressionOutput {
  const expression = extractRequiredTag(text, "expression");
  const topic = extractRequiredTag(text, "topic");
  if (!expression) throw new Error("CARD_EXPRESSION_EMPTY");
  if (!topic) throw new Error("CARD_TOPIC_EMPTY");
  return { expression, topic };
}

function extractRequiredTag(text: string, tag: "expression" | "topic"): string {
  const match = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, "i").exec(text);
  return match?.[1]?.trim() ?? "";
}

function normalizeTopicLocale(value?: string | null): CardTopicLocale {
  if (value === "zh-TW" || value === "en-US" || value === "ja-JP") return value;
  return "zh-CN";
}

function resolveCardLanguage(value?: string | null): CardExpressionLanguage {
  if (isTargetLanguageCode(value)) return value;
  const error = new Error(`Unsupported card language: ${value ?? "missing"}`) as Error & { code: string };
  error.code = "CARD_LANGUAGE_UNSUPPORTED";
  throw error;
}

function topicLocaleName(locale: CardTopicLocale): string {
  switch (locale) {
    case "zh-TW": return "Traditional Chinese";
    case "en-US": return "English";
    case "ja-JP": return "Japanese";
    default: return "Simplified Chinese";
  }
}
