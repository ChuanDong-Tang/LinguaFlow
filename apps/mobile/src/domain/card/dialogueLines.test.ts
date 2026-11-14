import assert from "node:assert/strict";
import test from "node:test";
import { dialoguePairs, segmentLines } from "./dialogueLines";

test("segments map to the line they start on", () => {
  const text = "I walked the dog. It was fun.\nThe park downstairs.";
  const lines = segmentLines(text, [{ id: "a", startUtf16: 0 }, { id: "b", startUtf16: 18 }, { id: "c", startUtf16: 30 }]);
  assert.deepEqual([...lines.entries()], [["a", 0], ["b", 0], ["c", 1]]);
});

test("user and OIO lines pair up in order", () => {
  const pairs = dialoguePairs(
    { text: "A1. A2.\nB1.", segments: [{ id: "a1", startUtf16: 0 }, { id: "a2", startUtf16: 4 }, { id: "b1", startUtf16: 8 }] },
    { text: "Nice!\nWhere?", segments: [{ id: "r1", startUtf16: 0 }, { id: "r2", startUtf16: 6 }] },
  );
  assert.deepEqual(pairs, [
    { line: 0, user: ["a1", "a2"], oio: ["r1"] },
    { line: 1, user: ["b1"], oio: ["r2"] },
  ]);
});
