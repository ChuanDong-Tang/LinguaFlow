import type { RewriteStreamEvent, RewriteStreamRequestBody } from "@lf/core/contracts/chatStream.js";
import type {
  AbortSignalLike,
  AIProvider,
} from "@lf/core/ports/ai/AIProvider.js";
import type { ChatMessageService, MessageView } from "./ChatMessageService.js";
import type { RewriteTaskGuard } from "./RewriteTaskGuard.js";
import type { EntitlementService } from "../entitlement/EntitlementService.js";
import type {
  AiRequestLogRepository,
  AiRequestLogStatus,
} from "@lf/core/ports/repository/AiRequestLogRepository.js";
import type { RewriteRateLimiter } from "./RewriteRateLimiter.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";

type RewriteStreamServiceInput = RewriteStreamRequestBody & {
  signal?: AbortSignalLike;
  requestId: string;
};

type AppErrorCode =
  | "RATE_LIMITED"
  | "TASK_IN_PROGRESS"
  | "INPUT_TOO_LONG";

type AppError = Error & { code: AppErrorCode };

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
    onEvent: (event: RewriteStreamEvent) => Promise<void> | void
  ): Promise<void> {
    let assistantText = "";
    const shouldPersist = Boolean(input.conversationId && input.userMessageId);

    if (shouldPersist) {
      await this.chatMessageService.assertUserMessageOwnership({
        userId: input.userId,
        conversationId: input.conversationId!,
        userMessageId: input.userMessageId!,
      });
    }

    const startedAt = Date.now();
    const taskId = input.userMessageId ?? input.requestId;
    const config = getRuntimeConfig();
    const taskTtlMs = config.rewriteTaskTtlMs;
    const rateLimit = config.rewriteGlobalRateLimit;
    const rateWindowMs = config.rewriteGlobalRateWindowMs;
    const rateAllowed = await this.rateLimiter.consume(
      this.currentRateLimitKey(),
      rateLimit,
      rateWindowMs
    );

    if (!rateAllowed) {
      if (shouldPersist) await this.chatMessageService.markUserMessageFailed(input.userMessageId!);
      const error = createAppError(
        "RATE_LIMITED",
        "Too many rewrite tasks. Please try again later."
      );
      await this.logFailedAiRequest(input, {
        startedAt,
        status: "rate_limited",
        error,
        outputChars: 0,
      });
      throw error;
    }

    const userRateLimit = config.rewriteUserRateLimit;
    const userRateWindowMs = config.rewriteUserRateWindowMs;
    const userRateAllowed = await this.rateLimiter.consume(
      this.userRateLimitKey(input.userId),
      userRateLimit,
      userRateWindowMs
    );

    if (!userRateAllowed) {
      if (shouldPersist) await this.chatMessageService.markUserMessageFailed(input.userMessageId!);
      const error = createAppError(
        "RATE_LIMITED",
        "Too many requests for this user. Please try again later."
      );
      await this.logFailedAiRequest(input, {
        startedAt,
        status: "rate_limited",
        error,
        outputChars: 0,
      });
      throw error;
    }

    const rewriteMaxInputChars = getRuntimeConfig().rewriteMaxInputChars;
    if (input.text.length > rewriteMaxInputChars) {
      const error = createAppError("INPUT_TOO_LONG", "Input too long");
      await this.logFailedAiRequest(input, {
        startedAt,
        status: "failed",
        error,
        outputChars: 0,
      });
      throw error;
    }
      
    const acquired = await this.taskGuard.acquire(input.userId, taskId, taskTtlMs);

    if (!acquired) {
      if (shouldPersist) await this.chatMessageService.markUserMessageFailed(input.userMessageId!);
      const error = createAppError(
        "TASK_IN_PROGRESS",
        "A rewrite task is already running for this user."
      );
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
          if (event.type === "done") {
            return;
          }
          await onEvent(event);
        }
      );
      const totalChars = input.text.length + assistantText.length;
      await this.entitlementService.assertCanUse(input.userId, totalChars);
      const assistantMessage = shouldPersist
        ? await this.createPersistedAssistantMessage(input, assistantText)
        : undefined;
      await this.entitlementService.consume(input.userId, totalChars);
      await onEvent({ type: "done", assistantMessage });
    }catch(error){
      if (shouldPersist) await this.chatMessageService.markUserMessageFailed(input.userMessageId!);
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
    const windowMs = getRuntimeConfig().rewriteGlobalRateWindowMs;
    const bucket = Math.floor(Date.now() / windowMs);
    return `rewrite:rate:global:${bucket}`;
  }

  private userRateLimitKey(userId: string): string {
    const windowMs = getRuntimeConfig().rewriteUserRateWindowMs;
    const bucket = Math.floor(Date.now() / windowMs);
    return `rewrite:rate:user:${userId}:${bucket}`;
  }

  private async createPersistedAssistantMessage(
    input: RewriteStreamServiceInput,
    assistantText: string
  ): Promise<MessageView> {
    await this.chatMessageService.markUserMessageSuccess(input.userMessageId!);
    return this.chatMessageService.createAssistantMessage(
      input.conversationId!,
      input.userId,
      assistantText,
      input.userMessageId!
    );
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

function createAppError(code: AppErrorCode, message: string): AppError {
  const error = new Error(message) as AppError;
  error.code = code;
  return error;
}
