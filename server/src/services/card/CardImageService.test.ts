import assert from "node:assert/strict";
import test from "node:test";
import { decideCardImageModeration } from "./CardImageService.js";

test("soft-accepts NationalInstitution false positives for review", () => {
  assert.deepEqual(
    decideCardImageModeration({
      suggestion: "Block",
      label: "Polity",
      subLabel: "NationalInstitution",
      score: 99,
    }),
    {
      status: "approved_with_review",
      accepted: true,
      reason: "soft_label_override",
      blockScore: null,
    },
  );
});

test("continues to reject other high-confidence Polity classifications", () => {
  assert.deepEqual(
    decideCardImageModeration({
      suggestion: "Block",
      label: "Polity",
      subLabel: "ChineseNationalFlag",
      score: 91,
    }),
    {
      status: "rejected",
      accepted: false,
      reason: "score_at_or_above_threshold",
      blockScore: 90,
    },
  );
});

test("continues to reject high-confidence non-Polity classifications", () => {
  assert.deepEqual(
    decideCardImageModeration({
      suggestion: "Block",
      label: "Illegal",
      subLabel: "Drug",
      score: 99,
    }),
    {
      status: "rejected",
      accepted: false,
      reason: "score_at_or_above_threshold",
      blockScore: 80,
    },
  );
});

test("does not soften NationalInstitution when the vendor score is missing", () => {
  assert.deepEqual(
    decideCardImageModeration({
      suggestion: "Block",
      label: "Polity",
      subLabel: "NationalInstitution",
      score: null,
    }),
    {
      status: "rejected",
      accepted: false,
      reason: "vendor_block_without_valid_score",
      blockScore: null,
    },
  );
});
