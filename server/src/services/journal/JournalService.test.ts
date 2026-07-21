import assert from "node:assert/strict";
import test from "node:test";
import type { MessageEntity } from "@lf/core/ports/repository/MessageRepository.js";
import {
  JournalPracticeConflictError,
  JournalService,
  JournalValidationError,
  pairLegacyMessages,
} from "./JournalService.js";

test("legacy pairing prefers the latest successful assistant for an explicit source", () => {
  const user = message({ id: "u1", role: "user", createdAt: "2026-07-20T01:00:00Z" });
  const older = message({
    id: "a1",
    role: "assistant",
    sourceMessageId: user.id,
    createdAt: "2026-07-20T01:00:01Z",
  });
  const latest = message({
    id: "a2",
    role: "assistant",
    sourceMessageId: user.id,
    createdAt: "2026-07-20T01:00:02Z",
  });

  const pairs = pairLegacyMessages([latest, user, older]);

  assert.equal(pairs.length, 1);
  assert.equal(pairs[0]?.assistant.id, latest.id);
});

test("legacy pairing only falls back to an adjacent unambiguous user message", () => {
  const user = message({ id: "u1", role: "user", createdAt: "2026-07-20T01:00:00Z" });
  const adjacent = message({ id: "a1", role: "assistant", createdAt: "2026-07-20T01:00:01Z" });
  const unrelated = message({ id: "a2", role: "assistant", createdAt: "2026-07-20T01:00:02Z" });

  const pairs = pairLegacyMessages([unrelated, adjacent, user]);

  assert.deepEqual(pairs.map((pair) => pair.assistant.id), [adjacent.id]);
});

test("legacy pairing rejects cross-conversation explicit sources", () => {
  const user = message({ id: "u1", role: "user", conversationId: "conversation-1" });
  const assistant = message({
    id: "a1",
    role: "assistant",
    conversationId: "conversation-2",
    sourceMessageId: user.id,
  });

  assert.deepEqual(pairLegacyMessages([user, assistant]), []);
});

test("cloze rejects a UTF-16 range that splits an emoji grapheme", async () => {
  const service = journalServiceForCloze();
  await assert.rejects(
    service.updateCloze("user-1", "journal:entry-1", {
      baseVersion: 0,
      operation: { type: "add", segmentId: "segment-1", startUtf16: 2, endUtf16: 3 },
    }),
    JournalValidationError,
  );
});

test("cloze converts an optimistic-lock race into a stable conflict", async () => {
  const service = journalServiceForCloze({ loseSaveRace: true });
  await assert.rejects(
    service.updateCloze("user-1", "journal:entry-1", {
      baseVersion: 0,
      operation: { type: "add", segmentId: "segment-1", startUtf16: 0, endUtf16: 1 },
    }),
    JournalPracticeConflictError,
  );
});

test("cloze accepts a result-only operation without removing a blank", async () => {
  let savedState: unknown = null;
  const service = journalServiceForCloze({
    currentClozeState: {
      schemaVersion: 1,
      blanks: [{ id: "blank-1", segmentId: "segment-1", startUtf16: 0, endUtf16: 1, answer: "A" }],
    },
    onSave: (state) => { savedState = state; },
  });

  const practice = await service.updateCloze("user-1", "journal:entry-1", {
    baseVersion: 0,
    operation: { type: "result" },
    result: "correct",
  });

  assert.equal((savedState as { blanks: unknown[] }).blanks.length, 1);
  assert.equal(practice?.clozeLastResult, "correct");
});

