import { createHash } from "node:crypto";
import { buildPhraseOccurrenceEmbeddingInput } from "@lf/core/text/phraseOccurrenceEmbedding.js";
import type { PhraseOccurrenceEmbeddingSource } from "@lf/core/ports/repository/CardEnrichmentRepository.js";

export async function loadPhraseOccurrenceEmbeddingSourceData(
  tx: any,
  occurrenceId: string,
  userId?: string,
): Promise<PhraseOccurrenceEmbeddingSource | null> {
  const occurrence = await tx.phraseOccurrence.findFirst({
    where: { id: occurrenceId, ...(userId ? { userId } : {}) },
    select: {
      id: true,
      userId: true,
      cardId: true,
      sourceField: true,
      segmentId: true,
      startUtf16: true,
      endUtf16: true,
      surfaceText: true,
      phrase: { select: { languageCode: true, canonicalText: true, status: true } },
    },
  });
  if (!occurrence || occurrence.sourceField !== "ai_expression" || occurrence.phrase.status !== "normalized") return null;
  const segments = await tx.cardRewriteSegment.findMany({
    where: { entryId: occurrence.cardId },
    select: { id: true, text: true, ordinal: true },
    orderBy: { ordinal: "asc" },
  });
  const normalizedSurface = occurrence.surfaceText.normalize("NFKC").toLocaleLowerCase();
  const rangeMatches = (text: string) => text
    .slice(occurrence.startUtf16, occurrence.endUtf16)
    .normalize("NFKC")
    .toLocaleLowerCase() === normalizedSurface;
  let segment = segments.find((candidate: { id: string; text: string }) => candidate.id === occurrence.segmentId && rangeMatches(candidate.text));
  if (!segment) {
    const matches = segments.filter((candidate: { text: string }) => rangeMatches(candidate.text));
    if (matches.length === 1) segment = matches[0];
  }
  let startUtf16 = occurrence.startUtf16;
  let endUtf16 = occurrence.endUtf16;
  if (!segment) {
    const matches = segments.flatMap((candidate: { text: string }) => {
      const index = candidate.text.normalize("NFKC").toLocaleLowerCase().indexOf(normalizedSurface);
      return index >= 0 ? [{ candidate, index }] : [];
    });
    if (matches.length === 1) {
      segment = matches[0].candidate;
      startUtf16 = matches[0].index;
      endUtf16 = matches[0].index + occurrence.surfaceText.length;
    }
  }
  if (!segment) return null;
  return {
    userId: occurrence.userId,
    occurrenceId: occurrence.id,
    cardId: occurrence.cardId,
    languageCode: occurrence.phrase.languageCode,
    canonicalText: occurrence.phrase.canonicalText,
    sentence: segment.text,
    startUtf16,
    endUtf16,
  };
}

export async function enqueuePhraseOccurrenceEmbeddingForOccurrence(
  tx: any,
  occurrenceId: string,
): Promise<void> {
  const occurrence = await loadPhraseOccurrenceEmbeddingSourceData(tx, occurrenceId);
  if (!occurrence) return;
  const input = buildPhraseOccurrenceEmbeddingInput(occurrence);
  if (!input) return;
  const inputHash = createHash("sha256").update(input).digest("hex");
  await enqueuePhraseOccurrenceEmbeddingGeneration(tx, {
    userId: occurrence.userId,
    occurrenceId: occurrence.occurrenceId,
    inputHash,
    inputVersion: `phrase_occurrence_embedding_input_v1:${inputHash}`,
  });
}

export async function enqueuePhraseOccurrenceEmbeddingGeneration(
  tx: any,
  input: { userId: string; occurrenceId: string; inputHash: string; inputVersion: string },
): Promise<void> {
  await tx.cardEnrichmentJob.upsert({
    where: {
      userId_sourceKind_sourceId_jobType_inputVersion: {
        userId: input.userId,
        sourceKind: "phrase_occurrence",
        sourceId: input.occurrenceId,
        jobType: "generate_phrase_occurrence_embedding",
        inputVersion: input.inputVersion,
      },
    },
    create: {
      userId: input.userId,
      sourceKind: "phrase_occurrence",
      sourceId: input.occurrenceId,
      jobType: "generate_phrase_occurrence_embedding",
      inputHash: input.inputHash,
      inputVersion: input.inputVersion,
      payload: { occurrenceId: input.occurrenceId, schemaVersion: 1 },
    },
    update: {},
  });
}
