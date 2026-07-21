import type { AIProvider } from "@lf/core/ports/ai/AIProvider.js";
import type { JournalEntryEntity, JournalRepository } from "@lf/core/ports/repository/JournalRepository.js";
import type { AiRequestLogRepository } from "@lf/core/ports/repository/AiRequestLogRepository.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import { getPromptProfile, parseTaggedRewriteOutput } from "@lf/core/Prompts/rewriteAssistantPrompt.js";
import { segmentLearningSentences } from "@lf/core/text/learningText.js";
import { countGraphemes } from "@lf/core/text/grapheme.js";
import type { EntitlementService } from "../entitlement/EntitlementService.js";
import type { ContentSafetyService } from "../contentSafety/ContentSafetyService.js";
import type { ChatGenerationTaskGuard } from "../chat/ChatGenerationTaskGuard.js";
import { taskGuardId } from "./JournalService.js";

export class JournalRewriteWorkerService {
  constructor(
    private readonly repository: JournalRepository,
    private readonly aiProvider: AIProvider,
    private readonly entitlementService: EntitlementService,
    private readonly taskGuard: ChatGenerationTaskGuard,
    private readonly aiRequestLogRepository: AiRequestLogRepository,
    private readonly systemEventLogRepository?: SystemEventLogRepository,
    private readonly contentSafetyService?: ContentSafetyService,
    private readonly options: { leaseMs?: number; leaseRenewMs?: number } = {},
  ) {}

  get leaseMs(): number {
    return this.options.leaseMs ?? 3 * 60 * 1_000;
  }

  async claimAndProcess(workerId: string): Promise<boolean> {
    const entry = await this.repository.claimNextQueued(workerId, new Date(Date.now() + this.leaseMs));
    if (!entry) return false;
    await this.process(entry, workerId);
    return true;
  }

  async failExpiredLeases(limit = 50): Promise<number> {
    const entries = await this.repository.listExpiredProcessing(new Date(), limit);
    let failed = 0;
    for (const entry of entries) {
      const failedAt = new Date();
      const marked = await this.repository.markFailedAndScrub(entry.id, entry.workerId, failedAt, failedAt);
      if (!marked) continue;
      failed += 1;
      await this.taskGuard.release(entry.userId, taskGuardId(entry.clientId));
      await this.logFailure(entry, "JOURNAL_TASK_LEASE_EXPIRED", "Journal worker lease expired");
    }
    return failed;
  }

  async cleanupExpiredFailureTombstones(limit = 100): Promise<number> {
    return this.repository.deleteFailedTombstonesBefore(
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000),
      limit,
    );
  }

  private async process(entry: JournalEntryEntity, workerId: string): Promise<void> {
    const originalText = entry.originalText;
    if (!originalText) {
      await this.fail(entry, workerId, new Error("JOURNAL_ORIGINAL_TEXT_MISSING"));
      return;
    }

    const requestId = `journal_${entry.id}`;
    const startedAt = Date.now();
    let rawOutput = "";
    const renewEvery = this.options.leaseRenewMs ?? 30_000;
    const renewTimer = setInterval(() => {
      void this.repository.renewLease(entry.id, workerId, new Date(Date.now() + this.leaseMs));
      void this.taskGuard
        .renew(entry.userId, taskGuardId(entry.clientId), this.leaseMs)
        .catch(() => undefined);
    }, renewEvery);

    try {
      const profile = getPromptProfile({
        contactCode: "curious_companion",
        language: entry.languageCode,
        appLocale: "zh-CN",
        difficulty: entry.promptDifficultySnapshot,
        companionMode: "rewrite_only",
      });
      await this.aiProvider.generateChatTextStream(
        {
          userId: entry.userId,
          text: originalText,
          languageCode: entry.languageCode,
          appLocale: "zh-CN",
          promptDifficulty: entry.promptDifficultySnapshot,
          companionMode: "rewrite_only",
          systemPrompt: profile.systemPrompt,
        },
        (event) => {
          if (event.type === "delta") rawOutput += event.text;
        },
      );
      const rewrittenText = parseTaggedRewriteOutput(rawOutput).rewrite.trim();
      if (!rewrittenText) throw new Error("JOURNAL_REWRITE_EMPTY");
      this.contentSafetyService?.assertAllowed(rewrittenText, "output");
      await this.contentSafetyService?.assertAllowedRemote({
        text: rewrittenText,
        stage: "output",
        requestId,
        userId: entry.userId,
      });
      const segments = segmentLearningSentences({
        text: rewrittenText,
        languageCode: entry.languageCode,
        minSegmentChars: 1,
        maxSegmentChars: 800,
      }).map((segment, ordinal) => ({
        ordinal,
        text: segment.text,
        startUtf16: segment.textStart,
        endUtf16: segment.textEnd,
      }));
      await this.repository.complete({
        entryId: entry.id,
        workerId,
        rewrittenText,
        outputChars: countGraphemes(rewrittenText),
        publishedAt: new Date(),
        segments,
      });
      try {
        await this.entitlementService.consumeUpToLimit(
          entry.userId,
          entry.inputChars + countGraphemes(rewrittenText),
          { dateKey: entry.dateKey },
        );
      } catch (error) {
        await this.writeSystemLog(entry, "journal.entitlement.settlement_failed", error, {
          requestId,
          inputChars: entry.inputChars,
          outputChars: countGraphemes(rewrittenText),
        });
      }
    } catch (error) {
      await this.fail(entry, workerId, error, Date.now() - startedAt, rawOutput.length);
    } finally {
      clearInterval(renewTimer);
      await this.taskGuard.release(entry.userId, taskGuardId(entry.clientId));
    }
  }

  private async fail(
    entry: JournalEntryEntity,
    workerId: string,
    error: unknown,
    durationMs = 0,
    outputChars = 0,
  ): Promise<void> {
    await this.repository.markFailedAndScrub(entry.id, workerId, new Date());
    try {
      await this.aiRequestLogRepository.create({
        requestId: `journal_${entry.id}`,
        userId: entry.userId,
        provider: this.aiProvider.providerName,
        model: this.aiProvider.modelName,
        status: "failed",
        inputChars: entry.inputChars,
        outputChars,
        durationMs,
        errorCode: resolveErrorCode(error),
        errorMessage: safeErrorMessage(error),
      });
    } catch {
      // Preserve the original terminal state even if audit persistence fails.
    }
    await this.logFailure(entry, resolveErrorCode(error), safeErrorMessage(error));
  }

  private async logFailure(entry: JournalEntryEntity, errorCode: string, errorMessage: string): Promise<void> {
    await this.writeSystemLog(entry, "journal.rewrite.failed", new Error(errorMessage), {
      errorCode,
      workerId: entry.workerId,
      provider: this.aiProvider.providerName,
      model: this.aiProvider.modelName,
    });
  }

  private async writeSystemLog(
    entry: JournalEntryEntity,
    event: string,
    error: unknown,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.systemEventLogRepository?.create({
        userId: entry.userId,
        module: "journal",
        event,
        level: "error",
        status: "failed",
        errorCode: resolveErrorCode(error),
        errorMessage: safeErrorMessage(error),
        metadata: { entryId: entry.id, ...metadata },
      });
    } catch {
      // System logging never changes task state.
    }
  }
}

function resolveErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) return String(error.code);
  if (error instanceof Error && error.message.match(/^[A-Z0-9_]+$/)) return error.message;
  return error instanceof Error ? error.name.toUpperCase() : "UNKNOWN";
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "unknown");
  return message.slice(0, 500);
}
