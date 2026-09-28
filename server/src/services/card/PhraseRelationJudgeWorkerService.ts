import { createHash } from "node:crypto";
import {
  buildPhraseRelationJudgePrompt,
  parsePhraseRelationJudgeOutput,
  phraseRelationJudgeHashInput,
  PHRASE_RELATION_JUDGE_PROMPT_VERSION,
} from "@lf/core/Prompts/phraseRelationJudgePrompt.js";
import type { AIProvider } from "@lf/core/ports/ai/AIProvider.js";
import type { CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import type { ResourceGovernor } from "../resource/ResourceGovernor.js";
import { resolveEnrichmentRetry, safeEnrichmentErrorMessage, safeEnrichmentErrorMetadata } from "./EnrichmentJobRetry.js";

export class PhraseRelationJudgeWorkerService {
  constructor(
    private readonly repository: CardEnrichmentRepository,
    private readonly aiProvider: AIProvider,
    private readonly logs?: SystemEventLogRepository,
    private readonly options: { leaseMs?: number; maxAttempts?: number } = {},
    private readonly resourceGovernor?: ResourceGovernor,
  ) {}

  async claimAndProcess(workerId: string): Promise<boolean> {
    const job = await this.repository.claimNextPhraseRelationJudgeJob(
      workerId,
      new Date(Date.now() + (this.options.leaseMs ?? 60_000)),
    );
    if (!job) return false;
    const startedAt = Date.now();
    try {
      const source = await this.repository.loadPhraseRelationJudgeSource(job);
      if (!source) {
        await this.repository.completeWithoutResult(job, "PHRASE_RELATION_JUDGE_SOURCE_MISSING");
        return true;
      }
      if (createHash("sha256").update(phraseRelationJudgeHashInput(source)).digest("hex") !== job.inputHash) {
        await this.repository.completeWithoutResult(job, "PHRASE_RELATION_JUDGE_INPUT_STALE");
        return true;
      }
      let selectedOccurrenceId: string | null = null;
      if (source.candidates.length) {
        const prompt = buildPhraseRelationJudgePrompt(source);
        let output = "";
        const generate = () => this.aiProvider.generateChatTextStream({
          userId: source.userId,
          text: prompt.userPrompt,
          languageCode: source.anchor.languageCode,
          systemPrompt: prompt.systemPrompt,
          rawUserPrompt: true,
          maxOutputTokens: 24,
          temperature: 0,
        }, (event) => { if (event.type === "delta") output += event.text; });
        if (this.resourceGovernor) await this.resourceGovernor.execute("llm", source.userId, generate);
        else await generate();
        selectedOccurrenceId = parsePhraseRelationJudgeOutput(output, source.candidates).selectedOccurrenceId;
      }
      await this.repository.completePhraseRelationJudgeJob(job, {
        selectedOccurrenceId,
        promptVersion: PHRASE_RELATION_JUDGE_PROMPT_VERSION,
        provider: this.aiProvider.providerName,
        model: this.aiProvider.modelName,
      });
    } catch (error) {
      const retry = resolveEnrichmentRetry(error, job.attempts, this.options.maxAttempts ?? 3);
      await this.repository.rescheduleOrFail(job, safeEnrichmentErrorMessage(error), retry.retryAt, { preserveAttempt: retry.preserveAttempt });
      await this.logs?.create({
        requestId: `phrase_relation_judge_${job.id}`,
        userId: job.userId,
        module: "card",
        event: retry.retryAt ? "phrase.relation_judge.retry" : "phrase.relation_judge.failed",
        level: retry.retryAt ? "warn" : "error",
        status: retry.retryAt ? "ignored" : "failed",
        errorCode: typeof error === "object" && error !== null && "code" in error ? String(error.code) : "PHRASE_RELATION_JUDGE_FAILED",
        errorMessage: safeEnrichmentErrorMessage(error),
        metadata: {
          occurrenceId: job.sourceId,
          promptVersion: PHRASE_RELATION_JUDGE_PROMPT_VERSION,
          attempts: job.attempts,
          durationMs: Date.now() - startedAt,
          nextAttemptAt: retry.retryAt?.toISOString() ?? null,
          ...safeEnrichmentErrorMetadata(error),
        },
      }).catch((logError) => {
        console.error("[phrase-relation-judge-worker] system event log write failed", safeEnrichmentErrorMetadata(logError));
      });
    }
    return true;
  }
}
