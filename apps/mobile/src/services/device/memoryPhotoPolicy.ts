export type MemoryPhotoAccess = "all" | "limited" | "denied" | "undetermined";

export function memoryPhotoAccess(permission: { granted: boolean; status: string; accessPrivileges?: "all" | "limited" | "none" }): MemoryPhotoAccess {
  if (permission.accessPrivileges === "limited") return "limited";
  if (permission.granted && permission.accessPrivileges !== "none") return "all";
  return permission.status === "undetermined" ? "undetermined" : "denied";
}

export function photoDayRange(date: Date) {
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid photo day");
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return { start: start.getTime(), end: end.getTime() };
}

export function mergePhotoPage<T extends { id: string }>(current: readonly T[], incoming: readonly T[]): T[] {
  const seen = new Set(current.map((photo) => photo.id));
  return [...current, ...incoming.filter((photo) => {
    if (seen.has(photo.id)) return false;
    seen.add(photo.id);
    return true;
  })];
}

/** Preview must stay local: an iOS Photos identifier is not a readable file. */
export function memoryPhotoPreviewUri(info: { localUri?: string | null; uri: string }): string | null {
  return [info.localUri, info.uri].find(uri => uri && /^(file|content):\/\//i.test(uri)) ?? null;
}

export function photoBatch<T>(photos: readonly T[], count: number, random: () => number = Math.random): T[] {
  const pool = [...photos];
  const size = Math.min(pool.length, Math.max(0, Number.isFinite(count) ? Math.floor(count) : 0));
  for (let index = 0; index < size; index += 1) {
    const value = random();
    const unit = Number.isFinite(value) ? Math.min(1 - Number.EPSILON, Math.max(0, value)) : 0;
    const picked = index + Math.floor(unit * (pool.length - index));
    [pool[index], pool[picked]] = [pool[picked], pool[index]];
  }
  return pool.slice(0, size);
}

export function nextPhotoSet<T extends { id: string }>(photos: readonly T[], current: readonly T[], count: number, shuffled: boolean, hasNextPage: boolean, random: () => number = Math.random) {
  const size = Math.max(0, Number.isFinite(count) ? Math.floor(count) : 0);
  const after = current.length ? photos.findIndex((photo) => photo.id === current[current.length - 1].id) + 1 : 0;
  const currentIds = new Set(current.map((photo) => photo.id));
  const candidates = shuffled ? photos.filter((photo) => !currentIds.has(photo.id)) : photos.slice(after);
  const needsMore = hasNextPage && candidates.length < size;
  // Do not cycle back to seen photos while the library still has unread pages.
  const pool = candidates.length || hasNextPage ? candidates : photos;
  return { assets: shuffled ? photoBatch(pool, size, random) : pool.slice(0, size), needsMore };
}
