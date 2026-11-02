import test from "node:test";
import assert from "node:assert/strict";
import { swipedMemoryTab } from "./memoryHome";

test("home swipe follows visual tab order and stops at both ends", () => {
  assert.equal(swipedMemoryTab("memory", -100, 2), "today");
  assert.equal(swipedMemoryTab("today", -100, 2), "blind");
  assert.equal(swipedMemoryTab("blind", 100, 2), "today");
  assert.equal(swipedMemoryTab("today", 100, 2), "memory");
  assert.equal(swipedMemoryTab("memory", 100, 2), "memory");
  assert.equal(swipedMemoryTab("blind", -100, 2), "blind");
});

test("short, vertical and diagonal gestures keep the current home tab", () => {
  for (const [dx, dy] of [[0, 100], [30, 0], [80, 70], [-80, -70]]) {
    assert.equal(swipedMemoryTab("today", dx, dy), "today");
  }
});
