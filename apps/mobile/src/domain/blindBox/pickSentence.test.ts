import assert from "node:assert/strict";
import test from "node:test";
import { blindBoxCapacity, blindBoxEntryId, blindBoxOrder, blindBoxToneCounts, buildBlindBoxSet, isBlindBoxPlayable, parseBlindBoxEntry, pickBlindBoxSentence } from "./pickSentence";

const segments = ["s1", "s2", "s3"];

test("unanswered or wrong sentences come first, in order", () => {
  assert.equal(pickBlindBoxSentence(segments, [{ id: "a", segmentId: "s2", startUtf16: 0 }, { id: "b", segmentId: "s3", startUtf16: 0 }]), "s2");
  assert.equal(pickBlindBoxSentence(segments, [
    { id: "a", segmentId: "s1", startUtf16: 0, lastResult: "correct" },
    { id: "b", segmentId: "s2", startUtf16: 0, lastResult: "correct" },
    { id: "c", segmentId: "s3", startUtf16: 4, lastResult: "incorrect" },
  ]), "s3");
  assert.equal(pickBlindBoxSentence(segments, [
    { id: "a", segmentId: "s1", startUtf16: 0, lastResult: "correct" },
    { id: "b", segmentId: "s2", startUtf16: 0 },
  ]), "s2");
});

test("all right: the first sentence with blanks; none: null", () => {
  assert.equal(pickBlindBoxSentence(segments, [{ id: "a", segmentId: "s2", startUtf16: 0, mastered: true }, { id: "b", segmentId: "s3", startUtf16: 0, lastResult: "correct" }]), "s2");
  assert.equal(pickBlindBoxSentence(segments, []), null);
});

test("playable cards have blanks", () => {
  assert.equal(isBlindBoxPlayable({ totalBlanks: 0, status: "clozed" }), false);
  assert.equal(isBlindBoxPlayable({ totalBlanks: 2 }), true);
  assert.equal(isBlindBoxPlayable({ status: "completed" }), true);
  assert.equal(isBlindBoxPlayable(null), false);
});

test("set starts at the tapped card", () => {
  assert.deepEqual(blindBoxOrder(["a", "b", "c", "d"], "c"), ["c", "d", "a", "b"]);
  assert.deepEqual(blindBoxOrder(["a", "b"], "x"), ["a", "b"]);
});

test("the chosen tones decide the sentence (round 4)", () => {
  const blanks = [
    { id: "a", segmentId: "s1", startUtf16: 0, lastResult: "correct" as const },
    { id: "b", segmentId: "s2", startUtf16: 0, lastResult: "incorrect" as const },
    { id: "c", segmentId: "s3", startUtf16: 0 },
  ];
  assert.equal(pickBlindBoxSentence(segments, blanks, ["unanswered"]), "s3");
  assert.equal(pickBlindBoxSentence(segments, blanks, ["incorrect", "unanswered"]), "s2");
  assert.equal(pickBlindBoxSentence(segments, blanks, ["correct"]), "s1");
  // Nothing matches (stale summary): an open blank first.
  assert.equal(pickBlindBoxSentence(segments, blanks.slice(0, 2), ["unanswered"]), "s2");
});

test("tone counts and playability follow the card summary", () => {
  assert.deepEqual(blindBoxToneCounts({ totalBlanks: 5, answeredBlanks: 3, accuracy: 67 }), { unanswered: 2, incorrect: 1, correct: 2 });
  assert.deepEqual(blindBoxToneCounts({ totalBlanks: 4, answeredBlanks: 4, accuracy: 100 }), { unanswered: 0, incorrect: 0, correct: 4 });
  assert.equal(blindBoxToneCounts({ status: "clozed" }), null);
  const allRight = { totalBlanks: 4, answeredBlanks: 4, accuracy: 100 };
  assert.equal(isBlindBoxPlayable(allRight, ["unanswered", "incorrect"]), false);
  assert.equal(isBlindBoxPlayable(allRight, ["correct"]), true);
  assert.equal(isBlindBoxPlayable({ totalBlanks: 3, answeredBlanks: 3, accuracy: 33 }, ["incorrect"]), true);
  assert.equal(isBlindBoxPlayable({ status: "clozed" }, ["unanswered"]), true);
  assert.equal(isBlindBoxPlayable({ status: "clozed" }, ["correct"]), false);
});

