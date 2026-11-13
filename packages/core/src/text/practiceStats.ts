import { clozeBlankTone } from "./clozeProgress.js";

/**
 * 学习统计 for OIO AI (2026-11): which answers the user keeps missing, from
 * the per-blank answer memory in each card's cloze state.
 */
export type PracticeStateRow = { cardId: string; title: string; updatedAt: Date; clozeState: unknown };

export type WeakWord = {
  answer: string;
  /** Wrong attempts across cards (attempts − correct). */
  misses: number;
  /** Still wrong on the latest attempt somewhere. */
  stillWrong: boolean;
  cardIds: string[];
};

export type PracticeStats = {
  cardsPracticed: number;
  blanksAnswered: number;
  accuracy: number | null;
  weakWords: WeakWord[];
  /** Cards whose latest answers include a wrong one, most recent first. */
  cardsWithMistakes: Array<{ cardId: string; title: string; wrongBlanks: number }>;
};

type Blank = { id?: unknown; answer?: unknown; attempts?: unknown; correctCount?: unknown; lastResult?: unknown; mastered?: unknown };

function blanksOf(state: unknown): Blank[] {
  const blanks = state && typeof state === "object" ? (state as { blanks?: unknown }).blanks : null;
  return Array.isArray(blanks) ? blanks.filter((blank): blank is Blank => Boolean(blank) && typeof blank === "object") : [];
}

export function practiceStats(rows: PracticeStateRow[], options: { since?: Date; limit?: number } = {}): PracticeStats {
  const limit = options.limit ?? 10;
  const recent = rows.filter((row) => !options.since || row.updatedAt >= options.since)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const words = new Map<string, WeakWord>();
  const cardsWithMistakes: PracticeStats["cardsWithMistakes"] = [];
  let answered = 0;
  let correct = 0;
  let practiced = 0;
  for (const row of recent) {
    let wrongBlanks = 0;
    let touched = false;
    for (const blank of blanksOf(row.clozeState)) {
      const tone = clozeBlankTone(blank as { id: string });
      if (tone === "unanswered") continue;
      touched = true;
      answered += 1;
      if (tone === "correct") correct += 1;
      else wrongBlanks += 1;
      const attempts = Number(blank.attempts) || 0;
      const misses = Math.max(0, attempts - (Number(blank.correctCount) || 0)) || (tone === "incorrect" ? 1 : 0);
      const answer = typeof blank.answer === "string" ? blank.answer.trim() : "";
      if (!misses || !answer) continue;
      const key = answer.toLowerCase();
      const word = words.get(key) ?? { answer, misses: 0, stillWrong: false, cardIds: [] };
      word.misses += misses;
      word.stillWrong ||= tone === "incorrect";
      if (!word.cardIds.includes(row.cardId)) word.cardIds.push(row.cardId);
      words.set(key, word);
    }
    if (touched) practiced += 1;
    if (wrongBlanks) cardsWithMistakes.push({ cardId: row.cardId, title: row.title, wrongBlanks });
  }
  return {
    cardsPracticed: practiced,
    blanksAnswered: answered,
    accuracy: answered ? Math.round((correct / answered) * 100) : null,
    weakWords: [...words.values()]
      .sort((a, b) => Number(b.stillWrong) - Number(a.stillWrong) || b.misses - a.misses || a.answer.localeCompare(b.answer))
      .slice(0, limit),
    cardsWithMistakes: cardsWithMistakes.slice(0, limit),
  };
}
