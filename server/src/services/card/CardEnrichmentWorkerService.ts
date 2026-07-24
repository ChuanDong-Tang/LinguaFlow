import { createHash } from "node:crypto";
import type { EmbeddingProvider } from "@lf/core/ports/ai/EmbeddingProvider.js";
import type { CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import { buildCardEmbeddingInput } from "./CardRewriteWorkerService.js";

export class CardEnrichmentWorkerService {
  constructor(
    private readonly repository: CardEnrichmentRepository,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly systemEventLogRepository?: SystemEventLogRepository,
    private readonly options: { leaseMs?: number; maxAttempts?: number } = {},
  ) {}

  async claimAndProcess(workerId: string): Promise<boolean> {
    const leaseMs = this.options.leaseMs ?? 60_000;
    const job = await this.repository.claimNextEmbeddingJob(workerId, new Date(Date.now() + leaseMs));
    if (!job) return false;

    try {
      const source = await this.repository.loadEmbeddingSource(job);
      if (!source) {
        await this.repository.completeWithoutResult(job, "CARD_EMBEDDING_SOURCE_MISSING");
        return true;
      }
      const input = buildCardEmbeddingInput(source.originalText, source.rewrittenText);
      const currentHash = createHash("sha256").update(input).digest("hex");
      if (currentHash !== job.inputHash) {
        await this.repository.completeWithoutResult(job, "CARD_EMBEDDING_INPUT_STALE");
        return true;
      }
      const result = await this.embeddingProvider.embed(input);
      await this.repository.completeEmbeddingJob(job, result);
    } catch (error) {
      const maxAttempts = this.options.maxAttempts ?? 3;
      const retryAt = job.attempts >= maxAttempts
        ? null
        : new Date(Date.now() + retryDelayMs(job.attempts));
      await this.repository.rescheduleOrFail(job, safeErrorMessage(error), retryAt);
      if (!retryAt) await this.logTerminalFailure(job.userId, job.sourceId, error);
    }
    return true;
  }

  private async logTerminalFailure(userId: string, sourceId: string, error: unknown): Promise<void> {
    try {
      await this.systemEventLogRepository?.create({
        userId,
        module: "card",
        event: "card.embedding.failed",
        level: "error",
        status: "failed",
        errorCode: resolveErrorCode(error),
        errorMessage: safeErrorMessage(error),
        metadata: {
          sourceId,
          provider: this.embeddingProvider.providerName,
          modelVersion: this.embeddingProvider.modelVersion,
        },
      });
    } catch {
      // Observability must not requeue a terminal job.
    }
  }
}

function retryDelayMs(attempts: number): number {
  return Math.min(60_000, 1_000 * (2 ** Math.max(0, attempts - 1)));
}

function resolveErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) return String(error.code);
  return error instanceof Error ? error.name.toUpperCase() : "UNKNOWN";
}

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error ?? "unknown")).slice(0, 500);
}
