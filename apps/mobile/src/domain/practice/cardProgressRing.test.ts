import assert from "node:assert/strict";
import test from "node:test";
import { cardProgressRing } from "./cardProgressRing";

test("ring states follow blanks and accuracy", () => {
  assert.deepEqual(cardProgressRing(null), { fraction: 0, tone: "empty", label: "0%" });
  assert.deepEqual(cardProgressRing({ totalBlanks: 3, answeredBlanks: 0, accuracy: null }), { fraction: 0.1, tone: "pending", label: "0%" });
  assert.deepEqual(cardProgressRing({ totalBlanks: 3, answeredBlanks: 3, accuracy: 67 }), { fraction: 0.67, tone: "partial", label: "67%" });
  assert.deepEqual(cardProgressRing({ totalBlanks: 2, answeredBlanks: 2, accuracy: 100 }), { fraction: 1, tone: "perfect", label: "100%" });
  assert.equal(cardProgressRing({ totalBlanks: 2, answeredBlanks: 1, accuracy: 0 }).fraction, 0.1);
});
