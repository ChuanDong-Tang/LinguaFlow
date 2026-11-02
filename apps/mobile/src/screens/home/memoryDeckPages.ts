export function memoryDeckPages<T>(items: readonly T[], perPage: number): T[][] {
  const size = perPage === 1 || perPage === 2 ? perPage : 3;
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}
