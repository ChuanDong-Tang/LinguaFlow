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

test("history days run farthest first, ending with month and week", () => {
  const days = historyDays("2026-11-11", 3);
  assert.deepEqual(days.map((day) => day.dateKey), ["2023-11-11", "2024-11-11", "2025-11-11", "2026-10-11", "2026-11-04"]);
  assert.deepEqual(days.map((day) => day.key), ["years3", "years2", "year1", "month", "week"]);
  assert.equal(historyDays("2024-02-29", 1)[0]!.dateKey, "2023-02-28");
  assert.equal(historyDays("2026-03-31", 1)[1]!.dateKey, "2026-02-28");
});

test("shift across month ends", () => {
  assert.equal(shiftDay("2026-03-01", -1), "2026-02-28");
});
