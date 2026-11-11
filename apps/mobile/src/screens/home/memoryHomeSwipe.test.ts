import test from "node:test";
import assert from "node:assert/strict";
import { swipedMemoryTab } from "./memoryHome";

test("home swipe follows visual tab order (盲盒 / 回忆 / 今日 / 播客) and stops at both ends", () => {
  assert.equal(swipedMemoryTab("blind", -100, 2), "memory");
  assert.equal(swipedMemoryTab("memory", -100, 2), "today");
  assert.equal(swipedMemoryTab("today", -100, 2), "podcast");
  assert.equal(swipedMemoryTab("podcast", 100, 2), "today");
  assert.equal(swipedMemoryTab("memory", 100, 2), "blind");
  assert.equal(swipedMemoryTab("blind", 100, 2), "blind");
  assert.equal(swipedMemoryTab("podcast", -100, 2), "podcast");
});

test("short, vertical and diagonal gestures keep the current home tab", () => {
  for (const [dx, dy] of [[0, 100], [30, 0], [80, 70], [-80, -70]]) {
    assert.equal(swipedMemoryTab("today", dx, dy), "today");
  }
});
