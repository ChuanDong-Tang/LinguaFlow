export type PhraseTier = "level_1" | "level_2" | "level_3";

export function normalizePhraseKey(value: string): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function getPhraseTier(score: number): PhraseTier {
  const safeScore = Number.isFinite(Number(score)) ? Number(score) : 0;
  if (safeScore >= 6) return "level_3";
  if (safeScore >= 3) return "level_2";
  return "level_1";
}

export function clampCardPhraseScore(score: number): number {
  const safeScore = Number.isFinite(Number(score)) ? Number(score) : 0;
  return Math.max(0, Math.min(10, safeScore));
}

export function calcCardAverageScore(scores: number[]): number {
  if (!Array.isArray(scores) || !scores.length) return 0;
  const total = scores.reduce((sum, score) => sum + clampCardPhraseScore(score), 0);
  return total / scores.length;
}
