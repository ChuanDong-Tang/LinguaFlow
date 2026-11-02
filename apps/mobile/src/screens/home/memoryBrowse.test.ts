import assert from "node:assert/strict";
import test from "node:test";
import { canSwipeMemoryCard, memoryBrowseIds, memoryBrowsePosition, memoryBrowseRound } from "./memoryBrowse";

test("round freezes ten unique scoped cards with the clicked card first", () => {
  const pool = Array.from({ length: 44 }, (_, i) => String(i));
  const before = [...pool];
  const round = memoryBrowseRound([...pool, "12"], "12", () => 0.5);
  assert.equal(round.length, 10);
  assert.equal(round[0], "12");
  assert.equal(new Set(round).size, 10);
  assert.ok(round.every(id => pool.includes(id)));
  assert.deepEqual(pool, before);
  assert.equal(memoryBrowsePosition(round, round[9])?.next, undefined);
});

test("short and missing-card rounds cannot fabricate or leak cards", () => {
  assert.deepEqual(memoryBrowseRound(["a", "b", "a"], "b", () => 0), ["b", "a"]);
  assert.deepEqual(memoryBrowseRound(["a"], "a"), ["a"]);
  assert.deepEqual(memoryBrowseRound(["a"], "outside"), []);
  assert.deepEqual(memoryBrowseRound([], "a"), []);
});
test("browse captures displayed order, excludes pending cards and duplicates", () => {
  const rows = [
    { id: "a", status: "completed", isSample: false, dateKey: "2026-10-22" },
    { id: "b", status: "processing", isSample: false, dateKey: "2026-10-22" },
    { id: "c", status: "completed", isSample: true, dateKey: "2026-10-21" },
  ];
  assert.deepEqual(memoryBrowseIds([...rows, rows[0]]), ["c", "a"]);
  assert.deepEqual(memoryBrowseIds(rows, "2026-10-22"), ["a"]);
  assert.equal(rows[0].id, "a");
});
test("browse boundaries never wrap or navigate outside the opening list", () => {
  assert.deepEqual(memoryBrowsePosition(["a", "b"], "a"), { index: 0, total: 2, previous: undefined, next: "b" });
  assert.equal(memoryBrowsePosition(["a", "b"], "b")?.next, undefined);
  assert.deepEqual(memoryBrowsePosition(["a"], "a"), { index: 0, total: 1, previous: undefined, next: undefined });
  assert.equal(memoryBrowsePosition([], "a"), null);
  assert.equal(memoryBrowsePosition(["a", "b"], "c"), null);
});

test("card browsing never steals playback, dictation, image or editing gestures", () => {
  const idle = {
    hasPosition: true, tab: "review", playback: false, editing: false,
    loading: false, imageAdding: false, imageGesture: false, interactionLocked: false,
  };
  assert.equal(canSwipeMemoryCard(idle), true);
  assert.equal(canSwipeMemoryCard({ ...idle, hasPosition: false }), false);
  assert.equal(canSwipeMemoryCard({ ...idle, tab: "dictation" }), false);
  for (const flag of ["playback", "editing", "loading", "imageAdding", "imageGesture", "interactionLocked"] as const) {
    assert.equal(canSwipeMemoryCard({ ...idle, [flag]: true }), false, flag);
  }
});
