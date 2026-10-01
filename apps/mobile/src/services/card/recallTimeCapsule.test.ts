import assert from "node:assert/strict";
import test from "node:test";
import {
  isTimeCapsuleQuery,
  mergeTimeCapsuleRecords,
  recallTimeCapsuleAnchors,
  restoreTimeCapsuleRecordOrder,
  timeCapsuleQuery,
} from "./recallTimeCapsule.js";

test("builds year, quarter, month, and week anchors from farthest to nearest", () => {
  assert.deepEqual(recallTimeCapsuleAnchors(new Date(2026, 8, 29, 9)), [
    { kind: "year", dateKey: "2025-09-29" },
    { kind: "quarter", dateKey: "2026-06-29" },
    { kind: "month", dateKey: "2026-08-29" },
    { kind: "week", dateKey: "2026-09-22" },
  ]);
});

test("clamps missing month days and leap days to the target month's last day", () => {
  assert.equal(recallTimeCapsuleAnchors(new Date(2025, 2, 31, 9))[2]?.dateKey, "2025-02-28");
  assert.equal(recallTimeCapsuleAnchors(new Date(2024, 1, 29, 9))[0]?.dateKey, "2023-02-28");
});

test("merges available anchor records in order and keeps the first label for duplicates", () => {
  const anchors = recallTimeCapsuleAnchors(new Date(2026, 8, 29, 9));
  const merged = mergeTimeCapsuleRecords([
    { anchor: anchors[0]!, records: [{ id: "year" }, { id: "duplicate" }] },
    { anchor: anchors[1]!, records: [] },
    { anchor: anchors[2]!, records: [{ id: "duplicate" }, { id: "month" }] },
    { anchor: anchors[3]!, records: [{ id: "week" }] },
  ]);
  assert.deepEqual(merged.records.map((record) => record.id), ["year", "duplicate", "month", "week"]);
  assert.equal(merged.anchorByRecordId.duplicate?.kind, "year");
  assert.equal(merged.anchorByRecordId.month?.dateKey, "2026-08-29");
});

test("uses a stable query marker for time capsule sessions", () => {
  const query = timeCapsuleQuery(new Date(2026, 8, 29, 9));
  assert.equal(query, "time-capsule:2026-09-29");
  assert.equal(isTimeCapsuleQuery(query), true);
  assert.equal(isTimeCapsuleQuery("blind:week"), false);
});

test("restores the accumulated record order when session nodes arrive interleaved", () => {
  const ordered = restoreTimeCapsuleRecordOrder([
    { recordId: "month-2" },
    { recordId: "week-1" },
    { recordId: "month-1" },
    { recordId: "year-1" },
    { recordId: "unexpected" },
  ], ["year-1", "month-1", "month-2", "week-1"]);
  assert.deepEqual(ordered.map((node) => node.recordId), [
    "year-1",
    "month-1",
    "month-2",
    "week-1",
    "unexpected",
  ]);
});
