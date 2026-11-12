import assert from "node:assert/strict";
import test from "node:test";
import { arrangeLibrary, mergeRecent, type PodcastLibraryItem } from "./podcastLibrary";

const base: PodcastLibraryItem[] = [
  { id: "favorites", kind: "favorites", title: "收藏", coverUrl: null, order: 0 },
  { id: "day:2026-11-12", kind: "day", title: "今天", coverUrl: null, order: 1 },
  { id: "folder:a", kind: "folder", title: "装修", count: 9, coverUrl: null, order: 2 },
  { id: "theme:旅行", kind: "theme", title: "旅行", count: 3, coverUrl: null, order: 3 },
];

test("recent playlists annotate matching rows or become their own", () => {
  const merged = mergeRecent(base, [{ id: "folder:a", title: "装修", recordIds: ["1"], playedAt: 100 }, { id: "random", title: "随机", recordIds: ["1", "2"], playedAt: 50 }]);
  assert.equal(merged.find((item) => item.id === "folder:a")!.playedAt, 100);
  assert.equal(merged.find((item) => item.id === "random")!.kind, "recent");
});

test("favorites stay pinned; sorts and filters", () => {
  const merged = mergeRecent(base, [{ id: "theme:旅行", title: "旅行", recordIds: [], playedAt: 200 }, { id: "folder:a", title: "装修", recordIds: [], playedAt: 100 }]);
  assert.deepEqual(arrangeLibrary(merged, "recent", "all").map((item) => item.id), ["favorites", "theme:旅行", "folder:a", "day:2026-11-12"]);
  assert.deepEqual(arrangeLibrary(merged, "count", "all").map((item) => item.id).slice(0, 3), ["favorites", "folder:a", "theme:旅行"]);
  assert.deepEqual(arrangeLibrary(merged, "added", "theme").map((item) => item.id), ["theme:旅行"]);
  assert.deepEqual(arrangeLibrary(merged, "added", "folder").map((item) => item.id), ["favorites", "folder:a"]);
});
