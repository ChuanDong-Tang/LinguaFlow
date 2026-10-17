import assert from "node:assert/strict";
import test from "node:test";
import { resolveDeviceLanguage } from "./deviceLanguage";

test("maps device locales to supported interface languages", () => {
  for (const [locale, expected] of [
    ["zh_CN", "zh-CN"], ["zh-Hans-HK", "zh-CN"],
    ["zh-TW", "zh-TW"], ["zh_HK", "zh-TW"], ["zh-MO", "zh-TW"],
    ["zh-Hant-US", "zh-TW"], ["ja_JP", "ja-JP"],
    ["en-GB", "en-US"], ["fr-FR", "en-US"], ["", "en-US"],
  ]) assert.equal(resolveDeviceLanguage(locale), expected);
  assert.equal(resolveDeviceLanguage(undefined), "en-US");
});