test("a repeated card gives its next sentence, never the same one", () => {
  const blanks = [
    { id: "a", segmentId: "s1", startUtf16: 0, lastResult: "incorrect" as const },
    { id: "b", segmentId: "s2", startUtf16: 0 },
    { id: "c", segmentId: "s3", startUtf16: 0, lastResult: "correct" as const },
  ];
  assert.equal(pickBlindBoxSentence(segments, blanks, ["unanswered", "incorrect"], 1), "s1");
  assert.equal(pickBlindBoxSentence(segments, blanks, ["unanswered", "incorrect"], 2), "s2");
  // Past the matching ones: another sentence with blanks.
  assert.equal(pickBlindBoxSentence(segments, blanks, ["unanswered", "incorrect"], 3), "s3");
});

test("entries round-trip", () => {
  assert.equal(blindBoxEntryId("card:x", 1), "card:x");
  assert.deepEqual(parseBlindBoxEntry(blindBoxEntryId("card:x", 3)), { recordId: "card:x", occurrence: 3 });
  assert.deepEqual(parseBlindBoxEntry("card:x"), { recordId: "card:x", occurrence: 1 });
});

test("sets use every distinct card before repeating any (round 4)", () => {
  const set = buildBlindBoxSet([{ id: "A", preferred: 5 }, { id: "B", preferred: 5 }, { id: "C", preferred: 5 }], "B", 3, () => 0.5);
  assert.equal(set.length, 3);
  assert.equal(set[0], "B");
  assert.equal(new Set(set).size, 3);
});

test("repeats only fill a short set, and never sit next to each other when avoidable", () => {
  const rnd = (() => { let i = 0; const seq = [0.1, 0.9, 0.4, 0.7, 0.2]; return () => seq[i++ % seq.length]!; })();
  const set = buildBlindBoxSet([{ id: "A", preferred: 3 }, { id: "B", preferred: 2 }, { id: "C", preferred: 1 }], "A", 10, rnd);
  // 6 sentences exist in total.
  assert.equal(set.length, 6);
  const ids = set.map((entry) => parseBlindBoxEntry(entry).recordId);
  assert.deepEqual(new Set(ids.slice(0, 3)), new Set(["A", "B", "C"]));
  for (let i = 1; i < ids.length - 1; i += 1) assert.notEqual(ids[i], ids[i - 1], `adjacent at ${i}: ${set.join(",")}`);
  // Each card's sentences are numbered without gaps.
  assert.deepEqual(set.filter((entry) => entry.startsWith("A")), ["A", "A~2", "A~3"]);
});

test("one card left: it may repeat back to back (nothing else to show)", () => {
  assert.deepEqual(buildBlindBoxSet([{ id: "A", preferred: 2 }], "A", 5), ["A", "A~2"]);
});

test("answered-right sentences only fill in after the open ones run out, still alternating", () => {
  const set = buildBlindBoxSet([
    { id: "A", preferred: 1, extra: 2 },
    { id: "B", preferred: 0, extra: 2 },
    { id: "C", preferred: 1, extra: 0 },
  ], null, 6, () => 0.3);
  const ids = set.map((entry) => parseBlindBoxEntry(entry).recordId);
  // Open sentences (A, C) come first.
  assert.deepEqual(new Set(ids.slice(0, 2)), new Set(["A", "C"]));
  assert.equal(set.length, 6);
  for (let i = 1; i < ids.length; i += 1) assert.notEqual(ids[i], ids[i - 1], set.join(","));
});

test("capacity splits chosen blanks from the rest", () => {
  assert.deepEqual(blindBoxCapacity({ totalBlanks: 5, answeredBlanks: 3, accuracy: 67 }, ["unanswered", "incorrect"]), { preferred: 3, extra: 2 });
  assert.deepEqual(blindBoxCapacity({ totalBlanks: 4, answeredBlanks: 4, accuracy: 100 }, ["unanswered", "incorrect"]), { preferred: 0, extra: 4 });
});
