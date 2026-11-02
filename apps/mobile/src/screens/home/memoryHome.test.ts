import test from "node:test";
import assert from "node:assert/strict";
import { homeDateKey, homeLibraryView, memoryHomeCopy, shiftMemoryDay } from "./memoryHome";

test("collections only scope Memories, including unclassified, while trash remains isolated", () => {
  for (const selection of ["all", "unclassified", "collection-123"]) {
    assert.equal(homeLibraryView("memory", selection), selection);
    assert.equal(homeLibraryView("today", selection), "all");
    assert.equal(homeLibraryView("blind", selection), "all");
    assert.equal(homeLibraryView("memory", selection), selection);
  }
  for (const tab of ["memory", "today", "blind"] as const) {
    assert.equal(homeLibraryView(tab, "trash"), "trash");
  }
});

test("only Today scopes pagination to a local calendar day", () => {
  const date = new Date(2026, 9, 22, 0, 1);
  assert.equal(homeDateKey("today", false, date), "2026-10-22");
  assert.equal(homeDateKey("memory", false, date), undefined);
  assert.equal(homeDateKey("blind", false, date), undefined);
  assert.equal(homeDateKey("today", true, date), undefined);
  assert.equal(homeDateKey("today", false, new Date(2026, 9, 23)), "2026-10-23");
});
test("home copy covers supported languages and safe fallback", () => {
  for (const locale of ["zh-CN", "zh-TW", "en-US", "ja-JP", "unknown"]) {
    assert.ok(memoryHomeCopy(locale).open);
    assert.ok(memoryHomeCopy(locale).todayEmpty);
  }
});

test("day navigation crosses month/year/leap boundaries and cannot enter future", () => {
  assert.equal(shiftMemoryDay("2026-01-01", -1, "2026-10-24"), "2025-12-31");
  assert.equal(shiftMemoryDay("2024-03-01", -1, "2026-10-24"), "2024-02-29");
  assert.equal(shiftMemoryDay("2026-03-01", -1, "2026-10-24"), "2026-02-28");
  assert.equal(shiftMemoryDay("2026-10-23", 1, "2026-10-24"), "2026-10-24");
  assert.equal(shiftMemoryDay("2026-10-24", 1, "2026-10-24"), "2026-10-24");
  assert.equal(shiftMemoryDay("invalid", -1, "2026-10-24"), "2026-10-24");
});
