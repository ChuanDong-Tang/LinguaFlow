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

type DatedPhoto = { creationTime: number; modificationTime: number };

/**
 * Android maps creationTime to MediaStore DATE_TAKEN, which is empty (0) for
 * screenshots, saved/downloaded images and some OEM camera files.
 */
export function photoTakenTime(photo: DatedPhoto): number {
  return photo.creationTime > 0 ? photo.creationTime : photo.modificationTime;
}

/**
 * Filter one Android page, read newest-modified first, to a local day. Native
 * DATE_TAKEN filtering would drop every undated photo, so the day is applied here.
 * A file is modified no earlier than it is taken, so once a page reaches rows
 * modified before the day, later pages cannot contain photos from that day.
 */
export function androidPhotoDayPage<T extends DatedPhoto>(photos: readonly T[], range: { start: number; end: number }) {
  return {
    photos: photos.filter((photo) => {
      const time = photoTakenTime(photo);
      return time >= range.start && time < range.end;
    }),
    passedDay: photos.some((photo) => photo.modificationTime > 0 && photo.modificationTime < range.start),
  };
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

/**
 * Change the size of the set being viewed, right away (round 4): a bigger size
 * appends fresh photos after the current ones; a smaller one drops only photos
 * not yet reached — everything up to `keepThrough` (the furthest photo seen or
 * made into a card) stays.
 */
export function resizePhotoSet<T extends { id: string }>(current: readonly T[], photos: readonly T[], count: number, keepThrough: number, random: () => number = Math.random): T[] {
  const size = Math.max(0, Number.isFinite(count) ? Math.floor(count) : 0);
  if (size <= current.length) return current.slice(0, Math.min(current.length, Math.max(size, keepThrough + 1)));
  const ids = new Set(current.map((photo) => photo.id));
  return [...current, ...photoBatch(photos.filter((photo) => !ids.has(photo.id)), size - current.length, random)];
}

/** "近期" photos: from the start of the day `days - 1` days ago until now. */
export function recentPhotoWindowStart(now: Date, days = 3): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).getTime();
}

export function isRecentPhoto(photo: DatedPhoto, now: Date, days = 3): boolean {
  return photoTakenTime(photo) >= recentPhotoWindowStart(now, days);
}

/** 今天 / 昨天 / 前天 for recent photos; null when older (show the date instead). */
export function relativePhotoDay(time: number, now: Date): "today" | "yesterday" | "two_days_ago" | null {
  if (!(time > 0)) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  if (time >= today && time < today + day) return "today";
  if (time >= today - day && time < today) return "yesterday";
  if (time >= today - 2 * day && time < today - day) return "two_days_ago";
  return null;
}
