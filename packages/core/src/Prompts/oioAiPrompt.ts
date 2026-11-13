import type { AgentToolDefinition } from "../ports/ai/AgentChatProvider.js";

/**
 * OIO AI (2026-11, phase 1): finds the user's memories (cards) and helps them
 * practise. Read-only tools plus two app actions; nothing here changes data.
 */
export const OIO_AI_PROMPT_VERSION = "oio-ai-v2";
export const OIO_AI_MAX_TOOL_ROUNDS = 5;

export const OIO_AI_TOOLS: AgentToolDefinition[] = [
  {
    name: "search_cards",
    description: "Find the user's memory cards by meaning and keywords, optionally limited to a date range or to cards with photos. Use for any question about what the user wrote, did, ate, felt, or recorded.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for, in the user's words (Chinese or English). Omit to list cards in the date range." },
        date_from: { type: "string", description: "Inclusive start date YYYY-MM-DD." },
        date_to: { type: "string", description: "Inclusive end date YYYY-MM-DD." },
        has_photo: { type: "boolean", description: "Only cards with a photo or video." },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_card",
    description: "Read one card in full: original text, English rewrite, blanks and the user's latest answer on each.",
    parameters: { type: "object", properties: { card_id: { type: "string" } }, required: ["card_id"], additionalProperties: false },
  },
  {
    name: "practice_stats",
    description: "The user's cloze practice: accuracy, the answers they miss most, and cards with mistakes.",
    parameters: { type: "object", properties: { days: { type: "integer", minimum: 1, maximum: 365, description: "Look back this many days (default 30)." } }, additionalProperties: false },
  },
  {
    name: "find_word_in_my_cards",
    description: "Where a word or phrase appears in the user's own cards.",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
  },
  {
    name: "start_blind_box",
    description: "Offer the user a button that starts a 盲盒 practice set (one sentence per card) with these cards. Use after finding cards worth practising.",
    parameters: {
      type: "object",
      properties: {
        card_ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 50 },
        label: { type: "string", description: "Short button label in the user's language, e.g. 用这 5 张开一组盲盒." },
      },
      required: ["card_ids"],
      additionalProperties: false,
    },
  },
];

const pad = (n: number) => String(n).padStart(2, "0");
const key = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

/**
 * Ready-made date ranges for common phrases. v1 left the arithmetic to the
 * model, which resolved 去年这时候 to the wrong year; the ranges are now
 * computed here (dates are calendar days, timezone-free).
 */
export function oioAiDateAnchors(today: string): string[] {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const now = new Date(Date.UTC(y, m - 1, d));
  const weekday = (now.getUTCDay() + 6) % 7; // Monday = 0
  const thisMonday = addDays(now, -weekday);
  const lastMonthStart = new Date(Date.UTC(y, m - 2, 1));
  const lastMonthEnd = new Date(Date.UTC(y, m - 1, 0));
  const lastYear = new Date(Date.UTC(y - 1, m - 1, d));
  return [
    `today = ${key(now)}`,
    `yesterday = ${key(addDays(now, -1))}`,
    `this week (本周) = ${key(thisMonday)} .. ${key(now)}`,
    `last week (上周) = ${key(addDays(thisMonday, -7))} .. ${key(addDays(thisMonday, -1))}`,
    `last 7 days (最近一周) = ${key(addDays(now, -6))} .. ${key(now)}`,
    `this month (这个月) = ${key(new Date(Date.UTC(y, m - 1, 1)))} .. ${key(now)}`,
    `last month (上个月) = ${key(lastMonthStart)} .. ${key(lastMonthEnd)}`,
    `this time last year (去年这时候) = ${key(addDays(lastYear, -7))} .. ${key(addDays(lastYear, 7))}`,
    `last year (去年) = ${y - 1}-01-01 .. ${y - 1}-12-31`,
    `one week ago (一周前的今天) = ${key(addDays(now, -7))}; one month ago (一个月前的今天) = ${key(new Date(Date.UTC(y, m - 2, Math.min(d, 28))))}; one year ago (一年前的今天) = ${key(lastYear)}`,
  ];
}

export function buildOioAiSystemPrompt(input: { today: string; appLocale?: string; learningLanguage?: string; contextCard?: { id: string; title: string; text: string } | null }): string {
  const zh = !input.appLocale || input.appLocale.startsWith("zh");
  return [
    "You are OIO AI inside the OIO app. Users write short memories in their own language; OIO rewrites each into a card in the language they are learning and lets them practise with fill-in blanks (cloze).",
    "Your two jobs: (1) help the user find and revisit their memories; (2) help them learn from their practice.",
    `Date ranges to use as-is for relative dates (do not compute your own):\n${oioAiDateAnchors(input.today).map((line) => `  ${line}`).join("\n")}`,
    "- For phrases not listed, derive the range from today above. When a date range finds nothing, say which range you searched.",
    "Rules:",
    "- Never invent memories, dates or results. Anything about the user's cards must come from a tool result.",
    "- The app shows found cards as tappable tiles under your reply, so do not list every card in text: summarise in one or two sentences (how many, what they have in common, a notable detail).",
    "- When practice would help (mistakes found, cards about a theme found), call start_blind_box in the same turn so the user gets a start button. Do not ask \"要不要练习\" — the button is the offer.",
    "- If nothing is found, say so plainly and suggest a different search.",
    "- You cannot edit, move or delete cards yet; say so if asked.",
    `- Reply in ${zh ? "Simplified Chinese" : "the user's language"}. Keep replies short and warm, no headings, no markdown tables.`,
    input.learningLanguage ? `The user is learning ${input.learningLanguage}; quote words from cards exactly as written.` : "",
    input.contextCard ? `The user is asking about this card (id ${input.contextCard.id}) titled "${input.contextCard.title}":\n${input.contextCard.text.slice(0, 2000)}` : "",
  ].filter(Boolean).join("\n");
}
