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

test("rejects missing, duplicated, or crossed mappings", () => {
  assert.throws(() => parseCardRewriteAlignmentOutput({
    output: JSON.stringify({ groups: [
      { source: [0], target: [1] },
      { source: [1], target: [0] },
    ] }),
    sourceOrdinals: [0, 1],
    targetOrdinals: [0, 1],
  }));
  assert.throws(() => parseCardRewriteAlignmentOutput({
    output: JSON.stringify({ groups: [{ source: [0], target: [0] }] }),
    sourceOrdinals: [0, 1],
    targetOrdinals: [0],
  }));
});
