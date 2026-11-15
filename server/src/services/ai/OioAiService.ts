import type { AgentChatProvider, AgentMessage, AgentToolCall } from "@lf/core/ports/ai/AgentChatProvider.js";
import { buildDialogueCardPrompt, buildOioAiOpenerPrompt, buildOioAiSystemPrompt, OIO_AI_MAX_TOOL_ROUNDS, OIO_AI_PROMPT_VERSION, OIO_AI_THREAD_MAX_CHARS, OIO_AI_TOOLS, OIO_DIALOGUE_CARD_PROMPT_VERSION, oioAiProfile, parseDialogueCardOutput, parseOioAiOpener, type OioAiProfile } from "@lf/core/Prompts/oioAiPrompt.js";
import { practiceStats } from "@lf/core/text/practiceStats.js";
import type { OioAiCardSummary, PrismaOioAiRepository } from "../../infrastructure/repository/PrismaOioAiRepository.js";
import type { RecallService } from "../card/RecallService.js";
import type { UsageV2Service } from "../usage/UsageV2Service.js";
import type { CardService } from "../card/CardService.js";
import type { ContentSafetyService } from "../contentSafety/ContentSafetyService.js";

export type OioAiCard = OioAiCardSummary & { thumbnail: { url: string; width: number; height: number } | null };

/** Events streamed to the app (SSE). */
export type OioAiStreamEvent =
  | { type: "thread"; threadId: string }
  | { type: "delta"; text: string }
  | { type: "tool"; name: string }
  | { type: "cards"; cards: OioAiCard[] }
  | { type: "action"; action: OioAiAction }
  | { type: "done"; messageId: string; threadId: string };

/** start_blind_box: practise these cards; save_card: offer to save this conversation as a 对话卡; thread_full: the 1 万字 limit was reached. */
export type OioAiAction = { kind: "start_blind_box"; cardIds: string[]; label: string } | { kind: "save_card"; label: string } | { kind: "thread_full"; label: string };

type Block = { type: "cards"; cards: OioAiCard[] } | { type: "action"; action: OioAiAction };

const HISTORY_MESSAGES = 12;
/** 对话卡: the conversation's turns kept on the card (newest kept when longer). */
const DIALOGUE_MAX_TURNS = 60;
/** The user's lines on the card stay within the card's content limit (5000). */
const DIALOGUE_MAX_USER_CHARS = 4_500;
/** Openers: regenerated at most this often per user; recent ones are avoided. */
const OPENER_TTL_MS = 2 * 3_600_000;
const FALLBACK_OPENERS = {
  zh: [
    { greeting: "今天过得怎么样？", topics: ["今天有件小事", "最近在忙什么", "说说心情"] },
    { greeting: "最近有什么让你开心的事吗？", topics: ["一件开心事", "最近在追的剧", "周末计划"] },
    { greeting: "今天吃了什么好吃的？", topics: ["聊聊吃的", "今天的天气", "一个人"] },
  ],
  en: [
    { greeting: "How was your day?", topics: ["A small moment", "What I'm up to", "How I feel"] },
  ],
};
/** Offer 存成卡片 after this many of the user's messages, or earlier when they wrap up. */
const SAVE_OFFER_TURNS = 3;
const WRAP_UP = /(晚安|拜拜|再见|先这样|就这样|好了|不聊了|睡了|good ?night|bye)/iu;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

function oioAiError(code: string, message = code): Error {
  return Object.assign(new Error(message), { code });
}

