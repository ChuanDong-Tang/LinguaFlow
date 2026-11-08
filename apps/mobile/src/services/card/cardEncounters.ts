import { recordCardEncounter } from "../api/cardApi";

// "遇见": every time the user opens a card it counts as meeting it again.
// Re-opening the same card within a few minutes (swiping back and forth in a
// set) counts once. Failures are silent: the count is a nicety, not a record.
const REPEAT_WINDOW_MS = 10 * 60 * 1000;
const lastCountedAt = new Map<string, number>();
const listeners = new Set<(recordId: string, encounterCount: number) => void>();

export function subscribeCardEncounters(listener: (recordId: string, encounterCount: number) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function countCardEncounter(recordId: string, now = Date.now()): void {
  const last = lastCountedAt.get(recordId);
  if (last !== undefined && now - last < REPEAT_WINDOW_MS) return;
  lastCountedAt.set(recordId, now);
  void recordCardEncounter(recordId)
    .then(({ encounterCount }) => { for (const listener of listeners) listener(recordId, encounterCount); })
    .catch(() => { lastCountedAt.delete(recordId); });
}
