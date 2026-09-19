import assert from "node:assert/strict";
import test from "node:test";
import { buildSelectableTextFallbackSegments } from "./selectableTextFallback.js";

test("keeps a missing-native-view fallback readable without revealing blanks", () => {
  const segments = buildSelectableTextFallbackSegments({
    text: "Switch to playback mode now.",
    highlights: [{ start: 10, end: 23, groupIndex: 4 }],
    blanks: [{ start: 10, end: 23 }],
    correct: [],
    answers: [],
    answersVisible: false,
  });
  const blank = segments.find((segment) => segment.key === "10:23");
  assert.deepEqual(blank, {
    key: "10:23",
    text: "playback mode",
    hidden: true,
    highlighted: true,
    correct: false,
    blank: true,
    groupIndex: 4,
  });
  assert.equal(segments.map((segment) => segment.text).join(""), "Switch to playback mode now.");
});

test("shows answers and mastered-green state in the fallback", () => {
  const [segment] = buildSelectableTextFallbackSegments({
    text: "useful expressions",
    highlights: [{ start: 0, end: 18, groupIndex: 0 }],
    blanks: [{ start: 0, end: 18 }],
    correct: [{ start: 0, end: 18 }],
    answers: [{ start: 0, end: 18, text: "useful expressions" }],
    answersVisible: false,
  });
  assert.equal(segment.hidden, false);
  assert.equal(segment.correct, true);
  assert.equal(segment.highlighted, true);
});
