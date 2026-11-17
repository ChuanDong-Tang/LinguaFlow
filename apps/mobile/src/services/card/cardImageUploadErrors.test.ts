import assert from "node:assert/strict";
import test from "node:test";
import { isExpiredImageUploadError } from "./cardImageUploadErrors";

test("only CARD_IMAGE_NOT_READY means the draft's uploads must be redone", () => {
  assert.equal(isExpiredImageUploadError({ code: "CARD_IMAGE_NOT_READY", status: 409 }), true);
  assert.equal(isExpiredImageUploadError({ code: "TASK_IN_PROGRESS" }), false);
  assert.equal(isExpiredImageUploadError(new Error("CARD_IMAGE_NOT_READY")), false);
  assert.equal(isExpiredImageUploadError(null), false);
});
