export function memoryDeckPages<T>(items: readonly T[], perPage: number): T[][] {
  const size = perPage === 1 || perPage === 2 ? perPage : 3;
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}

/**
 * Deck page to show after reading a set: the page holding the last card read,
 * or the trailing "next set" page once the reader went past the final card.
 */
export function memoryDeckReturnPage(ids: readonly string[], perPage: number, lastId: string, finished: boolean): number | null {
  const size = perPage === 1 || perPage === 2 ? perPage : 3;
  const pageCount = Math.ceil(ids.length / size);
  if (finished) return pageCount;
  const index = ids.indexOf(lastId);
  return index < 0 ? null : Math.floor(index / size);
}
