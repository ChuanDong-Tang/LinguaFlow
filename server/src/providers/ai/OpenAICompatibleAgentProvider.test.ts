import assert from "node:assert/strict";
import test from "node:test";
import { AgentChunkAccumulator, toOpenAIMessages } from "./OpenAICompatibleAgentProvider.js";

test("tool call arguments streamed in pieces are joined per index", () => {
  const acc = new AgentChunkAccumulator();
  acc.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "search_cards", arguments: "{\"que" } }] } }] });
  acc.push({ choices: [{ delta: { tool_calls: [{ index: 1, id: "c2", function: { name: "practice_stats", arguments: "{}" } }] } }] });
  acc.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "ry\":\"装修\"}" } }] } }] });
  acc.push({ usage: { prompt_tokens: 10, completion_tokens: 4 } });
  assert.deepEqual(acc.toolCalls(), [
    { id: "c1", name: "search_cards", arguments: "{\"query\":\"装修\"}" },
    { id: "c2", name: "practice_stats", arguments: "{}" },
  ]);
  assert.deepEqual(acc.usage, { inputTokens: 10, outputTokens: 4, totalTokens: 14 });
});

test("text deltas pass through; no tools means no calls", () => {
  const acc = new AgentChunkAccumulator();
  assert.equal(acc.push({ choices: [{ delta: { content: "找到 3 张" } }] }), "找到 3 张");
  assert.equal(acc.push({ choices: [{ delta: {} }] }), "");
  assert.deepEqual(acc.toolCalls(), []);
});

test("messages map to the OpenAI wire format", () => {
  const wire = toOpenAIMessages([
    { role: "system", content: "s" },
    { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "get_card", arguments: "{}" }] },
    { role: "tool", toolCallId: "c1", content: "{\"ok\":true}" },
  ]);
  assert.deepEqual(wire, [
    { role: "system", content: "s" },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "get_card", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c1", content: "{\"ok\":true}" },
  ]);
});
