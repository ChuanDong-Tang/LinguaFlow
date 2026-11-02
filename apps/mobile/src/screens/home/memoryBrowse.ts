export function memoryBrowseIds(records: ReadonlyArray<{ id: string; status: string; isSample: boolean; dateKey: string }>, dateKey?: string): string[] {
  return [...new Set([...records]
    .filter((record) => record.status === "completed" && (!dateKey || record.dateKey === dateKey))
    .sort((a, b) => Number(b.isSample) - Number(a.isSample))
    .map((record) => record.id))];
}

/** Freeze a small round; the clicked card always leads and source order is untouched. */
export function memoryBrowseRound(ids: readonly string[], first: string, random: () => number = Math.random): string[] {
  const pool = [...new Set(ids)].filter(id => id !== first);
  if (!ids.includes(first)) return [];
  for (let i = pool.length - 1; i > 0; i--) {
    const value = random();
    const j = Math.floor((Number.isFinite(value) ? Math.max(0, Math.min(0.999999999, value)) : 0) * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return [first, ...pool.slice(0, 9)];
}

export function memoryBrowsePosition(ids: readonly string[] | undefined, id: string) {
  const index = ids?.indexOf(id) ?? -1;
  if (!ids || index < 0) return null;
  return { index, total: ids.length, previous: ids[index - 1], next: ids[index + 1] };
}

/** A card swipe must not steal gestures from playback, dictation or editing. */
export function canSwipeMemoryCard(input: {
  hasPosition: boolean;
  tab: string;
  playback: boolean;
  editing: boolean;
  loading: boolean;
  imageAdding: boolean;
  imageGesture: boolean;
  interactionLocked: boolean;
}) {
  return input.hasPosition && input.tab === "review" && !input.playback
    && !input.editing && !input.loading && !input.imageAdding
    && !input.imageGesture && !input.interactionLocked;
}
