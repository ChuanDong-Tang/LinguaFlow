import assert from "node:assert/strict";
import test from "node:test";
import type { AgentChatProvider, AgentRoundInput, AgentStreamEvent } from "@lf/core/ports/ai/AgentChatProvider.js";
import { OioAiService, type OioAiStreamEvent } from "./OioAiService.js";

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

function fixture(options: { tier?: string; agent: AgentChatProvider }) {
  const calls: string[] = [];
  const card = { recordId: "card_a", title: "装修", dateKey: "2026-10-20", preview: "We finally...", hasPhoto: true };
  const repository = {
    createThread: async () => "t1",
    findThread: async () => ({ id: "t1" }),
    listMessages: async () => [],
    appendMessage: async (_u: string, _t: string, message: { role: string }) => { calls.push(`append:${message.role}`); return `m_${message.role}`; },
    cardFacts: async () => new Map([["card_a", { dateKey: "2026-10-20", hasPhoto: true }], ["card_b", { dateKey: "2025-01-01", hasPhoto: false }]]),
    previews: async (_u: string, ids: string[]) => new Map(ids.filter((id) => id === "card_a").map((id) => [id, card])),
    listCardsInRange: async () => [card],
    getCard: async () => null,
    practiceRows: async () => [],
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
  const subscriptions = { getCurrentSubscription: async () => ({ tier: options.tier ?? "pro" }) };
  const service = new OioAiService(repository as never, options.agent, recall as never, usage as never, subscriptions as never);
  return { service, calls };
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

test("non-members are refused before anything is reserved", async () => {
  const { service, calls } = fixture({ tier: "free", agent: scriptedAgent([]) });
  await assert.rejects(service.chatStream({ userId: "u1", requestId: "r1", text: "hi", today: "2026-11-13" }, async () => undefined), { code: "OIO_AI_MEMBERS_ONLY" });
  assert.deepEqual(calls, []);
});

test("a failed model call releases the reservation", async () => {
  const agent: AgentChatProvider = { providerName: "fake", modelName: "x", streamRound: async () => { throw Object.assign(new Error("boom"), { code: "UPSTREAM_AI_ERROR" }); } };
  const { service, calls } = fixture({ agent });
  await assert.rejects(service.chatStream({ userId: "u1", requestId: "r1", text: "hi", today: "2026-11-13" }, async () => undefined), { code: "UPSTREAM_AI_ERROR" });
  assert.deepEqual(calls, ["reserve", "release"]);
});
