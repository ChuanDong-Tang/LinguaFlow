import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCardRewriteAlignmentSourceUnits,
  buildCardRewriteAlignmentPrompt,
  buildCardRewriteAlignmentRepairPrompt,
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

test("separates clear English sentence boundaries inside mixed original text without splitting decimals or abbreviations", () => {
  const sourceText = "我觉得是这样，Yeah, it gives off this vibe. But Tony is happy. 版本1.1.3。 Dr. Smith agrees.";
  const units = buildCardRewriteAlignmentSourceUnits({
    sourceText,
    segments: [{ startUtf16: 0, endUtf16: sourceText.length }],
  });
  assert.deepEqual(units.map((unit) => unit.text), [
    "我觉得是这样，", "Yeah,", "it gives off this vibe.",
    "But Tony is happy.", "版本1.1.3。", "Dr. Smith agrees.",
  ]);
  for (const unit of units) assert.equal(sourceText.slice(unit.startUtf16, unit.endUtf16), unit.text);
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

test("rejects an unmatched target instead of repeating the whole source", () => {
  assert.throws(() => parseCardRewriteAlignmentOutput({
    output: JSON.stringify({ matches: [{ source: [0], target: 0 }] }),
    sourceOrdinals: [0, 1],
    targetOrdinals: [0, 1],
  }));
});

test("coalesces exact reuse and bounded substantial overlap without changing target sentences", () => {
  assert.deepEqual(parseCardRewriteAlignmentOutput({
    output: JSON.stringify({ matches: [
      { source: [0, 1], target: 0 },
      { source: [0, 1], target: 1 },
      { source: [2], target: 2 },
    ] }),
    sourceOrdinals: [0, 1, 2],
    targetOrdinals: [0, 1, 2],
  }), [
    { sourceOrdinals: [0, 1], targetOrdinals: [0, 1] },
    { sourceOrdinals: [2], targetOrdinals: [2] },
  ]);
  assert.deepEqual(parseCardRewriteAlignmentOutput({
    output: JSON.stringify({ matches: [
      { source: [0, 1], target: 0 },
      { source: [1, 2], target: 1 },
    ] }),
    sourceOrdinals: [0, 1, 2],
    targetOrdinals: [0, 1],
  }), [
    { sourceOrdinals: [0], targetOrdinals: [0] },
    { sourceOrdinals: [1, 2], targetOrdinals: [1] },
  ]);
  assert.deepEqual(parseCardRewriteAlignmentOutput({
    output: JSON.stringify({ matches: [
      { source: [0, 1, 2], target: 0 },
      { source: [1, 2, 3], target: 1 },
    ] }),
    sourceOrdinals: [0, 1, 2, 3], targetOrdinals: [0, 1],
  }), [{ sourceOrdinals: [0, 1, 2, 3], targetOrdinals: [0, 1] }]);
});

test("does not chain touching range boundaries into a four-sentence group", () => {
  assert.deepEqual(parseCardRewriteAlignmentOutput({
    output: JSON.stringify({ groups: [
      { targetStart: 0, targetEnd: 0, sourceStart: 0, sourceEnd: 2 },
      { targetStart: 1, targetEnd: 1, sourceStart: 2, sourceEnd: 6 },
      { targetStart: 2, targetEnd: 2, sourceStart: 6, sourceEnd: 6 },
      { targetStart: 3, targetEnd: 3, sourceStart: 6, sourceEnd: 8 },
    ] }),
    sourceOrdinals: Array.from({ length: 9 }, (_, index) => index),
    targetOrdinals: [0, 1, 2, 3],
  }), [
    { sourceOrdinals: [0, 1], targetOrdinals: [0] },
    { sourceOrdinals: [2, 3, 4, 5], targetOrdinals: [1] },
    { sourceOrdinals: [6], targetOrdinals: [2] },
    { sourceOrdinals: [7, 8], targetOrdinals: [3] },
  ]);
});

test("never turns distant source references into a whole intervening passage", () => {
  assert.throws(() => parseCardRewriteAlignmentOutput({
    output: JSON.stringify({ matches: [
      { target: 0, source: [0, 15, 16, 17] },
      { target: 1, source: [1, 2] },
    ] }),
    sourceOrdinals: Array.from({ length: 18 }, (_, index) => index),
    targetOrdinals: [0, 1],
  }), /CARD_REWRITE_ALIGNMENT_NON_CONTIGUOUS_SOURCE/u);
});

test("rejects more than three rewrite sentences sharing one source passage", () => {
  assert.throws(() => parseCardRewriteAlignmentOutput({
    output: JSON.stringify({ matches: [0, 1, 2, 3].map((target) => ({ target, source: [0] })) }),
    sourceOrdinals: [0],
    targetOrdinals: [0, 1, 2, 3],
  }), /CARD_REWRITE_ALIGNMENT_SHARED_TARGET_LIMIT/u);
  assert.deepEqual(parseCardRewriteAlignmentOutput({
    output: JSON.stringify({ matches: [0, 1, 2].map((target) => ({ target, source: [0] })) }),
    sourceOrdinals: [0],
    targetOrdinals: [0, 1, 2],
  }), [{ sourceOrdinals: [0], targetOrdinals: [0, 1, 2] }]);
});

test("repair prompt keeps finalized target units and names the failed rule", () => {
  const originalPrompt = buildCardRewriteAlignmentPrompt({
    sourceSegments: [{ ordinal: 0, text: "今天说三件事。" }, { ordinal: 1, text: "哦，不对，是四件事。" }],
    targetSegments: [{ ordinal: 0, text: "Three things—actually four." }],
  });
  const repair = buildCardRewriteAlignmentRepairPrompt({
    originalPrompt,
    invalidOutput: '{"matches":[{"target":0,"source":[0,2]}]}',
    errorCode: "CARD_REWRITE_ALIGNMENT_NON_CONTIGUOUS_SOURCE",
  });
  const payload = JSON.parse(repair.userPrompt);
  assert.deepEqual(payload.sourceAndTarget, JSON.parse(originalPrompt.userPrompt));
  assert.match(repair.systemPrompt, /CARD_REWRITE_ALIGNMENT_NON_CONTIGUOUS_SOURCE/u);
  assert.match(repair.systemPrompt, /At most three adjacent target sentences/u);
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
