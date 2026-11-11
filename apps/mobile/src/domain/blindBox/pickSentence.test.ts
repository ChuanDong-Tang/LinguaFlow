import assert from "node:assert/strict";
import test from "node:test";
import { blindBoxOrder, pickBlindBoxSentence } from "./pickSentence";

const segments = ["s1", "s2", "s3"];

test("never answered: first sentence with a blank", () => {
  assert.equal(pickBlindBoxSentence(segments, [{ id: "a", segmentId: "s2", startUtf16: 0 }, { id: "b", segmentId: "s3", startUtf16: 0 }]), "s2");
});

test("answered before: the first sentence with a wrong blank", () => {
  assert.equal(pickBlindBoxSentence(segments, [
    { id: "a", segmentId: "s1", startUtf16: 0, lastResult: "correct" },
    { id: "b", segmentId: "s3", startUtf16: 4, lastResult: "incorrect" },
  ]), "s3");
});

test("all right: back to the first sentence with a blank; none: null", () => {
  assert.equal(pickBlindBoxSentence(segments, [{ id: "a", segmentId: "s2", startUtf16: 0, mastered: true }]), "s2");
  assert.equal(pickBlindBoxSentence(segments, []), null);
});

test("set starts at the tapped card", () => {
  assert.deepEqual(blindBoxOrder(["a", "b", "c", "d"], "c"), ["c", "d", "a", "b"]);
  assert.deepEqual(blindBoxOrder(["a", "b"], "x"), ["a", "b"]);
});
