import assert from "node:assert/strict";
import test from "node:test";
import { focusedCoverRect, homeCoverAspect } from "./coverAspect";

test("cover aspect follows the photo within 3:4 … 5:4", () => {
  assert.equal(homeCoverAspect(1080, 1920), 0.75);
  assert.equal(homeCoverAspect(1920, 1080), 1.25);
  assert.equal(homeCoverAspect(1000, 1000), 1);
});

test("focus moves the visible window", () => {
  const frame = { width: 100, height: 133.33 };
  assert.deepEqual(focusedCoverRect({ width: 1080, height: 1920 }, frame, { y: 0 }).top, -0);
  const bottom = focusedCoverRect({ width: 1080, height: 1920 }, frame, { y: 1 });
  assert.ok(Math.abs(bottom.top + (bottom.height - frame.height)) < 0.01);
});
