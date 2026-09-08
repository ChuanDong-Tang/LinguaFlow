type SentenceMark = { startMs: number; durationMs: number };

export function resolveCardPlaybackProgress(input: {
  positionMs: number;
  playerDurationMs: number | null;
  timelineDurationMs: number | null;
  sentenceMarks: SentenceMark[];
  sentenceTexts: string[];
}): { durationMs: number; progress: number } {
  const positive = (value: number | null) => value !== null && Number.isFinite(value) && value > 0 ? value : 0;
  const position = Number.isFinite(input.positionMs) ? Math.max(0, input.positionMs) : 0;
  const durationMs = positive(input.timelineDurationMs) || positive(input.playerDurationMs);
  if (durationMs) return { durationMs, progress: Math.min(1, position / durationMs) };
  // While the stream's total duration is unknown, advance through the known
  // sentence timeline. Unreceived sentences still reserve their share of the bar.
  const weights = input.sentenceTexts.map((text) => Math.max(1, Array.from(text).length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const completed = weights.reduce((sum, weight, index) => {
    const mark = input.sentenceMarks[index];
    if (!mark || !Number.isFinite(mark.startMs) || !positive(mark.durationMs)) return sum;
    return sum + weight * Math.max(0, Math.min(1, (position - mark.startMs) / mark.durationMs));
  }, 0);
  return { durationMs: 0, progress: total ? completed / total : 0 };
}
