import assert from "node:assert/strict";
import test from "node:test";
import { parseVideoLink, parseVideoUrl, videoEmbedUrl } from "./videoLink.ts";

test("youtube watch, short and shorts links normalize to a watch url", () => {
  for (const raw of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", "https://youtu.be/dQw4w9WgXcQ", "https://m.youtube.com/shorts/dQw4w9WgXcQ"]) {
    assert.deepEqual(parseVideoUrl(raw), { provider: "youtube", id: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
  }
});

test("bilibili BV and b23 short links", () => {
  assert.deepEqual(parseVideoUrl("https://www.bilibili.com/video/BV1xx411c7mD/?spm=1"), { provider: "bilibili", id: "BV1xx411c7mD", url: "https://www.bilibili.com/video/BV1xx411c7mD" });
  assert.equal(parseVideoUrl("https://b23.tv/abc123")?.provider, "bilibili");
});

test("other sites and malformed ids are rejected", () => {
  assert.equal(parseVideoUrl("https://www.baidu.com/s?wd=1"), null);
  assert.equal(parseVideoUrl("https://www.youtube.com/watch?v=short"), null);
  assert.equal(parseVideoUrl("javascript:alert(1)"), null);
});

test("finds a link inside shared text", () => {
  assert.equal(parseVideoLink("看了这个 https://youtu.be/dQw4w9WgXcQ。真不错")?.id, "dQw4w9WgXcQ");
  assert.equal(parseVideoLink("没有链接"), null);
});

test("embed URLs use the official players", () => {
  assert.equal(videoEmbedUrl("https://youtu.be/dQw4w9WgXcQ"), "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1&autoplay=1&rel=0");
  assert.equal(videoEmbedUrl("https://www.bilibili.com/video/BV1xx411c7mD"), "https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&autoplay=1&high_quality=1&danmaku=0");
  assert.equal(videoEmbedUrl("https://b23.tv/abcd12"), null);
  assert.equal(videoEmbedUrl("https://example.com/video"), null);
});
