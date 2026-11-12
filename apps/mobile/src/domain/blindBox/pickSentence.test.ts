import assert from "node:assert/strict";
import test from "node:test";
import { blindBoxOrder, isBlindBoxPlayable, pickBlindBoxSentence } from "./pickSentence";

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
