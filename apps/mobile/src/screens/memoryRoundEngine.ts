export type MemoryTask = "cloze_input" | "cloze_choice" | "meaning_sentence" | "listening_sentence" | "guided_speech" | "blind_speech";

export type MemoryTaskWeights = Readonly<Record<MemoryTask, number>>;

// Keep the mix in one place so product tuning does not need to change question generation.
// Cloze tasks intentionally dominate, sentence puzzles come next, and speaking is occasional.
export const DEFAULT_MEMORY_TASK_WEIGHTS: MemoryTaskWeights = {
  cloze_input: 32,
  cloze_choice: 32,
  meaning_sentence: 12,
  listening_sentence: 12,
  guided_speech: 6,
  blind_speech: 6,
};

export type MemoryCandidateLike = {
  recordId: string;
  segments: Array<{ id: string; ordinal: number; text: string }>;
  clozeState: {
    blanks: Array<{ id: string; segmentId: string; startUtf16?: number; endUtf16?: number; answer?: string; mastered?: boolean }>;
  };
};

export type ReviewableMemoryCandidateLike = MemoryCandidateLike & {
  clozeLastResult?: "correct" | "incorrect" | "revealed" | null;
  clozeNextReviewAt?: string | null;
};

export function isMemoryCandidateDue(candidate: ReviewableMemoryCandidateLike, now = Date.now()): boolean {
  if (candidate.clozeState.blanks.some((blank) => !blank.mastered)) return true;
  if (candidate.clozeLastResult === "incorrect" || candidate.clozeLastResult === "revealed") return true;
  if (!candidate.clozeNextReviewAt) return false;
  const nextReviewAt = Date.parse(candidate.clozeNextReviewAt);
  return Number.isFinite(nextReviewAt) && nextReviewAt <= now;
}

export type GeneratedMemoryQuestion = {
  segmentId: string;
  sentence: string;
  blankIds: string[];
  blankStartUtf16: number;
  blankEndUtf16: number;
  blankAnswer: string;
  task: MemoryTask;
  kind: "sentence" | "speech";
  affectsMastery: boolean;
};

export async function orderMemoryCandidates<T extends { recordId: string }>(
  candidates: T[],
  limit: number,
  loadRelated: (recordId: string) => Promise<Array<{ recordId: string; topic: string }>>,
  random: () => number = Math.random,
): Promise<{ candidates: T[]; relationTopics: Map<string, string> }> {
  if (!candidates.length || limit <= 0) return { candidates: [], relationTopics: new Map() };
  const ordered = [candidates[0]!];
  const remaining = candidates.slice(1);
  const relationTopics = new Map<string, string>();
  while (ordered.length < limit && remaining.length) {
    let selectedIndex = -1;
    try {
      const related = await loadRelated(ordered[ordered.length - 1]!.recordId);
      const rank = new Map(related.map((item, index) => [item.recordId, { index, topic: item.topic }]));
      for (let index = 0; index < remaining.length; index += 1) {
        if (!rank.has(remaining[index]!.recordId)) continue;
        if (selectedIndex < 0 || rank.get(remaining[index]!.recordId)!.index < rank.get(remaining[selectedIndex]!.recordId)!.index) selectedIndex = index;
      }
      if (selectedIndex >= 0) relationTopics.set(remaining[selectedIndex]!.recordId, rank.get(remaining[selectedIndex]!.recordId)!.topic);
    } catch {
      // Random fallback below deliberately keeps a failed relation request non-blocking.
    }
    if (selectedIndex < 0) selectedIndex = Math.min(remaining.length - 1, Math.floor(random() * remaining.length));
    ordered.push(remaining.splice(selectedIndex, 1)[0]!);
  }
  return { candidates: ordered, relationTopics };
}

export function buildMemoryCardQuestions(
  candidate: MemoryCandidateLike,
  random: () => number = Math.random,
  previousTasksBySegment: ReadonlyMap<string, MemoryTask> = new Map(),
  taskWeights: MemoryTaskWeights = DEFAULT_MEMORY_TASK_WEIGHTS,
): GeneratedMemoryQuestion[] {
  const bySegment = new Map<string, MemoryCandidateLike["clozeState"]["blanks"]>();
  for (const blank of candidate.clozeState.blanks) {
    const current = bySegment.get(blank.segmentId) ?? [];
    current.push(blank);
    bySegment.set(blank.segmentId, current);
  }
  const groups = candidate.segments
    .map((segment) => {
      const allBlanks = bySegment.get(segment.id) ?? [];
      const unmastered = allBlanks.filter((blank) => !blank.mastered);
      return { segment, blanks: unmastered.length ? unmastered : allBlanks };
    })
    .filter((group) => group.blanks.length > 0 && canBuildSentence(group.segment.text));
  if (!groups.length) return [];

  const shuffledGroups = shuffleWith(groups, random);
  return shuffledGroups.map((group) => {
    const supportedTasks: MemoryTask[] = ["cloze_input", "cloze_choice", "meaning_sentence", "listening_sentence", "guided_speech"];
    if (memoryWordCount(group.segment.text) <= 12) supportedTasks.push("blind_speech");
    const previousTask = previousTasksBySegment.get(group.segment.id);
    const allowedTasks = supportedTasks.filter((task) => task !== previousTask);
    const task = pickWeightedTask(allowedTasks.length ? allowedTasks : supportedTasks, taskWeights, random);
    const eligibleBlanks = group.blanks.filter((blank) => !blank.mastered);
    const blankPool = eligibleBlanks.length ? eligibleBlanks : group.blanks;
    const selectedBlank = blankPool[Math.min(blankPool.length - 1, Math.floor(random() * blankPool.length))]!;
    const start = Math.max(0, Math.min(group.segment.text.length, selectedBlank.startUtf16 ?? 0));
    const end = Math.max(start, Math.min(group.segment.text.length, selectedBlank.endUtf16 ?? start));
    const answer = group.segment.text.slice(start, end) || selectedBlank.answer?.trim() || group.segment.text;
    return {
      segmentId: group.segment.id,
      sentence: group.segment.text,
      blankIds: [selectedBlank.id],
      blankStartUtf16: start,
      blankEndUtf16: end,
      blankAnswer: answer,
      task,
      kind: task === "meaning_sentence" || task === "listening_sentence" || task === "cloze_input" || task === "cloze_choice" ? "sentence" : "speech",
      affectsMastery: true,
    };
  });
}

function pickWeightedTask(tasks: MemoryTask[], weights: MemoryTaskWeights, random: () => number): MemoryTask {
  const weighted = tasks.map((task) => ({ task, weight: Math.max(0, weights[task] ?? 0) }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return tasks[Math.min(tasks.length - 1, Math.floor(random() * tasks.length))]!;
  let target = Math.min(0.999999999, Math.max(0, random())) * total;
  for (const item of weighted) {
    if (target < item.weight) return item.task;
    target -= item.weight;
  }
  return weighted[weighted.length - 1]!.task;
}

function shuffleWith<T>(values: T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.min(index, Math.floor(random() * (index + 1)));
    [result[index], result[target]] = [result[target]!, result[index]!];
  }
  return result;
}

function memoryWordCount(sentence: string): number {
  const cjkUnits = sentence.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  if (cjkUnits?.length) return cjkUnits.length;
  const words = sentence.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
  return words.length || Array.from(sentence.trim()).length;
}

function canBuildSentence(sentence: string): boolean {
  const nonWhitespaceParts = sentence.match(/\S+/gu) ?? [];
  if (nonWhitespaceParts.length >= 2) return true;
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(sentence)
    && Array.from(sentence.trim()).length >= 2;
}
