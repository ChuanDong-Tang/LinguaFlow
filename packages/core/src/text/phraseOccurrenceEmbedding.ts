export interface PhraseOccurrenceEmbeddingInput {
  languageCode: string;
  canonicalText: string;
  sentence: string;
  startUtf16: number;
  endUtf16: number;
}

export function buildPhraseOccurrenceEmbeddingInput(input: PhraseOccurrenceEmbeddingInput): string | null {
  const sentence = input.sentence.normalize("NFKC").trim();
  const canonicalText = input.canonicalText.normalize("NFKC").trim();
  if (!sentence || !canonicalText) return null;
  if (!Number.isInteger(input.startUtf16) || !Number.isInteger(input.endUtf16)
    || input.startUtf16 < 0 || input.endUtf16 <= input.startUtf16 || input.endUtf16 > input.sentence.length) return null;
  const markedSentence = `${input.sentence.slice(0, input.startUtf16)}<phrase>${input.sentence.slice(input.startUtf16, input.endUtf16)}</phrase>${input.sentence.slice(input.endUtf16)}`
    .normalize("NFKC")
    .trim();
  return [
    `language: ${input.languageCode.trim()}`,
    `phrase: ${canonicalText}`,
    `sentence: ${markedSentence}`,
  ].join("\n");
}
