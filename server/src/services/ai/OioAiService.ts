import type { AgentChatProvider, AgentMessage, AgentToolCall } from "@lf/core/ports/ai/AgentChatProvider.js";
import { buildOioAiSystemPrompt, OIO_AI_MAX_TOOL_ROUNDS, OIO_AI_PROMPT_VERSION, OIO_AI_TOOLS } from "@lf/core/Prompts/oioAiPrompt.js";
import { practiceStats } from "@lf/core/text/practiceStats.js";
import type { OioAiCardSummary, PrismaOioAiRepository } from "../../infrastructure/repository/PrismaOioAiRepository.js";
import type { RecallService } from "../card/RecallService.js";
import type { UsageV2Service } from "../usage/UsageV2Service.js";
import type { SubscriptionService } from "../subscription/SubscriptionService.js";
import type { ContentSafetyService } from "../contentSafety/ContentSafetyService.js";

export type OioAiCard = OioAiCardSummary & { thumbnail: { url: string; width: number; height: number } | null };

/** Events streamed to the app (SSE). */
export type OioAiStreamEvent =
  | { type: "thread"; threadId: string }
  | { type: "delta"; text: string }
  | { type: "tool"; name: string }
  | { type: "cards"; cards: OioAiCard[] }
  | { type: "action"; action: { kind: "start_blind_box"; cardIds: string[]; label: string } }
  | { type: "done"; messageId: string; threadId: string };

type Block = { type: "cards"; cards: OioAiCard[] } | { type: "action"; action: { kind: "start_blind_box"; cardIds: string[]; label: string } };

const HISTORY_MESSAGES = 12;
const MEMBER_TIERS = new Set(["plus", "pro"]);
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
 * OIO AI (2026-11, phase 1): a tool-calling agent over the user's own cards.
 * Members only; billed with the existing UsageV2 token reservation. Every tool
 * is scoped to `userId` from the session — the model never chooses whose data.
 */
export class OioAiService {
  constructor(
    private readonly repository: PrismaOioAiRepository,
    private readonly agent: AgentChatProvider,
    private readonly recall: RecallService,
    private readonly usage: UsageV2Service,
    private readonly subscriptions: SubscriptionService,
    private readonly contentSafety?: ContentSafetyService,
  ) {}

  async assertMember(userId: string): Promise<void> {
    const subscription = await this.subscriptions.getCurrentSubscription(userId);
    if (!MEMBER_TIERS.has(String(subscription.tier))) throw oioAiError("OIO_AI_MEMBERS_ONLY", "OIO AI is for members.");
  }

  listThreads(userId: string) {
    return this.repository.listThreads(userId, 30);
  }

  async listMessages(userId: string, threadId: string) {
    if (!await this.repository.findThread(userId, threadId)) throw oioAiError("OIO_AI_THREAD_NOT_FOUND");
    const messages = await this.repository.listMessages(userId, threadId, 60);
    return messages.map(({ trace: _trace, ...message }) => message);
  }

  async chatStream(input: {
    userId: string;
    requestId: string;
    text: string;
    threadId?: string;
    contextCardId?: string;
    appLocale?: string;
    today: string;
    signal?: AbortSignal;
  }, emit: (event: OioAiStreamEvent) => Promise<void>): Promise<void> {
    const text = input.text.trim().slice(0, 1_000);
    if (!text) throw oioAiError("REQUEST_INVALID");
    await this.assertMember(input.userId);
    this.contentSafety?.assertAllowed(text, "input");

    let threadId = input.threadId;
    if (threadId && !await this.repository.findThread(input.userId, threadId)) throw oioAiError("OIO_AI_THREAD_NOT_FOUND");
    const contextCard = input.contextCardId ? await this.repository.getCard(input.userId, input.contextCardId) : null;
    const history = threadId ? await this.repository.listMessages(input.userId, threadId, HISTORY_MESSAGES) : [];
    threadId ??= await this.repository.createThread(input.userId, { title: text.slice(0, 40), contextCardId: contextCard?.recordId ?? null });
    await emit({ type: "thread", threadId });

    const messages: AgentMessage[] = [
      { role: "system", content: buildOioAiSystemPrompt({
        today: input.today,
        appLocale: input.appLocale,
        contextCard: contextCard ? { id: contextCard.recordId, title: contextCard.title, text: contextCard.rewrite || contextCard.original } : null,
      }) },
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
            result = await this.runTool(input.userId, call.name, args, async (block) => {
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
    await this.repository.appendMessage(input.userId, threadId, { role: "user", text, requestId: input.requestId });
    const messageId = await this.repository.appendMessage(input.userId, threadId, {
      role: "assistant", text: answer.trim(), blocks, trace, requestId: input.requestId, promptVersion: OIO_AI_PROMPT_VERSION,
    });
    await emit({ type: "done", messageId, threadId });
  }

  /** Runs one tool. `show` sends a block (cards / button) to the app and saves it on the reply. */
  private async runTool(userId: string, name: string, args: Record<string, unknown>, show: (block: Block) => Promise<void>): Promise<unknown> {
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
      if (cards.length) await show({ type: "cards", cards: await this.withThumbnails(userId, cards) });
      return { days, ...stats };
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
