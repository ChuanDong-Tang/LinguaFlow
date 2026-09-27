export const PHRASE_RELATION_JUDGE_JOB_TYPE = "judge_phrase_relation";
export const PHRASE_RELATION_JUDGE_SOURCE_KIND = "phrase_occurrence";
export const PHRASE_RELATION_JUDGE_PROMPT_VERSION = "phrase_relation_judge_v2";
export const PHRASE_RELATION_JUDGE_MAX_CANDIDATES = 5;

export interface PhraseRelationJudgeOccurrence {
  occurrenceId: string;
  languageCode: string;
  surfaceText: string;
  sentence: string;
  startUtf16: number;
  endUtf16: number;
}

export interface PhraseRelationJudgeCandidate extends PhraseRelationJudgeOccurrence {
  semanticScore: number;
}

export interface PhraseRelationJudgeSource {
  userId: string;
  anchor: PhraseRelationJudgeOccurrence;
  candidates: PhraseRelationJudgeCandidate[];
}

export function buildPhraseRelationJudgePrompt(source: PhraseRelationJudgeSource): {
  systemPrompt: string;
  userPrompt: string;
} {
  const candidates = source.candidates.slice(0, PHRASE_RELATION_JUDGE_MAX_CANDIDATES);
  const systemPrompt = [
    "You judge whether two highlighted expressions teach the same practical meaning in their shown contexts.",
    "Choose at most one candidate whose central meaning and usage purpose closely match the anchor.",
    "Accept useful near-paraphrases even when tense, inflection, register, emphasis, or degree words differ slightly (for example, 'really addictive' and 'so addictive').",
    "The expressions do not need to be interchangeable word-for-word inside the original sentences.",
    "Reject candidates that merely share a word, topic, broad category, sentiment, or grammatical shape.",
    "Reject different senses of the same word or phrasal verb, opposite polarity, incompatible modality, participant role, or action (for example, 'cracking up' meaning laughing versus 'cracked' meaning broken).",
    "When uncertain, choose none.",
    "Return exactly one XML tag: <choice>candidate_N</choice> or <choice>none</choice>.",
  ].join("\n");
  const userPrompt = [
    `Language: ${source.anchor.languageCode}`,
    `Anchor: ${markSelected(source.anchor)}`,
    ...candidates.map((candidate, index) => `candidate_${index + 1}: ${markSelected(candidate)}`),
  ].join("\n");
  return { systemPrompt, userPrompt };
}

export function phraseRelationJudgeHashInput(source: PhraseRelationJudgeSource): string {
  const prompt = buildPhraseRelationJudgePrompt(source);
  return JSON.stringify([PHRASE_RELATION_JUDGE_PROMPT_VERSION, prompt.systemPrompt, prompt.userPrompt]);
}

export function phraseRelationJudgeInputVersion(inputHash: string): string {
  return `${PHRASE_RELATION_JUDGE_PROMPT_VERSION}:${inputHash}`;
}

export function parsePhraseRelationJudgeOutput(
  output: string,
  candidates: PhraseRelationJudgeCandidate[],
): { selectedOccurrenceId: string | null } {
  const match = output.trim().match(/^<choice>(none|candidate_([1-9][0-9]*))<\/choice>$/i);
  if (!match) throw judgeOutputError("PHRASE_RELATION_JUDGE_OUTPUT_INVALID");
  if (match[1]?.toLowerCase() === "none") return { selectedOccurrenceId: null };
  const index = Number(match[2]) - 1;
  const selected = candidates[index];
  if (!selected || index >= PHRASE_RELATION_JUDGE_MAX_CANDIDATES) {
    throw judgeOutputError("PHRASE_RELATION_JUDGE_CHOICE_OUT_OF_RANGE");
  }
  return { selectedOccurrenceId: selected.occurrenceId };
}

function markSelected(occurrence: PhraseRelationJudgeOccurrence): string {
  const start = Math.max(0, Math.min(occurrence.sentence.length, occurrence.startUtf16));
  const end = Math.max(start, Math.min(occurrence.sentence.length, occurrence.endUtf16));
  const selected = occurrence.sentence.slice(start, end);
  if (selected && selected.localeCompare(occurrence.surfaceText, undefined, { sensitivity: "accent" }) === 0) {
    return `${occurrence.sentence.slice(0, start)}<selected>${selected}</selected>${occurrence.sentence.slice(end)}`;
  }
  const fallbackIndex = occurrence.sentence.toLocaleLowerCase().indexOf(occurrence.surfaceText.toLocaleLowerCase());
  if (fallbackIndex < 0) return `<selected>${occurrence.surfaceText}</selected> — ${occurrence.sentence}`;
  const fallbackEnd = fallbackIndex + occurrence.surfaceText.length;
  return `${occurrence.sentence.slice(0, fallbackIndex)}<selected>${occurrence.sentence.slice(fallbackIndex, fallbackEnd)}</selected>${occurrence.sentence.slice(fallbackEnd)}`;
}

function judgeOutputError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}
