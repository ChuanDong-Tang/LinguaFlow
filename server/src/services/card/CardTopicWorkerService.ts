import type { AIProvider, ChatTextGenerationStreamEvent } from "@lf/core/ports/ai/AIProvider.js";
import type { CardEnrichmentJobEntity, CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import { buildCardTopicPrompt, parseCardTopicOutput } from "@lf/core/Prompts/cardTopicPrompt.js";
import { CARD_TOPIC_MAX_CHARS } from "@lf/core/Prompts/cardExpressionPrompt.js";
import type { ResourceGovernor } from "../resource/ResourceGovernor.js";
import type { ContentSafetyService } from "../contentSafety/ContentSafetyService.js";
import { resolveEnrichmentRetry, safeEnrichmentErrorMessage } from "./EnrichmentJobRetry.js";
import type { UsageV2Service } from "../usage/UsageV2Service.js";
import { isPlatformMigrationBillingExempt, reserveLlmTokenUsage, settleLlmTokenUsage, settleOrReleaseFailedLlmUsage } from "../usage/LlmTokenMeter.js";

export class CardTopicWorkerService {
  constructor(
    private readonly repository: CardEnrichmentRepository,
    private readonly aiProvider: AIProvider,
    private readonly systemEventLogRepository?: SystemEventLogRepository,
    private readonly options: { leaseMs?: number; maxAttempts?: number; topicMaxChars?: number } = {},
    private readonly resourceGovernor?: ResourceGovernor,
    private readonly contentSafetyService?: ContentSafetyService,
    private readonly usageV2Service?: UsageV2Service,
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
    let meteredPrompt = "";
    const requestId = `card_topic_${job.id}:attempt:${job.attempts}`;
    let tokenMetered = !isPlatformMigrationBillingExempt(job.payload);
    let tokenUsage: Extract<ChatTextGenerationStreamEvent, { type: "done" }>["usage"];
    try {
      const source = await this.repository.loadTopicSource(job);
      if (!source) {
        await this.repository.completeWithoutResult(job, "CARD_TOPIC_SOURCE_MISSING_OR_STALE");
        return;
      }
      if (source.billingExemptReason === "chat_history_migration") tokenMetered = false;
      const topicMaxChars = this.options.topicMaxChars ?? CARD_TOPIC_MAX_CHARS;
      const prompt = buildCardTopicPrompt({ text: source.originalText, appLocale: source.appLocale, topicMaxChars });
      meteredPrompt = `${prompt.systemPrompt}\n${prompt.userPrompt}`;
      if (tokenMetered && !this.usageV2Service) throw new Error("V2 usage is unavailable");
      if (tokenMetered) await reserveLlmTokenUsage({
        usageService: this.usageV2Service!,
        userId: source.userId,
        requestId,
        feature: "organization",
        prompt: meteredPrompt,
        maxOutputTokens: 100,
        provider: this.aiProvider,
      });
      const generate = () => this.aiProvider.generateChatTextStream({
        userId: source.userId,
        text: prompt.userPrompt,
        appLocale: source.appLocale,
        companionMode: "platform_topic",
        systemPrompt: prompt.systemPrompt,
        rawUserPrompt: true,
        maxOutputTokens: 100,
      }, (event) => {
        if (event.type === "delta") output += event.text;
        if (event.type === "done") tokenUsage = event.usage;
      });
      if (this.resourceGovernor) await this.resourceGovernor.execute("llm", source.userId, generate);
      else await generate();
      if (tokenMetered) await settleLlmTokenUsage({
        usageService: this.usageV2Service!,
        userId: source.userId,
        requestId,
        prompt: meteredPrompt,
        output,
        usage: tokenUsage,
        provider: this.aiProvider,
      });
      const topic = parseCardTopicOutput(output, topicMaxChars);
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
        tokenMetered,
      });
    } catch (error) {
      if (tokenMetered && this.usageV2Service) await settleOrReleaseFailedLlmUsage({
        usageService: this.usageV2Service,
        userId: job.userId,
        requestId,
        prompt: meteredPrompt,
        output,
        usage: tokenUsage,
        provider: this.aiProvider,
      });
      const retry = resolveEnrichmentRetry(error, job.attempts, this.options.maxAttempts ?? 3);
      await this.repository.rescheduleOrFail(
        job,
        safeEnrichmentErrorMessage(error),
        retry.retryAt,
        { preserveAttempt: retry.preserveAttempt },
      );
      if (!retry.retryAt) await this.log(job, "failed", error, { outputChars: output.length, tokenMetered });
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

function resolveErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) return String(error.code);
  return error instanceof Error ? error.name.toUpperCase() : "UNKNOWN";
}

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error ?? "unknown")).slice(0, 500);
}