test("dictation validates and saves a legacy cloud record", async () => {
  const user = message({ id: "u1", role: "user", content: "原文" });
  const assistant = message({
    id: "a1",
    role: "assistant",
    sourceMessageId: user.id,
    content: "<REWRITE>Rewritten text.</REWRITE>",
  });
  let savedSourceId: string | null = null;
  const repository = {
    isLegacyHidden: async () => false,
    findPracticeState: async () => null,
    saveDictationResult: async (input: { sourceId: string }) => {
      savedSourceId = input.sourceId;
      return {
        id: "practice-1", userId: "user-1", sourceKind: "legacy_cloud", sourceId: input.sourceId,
        clozeState: null, clozeVersion: 0, clozeLastResult: null, clozeNextReviewAt: null,
        clozeCorrectStreak: 0, dictationCompleted: true, dictationLastResult: "correct",
        dictationPracticeCount: 1, dictationCorrectStreak: 1, dictationNextReviewAt: new Date(),
      };
    },
  };
  const messageRepository = {
    findById: async (id: string) => id === user.id ? user : id === assistant.id ? assistant : null,
  };
  const service = new JournalService(
    repository as never,
    {} as never,
    {} as never,
    {} as never,
    60_000,
    undefined,
    messageRepository as never,
  );

  const practice = await service.updateDictation("user-1", "legacy_cloud:a1", "correct");

  assert.equal(savedSourceId, "a1");
  assert.equal(practice?.dictationLastResult, "correct");
});

function journalServiceForCloze(options: {
  loseSaveRace?: boolean;
  currentClozeState?: unknown;
  onSave?: (state: unknown) => void;
} = {}) {
  const createdAt = new Date("2026-07-20T01:00:00Z");
  const entry = {
    id: "entry-1", userId: "user-1", dateKey: "2026-07-20", originalText: "原文",
    rewrittenText: "A👨‍👩‍👧‍👦B", languageCode: "en-US", promptDifficultySnapshot: "standard",
    promptVersion: "v1", status: "completed", clientId: "client-1", inputChars: 2,
    outputChars: 3, isSample: false, sampleImageKey: null, publishedAt: createdAt,
    processingAt: null, leaseExpiresAt: null, workerId: null, failedAt: null, deletedAt: null,
    createdAt, updatedAt: createdAt, image: null,
    segments: [{
      id: "segment-1", entryId: "entry-1", ordinal: 0, text: "A👨‍👩‍👧‍👦B",
      startUtf16: 0, endUtf16: "A👨‍👩‍👧‍👦B".length, createdAt,
    }],
  };
  const repository = {
    findByIdForUser: async () => entry,
    findPracticeState: async () => options.currentClozeState ? ({
      clozeState: options.currentClozeState,
      clozeVersion: 0,
      clozeCorrectStreak: 0,
    }) : null,
    saveClozeState: async (input: { state: unknown; result: string | null }) => {
      options.onSave?.(input.state);
      return options.loseSaveRace ? null : ({
      id: "practice-1", userId: "user-1", sourceKind: "journal", sourceId: "entry-1",
      clozeState: input.state, clozeVersion: 1, clozeLastResult: input.result, clozeNextReviewAt: null,
      clozeCorrectStreak: 0, dictationCompleted: false, dictationLastResult: null,
      dictationPracticeCount: 0, dictationCorrectStreak: 0, dictationNextReviewAt: null,
      });
    },
  };
  return new JournalService(repository as never, {} as never, {} as never, {} as never, 60_000);
}

function message(
  input: Omit<Partial<MessageEntity>, "createdAt" | "updatedAt"> &
    Pick<MessageEntity, "id" | "role"> &
    { createdAt?: string | Date; updatedAt?: string | Date },
): MessageEntity {
  const createdAt = new Date(input.createdAt ?? "2026-07-20T01:00:00Z");
  return {
    id: input.id,
    conversationId: input.conversationId ?? "conversation-1",
    userId: input.userId ?? "user-1",
    role: input.role,
    status: input.status ?? "success",
    content: input.content ?? "content",
    inputChars: 0,
    outputChars: 0,
    clientId: input.clientId ?? null,
    sourceMessageId: input.sourceMessageId ?? null,
    clozeState: input.clozeState ?? null,
    clozeVersion: input.clozeVersion ?? 0,
    clozePracticeDiscardedAt: input.clozePracticeDiscardedAt ?? null,
    conversationDateKey: input.conversationDateKey ?? "2026-07-20",
    languageCode: input.languageCode ?? "en-US",
    createdAt,
    updatedAt: input.updatedAt ? new Date(input.updatedAt) : createdAt,
  };
}
