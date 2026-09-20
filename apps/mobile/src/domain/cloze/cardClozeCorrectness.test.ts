import assert from "node:assert/strict";
import test from "node:test";
import { isCardClozeBlankCorrect } from "./cardClozeCorrectness.js";

test("keeps a persisted mastered blank visually correct after reopening a card", () => {
  assert.equal(isCardClozeBlankCorrect({ id: "persisted", mastered: true }, {}), true);
});

test("supports current-session answers without marking incorrect answers green", () => {
  assert.equal(isCardClozeBlankCorrect({ id: "session" }, { session: "correct" }), true);
  assert.equal(isCardClozeBlankCorrect({ id: "wrong" }, { wrong: "incorrect" }), false);
});