function parseArgs(call: AgentToolCall): Record<string, unknown> {
  try {
    const value = JSON.parse(call.arguments || "{}");
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

const str = (value: unknown, max = 200) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
const int = (value: unknown, min: number, max: number, fallback: number) => {
  const number = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(min, Math.min(max, number));
};

/**
 * OIO AI (2026-11): a companion to chat with (v4) that can also find the
 * user's memories and help them practise through tools. Open to everyone and
 * billed with the existing UsageV2 token reservation; input and output pass
 * content safety. Every tool is scoped to `userId` from the session — the
 * model never chooses whose data. A conversation can be saved as one 对话卡.
 */
export class OioAiService {
  constructor(
    private readonly repository: PrismaOioAiRepository,
    private readonly agent: AgentChatProvider,
    private readonly recall: RecallService,
    private readonly usage: UsageV2Service,
    private readonly cards: Pick<CardService, "create">,
    private readonly preferences: { getByUserId(userId: string): Promise<{ learningLanguage: string; appLocale: string }> },
    private readonly contentSafety?: ContentSafetyService,
  ) {}

  /** Served openers per user: accepted back from the app only if we served them. */
  private readonly openers = new Map<string, { at: number; opener: { greeting: string; topics: string[] }; recent: string[] }>();

  private async profile(userId: string): Promise<OioAiProfile> {
    return oioAiProfile(await this.repository.profileFacts(userId, new Date(Date.now() - 60 * 86_400_000)));
  }

  /**
   * A personal greeting and three topics to start a chat (2026-11): drawn from
   * what the user records, varied each time (recent ones avoided), regenerated
   * at most every 2 hours. A small platform-owned call, not billed; falls back
   * to light everyday openers.
   */
  async opener(input: { userId: string; appLocale?: string; today: string; hour: number; refresh?: boolean }): Promise<{ greeting: string; topics: string[] }> {
    const cached = this.openers.get(input.userId);
    if (cached && !input.refresh && Date.now() - cached.at < OPENER_TTL_MS) return cached.opener;
    const recent = cached?.recent ?? [];
    let opener: { greeting: string; topics: string[] } | null = null;
    try {
      const profile = await this.profile(input.userId);
      const prompt = buildOioAiOpenerPrompt({ appLocale: input.appLocale, today: input.today, hour: input.hour, profile, avoid: recent });
      let raw = "";
      await this.agent.streamRound({ messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }], tools: [], maxOutputTokens: 200, temperature: 0.9 }, (event) => {
        if (event.type === "delta") raw += event.text;
      });
      opener = parseOioAiOpener(raw);
      if (opener) this.contentSafety?.assertAllowed(`${opener.greeting}\n${opener.topics.join("\n")}`, "output");
    } catch {
      opener = null;
    }
    if (!opener) {
      const pool = input.appLocale && !input.appLocale.startsWith("zh") ? FALLBACK_OPENERS.en : FALLBACK_OPENERS.zh;
      opener = pool.find((item) => !recent.includes(item.greeting)) ?? pool[0]!;
    }
    // Remember greetings and topics, so the next ones differ.
    this.openers.set(input.userId, { at: Date.now(), opener, recent: [opener.greeting, ...opener.topics, ...recent].slice(0, 16) });
    return opener;
  }

  listThreads(userId: string) {
    return this.repository.listThreads(userId, 30);
  }

  async deleteThread(userId: string, threadId: string): Promise<void> {
    if (!await this.repository.deleteThread(userId, threadId)) throw oioAiError("OIO_AI_THREAD_NOT_FOUND");
  }

  async listMessages(userId: string, threadId: string) {
    const thread = await this.repository.findThread(userId, threadId);
    if (!thread) throw oioAiError("OIO_AI_THREAD_NOT_FOUND");
    const messages = await this.repository.listMessages(userId, threadId, 200);
    const chars = messages.reduce((sum, message) => sum + Array.from(message.text).length, 0);
    // A deleted 对话卡 no longer counts: the conversation can be saved again.
    const cardId = await this.repository.liveCardId(userId, thread.cardId);
    return { cardId, full: chars >= OIO_AI_THREAD_MAX_CHARS, messages: messages.map(({ trace: _trace, ...message }) => message) };
  }

  async chatStream(input: {
    userId: string;
    requestId: string;
    text: string;
    /** The greeting the chat was opened with (kept only if we served it). */
    opener?: string;
    threadId?: string;
    contextCardId?: string;
    appLocale?: string;
    today: string;
    signal?: AbortSignal;
  }, emit: (event: OioAiStreamEvent) => Promise<void>): Promise<void> {
    const text = input.text.trim().slice(0, 1_000);
    if (!text) throw oioAiError("REQUEST_INVALID");
    this.contentSafety?.assertAllowed(text, "input");
    await this.contentSafety?.assertAllowedRemote({ text, stage: "input", requestId: input.requestId, userId: input.userId });

    let threadId = input.threadId;
    const thread = threadId ? await this.repository.findThread(input.userId, threadId) : null;
    if (threadId && !thread) throw oioAiError("OIO_AI_THREAD_NOT_FOUND");
    // 1 万字 per conversation: past it, save it as a card or start a new chat.
    const usedChars = threadId ? await this.repository.threadChars(input.userId, threadId) : 0;
    if (usedChars >= OIO_AI_THREAD_MAX_CHARS) throw oioAiError("OIO_AI_THREAD_FULL");
    const contextCard = input.contextCardId ? await this.repository.getCard(input.userId, input.contextCardId) : null;
    const history = threadId ? await this.repository.listMessages(input.userId, threadId, HISTORY_MESSAGES) : [];
    const servedOpener = this.openers.get(input.userId)?.opener.greeting;
    const opener = !threadId && input.opener && input.opener === servedOpener ? input.opener : null;
    if (!threadId) {
      threadId = await this.repository.createThread(input.userId, { title: text.slice(0, 40), contextCardId: contextCard?.recordId ?? null });
      // The chat starts with OIO's greeting, so the reply has its context.
      if (opener) await this.repository.appendMessage(input.userId, threadId, { role: "assistant", text: opener, promptVersion: "oio-ai-opener-v1" });
    }
    await emit({ type: "thread", threadId });
    const profile = await this.profile(input.userId).catch(() => null);

    const messages: AgentMessage[] = [
      { role: "system", content: buildOioAiSystemPrompt({
        today: input.today,
        appLocale: input.appLocale,
        contextCard: contextCard ? { id: contextCard.recordId, title: contextCard.title, text: contextCard.rewrite || contextCard.original } : null,
        profile,
      }) },
      ...(opener ? [{ role: "assistant" as const, content: opener }] : []),
      ...history.map((message): AgentMessage => message.role === "user"
        ? { role: "user", content: message.text }
        // Keep which cards were shown, so "练这几张" works on the next turn.
        : { role: "assistant", content: `${message.text}${shownCardsNote(message.blocks)}` }),
      { role: "user", content: text },
    ];

    await this.usage.reserveTokens({
      userId: input.userId, requestId: input.requestId, feature: "reply", estimatedTokens: 8_000,
      provider: this.agent.providerName, model: this.agent.modelName, metadata: { surface: "oio_ai" },
    });
    let answer = "";
    const blocks: Block[] = [];
    const trace: Array<{ name: string; args: Record<string, unknown>; resultCount?: number; error?: string }> = [];
    const used = { input: 0, output: 0 };
    const offered = { practice: false };
    try {
      for (let round = 0; round <= OIO_AI_MAX_TOOL_ROUNDS; round += 1) {
        let roundText = "";
        let calls: AgentToolCall[] = [];
        await this.agent.streamRound({
          messages,
          // Last round: no tools, so the model must answer with what it has.
          tools: round < OIO_AI_MAX_TOOL_ROUNDS ? OIO_AI_TOOLS : [],
          maxOutputTokens: 900,
          signal: input.signal,
        }, async (event) => {
          if (event.type === "delta") { roundText += event.text; await emit({ type: "delta", text: event.text }); }
          else if (event.type === "tool_calls") calls = event.calls;
          else if (event.usage) { used.input += event.usage.inputTokens; used.output += event.usage.outputTokens; }
        });
        answer += roundText;
        if (!calls.length) break;
        messages.push({ role: "assistant", content: roundText, toolCalls: calls });
        for (const call of calls) {
          await emit({ type: "tool", name: call.name });
          const args = parseArgs(call);
          let result: unknown;
          try {
            result = await this.runTool(input.userId, call.name, args, offered, async (block) => {
              if (block.type === "action") { if (offered.practice) return; offered.practice = true; }
              blocks.push(block);
              await emit(block.type === "cards" ? { type: "cards", cards: block.cards } : { type: "action", action: block.action });
            });
            trace.push({ name: call.name, args, resultCount: Array.isArray((result as { cards?: unknown[] })?.cards) ? (result as { cards: unknown[] }).cards.length : undefined });
          } catch (error) {
            const code = error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : "TOOL_FAILED";
            result = { error: code };
            trace.push({ name: call.name, args, error: code });
          }
          messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify(result) });
        }
      }
      await this.usage.settleTokens({
        userId: input.userId, requestId: input.requestId,
        inputTokens: used.input || Math.ceil(JSON.stringify(messages).length / 2),
        outputTokens: used.output || Math.ceil(answer.length / 2),
        billableCharacters: Array.from(answer).length,
        meteringSource: used.input ? "provider" : "tokenizer",
        provider: this.agent.providerName, model: this.agent.modelName, metadata: { surface: "oio_ai" },
      });
    } catch (error) {
      await this.usage.releaseTokens(input.userId, input.requestId).catch(() => undefined);
      throw error;
    }
    // The reply streamed already; if it fails review it is not kept (the app clears it).
    if (answer.trim()) {
      this.contentSafety?.assertAllowed(answer, "output");
      await this.contentSafety?.assertAllowedRemote({ text: answer, stage: "output", requestId: input.requestId, userId: input.userId });
    }
    // 存成卡片: offered once per conversation, by the server (not left to the model).
    const userTurns = history.filter((message) => message.role === "user").length + 1;
    const offeredBefore = history.some((message) => Array.isArray(message.blocks) && (message.blocks as Block[]).some((block) => block.type === "action" && block.action.kind === "save_card"));
    const zh = !input.appLocale || input.appLocale.startsWith("zh");
    if (usedChars + Array.from(text).length + Array.from(answer).length >= OIO_AI_THREAD_MAX_CHARS) {
      const block: Block = { type: "action", action: { kind: "thread_full", label: zh ? "这段对话已经很长啦，存成卡片，或者开个新对话接着聊" : "This chat is getting long — save it as a card or start a new one" } };
      blocks.push(block);
      await emit({ type: "action", action: block.action });
    } else if (!thread?.cardId && !offeredBefore && answer.trim() && (userTurns >= SAVE_OFFER_TURNS || (userTurns >= 2 && WRAP_UP.test(text)))) {
      const block: Block = { type: "action", action: { kind: "save_card", label: zh ? "把这段对话存成卡片" : "Save this chat as a card" } };
      blocks.push(block);
      await emit({ type: "action", action: block.action });
    }
    await this.repository.appendMessage(input.userId, threadId, { role: "user", text, requestId: input.requestId });
    const messageId = await this.repository.appendMessage(input.userId, threadId, {
      role: "assistant", text: answer.trim(), blocks, trace, requestId: input.requestId, promptVersion: OIO_AI_PROMPT_VERSION,
    });
    await emit({ type: "done", messageId, threadId });
  }

  /**
   * 对话卡: the whole conversation as one card, line by line — the user's
   * messages (Chinese kept as the original) rewritten in the learning language
   * as the card's text, OIO's replies as its reply. Idempotent per thread.
   */
  async saveThreadAsCard(input: { userId: string; requestId: string; threadId: string }): Promise<{ recordId: string; created: boolean }> {
    const thread = await this.repository.findThread(input.userId, input.threadId);
    if (!thread) throw oioAiError("OIO_AI_THREAD_NOT_FOUND");
    const existing = await this.repository.liveCardId(input.userId, thread.cardId);
    if (existing) return { recordId: existing, created: false };
    // The saved card was deleted: save the conversation again as a new card.
    if (thread.cardId) await this.repository.clearThreadCard(input.userId, input.threadId);
    const turns = dialogueTurns(await this.repository.listMessages(input.userId, input.threadId, 200));
    if (!turns.length) throw oioAiError("OIO_AI_NOTHING_TO_SAVE");
    const preference = await this.preferences.getByUserId(input.userId);
    const prompt = buildDialogueCardPrompt({ learningLanguage: preference.learningLanguage, appLocale: preference.appLocale, turns });
    await this.usage.reserveTokens({
      userId: input.userId, requestId: input.requestId, feature: "rewrite", estimatedTokens: 6_000,
      provider: this.agent.providerName, model: this.agent.modelName, metadata: { surface: "oio_ai_card" },
    });
    let parsed: ReturnType<typeof parseDialogueCardOutput> = null;
    const used = { input: 0, output: 0 };
    let raw = "";
    try {
      for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
        raw = "";
        await this.agent.streamRound({
          messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
          tools: [], maxOutputTokens: 3_000, temperature: 0.3,
        }, (event) => {
          if (event.type === "delta") raw += event.text;
          else if (event.type === "done" && event.usage) { used.input += event.usage.inputTokens; used.output += event.usage.outputTokens; }
        });
        parsed = parseDialogueCardOutput(raw, turns.length);
      }
      if (!parsed) throw oioAiError("OIO_AI_CARD_FAILED");
      await this.usage.settleTokens({
        userId: input.userId, requestId: input.requestId,
        inputTokens: used.input || Math.ceil(prompt.user.length / 2), outputTokens: used.output || Math.ceil(raw.length / 2),
        billableCharacters: Array.from(parsed.turns.map((turn) => turn.user).join("")).length,
        meteringSource: used.input ? "provider" : "tokenizer",
        provider: this.agent.providerName, model: this.agent.modelName, metadata: { surface: "oio_ai_card", promptVersion: OIO_DIALOGUE_CARD_PROMPT_VERSION },
      });
    } catch (error) {
      await this.usage.releaseTokens(input.userId, input.requestId).catch(() => undefined);
      throw error;
    }
    // The normal card path: content safety on everything, no AI rewrite (we bring it).
    const card = await this.cards.create({
      userId: input.userId,
      requestId: input.requestId,
      body: {
        // Unique per save, so a conversation whose card was deleted can be saved again.
        clientId: `oio-ai:${input.threadId}:${Date.now()}`,
        title: parsed.title || thread.title?.slice(0, 16) || null,
        originalText: turns.map((turn) => turn.user).join("\n"),
        rewrittenText: parsed.turns.map((turn) => turn.user).join("\n"),
        replyText: parsed.turns.map((turn) => turn.oio).join("\n"),
        generateRewrite: false,
      },
    } as Parameters<CardService["create"]>[0]);
    await this.repository.linkDialogueCard(input.userId, input.threadId, card.id);
    return { recordId: card.id, created: true };
  }

  /** Runs one tool. `show` sends a block (cards / button) to the app and saves it on the reply. */
  private async runTool(userId: string, name: string, args: Record<string, unknown>, offered: { practice: boolean }, show: (block: Block) => Promise<void>): Promise<unknown> {
    if (name === "search_cards") {
      const query = str(args.query);
      const dateFrom = DATE.test(String(args.date_from ?? "")) ? String(args.date_from) : undefined;
      const dateTo = DATE.test(String(args.date_to ?? "")) ? String(args.date_to) : undefined;
      const hasPhoto = args.has_photo === true;
      const limit = int(args.limit, 1, 20, 10);
      let cards: OioAiCardSummary[];
      if (query) {
        const found = await this.recall.search(userId, { query, limit: 20 });
        const facts = await this.repository.cardFacts(userId, found.map((item) => item.recordId));
        const previews = await this.repository.previews(userId, found.map((item) => item.recordId));
        cards = found.flatMap((item) => {
          const fact = facts.get(item.recordId);
          const preview = previews.get(item.recordId);
          if (!fact || !preview) return [];
          if (dateFrom && fact.dateKey < dateFrom) return [];
          if (dateTo && fact.dateKey > dateTo) return [];
          if (hasPhoto && !fact.hasPhoto) return [];
          return [preview];
        }).slice(0, limit);
      } else {
        cards = await this.repository.listCardsInRange(userId, { dateFrom, dateTo, hasPhoto, limit });
      }
      if (cards.length) await show({ type: "cards", cards: await this.withThumbnails(userId, cards) });
      return { count: cards.length, cards: cards.map(forModel) };
    }
    if (name === "get_card") {
      const card = await this.repository.getCard(userId, String(args.card_id ?? ""));
      if (!card) return { error: "CARD_NOT_FOUND" };
      return { ...card, original: card.original.slice(0, 1_500), rewrite: card.rewrite.slice(0, 1_500), reply: card.reply.slice(0, 600) };
    }
    if (name === "practice_stats") {
      const days = int(args.days, 1, 365, 30);
      const stats = practiceStats(await this.repository.practiceRows(userId, new Date(Date.now() - days * 86_400_000)), { limit: 10 });
      const ids = stats.cardsWithMistakes.slice(0, 6).map((card) => card.cardId);
      const previews = await this.repository.previews(userId, ids);
      const cards = ids.flatMap((id) => previews.get(id) ? [previews.get(id)!] : []);
      if (cards.length) {
        await show({ type: "cards", cards: await this.withThumbnails(userId, cards) });
        // The practice button comes with the mistakes, not at the model's discretion
        // (it sometimes said a button was ready without offering one).
        await show({ type: "action", action: { kind: "start_blind_box", cardIds: cards.map((card) => card.recordId), label: `用这 ${cards.length} 张练一组` } });
      }
      return { days, ...stats, practiceButtonShown: cards.length > 0 };
    }
    if (name === "find_word_in_my_cards") {
      const text = str(args.text, 100);
      if (!text) return { error: "TEXT_REQUIRED" };
      const found = await this.recall.lexicalSearch(userId, { query: text, limit: 12 });
      const previews = await this.repository.previews(userId, found.map((item) => item.recordId));
      const cards = found.flatMap((item) => previews.get(item.recordId) ? [previews.get(item.recordId)!] : []);
      if (cards.length) await show({ type: "cards", cards: await this.withThumbnails(userId, cards) });
      return { count: cards.length, occurrences: found.slice(0, 12).map((item) => ({ id: item.recordId, title: item.displayTitle, sentences: (item.matches ?? []).slice(0, 2).map((match) => match.sentence) })) };
    }
    if (name === "start_blind_box") {
      if (offered.practice) return { ok: true, alreadyShown: true };
      const requested = Array.isArray(args.card_ids) ? args.card_ids.map(String).slice(0, 50) : [];
      const owned = await this.repository.previews(userId, requested);
      const cardIds = requested.filter((id) => owned.has(id));
      if (!cardIds.length) return { error: "NO_VALID_CARDS" };
      const label = str(args.label, 30) ?? `用这 ${cardIds.length} 张开一组盲盒`;
      await show({ type: "action", action: { kind: "start_blind_box", cardIds, label } });
      return { ok: true, offered: cardIds.length };
    }
    return { error: "UNKNOWN_TOOL" };
  }

  private async withThumbnails(userId: string, cards: OioAiCardSummary[]): Promise<OioAiCard[]> {
    const withImages = await this.recall.withThumbnails(userId, cards);
    return withImages.map((card) => ({ ...card, thumbnail: card.thumbnail ? { url: card.thumbnail.url, width: card.thumbnail.width, height: card.thumbnail.height } : null }));
  }
}

