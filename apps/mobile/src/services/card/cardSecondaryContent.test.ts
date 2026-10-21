import assert from "node:assert/strict";
import test from "node:test";
import { resolveCardSecondaryContent } from "./cardSecondaryContent";

for (const [languageCode, text] of [
  ["zh-CN", "点击播放，听听这句话。"],
  ["zh-TW", "點擊播放，聽聽這句話。"],
  ["en-US", "Tap play to listen."],
  ["ja-JP", "再生して聞いてみましょう。"],
]) {
  test(`tutorial displays supplied ${languageCode} translation without an aligned original`, () => {
    const segments = [{ ordinal: 0, text }];
    assert.deepEqual(resolveCardSecondaryContent({
      contentType: "rewrite", auxiliarySegments: segments, auxiliaryLanguageCode: languageCode,
    }, true), { segments, languageCode });
  });
}

test("ordinary rewrites still use aligned originals, not translations", () => {
  const segments = [{ ordinal: 0, text: "用户原文" }];
  assert.deepEqual(resolveCardSecondaryContent({
    contentType: "rewrite", alignedOriginalSegments: segments, alignedOriginalLanguageCode: "zh-CN",
    auxiliarySegments: [{ ordinal: 0, text: "Translation" }], auxiliaryLanguageCode: "en-US",
  }), { segments, languageCode: "zh-CN" });
  assert.deepEqual(resolveCardSecondaryContent({
    contentType: "rewrite", auxiliarySegments: [{ ordinal: 0, text: "Translation" }],
  }), { segments: [], languageCode: null });
});

test("other content types retain their auxiliary text", () => {
  const segments = [{ ordinal: 1, text: "辅助说明" }];
  for (const contentType of ["reply", "image:1", "original"]) {
    for (const isSample of [false, true]) {
      assert.deepEqual(resolveCardSecondaryContent({
        contentType, auxiliarySegments: segments, auxiliaryLanguageCode: "zh-CN",
      }, isSample), { segments, languageCode: "zh-CN" });
    }
  }
});

test("missing tutorial translations are safe", () => {
  assert.deepEqual(resolveCardSecondaryContent({ contentType: "rewrite" }, true), {
    segments: [], languageCode: null,
  });
});
