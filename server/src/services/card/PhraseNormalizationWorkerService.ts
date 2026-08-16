import type { AIProvider, ChatTextGenerationStreamEvent } from "@lf/core/ports/ai/AIProvider.js";
import type { CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import {
  buildPhraseNormalizationPrompt,
  parsePhraseNormalizationOutput,
} from "@lf/core/Prompts/phraseNormalizationPrompt.js";
import { normalizePhraseSurface, PHRASE_NORMALIZER_VERSION } from "@lf/core/text/phraseNormalization.js";
import { ResourceLimitedError, type ResourceGovernor } from "../resource/ResourceGovernor.js";
import { resolveEnrichmentRetry, safeEnrichmentErrorMessage } from "./EnrichmentJobRetry.js";
import type { UsageV2Service } from "../usage/UsageV2Service.js";
import { isPlatformMigrationBillingExempt, reserveLlmTokenUsage, settleLlmTokenUsage, settleOrReleaseFailedLlmUsage } from "../usage/LlmTokenMeter.js";
import { TokenQuotaExceededError } from "../usage/UsageV2Service.js";

export class PhraseNormalizationWorkerService {
  constructor(
    private readonly repository: CardEnrichmentRepository,
    private readonly aiProvider: AIProvider,
    private readonly options: { leaseMs?: number; maxAttempts?: number } = {},
    private readonly resourceGovernor?: ResourceGovernor,
    private readonly usageV2Service?: UsageV2Service,
  ) {}

  async claimAndProcess(workerId: string): Promise<boolean> {
    const job = await this.repository.claimNextPhraseNormalizationJob(
      workerId,
      new Date(Date.now() + (this.options.leaseMs ?? 60_000)),
    );
    if (!job) return false;
    let source: Awaited<ReturnType<CardEnrichmentRepository["loadPhraseNormalizationSource"]>> = null;
    let meteredPrompt = "";
    let rawOutput = "";
    let tokenUsage: Extract<ChatTextGenerationStreamEvent, { type: "done" }>["usage"];
    const requestId = `phrase_normalization_${job.id}:attempt:${job.attempts}`;
    let tokenMetered = !isPlatformMigrationBillingExempt(job.payload);
    try {
      source = await this.repository.loadPhraseNormalizationSource(job);
      if (!source) {
        await this.repository.completeWithoutResult(job, "PHRASE_SOURCE_MISSING");
        return true;
      }
      const normalizationSource = source;
      if (normalizationSource.billingExemptReason === "chat_history_migration") tokenMetered = false;
      const prompt = buildPhraseNormalizationPrompt(normalizationSource);
      meteredPrompt = `${prompt.systemPrompt}\n${prompt.userPrompt}`;
      if (tokenMetered && !this.usageV2Service) throw new Error("V2 usage is unavailable");
      if (tokenMetered) await reserveLlmTokenUsage({
        usageService: this.usageV2Service!,
        userId: normalizationSource.userId,
        requestId,
        feature: "organization",
        prompt: meteredPrompt,
        maxOutputTokens: 500,
        provider: this.aiProvider,
      });
      const generate = () => this.aiProvider.generateChatTextStream({
        userId: normalizationSource.userId,
        text: prompt.userPrompt,
        languageCode: normalizationSource.languageCode,
        systemPrompt: prompt.systemPrompt,
        rawUserPrompt: true,
        maxOutputTokens: 500,
      }, (event) => {
        if (event.type === "delta") rawOutput += event.text;
        if (event.type === "done") tokenUsage = event.usage;
      });
      if (this.resourceGovernor) await this.resourceGovernor.execute("llm", normalizationSource.userId, generate);
      else await generate();
      if (tokenMetered) await settleLlmTokenUsage({
        usageService: this.usageV2Service!,
        userId: normalizationSource.userId,
        requestId,
        prompt: meteredPrompt,
        output: rawOutput,
        usage: tokenUsage,
        provider: this.aiProvider,
      });
      const parsed = parsePhraseNormalizationOutput(rawOutput);
      const canonicalKey = normalizePhraseSurface(parsed.canonicalText, normalizationSource.languageCode);
      if (!canonicalKey) throw phraseError("PHRASE_CANONICAL_INVALID");
      const variants = parsed.variants
        .map((surfaceText) => ({
          surfaceText,
          normalizedText: normalizePhraseSurface(surfaceText, normalizationSource.languageCode),
          source: normalizePhraseSurface(normalizationSource.surfaceText, normalizationSource.languageCode) === normalizePhraseSurface(surfaceText, normalizationSource.languageCode)
            ? normalizationSource.observedSource
            : "generated" as const,
        }))
        .filter((variant) => Boolean(variant.normalizedText));
      await this.repository.completePhraseNormalization(job, {
        canonicalText: parsed.canonicalText,
        canonicalKey,
        variants,
        normalizerVersion: PHRASE_NORMALIZER_VERSION,
      });
    } catch (error) {
      if (tokenMetered && source && this.usageV2Service) await settleOrReleaseFailedLlmUsage({
        usageService: this.usageV2Service,
        userId: source.userId,
        requestId,
        prompt: meteredPrompt,
        output: rawOutput,
        usage: tokenUsage,
        provider: this.aiProvider,
      });
      const maxAttempts = this.options.maxAttempts ?? 3;
      if (error instanceof ResourceLimitedError || error instanceof TokenQuotaExceededError) {
        const retry = resolveEnrichmentRetry(error, job.attempts, maxAttempts);
        await this.repository.rescheduleOrFail(
          job,
          safeEnrichmentErrorMessage(error),
          retry.retryAt,
          { preserveAttempt: retry.preserveAttempt },
        );
        return true;
      }
      if (job.attempts >= maxAttempts && source) {
        try {
          const normalizedText = normalizePhraseSurface(source.surfaceText, source.languageCode);
          if (!normalizedText) throw phraseError("PHRASE_FALLBACK_INVALID");
          await this.repository.completePhraseNormalization(job, {
            canonicalText: source.surfaceText.trim(),
            canonicalKey: normalizedText,
            variants: [{
              surfaceText: source.surfaceText,
              normalizedText,
              source: source.observedSource,
            }],
            normalizerVersion: PHRASE_NORMALIZER_VERSION,
          });
          return true;
        } catch (fallbackError) {
          await this.repository.rescheduleOrFail(job, safeErrorMessage(fallbackError), null);
          return true;
        }
      }
      const retry = resolveEnrichmentRetry(error, job.attempts, maxAttempts);
      await this.repository.rescheduleOrFail(job, safeEnrichmentErrorMessage(error), retry.retryAt);
    }
    return true;
  }

}

function phraseError(code: string): Error {
  const error = new Error(code) as Error & { code: string };
  error.code = code;
  return error;
}

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error ?? "unknown")).slice(0, 500);
}