function forModel(card: OioAiCardSummary) {
  return { id: card.recordId, title: card.title, date: card.dateKey, photo: card.hasPhoto, preview: card.preview.slice(0, 90) };
}

function shownCardsNote(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  const ids = blocks.flatMap((block) => block && typeof block === "object" && (block as Block).type === "cards" ? (block as { cards: OioAiCardSummary[] }).cards.map((card) => card.recordId) : []);
  return ids.length ? `\n[cards shown: ${ids.slice(0, 20).join(", ")}]` : "";
}

/**
 * Pair the conversation into turns: each user message (consecutive ones joined)
 * with OIO's reply. Turns without a reply are dropped so lines pair 1:1; long
 * conversations keep their newest turns within the card's limits.
 */
export function dialogueTurns(messages: Array<{ role: "user" | "assistant"; text: string }>): Array<{ user: string; oio: string }> {
  const turns: Array<{ user: string; oio: string }> = [];
  let pending: string[] = [];
  for (const message of messages) {
    const text = message.text.replace(/\s*\n+\s*/gu, " ").trim();
    if (!text) continue;
    if (message.role === "user") { pending.push(text); continue; }
    if (!pending.length) continue;
    turns.push({ user: pending.join(" "), oio: text });
    pending = [];
  }
  // The whole conversation when it fits the card; otherwise its newest turns.
  const kept: typeof turns = [];
  let chars = 0;
  for (const turn of turns.reverse()) {
    chars += Array.from(turn.user).length;
    if (kept.length >= DIALOGUE_MAX_TURNS || (kept.length && chars > DIALOGUE_MAX_USER_CHARS)) break;
    kept.unshift(turn);
  }
  return kept;
}
