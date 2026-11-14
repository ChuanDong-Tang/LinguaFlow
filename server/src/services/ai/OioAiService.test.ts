import assert from "node:assert/strict";
import test from "node:test";
import type { AgentChatProvider, AgentRoundInput, AgentStreamEvent } from "@lf/core/ports/ai/AgentChatProvider.js";
import { dialogueTurns, OioAiService, type OioAiStreamEvent } from "./OioAiService.js";

function scriptedAgent(rounds: Array<AgentStreamEvent[]>): AgentChatProvider & { inputs: AgentRoundInput[] } {
  const inputs: AgentRoundInput[] = [];
  return {
    providerName: "fake", modelName: "fake-1", inputs,
    async streamRound(input, onEvent) {
      inputs.push(structuredClone(input));
      for (const event of rounds.shift() ?? [{ type: "done" }]) await onEvent(event);
    },
  };
}

function fixture(options: { agent: AgentChatProvider; practiceRows?: unknown[]; history?: Array<{ role: "user" | "assistant"; text: string; blocks?: unknown }>; thread?: Record<string, unknown> }) {
  const calls: string[] = [];
  const card = { recordId: "card_a", title: "装修", dateKey: "2026-10-20", preview: "We finally...", hasPhoto: true };
  const repository = {
    createThread: async () => "t1",
    findThread: async () => ({ id: "t1", title: "遛狗", cardId: null, ...options.thread }),
    listMessages: async () => options.history ?? [],
    linkDialogueCard: async (_u: string, _t: string, recordId: string) => { calls.push(`link:${recordId}`); },
    appendMessage: async (_u: string, _t: string, message: { role: string }) => { calls.push(`append:${message.role}`); return `m_${message.role}`; },
    cardFacts: async () => new Map([["card_a", { dateKey: "2026-10-20", hasPhoto: true }], ["card_b", { dateKey: "2025-01-01", hasPhoto: false }]]),
    previews: async (_u: string, ids: string[]) => new Map(ids.filter((id) => id === "card_a").map((id) => [id, card])),
    listCardsInRange: async () => [card],
    getCard: async () => null,
    practiceRows: async () => options.practiceRows ?? [],
  };
  const recall = {
    search: async () => [{ recordId: "card_a", displayTitle: "装修" }, { recordId: "card_b", displayTitle: "old" }],
    lexicalSearch: async () => [],
    withThumbnails: async (_u: string, cards: Array<Record<string, unknown>>) => cards.map((item) => ({ ...item, thumbnail: null })),
  };
  const usage = {
    reserveTokens: async () => { calls.push("reserve"); },
    settleTokens: async (input: { billableCharacters: number }) => { calls.push(`settle:${input.billableCharacters}`); },
    releaseTokens: async () => { calls.push("release"); },
  };
  const created: unknown[] = [];
  const cards = { create: async (input: { body: unknown }) => { created.push(input.body); return { id: "card:new" }; } };
  const preferences = { getByUserId: async () => ({ learningLanguage: "en-US", appLocale: "zh-CN" }) };
  const service = new OioAiService(repository as never, options.agent, recall as never, usage as never, cards as never, preferences);
  return { service, calls, created };
}

test("searches, shows cards, offers practice, answers, then bills", async () => {
  const agent = scriptedAgent([
    [{ type: "tool_calls", calls: [{ id: "c1", name: "search_cards", arguments: JSON.stringify({ query: "装修", date_from: "2026-10-01", date_to: "2026-10-31" }) }] }, { type: "done", usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 } }],
    [{ type: "tool_calls", calls: [{ id: "c2", name: "start_blind_box", arguments: JSON.stringify({ card_ids: ["card_a", "someone_else"] }) }] }, { type: "done" }],
    [{ type: "delta", text: "找到 1 张" }, { type: "done", usage: { inputTokens: 200, outputTokens: 5, totalTokens: 205 } }],
  ]);
  const { service, calls } = fixture({ agent });
  const events: OioAiStreamEvent[] = [];
  await service.chatStream({ userId: "u1", requestId: "r1", text: "上个月装修的", today: "2026-11-13" }, async (event) => { events.push(event); });

  const cards = events.find((event) => event.type === "cards");
  // The out-of-range card (2025) is filtered out by the date window.
  assert.deepEqual(cards && cards.type === "cards" ? cards.cards.map((card) => card.recordId) : null, ["card_a"]);
  const action = events.find((event) => event.type === "action");
  // Only the user's own card is offered.
  assert.deepEqual(action && action.type === "action" ? action.action.cardIds : null, ["card_a"]);
  assert.equal(events.filter((event) => event.type === "delta").map((event) => (event as { text: string }).text).join(""), "找到 1 张");
  assert.equal(events.at(-1)?.type, "done");
  assert.deepEqual(calls, ["reserve", "settle:6", "append:user", "append:assistant"]);
  // Tool results go back to the model as tool messages.
  assert.equal(agent.inputs[1]!.messages.at(-1)!.role, "tool");
});

