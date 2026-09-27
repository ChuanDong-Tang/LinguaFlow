import { createHash } from "node:crypto";
import { buildPhraseOccurrenceEmbeddingInput } from "@lf/core/text/phraseOccurrenceEmbedding.js";
import {
  buildPhraseOccurrenceContextMeaningEmbeddingInput,
  buildPhraseOccurrenceContextMeaningPrompt,
  buildPhraseOccurrenceSenseEmbeddingInput,
  buildPhraseOccurrenceSensePrompt,
  parsePhraseOccurrenceContextMeaningOutput,
  parsePhraseOccurrenceSenseOutput,
  PHRASE_OCCURRENCE_CONTEXT_MEANING_PROMPT_VERSION,
  PHRASE_OCCURRENCE_CONTEXT_MEANING_REPRESENTATION_VERSION,
  PHRASE_OCCURRENCE_SENSE_PROMPT_VERSION,
} from "@lf/core/Prompts/phraseOccurrenceSensePrompt.js";
import type { EmbeddingProvider } from "@lf/core/ports/ai/EmbeddingProvider.js";
import type { AIProvider } from "@lf/core/ports/ai/AIProvider.js";
import type { CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import type { ResourceGovernor } from "../resource/ResourceGovernor.js";
import { resolveEnrichmentRetry, safeEnrichmentErrorMessage } from "./EnrichmentJobRetry.js";
import {
  isPhraseOccurrenceSenseJob,
  phraseOccurrenceRepresentationHashInput,
  phraseOccurrenceRepresentationVersionFromJob,
} from "../../infrastructure/repository/PhraseOccurrenceEmbeddingJobs.js";

export class PhraseOccurrenceEmbeddingWorkerService {
  constructor(
    private readonly repository: CardEnrichmentRepository,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly systemEventLogRepository?: SystemEventLogRepository,
    private readonly options: { leaseMs?: number; maxAttempts?: number } = {},
    private readonly resourceGovernor?: ResourceGovernor,
    private readonly aiProvider?: AIProvider,
  ) {}

  async claimAndProcess(workerId: string): Promise<boolean> {
    const job = await this.repository.claimNextPhraseOccurrenceEmbeddingJob(
      workerId,
      new Date(Date.now() + (this.options.leaseMs ?? 60_000)),
    );
    if (!job) return false;
    try {
      const source = await this.repository.loadPhraseOccurrenceEmbeddingSource(job);
      if (!source) {
        await this.repository.completeWithoutResult(job, "PHRASE_OCCURRENCE_EMBEDDING_SOURCE_MISSING");
        return true;
      }
      const senseJob = isPhraseOccurrenceSenseJob(job);
      const representationVersion = phraseOccurrenceRepresentationVersionFromJob(job);
      const sourceInput = senseJob
        ? phraseOccurrenceRepresentationHashInput(source, representationVersion)
        : buildPhraseOccurrenceEmbeddingInput(source);
      if (!sourceInput) {
        await this.repository.completeWithoutResult(job, "PHRASE_OCCURRENCE_EMBEDDING_INPUT_INVALID");
        return true;
      }
      const inputHash = createHash("sha256").update(sourceInput).digest("hex");
      if (inputHash !== job.inputHash) {
        await this.repository.completeWithoutResult(job, "PHRASE_OCCURRENCE_EMBEDDING_INPUT_STALE");
        return true;
      }
      let meaningText: string | null = null;
      let polarity: string | null = null;
      let modality: string | null = null;
      let meaningKind: string | null = null;
      let embeddingInput = sourceInput;
      if (senseJob) {
        if (!this.aiProvider) throw workerError("PHRASE_OCCURRENCE_SENSE_PROVIDER_UNAVAILABLE");
        const contextMeaningV2 = representationVersion === PHRASE_OCCURRENCE_CONTEXT_MEANING_REPRESENTATION_VERSION;
        const prompt = contextMeaningV2
          ? buildPhraseOccurrenceContextMeaningPrompt(source)
          : buildPhraseOccurrenceSensePrompt(source);
        let rawOutput = "";
        const generate = () => this.aiProvider!.generateChatTextStream({
          userId: source.userId,
          text: prompt.userPrompt,
          languageCode: source.languageCode,
          systemPrompt: prompt.systemPrompt,
          rawUserPrompt: true,
          maxOutputTokens: contextMeaningV2 ? 160 : 80,
          temperature: 0,
        }, (event) => { if (event.type === "delta") rawOutput += event.text; });
        if (this.resourceGovernor) await this.resourceGovernor.execute("llm", source.userId, generate);
        else await generate();
        if (contextMeaningV2) {
          const parsed = parsePhraseOccurrenceContextMeaningOutput(rawOutput);
          meaningText = parsed.meaning;
          polarity = parsed.polarity;
          modality = parsed.modality;
          meaningKind = parsed.meaningKind;
          embeddingInput = buildPhraseOccurrenceContextMeaningEmbeddingInput(parsed);
        } else {
          meaningText = parsePhraseOccurrenceSenseOutput(rawOutput);
          embeddingInput = buildPhraseOccurrenceSenseEmbeddingInput(meaningText);
        }
      }
      const embed = () => this.embeddingProvider.embed(embeddingInput);
      const result = this.resourceGovernor
        ? await this.resourceGovernor.executeConcurrency("embedding", job.userId, embed)
        : await embed();
      await this.repository.completePhraseOccurrenceEmbeddingJob(job, result, senseJob ? {
        representationVersion,
        promptVersion: representationVersion === PHRASE_OCCURRENCE_CONTEXT_MEANING_REPRESENTATION_VERSION
          ? PHRASE_OCCURRENCE_CONTEXT_MEANING_PROMPT_VERSION
          : PHRASE_OCCURRENCE_SENSE_PROMPT_VERSION,
        meaningText,
        polarity,
        modality,
        meaningKind,
      } : undefined);
    } catch (error) {
      const retry = resolveEnrichmentRetry(error, job.attempts, this.options.maxAttempts ?? 3);
      await this.repository.rescheduleOrFail(job, safeEnrichmentErrorMessage(error), retry.retryAt, { preserveAttempt: retry.preserveAttempt });
      if (!retry.retryAt) {
        await this.systemEventLogRepository?.create({
          userId: job.userId,
          module: "card",
          event: "phrase.occurrence_embedding.failed",
          level: "error",
          status: "failed",
          errorCode: typeof error === "object" && error !== null && "code" in error ? String(error.code) : "PHRASE_OCCURRENCE_EMBEDDING_FAILED",
          errorMessage: (error instanceof Error ? error.message : String(error ?? "unknown")).slice(0, 500),
          metadata: { occurrenceId: job.sourceId, modelVersion: this.embeddingProvider.modelVersion },
        }).catch(() => undefined);
      }
    }
    return true;
  }
}

function workerError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}
