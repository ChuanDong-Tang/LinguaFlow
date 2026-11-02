export function memoryArchiveSet(
  records: ReadonlyArray<{ id: string; status: string; isSample: boolean }>,
  count: number,
  previous: readonly string[] = [],
  random: () => number = Math.random,
): string[] {
  const all = [...new Set(records.filter(r => r.status === "completed" && !r.isSample).map(r => r.id))];
  const unseen = all.filter(id => !previous.includes(id));
  const pool = unseen.length ? unseen : all;
  const size = Number.isFinite(count) ? Math.min(pool.length, Math.max(0, Math.floor(count))) : 0;
  for (let i = 0; i < size; i++) {
    const value = random();
    const offset = Number.isFinite(value) ? Math.max(0, Math.min(0.999999999, value)) : 0;
    const j = i + Math.floor(offset * (pool.length - i));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, size);
}
