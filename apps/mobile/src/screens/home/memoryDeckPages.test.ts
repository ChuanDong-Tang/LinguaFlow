import test from "node:test";
import assert from "node:assert/strict";
import { memoryDeckPages } from "./memoryDeckPages";
test("pages cover each frozen card exactly once including short final pages", () => {
  const ids = ["a", "b", "c", "d", "e"];
  for (const size of [1, 2, 3]) {
    const pages = memoryDeckPages(ids, size);
    assert.equal(pages.length, Math.ceil(ids.length / size));
    assert.deepEqual(pages.flat(), ids);
  }
  assert.deepEqual(memoryDeckPages(ids, 3), [["a", "b", "c"], ["d", "e"]]);
  assert.deepEqual(ids, ["a", "b", "c", "d", "e"]);
});
test("empty and invalid layout settings stay bounded", () => {
  assert.deepEqual(memoryDeckPages([], 3), []);
  assert.deepEqual(memoryDeckPages([1, 2, 3, 4], NaN), [[1, 2, 3], [4]]);
});

test("photo groups retain exact assets for selection, never sliding one item at a time", () => {
  const photos = Array.from({ length: 15 }, (_, index) => ({ id: `photo-${index}`, uri: `local://${index}` }));
  for (const visible of [1, 2, 3]) {
    const pages = memoryDeckPages(photos, visible);
    assert.strictEqual(pages[1][0], photos[visible]);
    assert.strictEqual(pages[0][visible - 1], photos[visible - 1]);
    assert.deepEqual(pages.flat(), photos);
  }
  const next = memoryDeckPages(photos.slice(3, 8), 3);
  assert.deepEqual(next[0].map(photo => photo.id), ["photo-3", "photo-4", "photo-5"]);
  assert.equal(next[1].length, 2);
});
