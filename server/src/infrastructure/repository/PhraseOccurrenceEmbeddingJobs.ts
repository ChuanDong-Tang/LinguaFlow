import { createHash } from "node:crypto";
import { buildPhraseOccurrenceEmbeddingInput } from "@lf/core/text/phraseOccurrenceEmbedding.js";

export async function enqueuePhraseOccurrenceEmbeddingForOccurrence(
  tx: any,
  occurrenceId: string,
): Promise<void> {
  const occurrence = await tx.phraseOccurrence.findUnique({
    where: { id: occurrenceId },
    select: {
      id: true,
      userId: true,
      cardId: true,
      sourceField: true,
      segmentId: true,
      startUtf16: true,
      endUtf16: true,
      phrase: { select: { languageCode: true, canonicalText: true, status: true } },
    },
  });
  if (!occurrence || occurrence.sourceField !== "ai_expression" || !occurrence.segmentId
    || occurrence.phrase.status !== "normalized") return;
  const segment = await tx.cardRewriteSegment.findFirst({
    where: { id: occurrence.segmentId, cardId: occurrence.cardId },
    select: { text: true },
  });
  if (!segment) return;
  const input = buildPhraseOccurrenceEmbeddingInput({
    languageCode: occurrence.phrase.languageCode,
    canonicalText: occurrence.phrase.canonicalText,
    sentence: segment.text,
    startUtf16: occurrence.startUtf16,
    endUtf16: occurrence.endUtf16,
  });
  if (!input) return;
  const inputHash = createHash("sha256").update(input).digest("hex");
  await enqueuePhraseOccurrenceEmbeddingGeneration(tx, {
    userId: occurrence.userId,
    occurrenceId: occurrence.id,
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
