import assert from "node:assert/strict";
import test from "node:test";
import { focusedCoverRect, homeCoverAspect } from "./coverAspect";

test("cover aspect follows the photo within 2:3 … 4:3", () => {
  assert.equal(homeCoverAspect(1080, 1920), 2 / 3);
  assert.equal(homeCoverAspect(1920, 1080), 4 / 3);
  assert.equal(homeCoverAspect(1500, 2000), 0.75);
  assert.equal(homeCoverAspect(1000, 1000), 1);
});

test("focus moves the visible window", () => {
  const frame = { width: 100, height: 133.33 };
  assert.deepEqual(focusedCoverRect({ width: 1080, height: 1920 }, frame, { y: 0 }).top, -0);
  const bottom = focusedCoverRect({ width: 1080, height: 1920 }, frame, { y: 1 });
  assert.ok(Math.abs(bottom.top + (bottom.height - frame.height)) < 0.01);
});

test("the picked point stays centred whatever the frame shape", () => {
  const photo = { width: 1000, height: 2000 };
  // Point at 40% height: a square and a 3:4 frame both centre on it.
  const square = focusedCoverRect(photo, { width: 100, height: 100 }, { y: 0.4 });
  const tall = focusedCoverRect(photo, { width: 100, height: 133 }, { y: 0.4 });
  assert.ok(Math.abs((-square.top + 50) / square.height - 0.4) < 0.001);
  assert.ok(Math.abs((-tall.top + 66.5) / tall.height - 0.4) < 0.001);
  // Landscape in a square: horizontal focus.
  const wide = focusedCoverRect({ width: 2000, height: 1000 }, { width: 100, height: 100 }, { x: 0.25 });
  assert.ok(Math.abs((-wide.left + 50) / wide.width - 0.25) < 0.001);
});
