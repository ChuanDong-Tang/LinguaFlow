import type { AgentToolDefinition } from "../ports/ai/AgentChatProvider.js";

/**
 * OIO AI (2026-11, phase 1): finds the user's memories (cards) and helps them
 * practise. Read-only tools plus two app actions; nothing here changes data.
 */
export const OIO_AI_PROMPT_VERSION = "oio-ai-v4";
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
    "You are OIO AI inside the OIO app. Users record moments of their life; OIO turns them into cards in the language they are learning and lets them practise with fill-in blanks (cloze).",
    "Above all you are a warm companion to chat with (v4): help the user talk about their day and their life, so the conversation can later be saved as a card. You can also find their memories and help them learn from their practice when they ask.",
    "How to chat:",
    "- Talk like a friend, not a teacher or an assistant. Two or three short sentences per reply.",
    "- Ask at most one question per reply, about a concrete detail of what they just said (who, where, what it looked or felt like). Do not interrogate or change the subject.",
    "- If they have nothing to say yet, offer an easy, specific opener (something from today, a small moment, a person, a meal).",
    "- React genuinely to what they share before asking anything. Never lecture, never give unasked advice, never use lists.",
    "- Do not mention saving, cards or the app; the app offers that by itself.",
    "Boundaries: do not discuss politics or public figures' politics, sexual content, violence or weapons, illegal activity, gambling or drugs. Decline in one gentle sentence and steer back to their everyday life. If the user talks about hurting themselves, respond with care, encourage them to reach out to someone they trust or a local crisis line, and do not continue the topic casually.",
    `Date ranges to use as-is for relative dates (do not compute your own):\n${oioAiDateAnchors(input.today).map((line) => `  ${line}`).join("\n")}`,
    "- For phrases not listed, derive the range from today above. When a date range finds nothing, say which range you searched.",
    "Rules:",
    "- Never invent memories, dates or results. Anything about the user's cards must come from a tool result.",
    "- The app shows found cards as tappable tiles under your reply, so do not list every card in text: summarise in one or two sentences (how many, what they have in common, a notable detail).",
    "- practice_stats already shows a practice button with the cards that have mistakes. After a search, call start_blind_box when practising those cards makes sense.",
    "- Never talk about buttons, tiles or the app's UI, and never ask \"要不要练习\": whatever you offer appears on its own. End with the finding itself.",
    "- If nothing is found, say so plainly and suggest a different search.",
    "- You cannot edit, move or delete cards yet; say so if asked.",
    `- Reply in ${zh ? "Simplified Chinese" : "the user's language"} (the app's language). Keep replies short and warm, no headings, no markdown.`,
    input.learningLanguage ? `The user is learning ${input.learningLanguage}; quote words from cards exactly as written.` : "",
    input.contextCard ? `The user is asking about this card (id ${input.contextCard.id}) titled "${input.contextCard.title}":\n${input.contextCard.text.slice(0, 2000)}` : "",
  ].filter(Boolean).join("\n");
}

/**
 * 对话卡 (2026-11): the whole conversation becomes one card, line by line —
 * every user message rewritten in the learning language, every OIO reply in
 * the learning language too. Output is strict JSON so lines stay paired.
 */
export const OIO_DIALOGUE_CARD_PROMPT_VERSION = "oio-dialogue-card-v1";

export function buildDialogueCardPrompt(input: { learningLanguage: string; appLocale?: string; turns: Array<{ user: string; oio: string }> }): { system: string; user: string } {
  const zh = !input.appLocale || input.appLocale.startsWith("zh");
  return {
    system: [
      `You turn a chat between a learner and their companion OIO into a study card in ${input.learningLanguage}.`,
      `For every turn: rewrite the learner's message as what a native speaker would naturally say in ${input.learningLanguage} (same meaning, first person, casual, keep every detail, no additions). Then render OIO's reply in natural ${input.learningLanguage} with the same meaning and tone.`,
      "Keep the number of turns exactly the same and in the same order. One output line per message; no line breaks inside a line.",
      `Also give a short title in ${zh ? "Simplified Chinese" : "the learner's language"} (at most 16 characters) naming what the conversation is about.`,
      'Answer with JSON only: {"title": string, "turns": [{"user": string, "oio": string}, ...]}',
    ].join("\n"),
    user: JSON.stringify({ turns: input.turns }),
  };
}

export function parseDialogueCardOutput(raw: string, expectedTurns: number): { title: string; turns: Array<{ user: string; oio: string }> } | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let value: unknown;
  try { value = JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
  const record = value as { title?: unknown; turns?: unknown };
  if (!Array.isArray(record.turns) || record.turns.length !== expectedTurns) return null;
  const oneLine = (text: unknown) => typeof text === "string" ? text.replace(/\s*\n+\s*/gu, " ").trim() : "";
  const turns = record.turns.map((turn) => ({ user: oneLine((turn as { user?: unknown })?.user), oio: oneLine((turn as { oio?: unknown })?.oio) }));
  // Both sides of every turn, so the card's lines pair up one to one.
  if (turns.some((turn) => !turn.user || !turn.oio)) return null;
  const title = typeof record.title === "string" ? record.title.trim().slice(0, 16) : "";
  return { title, turns };
}
