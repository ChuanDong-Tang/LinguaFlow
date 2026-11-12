import assert from "node:assert/strict";
import test from "node:test";
import { endPracticeSession, recordPracticeAttempt, startPracticeSession } from "./practiceSession";

test("summarizes a set: latest result per blank, cards touched", () => {
  recordPracticeAttempt("c0", "x", true); // ignored: no session yet
  startPracticeSession();
  recordPracticeAttempt("c1", "a", false);
  recordPracticeAttempt("c1", "a", true);
  recordPracticeAttempt("c2", "b", false);
  assert.deepEqual(endPracticeSession(), { cards: 2, right: 1, wrong: 1, accuracy: 50 });
  assert.equal(endPracticeSession(), null);
});
