import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessage } from "./types";
import { removeInactiveAssistantPlaceholders } from "./messageState";

const NOW = Date.parse("2026-07-14T14:00:00.000Z");

function message(input: Partial<ChatMessage> & Pick<ChatMessage, "clientId">): ChatMessage {
  const { clientId, ...overrides } = input;
  return {
    localId: clientId,
    clientId,
    role: "assistant",
    text: "",
    time: "22:00",
    createdAt: "2026-07-14T13:59:30.000Z",
    status: "pending",
    ...overrides,
  };
}

test("keeps the placeholder for the active assistant generation", () => {
  const active = message({
    clientId: "assistant-active",
    createdAt: "2026-07-14T13:00:00.000Z",
  });

  assert.deepEqual(
    removeInactiveAssistantPlaceholders([active], new Set([active.clientId]), NOW),
    [active]
  );
});

test("keeps a recent placeholder during the send-to-session handoff", () => {
  const recent = message({ clientId: "assistant-recent" });

  assert.deepEqual(
    removeInactiveAssistantPlaceholders([recent], new Set(), NOW),
    [recent]
  );
});

test("removes an old pending assistant when no generation owns it", () => {
  const stale = message({
    clientId: "assistant-stale",
    createdAt: "2026-07-14T13:50:00.000Z",
  });
  const completed = message({
    clientId: "assistant-complete",
    status: "success",
    text: "Super healing",
    createdAt: "2026-07-14T13:50:10.000Z",
  });
  const user = message({
    clientId: "user-message",
    role: "user",
    status: "success",
    text: "非常治愈",
    createdAt: "2026-07-14T13:50:00.000Z",
  });

  assert.deepEqual(
    removeInactiveAssistantPlaceholders([user, stale, completed], new Set(), NOW),
    [user, completed]
  );
});
