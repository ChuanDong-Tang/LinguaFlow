import { mergePhotoPage, type MemoryPhotoAccess } from "./memoryPhotoPolicy";

export type PhotoPage<T> = {
  assets: T[];
  access: MemoryPhotoAccess;
  canAskAgain: boolean;
  hasNextPage: boolean;
  endCursor?: string;
};
export type PhotoPagerState<T> = PhotoPage<T> & { loading: boolean; error: boolean };

/** One controller per open photo browser; no permission prompts or uploads. */
export function createMemoryPhotoPager<T extends { id: string }>(
  read: (query: { day?: Date; after?: string }) => Promise<PhotoPage<T>>,
  changed: (state: PhotoPagerState<T>) => void,
) {
  const empty = (): PhotoPagerState<T> => ({ assets: [], access: "undetermined", canAskAgain: true, hasNextPage: true, loading: false, error: false });
  let state = empty();
  let generation = 0;
  let day: Date | undefined;
  let disposed = false;
  const publish = (next: PhotoPagerState<T>) => { state = next; if (!disposed) changed(next); };

  async function load() {
    if (disposed || state.loading || !state.hasNextPage) return;
    const token = generation;
    const cursor = state.endCursor;
    const previousAccess = state.access;
    publish({ ...state, loading: true, error: false });
    try {
      const page = await read({ day, after: cursor });
      if (disposed || token !== generation) return;
      const accessible = page.access === "all" || page.access === "limited";
      // A changed scope makes old cursors and previously readable assets unsafe.
      if (cursor && accessible && previousAccess !== page.access) {
        await reset(day);
        return;
      }
      publish({
        ...page,
        assets: accessible ? mergePhotoPage(state.assets, page.assets) : [],
        hasNextPage: accessible && page.hasNextPage && Boolean(page.endCursor) && page.endCursor !== cursor,
        loading: false,
        error: false,
      });
    } catch {
      if (!disposed && token === generation) publish({ ...state, loading: false, error: true });
    }
  }

  async function reset(nextDay?: Date) {
    if (disposed) return;
    generation += 1;
    day = nextDay ? new Date(nextDay.getTime()) : undefined;
    publish(empty());
    await load();
  }

  return {
    reset,
    loadMore: load,
    getState: () => state,
    dispose: () => { disposed = true; generation += 1; },
  };
}
