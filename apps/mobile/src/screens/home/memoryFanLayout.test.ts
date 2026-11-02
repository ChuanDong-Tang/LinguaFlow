import test from "node:test";
import assert from "node:assert/strict";
import { memoryFanLayout } from "./memoryFanLayout";
test("rotated photo stacks stay inside narrow and wide page bounds", () => {
  for (const width of [240, 280, 320, 343, 390, 700]) {
    for (const requestedHeight of [170, 285, 420, 600]) {
      const card = memoryFanLayout(width, requestedHeight);
      const angle = card.angle * Math.PI / 180;
      const rotatedWidth = card.width * Math.cos(angle) + card.height * Math.sin(angle);
      assert.ok(rotatedWidth + card.offset * 2 < width, `${width}/${requestedHeight}`);
      assert.ok(card.height <= requestedHeight);
    }
  }
});
