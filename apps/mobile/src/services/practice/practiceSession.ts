// One blind-box set's results, for the end-of-set 战绩 summary (2026-11).
// Cloze grading reports here only while a session is open.

export type PracticeSessionSummary = { cards: number; right: number; wrong: number; accuracy: number };

let active: { cards: Set<string>; results: Map<string, boolean> } | null = null;

export function startPracticeSession(): void {
  active = { cards: new Set(), results: new Map() };
}

/** Latest result per blank wins (a redone blank counts once). */
export function recordPracticeAttempt(recordId: string, blankId: string, correct: boolean): void {
  if (!active) return;
  active.cards.add(recordId);
  active.results.set(`${recordId}:${blankId}`, correct);
}

export function summarizePracticeSession(): PracticeSessionSummary | null {
  if (!active || !active.results.size) return null;
  const values = [...active.results.values()];
  const right = values.filter(Boolean).length;
  return { cards: active.cards.size, right, wrong: values.length - right, accuracy: Math.round((right / values.length) * 100) };
}

export function endPracticeSession(): PracticeSessionSummary | null {
  const summary = summarizePracticeSession();
  active = null;
  return summary;
}
