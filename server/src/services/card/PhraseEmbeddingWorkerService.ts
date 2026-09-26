import { createHash } from "node:crypto";
import type { EmbeddingProvider } from "@lf/core/ports/ai/EmbeddingProvider.js";
import type { CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import type { ResourceGovernor } from "../resource/ResourceGovernor.js";
import { resolveEnrichmentRetry, safeEnrichmentErrorMessage } from "./EnrichmentJobRetry.js";

export class PhraseEmbeddingWorkerService {
  constructor(
    private readonly repository: CardEnrichmentRepository,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly systemEventLogRepository?: SystemEventLogRepository,
    private readonly options: { leaseMs?: number; maxAttempts?: number } = {},
    private readonly resourceGovernor?: ResourceGovernor,
  ) {}

  async claimAndProcess(workerId: string): Promise<boolean> {
    const job = await this.repository.claimNextPhraseEmbeddingJob(
      workerId,
      new Date(Date.now() + (this.options.leaseMs ?? 60_000)),
    );
    if (!job) return false;
    try {
      const source = await this.repository.loadPhraseEmbeddingSource(job);
      if (!source) {
        await this.repository.completeWithoutResult(job, "PHRASE_EMBEDDING_SOURCE_MISSING");
        return true;
      }
      const input = phraseEmbeddingInput(source.languageCode, source.canonicalText);
      const inputHash = createHash("sha256").update(input).digest("hex");
      if (inputHash !== job.inputHash) {
        await this.repository.completeWithoutResult(job, "PHRASE_EMBEDDING_INPUT_STALE");
        return true;
      }
      const embed = () => this.embeddingProvider.embed(input);
      const result = this.resourceGovernor
        ? await this.resourceGovernor.executeConcurrency("embedding", job.userId, embed)
        : await embed();
      await this.repository.completePhraseEmbeddingJob(job, result);
    } catch (error) {
      const retry = resolveEnrichmentRetry(error, job.attempts, this.options.maxAttempts ?? 3);
      await this.repository.rescheduleOrFail(job, safeEnrichmentErrorMessage(error), retry.retryAt, { preserveAttempt: retry.preserveAttempt });
      if (!retry.retryAt) {
        await this.systemEventLogRepository?.create({
          userId: job.userId,
          module: "card",
          event: "phrase.embedding.failed",
          level: "error",
          status: "failed",
          errorCode: typeof error === "object" && error !== null && "code" in error ? String(error.code) : "PHRASE_EMBEDDING_FAILED",
          errorMessage: (error instanceof Error ? error.message : String(error ?? "unknown")).slice(0, 500),
          metadata: { phraseId: job.sourceId, modelVersion: this.embeddingProvider.modelVersion },
        }).catch(() => undefined);
      }
    }
    return true;
  }
}

function phraseEmbeddingInput(languageCode: string, canonicalText: string): string {
  return `${languageCode}\n${canonicalText.normalize("NFKC").trim()}`;
}