test("a failed model call releases the reservation", async () => {
  const agent: AgentChatProvider = { providerName: "fake", modelName: "x", streamRound: async () => { throw Object.assign(new Error("boom"), { code: "UPSTREAM_AI_ERROR" }); } };
  const { service, calls } = fixture({ agent });
  await assert.rejects(service.chatStream({ userId: "u1", requestId: "r1", text: "hi", today: "2026-11-13" }, async () => undefined), { code: "UPSTREAM_AI_ERROR" });
  assert.deepEqual(calls, ["reserve", "release"]);
});

test("practice stats bring their own practice button, offered once per turn", async () => {
  const agent = scriptedAgent([
    [{ type: "tool_calls", calls: [{ id: "c1", name: "practice_stats", arguments: "{}" }] }, { type: "done" }],
    [{ type: "tool_calls", calls: [{ id: "c2", name: "start_blind_box", arguments: JSON.stringify({ card_ids: ["card_a"] }) }] }, { type: "done" }],
    [{ type: "delta", text: "tiles 错了一次" }, { type: "done" }],
  ]);
  const { service } = fixture({ agent, practiceRows: [{ cardId: "card_a", title: "装修", updatedAt: new Date(), clozeState: { blanks: [{ id: "b", answer: "tiles", attempts: 1, correctCount: 0, lastResult: "incorrect" }] } }] });
  const events: OioAiStreamEvent[] = [];
  await service.chatStream({ userId: "u1", requestId: "r1", text: "老错哪些词", today: "2026-11-14" }, async (event) => { events.push(event); });
  const actions = events.filter((event) => event.type === "action");
  assert.equal(actions.length, 1);
  assert.deepEqual(actions[0]!.type === "action" ? actions[0]!.action.cardIds : null, ["card_a"]);
});

test("the third message brings a one-time 存成卡片 offer", async () => {
  const history = [
    { role: "user" as const, text: "今天遛狗了" }, { role: "assistant" as const, text: "去哪儿遛的？" },
    { role: "user" as const, text: "楼下公园" }, { role: "assistant" as const, text: "狗狗开心吗？" },
  ];
  const { service } = fixture({ agent: scriptedAgent([[{ type: "delta", text: "听起来很惬意" }, { type: "done" }]]), history });
  const events: OioAiStreamEvent[] = [];
  await service.chatStream({ userId: "u1", requestId: "r1", threadId: "t1", text: "它跑得可欢了", today: "2026-11-15", appLocale: "zh-CN" }, async (event) => { events.push(event); });
  const offer = events.find((event) => event.type === "action");
  assert.equal(offer && offer.type === "action" ? offer.action.kind : null, "save_card");

  const offeredHistory = [...history.slice(0, 3), { role: "assistant" as const, text: "狗狗开心吗？", blocks: [{ type: "action", action: { kind: "save_card", label: "x" } }] }];
  const again = fixture({ agent: scriptedAgent([[{ type: "delta", text: "好呀" }, { type: "done" }]]), history: offeredHistory });
  const later: OioAiStreamEvent[] = [];
  await again.service.chatStream({ userId: "u1", requestId: "r2", threadId: "t1", text: "还有一件事", today: "2026-11-15" }, async (event) => { later.push(event); });
  assert.equal(later.some((event) => event.type === "action"), false);
});

test("a conversation becomes one card, line by line", async () => {
  const history = [
    { role: "user" as const, text: "今天遛狗了" }, { role: "assistant" as const, text: "去哪儿遛的？" },
    { role: "user" as const, text: "楼下公园" }, { role: "user" as const, text: "人很多" }, { role: "assistant" as const, text: "狗狗开心吗？" },
    { role: "user" as const, text: "没回复的一句" },
  ];
  const output = JSON.stringify({ title: "遛狗", turns: [{ user: "I walked the dog today.", oio: "Where did you go?" }, { user: "The park downstairs. It was crowded.", oio: "Was the dog happy?" }] });
  const { service, calls, created } = fixture({ agent: scriptedAgent([[{ type: "delta", text: output }, { type: "done" }]]), history });
  const result = await service.saveThreadAsCard({ userId: "u1", requestId: "r1", threadId: "t1" });
  assert.deepEqual(result, { recordId: "card:new", created: true });
  assert.deepEqual(created[0], {
    clientId: "oio-ai:t1", title: "遛狗",
    originalText: "今天遛狗了\n楼下公园 人很多",
    rewrittenText: "I walked the dog today.\nThe park downstairs. It was crowded.",
    replyText: "Where did you go?\nWas the dog happy?",
    generateRewrite: false,
  });
  assert.deepEqual(calls, ["reserve", "settle:59", "link:card:new"]);
  // Already saved: the same card, nothing generated.
  const saved = fixture({ agent: scriptedAgent([]), thread: { cardId: "card:old" } });
  assert.deepEqual(await saved.service.saveThreadAsCard({ userId: "u1", requestId: "r2", threadId: "t1" }), { recordId: "card:old", created: false });
  assert.deepEqual(saved.calls, []);
});

test("turns pair user messages with replies and drop unanswered ones", () => {
  assert.deepEqual(dialogueTurns([
    { role: "assistant", text: "你好" },
    { role: "user", text: "a\nb" }, { role: "assistant", text: "c" },
    { role: "user", text: "d" },
  ]), [{ user: "a b", oio: "c" }]);
});
