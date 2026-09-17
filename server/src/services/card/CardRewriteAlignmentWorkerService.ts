import type { AIProvider, ChatTextGenerationStreamEvent } from "@lf/core/ports/ai/AIProvider.js";
import type { CardEnrichmentJobEntity, CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import {
  buildCardRewriteAlignmentPrompt,
  buildCardRewriteAlignmentSourceUnits,
  CARD_REWRITE_ALIGNMENT_PROMPT_VERSION,
  parseCardRewriteAlignmentOutput,
  type CardRewriteAlignmentResult,
} from "@lf/core/Prompts/cardRewriteAlignmentPrompt.js";
import type { ResourceGovernor } from "../resource/ResourceGovernor.js";
import type { ContentSafetyService } from "../contentSafety/ContentSafetyService.js";
import { inferLearningTextLanguage } from "@lf/core/text/learningText.js";
import { resolveEnrichmentRetry, safeEnrichmentErrorMessage } from "./EnrichmentJobRetry.js";
import { cardContentBlockVersion } from "./cardContentSegments.js";
import { segmentLearningSentences } from "../text/learningSentenceSegmenter.js";

export class CardRewriteAlignmentWorkerService {
  constructor(
    private readonly repository: CardEnrichmentRepository,
    private readonly aiProvider: AIProvider,
    private readonly systemEventLogRepository?: SystemEventLogRepository,
    private readonly options: { leaseMs?: number; maxAttempts?: number } = {},
    private readonly resourceGovernor?: ResourceGovernor,
    private readonly contentSafetyService?: ContentSafetyService,
  ) {}

  async claimAndProcess(workerId: string): Promise<boolean> {
    const job = await this.repository.claimNextRewriteAlignmentJob(
      workerId,
      new Date(Date.now() + (this.options.leaseMs ?? 120_000)),
    );
    if (!job) return false;
    await this.process(job);
    return true;
  }

  private async process(job: CardEnrichmentJobEntity): Promise<void> {
    const startedAt = Date.now();
    const requestId = `card_rewrite_alignment_${job.id}:attempt:${job.attempts}`;
    let output = "";
    let usage: Extract<ChatTextGenerationStreamEvent, { type: "done" }>["usage"];
    try {
      const source = await this.repository.loadRewriteAlignmentSource(job);
      if (!source) {
        await this.repository.completeWithoutResult(job, "CARD_REWRITE_ALIGNMENT_SOURCE_MISSING_OR_STALE");
        return;
      }
      const sourceLanguageCode = inferLearningTextLanguage(source.originalText, source.appLocaleSnapshot);
      const targetLanguageCode = source.rewrittenLanguageCode ?? source.languageCode;
      const sourceSegments = segmentLearningSentences({
        text: source.originalText,
        languageCode: sourceLanguageCode,
        minSegmentChars: 1,
        maxSegmentChars: 800,
      }).map((segment, ordinal) => ({
        ordinal,
        text: segment.text,
        startUtf16: segment.textStart,
        endUtf16: segment.textEnd,
      }));
      const targetSegments = segmentLearningSentences({
        text: source.rewrittenText,
        languageCode: targetLanguageCode,
        minSegmentChars: 1,
        maxSegmentChars: 800,
      }).map((segment, ordinal) => ({ ordinal, text: segment.text }));
      if (!sourceSegments.length || !targetSegments.length) {
        await this.repository.completeWithoutResult(job, "CARD_REWRITE_ALIGNMENT_SEGMENTS_MISSING");
        return;
      }
      const sourceUnits = buildCardRewriteAlignmentSourceUnits({ sourceText: source.originalText, segments: sourceSegments });
      const prompt = buildCardRewriteAlignmentPrompt({
        sourceSegments: sourceUnits,
        targetSegments,
      });
      await this.assertBackgroundCapacity();
      const generate = () => this.aiProvider.generateChatTextStream({
        userId: source.userId,
        text: prompt.userPrompt,
        languageCode: source.languageCode,
        appLocale: "en-US",
        promptDifficulty: "standard",
        companionMode: "rewrite_only",
        systemPrompt: prompt.systemPrompt,
        rawUserPrompt: true,
        maxOutputTokens: Math.min(2_000, Math.max(300, (sourceSegments.length + targetSegments.length) * 40)),
      }, (event) => {
        if (event.type === "delta") output += event.text;
        if (event.type === "done") usage = event.usage;
      });
      if (this.resourceGovernor) await this.resourceGovernor.execute("llm", source.userId, generate);
      else await generate();
      const groups = parseCardRewriteAlignmentOutput({
        output,
        sourceOrdinals: sourceUnits.map((segment) => segment.ordinal),
        targetOrdinals: targetSegments.map((segment) => segment.ordinal),
      });
      this.contentSafetyService?.assertAllowed(output, "output");
      await this.contentSafetyService?.assertAllowedRemote({
        text: output,
        stage: "output",
        requestId,
        userId: source.userId,
      });
      const alignment: CardRewriteAlignmentResult = {
        schemaVersion: 1,
        promptVersion: CARD_REWRITE_ALIGNMENT_PROMPT_VERSION,
        sourceContentVersion: cardContentBlockVersion({
          contentType: "original",
          text: source.originalText,
          sourceHash: source.originalContentHash,
        }),
        targetContentVersion: cardContentBlockVersion({
          contentType: "rewrite",
          text: source.rewrittenText,
          sourceHash: source.rewrittenSourceHash,
        }),
        sourceUnits: sourceUnits.map(({ ordinal, startUtf16, endUtf16 }) => ({ ordinal, startUtf16, endUtf16 })),
        groups,
      };
      if (!await this.repository.completeRewriteAlignmentJob(job, alignment)) return;
      await this.log(job, "success", null, {
        durationMs: Date.now() - startedAt,
        sourceSegmentCount: sourceUnits.length,
        targetSegmentCount: targetSegments.length,
        groupCount: groups.length,
        outputChars: output.length,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
      });
    } catch (error) {
      const retry = error instanceof AlignmentBackgroundCapacityError
        ? { retryAt: new Date(Date.now() + 60_000), preserveAttempt: true }
        : resolveEnrichmentRetry(error, job.attempts, this.options.maxAttempts ?? 3);
      await this.repository.rescheduleOrFail(job, safeEnrichmentErrorMessage(error), retry.retryAt, {
        preserveAttempt: retry.preserveAttempt,
      });
      await this.log(job, retry.retryAt ? "retry" : "failed", error, {
        durationMs: Date.now() - startedAt,
        outputChars: output.length,
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
      throw new AlignmentBackgroundCapacityError();
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
        requestId: `card_rewrite_alignment_${job.id}`,
        userId: job.userId,
        module: "card",
        event: status === "success" ? "card.rewrite_alignment.generated" : status === "retry" ? "card.rewrite_alignment.retry" : "card.rewrite_alignment.failed",
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

class AlignmentBackgroundCapacityError extends Error {
  readonly code = "CARD_REWRITE_ALIGNMENT_BACKGROUND_CAPACITY_UNAVAILABLE";
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
