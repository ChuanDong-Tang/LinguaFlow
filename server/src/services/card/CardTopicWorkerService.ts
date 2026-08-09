import type { AIProvider } from "@lf/core/ports/ai/AIProvider.js";
import type { CardEnrichmentJobEntity, CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import { buildCardTopicPrompt, parseCardTopicOutput } from "@lf/core/Prompts/cardTopicPrompt.js";
import type { ResourceGovernor } from "../resource/ResourceGovernor.js";
import type { ContentSafetyService } from "../contentSafety/ContentSafetyService.js";

export class CardTopicWorkerService {
  constructor(
    private readonly repository: CardEnrichmentRepository,
    private readonly aiProvider: AIProvider,
    private readonly systemEventLogRepository?: SystemEventLogRepository,
    private readonly options: { leaseMs?: number; maxAttempts?: number } = {},
    private readonly resourceGovernor?: ResourceGovernor,
    private readonly contentSafetyService?: ContentSafetyService,
  ) {}

  async claimAndProcess(workerId: string): Promise<boolean> {
    const job = await this.repository.claimNextTopicJob(
      workerId,
      new Date(Date.now() + (this.options.leaseMs ?? 60_000)),
    );
    if (!job) return false;
    await this.process(job);
    return true;
  }

  private async process(job: CardEnrichmentJobEntity): Promise<void> {
    const startedAt = Date.now();
    let output = "";
    try {
      const source = await this.repository.loadTopicSource(job);
      if (!source) {
        await this.repository.completeWithoutResult(job, "CARD_TOPIC_SOURCE_MISSING_OR_STALE");
        return;
      }
      const prompt = buildCardTopicPrompt({ text: source.originalText, appLocale: source.appLocale });
      const generate = () => this.aiProvider.generateChatTextStream({
        userId: source.userId,
        text: prompt.userPrompt,
        appLocale: source.appLocale,
        companionMode: "platform_topic",
        systemPrompt: prompt.systemPrompt,
        rawUserPrompt: true,
        maxOutputTokens: 100,
      }, (event) => { if (event.type === "delta") output += event.text; });
      if (this.resourceGovernor) await this.resourceGovernor.execute("llm", source.userId, generate);
      else await generate();
      const topic = parseCardTopicOutput(output);
      this.contentSafetyService?.assertAllowed(topic, "output");
      await this.contentSafetyService?.assertAllowedRemote({
        text: topic,
        stage: "output",
        requestId: `card_topic_${job.id}`,
        userId: source.userId,
      });
      if (!await this.repository.completeTopicJob(job, topic)) return;
      await this.log(job, "success", null, {
        durationMs: Date.now() - startedAt,
        inputChars: source.originalText.length,
        outputChars: topic.length,
        platformFunded: true,
      });
    } catch (error) {
      const retryAt = job.attempts >= (this.options.maxAttempts ?? 3)
        ? null
        : new Date(Date.now() + retryDelayMs(job.attempts));
      await this.repository.rescheduleOrFail(job, safeErrorMessage(error), retryAt);
      if (!retryAt) await this.log(job, "failed", error, { outputChars: output.length, platformFunded: true });
    }
  }

  private async log(
    job: CardEnrichmentJobEntity,
    status: "success" | "failed",
    error: unknown,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.systemEventLogRepository?.create({
        requestId: `card_topic_${job.id}`,
        userId: job.userId,
        module: "card",
        event: status === "success" ? "card.topic.generated" : "card.topic.failed",
        level: status === "success" ? "info" : "error",
        status,
        errorCode: error ? resolveErrorCode(error) : null,
        errorMessage: error ? safeErrorMessage(error) : null,
        metadata: {
          sourceId: job.sourceId,
          provider: this.aiProvider.providerName,
          model: this.aiProvider.modelName,
          ...metadata,
        },
      });
    } catch {
      // Audit persistence must not change the terminal job state.
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
