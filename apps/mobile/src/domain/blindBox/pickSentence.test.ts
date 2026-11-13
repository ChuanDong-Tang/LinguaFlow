import assert from "node:assert/strict";
import test from "node:test";
import { blindBoxOrder, blindBoxToneCounts, isBlindBoxPlayable, pickBlindBoxSentence } from "./pickSentence";

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
