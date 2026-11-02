import assert from "node:assert/strict";
import test from "node:test";
import { memoryReaderExpanded, shouldExpandMemorySwipe } from "./memoryReader";

test("photo introduction never blocks text-only cards, practice, onboarding or related passages", () => {
  const photo = { hasPhoto: true, requested: false, sample: false, practice: false, guided: false, relation: false };
  assert.equal(memoryReaderExpanded(photo), false);
  assert.equal(memoryReaderExpanded({ ...photo, hasPhoto: false }), true);
  for (const reason of ["requested", "sample", "practice", "guided", "relation"] as const) {
    assert.equal(memoryReaderExpanded({ ...photo, [reason]: true }), true, reason);
  }
});

test("expand requires a deliberate upward swipe, not a photo swipe or tap", () => {
  assert.equal(shouldExpandMemorySwipe(6, -70), true);
  for (const [dx, dy] of [[70, -6], [-70, -30], [0, 80], [2, -20], [60, -70], [NaN, -80]]) {
    assert.equal(shouldExpandMemorySwipe(dx, dy), false);
  }
});
