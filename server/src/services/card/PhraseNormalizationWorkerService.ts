import type { AIProvider } from "@lf/core/ports/ai/AIProvider.js";
import type { CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import {
  buildPhraseNormalizationPrompt,
  parsePhraseNormalizationOutput,
} from "@lf/core/Prompts/phraseNormalizationPrompt.js";
import { normalizePhraseSurface, PHRASE_NORMALIZER_VERSION } from "@lf/core/text/phraseNormalization.js";

export class PhraseNormalizationWorkerService {
  constructor(
    private readonly repository: CardEnrichmentRepository,
    private readonly aiProvider: AIProvider,
    private readonly options: { leaseMs?: number; maxAttempts?: number } = {},
  ) {}

  async claimAndProcess(workerId: string): Promise<boolean> {
    const job = await this.repository.claimNextPhraseNormalizationJob(
      workerId,
      new Date(Date.now() + (this.options.leaseMs ?? 60_000)),
    );
    if (!job) return false;
    let source: Awaited<ReturnType<CardEnrichmentRepository["loadPhraseNormalizationSource"]>> = null;
    try {
      source = await this.repository.loadPhraseNormalizationSource(job);
      if (!source) {
        await this.repository.completeWithoutResult(job, "PHRASE_SOURCE_MISSING");
        return true;
      }
      const normalizationSource = source;
      const prompt = buildPhraseNormalizationPrompt(normalizationSource);
      let rawOutput = "";
      await this.aiProvider.generateChatTextStream({
        userId: normalizationSource.userId,
        text: prompt.userPrompt,
        languageCode: normalizationSource.languageCode,
        systemPrompt: prompt.systemPrompt,
        rawUserPrompt: true,
        maxOutputTokens: 500,
      }, (event) => {
        if (event.type === "delta") rawOutput += event.text;
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
      const maxAttempts = this.options.maxAttempts ?? 3;
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
      const retryAt = job.attempts >= maxAttempts
        ? null
        : new Date(Date.now() + Math.min(60_000, 1_000 * (2 ** Math.max(0, job.attempts - 1))));
      await this.repository.rescheduleOrFail(job, safeErrorMessage(error), retryAt);
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
