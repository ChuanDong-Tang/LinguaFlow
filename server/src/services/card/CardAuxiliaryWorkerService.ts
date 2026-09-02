import type { AIProvider, ChatTextGenerationStreamEvent } from "@lf/core/ports/ai/AIProvider.js";
import type { CardEnrichmentJobEntity, CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import { buildCardContentGenerationPrompt, cardContentMaxOutputTokens, parseCardAuxiliaryOutput } from "@lf/core/Prompts/cardContentGenerationPrompt.js";
import type { ResourceGovernor } from "../resource/ResourceGovernor.js";
import type { ContentSafetyService } from "../contentSafety/ContentSafetyService.js";
import { resolveEnrichmentRetry, safeEnrichmentErrorMessage } from "./EnrichmentJobRetry.js";

export class CardAuxiliaryWorkerService {
  constructor(
    private readonly repository: CardEnrichmentRepository,
    private readonly aiProvider: AIProvider,
    private readonly systemEventLogRepository?: SystemEventLogRepository,
    private readonly options: { leaseMs?: number; maxAttempts?: number } = {},
    private readonly resourceGovernor?: ResourceGovernor,
    private readonly contentSafetyService?: ContentSafetyService,
  ) {}

  async claimAndProcess(workerId: string): Promise<boolean> {
    const job = await this.repository.claimNextAuxiliaryJob(
      workerId,
      new Date(Date.now() + (this.options.leaseMs ?? 120_000)),
    );
    if (!job) return false;
    await this.process(job);
    return true;
  }

  private async process(job: CardEnrichmentJobEntity): Promise<void> {
    const startedAt = Date.now();
    const requestId = `card_auxiliary_backfill_${job.id}:attempt:${job.attempts}`;
    let output = "";
    let usage: Extract<ChatTextGenerationStreamEvent, { type: "done" }>["usage"];
    try {
      const source = await this.repository.loadAuxiliarySource(job);
      if (!source) {
        await this.repository.completeWithoutResult(job, "CARD_AUXILIARY_SOURCE_MISSING_OR_STALE");
        return;
      }
      const sourceText = JSON.stringify(source.segments);
      const prompt = buildCardContentGenerationPrompt({
        target: "auxiliary",
        sourceText,
        languageCode: source.languageCode,
        appLocale: source.appLocale,
        difficulty: source.difficulty,
      });
      await this.assertBackgroundCapacity();
      const generate = () => this.aiProvider.generateChatTextStream({
        userId: source.userId,
        text: prompt.userPrompt,
        languageCode: source.languageCode,
        appLocale: source.appLocale,
        promptDifficulty: source.difficulty,
        companionMode: "rewrite_only",
        systemPrompt: prompt.systemPrompt,
        rawUserPrompt: true,
        maxOutputTokens: cardContentMaxOutputTokens("auxiliary", sourceText),
      }, (event) => {
        if (event.type === "delta") output += event.text;
        if (event.type === "done") usage = event.usage;
      });
      if (this.resourceGovernor) await this.resourceGovernor.execute("llm", source.userId, generate);
      else await generate();
      const auxiliarySegments = parseCardAuxiliaryOutput(output, source.segments.map((segment) => segment.ordinal));
      const auxiliaryText = auxiliarySegments.map((segment) => segment.text).join("\n");
      this.contentSafetyService?.assertAllowed(auxiliaryText, "output");
      await this.contentSafetyService?.assertAllowedRemote({
        text: auxiliaryText,
        stage: "output",
        requestId,
        userId: source.userId,
      });
      if (!await this.repository.completeAuxiliaryJob(job, auxiliarySegments)) return;
      await this.log(job, "success", null, {
        durationMs: Date.now() - startedAt,
        segmentCount: source.segments.length,
        inputChars: sourceText.length,
        outputChars: output.length,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        meteringSource: usage ? "provider" : "unavailable",
      });
    } catch (error) {
      const retry = error instanceof AuxiliaryBackgroundCapacityError
        ? { retryAt: new Date(Date.now() + 60_000), preserveAttempt: true }
        : resolveEnrichmentRetry(error, job.attempts, this.options.maxAttempts ?? 3);
      await this.repository.rescheduleOrFail(job, safeEnrichmentErrorMessage(error), retry.retryAt, {
        preserveAttempt: retry.preserveAttempt,
      });
      await this.log(job, retry.retryAt ? "retry" : "failed", error, {
        durationMs: Date.now() - startedAt,
        outputChars: output.length,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        nextAttemptAt: retry.retryAt?.toISOString() ?? null,
      });
    }
  }

  private async assertBackgroundCapacity(): Promise<void> {
    if (!this.resourceGovernor) return;
    const policy = this.resourceGovernor.policy("llm");
    const snapshot = (await this.resourceGovernor.snapshots(1)).find((item) => item.resource === "llm");
    if (!snapshot
      || policy.globalConcurrency <= 1
      || policy.globalRequestsPerMinute <= 1
      || snapshot.currentConcurrency >= policy.globalConcurrency - 1
      || snapshot.requestsLastMinute >= policy.globalRequestsPerMinute - 1) {
      throw new AuxiliaryBackgroundCapacityError();
    }
  }

  private async log(
    job: CardEnrichmentJobEntity,
    status: "success" | "retry" | "failed",
    error: unknown,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.systemEventLogRepository?.create({
        requestId: `card_auxiliary_backfill_${job.id}`,
        userId: job.userId,
        module: "card",
        event: status === "success" ? "card.auxiliary_backfill.generated" : status === "retry" ? "card.auxiliary_backfill.retry" : "card.auxiliary_backfill.failed",
        level: status === "success" ? "info" : status === "retry" ? "warn" : "error",
        status: status === "retry" ? "ignored" : status,
        errorCode: error ? resolveErrorCode(error) : null,
        errorMessage: error ? safeErrorMessage(error) : null,
        metadata: {
          sourceId: job.sourceId,
          attempt: job.attempts,
          provider: this.aiProvider.providerName,
          model: this.aiProvider.modelName,
          ...metadata,
        },
      });
    } catch {
      // Observability must not change the job state.
    }
  }
}

class AuxiliaryBackgroundCapacityError extends Error {
  readonly code = "CARD_AUXILIARY_BACKGROUND_CAPACITY_UNAVAILABLE";
  constructor() {
    super("Background LLM capacity is unavailable");
  }
}

function resolveErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) return String(error.code);
  if (error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)) return error.message;
  return error instanceof Error ? error.name.toUpperCase() : "UNKNOWN";
}

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error ?? "unknown")).slice(0, 500);
}
