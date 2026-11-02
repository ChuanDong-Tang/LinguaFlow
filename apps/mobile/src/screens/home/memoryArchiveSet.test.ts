import test from "node:test";
import assert from "node:assert/strict";
import { memoryArchiveSet } from "./memoryArchiveSet";
const card = (id: string, status = "completed", isSample = false) => ({ id, status, isSample });
test("memory groups exclude incomplete and sample cards and deduplicate", () => {
  const records = [card("a"), card("a"), card("b"), card("c", "pending"), card("d", "completed", true)];
  const before = JSON.stringify(records);
  assert.deepEqual(memoryArchiveSet(records, 15, [], () => 0), ["a", "b"]);
  assert.equal(JSON.stringify(records), before);
});
test("next group favors unseen memories and wraps only after exhaustion", () => {
  const records = [card("a"), card("b"), card("c")];
  assert.deepEqual(memoryArchiveSet(records, 15, ["a", "b"], () => 0), ["c"]);
  assert.deepEqual(memoryArchiveSet(records, 2, ["a", "b", "c"], () => 0), ["a", "b"]);
  assert.deepEqual(memoryArchiveSet([], 15), []);
  assert.deepEqual(memoryArchiveSet(records, NaN), []);
});
