import assert from "node:assert/strict";
import test from "node:test";
import {
  isCardClozeBlankAnsweredThisSession,
  isCardClozeBlankCorrect,
  shouldMaskCardClozeBlank,
} from "./cardClozeCorrectness.js";

test("keeps a persisted mastered blank visually correct after reopening a card", () => {
  assert.equal(isCardClozeBlankCorrect({ id: "persisted", mastered: true }, {}), true);
});

test("supports current-session answers without marking incorrect answers green", () => {
  assert.equal(isCardClozeBlankCorrect({ id: "session" }, { session: "correct" }), true);
  assert.equal(isCardClozeBlankCorrect({ id: "wrong" }, { wrong: "incorrect" }), false);
});

test("remasks persisted mastery until the answer is correct in the current session", () => {
  const mastered = { id: "persisted", mastered: true };
  assert.equal(isCardClozeBlankCorrect(mastered, {}), true);
  assert.equal(isCardClozeBlankAnsweredThisSession(mastered, {}), false);
  assert.equal(shouldMaskCardClozeBlank(mastered, {}, false), true);

  const checked = { persisted: "correct" as const };
  assert.equal(isCardClozeBlankAnsweredThisSession(mastered, checked), true);
  assert.equal(shouldMaskCardClozeBlank(mastered, checked, false), false);
  assert.equal(shouldMaskCardClozeBlank(mastered, {}, true), false);
});
