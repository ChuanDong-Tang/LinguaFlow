import type { RewriteStreamRequestBody } from "@lf/core/contracts/chatStream.js";
import type {
  AbortSignalLike,
  AIProvider,
  RewriteTextStreamEvent,
} from "@lf/core/ports/ai/AIProvider.js";
import type { ChatMessageService } from "./ChatMessageService.js";
import type { RewriteTaskGuard } from "./RewriteTaskGuard.js";
import type { EntitlementService } from "../entitlement/EntitlementService.js";
import type {
  AiRequestLogRepository,
  AiRequestLogStatus,
} from "@lf/core/ports/repository/AiRequestLogRepository.js";
import type { RewriteRateLimiter } from "./RewriteRateLimiter.js";

type RewriteStreamServiceInput = RewriteStreamRequestBody & {
  signal?: AbortSignalLike;
  requestId: string;
};

export class RewriteService {
  constructor(
    private readonly aiProvider: AIProvider,
    private readonly chatMessageService: ChatMessageService,
    private readonly taskGuard: RewriteTaskGuard,
    private readonly entitlementService: EntitlementService,
    private readonly aiRequestLogRepository: AiRequestLogRepository,
    private readonly rateLimiter: RewriteRateLimiter,
  ) {}
  
  async rewriteStream(
    input: RewriteStreamServiceInput,
    onEvent: (event: RewriteTextStreamEvent) => Promise<void> | void
  ): Promise<void> {
    let assistantText = "";
    const startedAt = Date.now();
    const taskId = input.userMessageId;
    const taskTtlMs = Number(process.env.REWRITE_TASK_TTL_MS ?? "60000");
    const rateLimit = Number(process.env.REWRITE_GLOBAL_RATE_LIMIT ?? "30");
    const rateWindowMs = Number(process.env.REWRITE_GLOBAL_RATE_WINDOW_MS ?? "60000");
    const rateAllowed = await this.rateLimiter.consume(
      this.currentRateLimitKey(),
      rateLimit,
      rateWindowMs
    );

    if (!rateAllowed) {
      await this.chatMessageService.markUserMessageFailed(input.userMessageId);
      const error = new Error("RATE_LIMITED: Too many rewrite tasks. Please try again later.");
      await this.logFailedAiRequest(input, {
        startedAt,
        status: "rate_limited",
        error,
        outputChars: 0,
      });
      throw error;
    }
      
    const acquired = await this.taskGuard.acquire(input.userId, taskId, taskTtlMs);

    if (!acquired) {
      await this.chatMessageService.markUserMessageFailed(input.userMessageId);
      const error = new Error("TASK_IN_PROGRESS: A rewrite task is already running for this user.");
      await this.logFailedAiRequest(input, {
        startedAt,
        status: "task_in_progress",
        error,
        outputChars: 0,
      });
      throw error;
    }

    try {
      await this.entitlementService.assertCanUse(input.userId, input.text.length);

      await this.aiProvider.rewriteTextStream(
        {
          userId: input.userId,
          text: input.text,
          systemPrompt: input.systemPrompt,
          signal: input.signal,
        },
        async (event) => {
          if (event.type === "delta" && typeof event.text === "string") {
            assistantText += event.text;
          }
          await onEvent(event);
        }
      );
      await this.chatMessageService.markUserMessageSuccess(input.userMessageId);
      const totalChars = input.text.length + assistantText.length;
      await this.entitlementService.assertCanUse(input.userId, totalChars);
      await this.chatMessageService.createAssistantMessage(
        input.conversationId,
        input.userId,
        assistantText,
        input.userMessageId
      );
      await this.entitlementService.consume(input.userId, totalChars);
    }catch(error){
      await this.chatMessageService.markUserMessageFailed(input.userMessageId);
      await this.logFailedAiRequest(input, {
        startedAt,
        status: this.resolveFailureStatus(error),
        error,
        outputChars: assistantText.length,
      });
      throw error;
    } finally {
      await this.taskGuard.release(input.userId, taskId);
    }
  }
  
  private currentRateLimitKey(): string {
    const windowMs = Number(process.env.REWRITE_GLOBAL_RATE_WINDOW_MS ?? "60000");
    const bucket = Math.floor(Date.now() / windowMs);
    return `rewrite:rate:global:${bucket}`;
  }

  private async logFailedAiRequest(
    input: RewriteStreamServiceInput,
    params: {
      startedAt: number;
      status: AiRequestLogStatus;
      error: unknown;
      outputChars: number;
    }
  ): Promise<void> {
    try {
      await this.aiRequestLogRepository.create({
        requestId: input.requestId,
        userId: input.userId,
        conversationId: input.conversationId,
        userMessageId: input.userMessageId,
        provider: this.aiProvider.providerName,
        model: this.aiProvider.modelName,
        status: params.status,
        inputChars: input.text.length,
        outputChars: params.outputChars,
        durationMs: Date.now() - params.startedAt,
        errorCode: this.resolveErrorCode(params.error, params.status),
        errorMessage: params.error instanceof Error ? params.error.message : String(params.error ?? "unknown"),
      });
    } catch {
      // Logging must never hide the original AI failure from the caller.
    }
  }

  private resolveFailureStatus(error: unknown): AiRequestLogStatus {
    const code = this.resolveErrorCode(error);
    if (code === "DAILY_QUOTA_EXCEEDED") return "quota_exceeded";
    if (code === "ABORT_ERR" || code === "ABORT_ERROR") return "cancelled";
    return "failed";
  }

  private resolveErrorCode(error: unknown, fallback?: string): string {
    if (typeof error === "object" && error !== null && "code" in error) {
      return String(error.code);
    }
    if (error instanceof Error && error.name) {
      return error.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    }
    return fallback ?? "UNKNOWN";
  }
}
