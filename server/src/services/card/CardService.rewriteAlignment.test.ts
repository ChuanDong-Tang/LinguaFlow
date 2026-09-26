import assert from "node:assert/strict";
import test from "node:test";
import { rewriteAlignedOriginalGroups, rewriteAlignedOriginalSegments } from "./CardService.js";

function entryWith(groups: Array<{ sourceOrdinals: number[]; targetOrdinals: number[] }>) {
  return {
    originalText: "A, B, C.",
    contentSegments: [
      { contentType: "original", ordinal: 0, contentVersion: "source-v1" },
      { contentType: "rewrite", ordinal: 0, contentVersion: "target-v1" },
      { contentType: "rewrite", ordinal: 1, contentVersion: "target-v1" },
      { contentType: "rewrite", ordinal: 2, contentVersion: "target-v1" },
    ],
    rewriteAlignment: {
      schemaVersion: 1,
      sourceContentVersion: "source-v1",
      targetContentVersion: "target-v1",
      sourceUnits: [
        { ordinal: 0, startUtf16: 0, endUtf16: 2 },
        { ordinal: 1, startUtf16: 3, endUtf16: 5 },
        { ordinal: 2, startUtf16: 6, endUtf16: 8 },
      ],
      groups,
    },
  } as never;
}

test("falls back to the original once for a historical partial-overlap alignment", () => {
  assert.deepEqual(rewriteAlignedOriginalSegments(entryWith([
    { sourceOrdinals: [0, 1], targetOrdinals: [0] },
    { sourceOrdinals: [1, 2], targetOrdinals: [1] },
    { sourceOrdinals: [2], targetOrdinals: [2] },
  ])), [{ ordinal: 2, text: "A, B, C.", startUtf16: 0, endUtf16: 8 }]);
});

test("preserves one exact source passage with all of its rewrite sentences", () => {
  assert.deepEqual(rewriteAlignedOriginalGroups(entryWith([
    { sourceOrdinals: [0, 1], targetOrdinals: [0, 1] },
    { sourceOrdinals: [2], targetOrdinals: [2] },
  ])), [
    { targetOrdinals: [0, 1], text: "A, B,", startUtf16: 0, endUtf16: 5, alignment: "exact" },
    { targetOrdinals: [2], text: "C.", startUtf16: 6, endUtf16: 8, alignment: "exact" },
  ]);
});

test("merges historical repeated source ranges into one display group", () => {
  assert.deepEqual(rewriteAlignedOriginalGroups(entryWith([
    { sourceOrdinals: [0, 1], targetOrdinals: [0] },
    { sourceOrdinals: [0, 1], targetOrdinals: [1] },
    { sourceOrdinals: [2], targetOrdinals: [2] },
  ])), [
    { targetOrdinals: [0, 1], text: "A, B,", startUtf16: 0, endUtf16: 5, alignment: "exact" },
    { targetOrdinals: [2], text: "C.", startUtf16: 6, endUtf16: 8, alignment: "exact" },
  ]);
});

test("keeps the legacy sentence projection for released clients", () => {
  assert.deepEqual(rewriteAlignedOriginalSegments(entryWith([
    { sourceOrdinals: [0, 1], targetOrdinals: [0, 1] },
    { sourceOrdinals: [2], targetOrdinals: [2] },
  ])), [
    { ordinal: 1, text: "A, B,", startUtf16: 0, endUtf16: 5 },
    { ordinal: 2, text: "C.", startUtf16: 6, endUtf16: 8 },
  ]);
});
