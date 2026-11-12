// Podcast library (2026-11, Spotify-style): one list of everything you can
// listen to — favorites (pinned), days, folders, themes, and recent playlists.

export type PodcastLibraryKind = "favorites" | "day" | "folder" | "theme" | "recent";
export type PodcastLibrarySort = "recent" | "added" | "alpha" | "count";
export type PodcastLibraryFilter = "all" | "day" | "folder" | "theme";

export type PodcastLibraryItem = {
  /** Same id the player stores for the playlist (e.g. "folder:abc", "day:2026-11-12"). */
  id: string;
  kind: PodcastLibraryKind;
  title: string;
  count?: number;
  coverUrl: string | null;
  playedAt?: number;
  /** Default (最近添加) order. */
  order: number;
};

/** Attach last-played times; recent playlists that match nothing else stay as their own rows. */
export function mergeRecent(items: PodcastLibraryItem[], recent: ReadonlyArray<{ id: string; title: string; recordIds: string[]; coverUrl?: string | null; playedAt?: number }>): PodcastLibraryItem[] {
  const byId = new Map(items.map((item) => [item.id, { ...item }]));
  let order = items.length;
  recent.forEach((playlist, index) => {
    // Older entries have no timestamp: keep their recency order.
    const playedAt = playlist.playedAt ?? -index;
    const existing = byId.get(playlist.id);
    if (existing) existing.playedAt = Math.max(existing.playedAt ?? Number.NEGATIVE_INFINITY, playedAt);
    else byId.set(playlist.id, { id: playlist.id, kind: "recent", title: playlist.title, count: playlist.recordIds.length, coverUrl: playlist.coverUrl ?? null, playedAt, order: order++ });
  });
  return [...byId.values()];
}

export function arrangeLibrary(items: PodcastLibraryItem[], sort: PodcastLibrarySort, filter: PodcastLibraryFilter): PodcastLibraryItem[] {
  const visible = items.filter((item) => filter === "all" || item.kind === filter || (item.kind === "favorites" && filter === "folder"));
  const compare = (a: PodcastLibraryItem, b: PodcastLibraryItem): number => {
    if (sort === "recent") return (b.playedAt ?? Number.NEGATIVE_INFINITY) - (a.playedAt ?? Number.NEGATIVE_INFINITY) || a.order - b.order;
    if (sort === "alpha") return a.title.localeCompare(b.title, "zh-Hans-CN") || a.order - b.order;
    if (sort === "count") return (b.count ?? -1) - (a.count ?? -1) || a.order - b.order;
    return a.order - b.order;
  };
  // 收藏 stays pinned on top, like Spotify's liked songs.
  const pinned = visible.filter((item) => item.kind === "favorites");
  return [...pinned, ...visible.filter((item) => item.kind !== "favorites").sort(compare)];
}
