import assert from "node:assert/strict";
import test from "node:test";
import { historyDays, relativeDayLabel, shiftDay } from "./todayDays";

test("relative labels for the 今日 tab", () => {
  assert.equal(relativeDayLabel("2026-11-11", "2026-11-11", "zh-CN"), "今日");
  assert.equal(relativeDayLabel("2026-11-10", "2026-11-11", "zh-CN"), "昨天");
  assert.equal(relativeDayLabel("2026-11-09", "2026-11-11", "zh-CN"), "前天");
  assert.equal(relativeDayLabel("2026-10-31", "2026-11-11", "zh-CN"), "11天前");
  assert.equal(relativeDayLabel("2026-11-10", "2026-11-11", "en-US"), "Yesterday");
});

test("history days: week, month, and 1–3 years back", () => {
  assert.deepEqual(historyDays("2026-11-11").map((day) => day.dateKey), ["2026-11-04", "2026-10-11", "2025-11-11", "2024-11-11", "2023-11-11"]);
  assert.equal(historyDays("2024-02-29")[2]!.dateKey, "2023-02-28");
  assert.equal(historyDays("2026-03-31")[1]!.dateKey, "2026-02-28");
});

test("shift across month ends", () => {
  assert.equal(shiftDay("2026-03-01", -1), "2026-02-28");
});
