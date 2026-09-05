import type { CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import type { ResourceGovernor } from "../resource/ResourceGovernor.js";
import type { CardService } from "./CardService.js";
import { resolveEnrichmentRetry, safeEnrichmentErrorMessage } from "./EnrichmentJobRetry.js";
import {
  CARD_IMAGE_DESCRIPTION_PROMPT_VERSION,
  CARD_IMAGE_DESCRIPTION_RESULT_VERSION,
} from "@lf/core/Prompts/cardImageDescriptionPrompt.js";

export class CardImageDescriptionWorkerService {
  constructor(
    private readonly repository: CardEnrichmentRepository,
    private readonly cardService: CardService,
    private readonly logs?: SystemEventLogRepository,
    private readonly resourceGovernor?: ResourceGovernor,
    private readonly options: { leaseMs?: number; maxAttempts?: number } = {},
  ) {}

  async claimAndProcess(workerId: string): Promise<boolean> {
    const job = await this.repository.claimNextImageDescriptionJob(
      workerId,
      new Date(Date.now() + (this.options.leaseMs ?? 180_000)),
    );
    if (!job) return false;
    const startedAt = Date.now();
    try {
      const currentPrefix = `${CARD_IMAGE_DESCRIPTION_PROMPT_VERSION}:${CARD_IMAGE_DESCRIPTION_RESULT_VERSION}:`;
      if (!job.inputVersion.startsWith(currentPrefix)) {
        await this.repository.completeWithoutResult(job, "CARD_IMAGE_DESCRIPTION_VERSION_RETIRED");
        return true;
      }
      const source = await this.repository.loadImageDescriptionSource(job);
      if (!source) {
        await this.repository.completeWithoutResult(job, "CARD_IMAGE_DESCRIPTION_SOURCE_MISSING_OR_CURRENT");
        return true;
      }
      if (!await this.hasBackgroundCapacity()) {
        await this.repository.rescheduleOrFail(job, "BACKGROUND_CAPACITY_UNAVAILABLE", new Date(Date.now() + 60_000), { preserveAttempt: true });
        return true;
      }
      await this.cardService.generateImageDescriptions({
        userId: job.userId,
        requestId: `card_image_description_backfill_${job.id}:attempt:${job.attempts}`,
        recordId: `card:${source.cardId}`,
        imageId: source.imageId,
        usageApiVersion: "v2",
        billingMode: "platform",
        forceRegenerate: source.forceRegenerate,
      });
      await this.repository.completeJob(job);
      await this.log(job.userId, job.id, "success", null, Date.now() - startedAt);
    } catch (error) {
      const retry = resolveEnrichmentRetry(error, job.attempts, this.options.maxAttempts ?? 3);
      await this.repository.rescheduleOrFail(job, safeEnrichmentErrorMessage(error), retry.retryAt, { preserveAttempt: retry.preserveAttempt });
      await this.log(job.userId, job.id, retry.retryAt ? "retry" : "failed", error, Date.now() - startedAt);
    }
    return true;
  }

  private async hasBackgroundCapacity(): Promise<boolean> {
    if (!this.resourceGovernor) return true;
    const policy = this.resourceGovernor.policy("llm");
    const snapshot = (await this.resourceGovernor.snapshots(1)).find((item) => item.resource === "llm");
    return Boolean(snapshot
      && policy.globalConcurrency > 1
      && policy.globalRequestsPerMinute > 1
      && snapshot.currentConcurrency < policy.globalConcurrency - 1
      && snapshot.requestsLastMinute < policy.globalRequestsPerMinute - 1);
  }

  private async log(userId: string, jobId: string, status: "success" | "retry" | "failed", error: unknown, durationMs: number): Promise<void> {
    await this.logs?.create({
      requestId: `card_image_description_backfill_${jobId}`,
      userId,
      module: "card",
      event: `card.image_description_backfill.${status}`,
      level: status === "success" ? "info" : status === "retry" ? "warn" : "error",
      status: status === "retry" ? "ignored" : status,
      errorCode: error && typeof error === "object" && "code" in error ? String(error.code) : null,
      errorMessage: error instanceof Error ? error.message.slice(0, 500) : null,
      metadata: { durationMs },
    }).catch(() => undefined);
  }
}
