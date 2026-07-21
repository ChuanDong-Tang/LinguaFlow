import assert from "node:assert/strict";
import test from "node:test";
import {
  InvalidProfileNicknameError,
  maskEmail,
  maskPhone,
  normalizeProfileNickname,
} from "./UserProfileService.js";

test("nickname normalization folds whitespace and counts grapheme clusters", () => {
  assert.equal(normalizeProfileNickname("  Reed   Tang  "), "Reed Tang");
  assert.equal(normalizeProfileNickname("👨‍👩‍👧‍👦A"), "👨‍👩‍👧‍👦A");
});

test("nickname validation rejects identity-shaped and symbol-only values", () => {
  for (const value of ["reed@example.com", "138 1234 5678", "✨✨✨", "\nReed"]) {
    assert.throws(() => normalizeProfileNickname(value), InvalidProfileNicknameError);
  }
});

test("binding masks never return the complete identity", () => {
  assert.equal(maskPhone("13812345678"), "138****5678");
  assert.equal(maskEmail("reed@example.com"), "re***@example.com");
});
