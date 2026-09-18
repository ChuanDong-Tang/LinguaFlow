import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCardRewriteAlignmentSourceUnits,
  parseCardRewriteAlignmentOutput,
} from "./cardRewriteAlignmentPrompt.js";

test("splits a long source sentence into smaller lookup units without changing text", () => {
  const sourceText = "我试着自己说，孩子会失去体验这些事情的机会，但参考答案用了 miss out on。";
  const units = buildCardRewriteAlignmentSourceUnits({
    sourceText,
    segments: [{ startUtf16: 0, endUtf16: sourceText.length }],
  });
  assert.deepEqual(units.map((unit) => unit.text), [
    "我试着自己说，",
    "孩子会失去体验这些事情的机会，",
    "但参考答案用了 miss out on。",
  ]);
  assert.equal(units.map((unit) => sourceText.slice(unit.startUtf16, unit.endUtf16)).join(""), sourceText);
});

test("treats multilingual punctuation as lookup boundaries, not target sentence rules", () => {
  const sourceText = "今日は雨、لكنني خرجت، फिर मैं घर गया।";
  const units = buildCardRewriteAlignmentSourceUnits({
    sourceText,
    segments: [{ startUtf16: 0, endUtf16: sourceText.length }],
  });
  assert.deepEqual(units.map((unit) => unit.text), ["今日は雨、", "لكنني خرجت،", "फिर मैं घर गया।"]);
});

test("accepts ordered one-to-many and many-to-one mappings", () => {
  const groups = parseCardRewriteAlignmentOutput({
    output: JSON.stringify({ groups: [
      { source: ["S0", "S1"], target: ["T0"] },
      { source: ["S2"], target: ["T1", "T2"] },
    ] }),
    sourceOrdinals: [0, 1, 2],
    targetOrdinals: [0, 1, 2],
  });
  assert.deepEqual(groups, [
    { sourceOrdinals: [0, 1], targetOrdinals: [0] },
    { sourceOrdinals: [2], targetOrdinals: [1, 2] },
  ]);
});

test("rejects mappings that reorder source ideas", () => {
  assert.throws(() => parseCardRewriteAlignmentOutput({
    output: JSON.stringify({ matches: [
      { target: 0, source: [2, 3] },
      { target: 1, source: [0, 1] },
      { target: 2, source: [4] },
    ] }),
    sourceOrdinals: [0, 1, 2, 3, 4],
    targetOrdinals: [0, 1, 2],
  }));
});

test("rejects a rewrite sentence that combines non-consecutive source ideas", () => {
  assert.throws(() => parseCardRewriteAlignmentOutput({
    output: JSON.stringify({ matches: [
      { target: 0, source: [0, 3, 4] },
      { target: 1, source: [1, 2] },
    ] }),
    sourceOrdinals: [0, 1, 2, 3, 4],
    targetOrdinals: [0, 1],
  }));
});

test("accepts safe scalar, named-field, and range variants from the model", () => {
  const groups = parseCardRewriteAlignmentOutput({
    output: JSON.stringify({ groups: [
      { sourceOrdinals: "S0-S1", targetOrdinals: "T0" },
      { source: 2, target: ["T1", "T2"] },
    ] }),
    sourceOrdinals: [0, 1, 2],
    targetOrdinals: [0, 1, 2],
  });
  assert.deepEqual(groups, [
    { sourceOrdinals: [0, 1], targetOrdinals: [0] },
    { sourceOrdinals: [2], targetOrdinals: [1, 2] },
  ]);
});

test("accepts explicit start/end range variants before validation", () => {
  const groups = parseCardRewriteAlignmentOutput({
    output: JSON.stringify({ groups: [
      { sourceStart: 0, sourceEnd: 2, targetStart: 0, targetEnd: 2 },
      { source_ids: "S3,S4", targetStart: 3, targetEnd: 3 },
    ] }),
    sourceOrdinals: [0, 1, 2, 3, 4],
    targetOrdinals: [0, 1, 2, 3],
  });
  assert.deepEqual(groups, [
    { sourceOrdinals: [0, 1, 2], targetOrdinals: [0, 1, 2] },
    { sourceOrdinals: [3, 4], targetOrdinals: [3] },
  ]);
});

test("uses the whole source as a safe fallback for an unmatched target", () => {
  assert.deepEqual(parseCardRewriteAlignmentOutput({
    output: JSON.stringify({ matches: [{ source: [0], target: 0 }] }),
    sourceOrdinals: [0, 1],
    targetOrdinals: [0, 1],
  }), [
    { sourceOrdinals: [0], targetOrdinals: [0] },
    { sourceOrdinals: [0, 1], targetOrdinals: [1] },
  ]);
});

test("rejects duplicated or crossed target mappings", () => {
  assert.throws(() => parseCardRewriteAlignmentOutput({
    output: JSON.stringify({ groups: [
      { source: [0], target: [1] },
      { source: [1], target: [0] },
    ] }),
    sourceOrdinals: [0, 1],
    targetOrdinals: [0, 1],
  }));
  assert.throws(() => parseCardRewriteAlignmentOutput({
    output: JSON.stringify({ matches: [{ source: [0], target: 0 }, { source: [1], target: 0 }] }),
    sourceOrdinals: [0, 1],
    targetOrdinals: [0],
  }));
});
