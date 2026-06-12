import type { ChatGenerationStreamEvent, ChatGenerationStreamRequestBody } from "@lf/core/contracts/chatStream.js";
import type {
  AbortSignalLike,
  AIProvider,
} from "@lf/core/ports/ai/AIProvider.js";
import type { ChatMessageService, MessageView } from "./ChatMessageService.js";
import type { ChatGenerationTaskGuard } from "./ChatGenerationTaskGuard.js";
import type { EntitlementService } from "../entitlement/EntitlementService.js";
import type {
  AiRequestLogRepository,
  AiRequestLogStatus,
} from "@lf/core/ports/repository/AiRequestLogRepository.js";
import type { ChatGenerationRateLimiter } from "./ChatGenerationRateLimiter.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import type { ConversationRepository } from "@lf/core/ports/repository/ConversationRepository.js";

type ChatGenerationStreamServiceInput = ChatGenerationStreamRequestBody & {
  userId: string;
  signal?: AbortSignalLike;
  requestId: string;
};

type AppErrorCode =
  | "RATE_LIMITED"
  | "TASK_IN_PROGRESS"
  | "INPUT_TOO_LONG"
  | "INPUT_TOO_SHORT";

type AppError = Error & { code: AppErrorCode };

export class ChatGenerationService {
  constructor(
    private readonly aiProvider: AIProvider,
    private readonly chatMessageService: ChatMessageService,
    private readonly taskGuard: ChatGenerationTaskGuard,
    private readonly entitlementService: EntitlementService,
    private readonly aiRequestLogRepository: AiRequestLogRepository,
    private readonly rateLimiter: ChatGenerationRateLimiter,
    private readonly conversationRepository: ConversationRepository,
  ) {}
  
  async generateChatStream(
    input: ChatGenerationStreamServiceInput,
    onEvent: (event: ChatGenerationStreamEvent) => Promise<void> | void
  ): Promise<void> {
    let assistantText = "";
    const shouldPersist = Boolean(input.conversationId && input.userMessageId);
    let quotaDateKey: string | undefined;

    if (shouldPersist) {
      await this.chatMessageService.assertUserMessageOwnership({
        userId: input.userId,
        conversationId: input.conversationId!,
        userMessageId: input.userMessageId!,
      });
      const conversation = await this.conversationRepository.findById(input.conversationId!);
      if (conversation && conversation.userId === input.userId) {
        quotaDateKey = conversation.dateKey;
      }
    }

    const startedAt = Date.now();
    const taskId = input.userMessageId ?? input.requestId;
    const config = getRuntimeConfig();
    const taskTtlMs = config.chatGenerationTaskTtlMs;
    const rateLimit = config.chatGenerationGlobalRateLimit;
    const rateWindowMs = config.chatGenerationGlobalRateWindowMs;
    const rateAllowed = await this.rateLimiter.consume(
      this.currentRateLimitKey(),
      rateLimit,
      rateWindowMs
    );

    if (!rateAllowed) {
      if (shouldPersist) await this.chatMessageService.markUserMessageFailed(input.userMessageId!);
      const error = createAppError(
        "RATE_LIMITED",
        "Too many chat generation tasks. Please try again later."
      );
      await this.logFailedAiRequest(input, {
        startedAt,
        status: "rate_limited",
        error,
        outputChars: 0,
      });
      throw error;
    }

    const userRateLimit = config.chatGenerationUserRateLimit;
    const userRateWindowMs = config.chatGenerationUserRateWindowMs;
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

    const chatGenerationMaxInputChars = config.chatGenerationMaxInputChars;
    const inputLimitLength = countInputCharsWithoutWhitespace(input.text);
    if (inputLimitLength > chatGenerationMaxInputChars) {
      const error = createAppError("INPUT_TOO_LONG", "Input too long");
      await this.logFailedAiRequest(input, {
        startedAt,
        status: "failed",
        error,
        outputChars: 0,
      });
      throw error;
    }

    const chatGenerationMinInputChars = config.chatGenerationMinInputChars;
    if (inputLimitLength < chatGenerationMinInputChars) {
      const error = createAppError("INPUT_TOO_SHORT", "Input too short");
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
        "A chat generation task is already running for this user."
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
      await this.entitlementService.assertCanStartGeneration(input.userId, { dateKey: quotaDateKey });

      await this.aiProvider.generateChatTextStream(
        {
          userId: input.userId,
          text: input.text,
          contactId: input.contactId,
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
      const assistantMessage = shouldPersist
        ? await this.createPersistedAssistantMessage(input, assistantText)
        : undefined;
      try {
        // 输出长度由模型决定；用户只要有额度发起本轮，就让回复完整返回，最终扣费最多扣到当日上限。
        await this.entitlementService.consumeUpToLimit(input.userId, totalChars, { dateKey: quotaDateKey });
      } catch (settlementError) {
        await this.logSettlementFailure(input, {
          error: settlementError,
          inputChars: input.text.length,
          outputChars: assistantText.length,
          totalChars,
          dateKey: quotaDateKey,
        });
      }
      await onEvent({ type: "done", assistantMessage });
    }catch(error){
      const failureStatus = this.resolveFailureStatus(error);
      if (failureStatus === "cancelled") {
        await this.consumeCancelledUsage(input, assistantText, quotaDateKey);
      }
      if (shouldPersist) await this.chatMessageService.markUserMessageFailed(input.userMessageId!);
      await this.logFailedAiRequest(input, {
        startedAt,
        status: failureStatus,
        error,
        outputChars: assistantText.length,
      });
      throw error;
    } finally {
      await this.taskGuard.release(input.userId, taskId);
    }
  }
  
  private currentRateLimitKey(): string {
    const windowMs = getRuntimeConfig().chatGenerationGlobalRateWindowMs;
    const bucket = Math.floor(Date.now() / windowMs);
    return `chat-generation:rate:global:${bucket}`;
  }

  private userRateLimitKey(userId: string): string {
    const windowMs = getRuntimeConfig().chatGenerationUserRateWindowMs;
    const bucket = Math.floor(Date.now() / windowMs);
    return `chat-generation:rate:user:${userId}:${bucket}`;
  }

  private async createPersistedAssistantMessage(
    input: ChatGenerationStreamServiceInput,
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
    input: ChatGenerationStreamServiceInput,
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

  private async logSettlementFailure(
    input: ChatGenerationStreamServiceInput,
    params: {
      error: unknown;
      inputChars: number;
      outputChars: number;
      totalChars: number;
      dateKey?: string;
    }
  ): Promise<void> {
    try {
      await this.aiRequestLogRepository.create({
        requestId: `${input.requestId}:settlement`,
        userId: input.userId,
        conversationId: input.conversationId,
        userMessageId: input.userMessageId,
        provider: this.aiProvider.providerName,
        model: this.aiProvider.modelName,
        status: "failed",
        inputChars: params.inputChars,
        outputChars: params.outputChars,
        durationMs: 0,
        errorCode: "ENTITLEMENT_CONSUME_FAILED",
        errorMessage: params.error instanceof Error ? params.error.message : String(params.error ?? "unknown"),
      });
    } catch {
      // Settlement logging must never turn a completed generation into a user-visible failure.
    }
  }

  private async consumeCancelledUsage(
    input: ChatGenerationStreamServiceInput,
    assistantText: string,
    dateKey?: string
  ): Promise<void> {
    const chargeChars = input.text.length + assistantText.length;
    // 用户主动停止时同样按已产生内容计费，但不允许额度被扣成超额。
    await this.entitlementService.consumeUpToLimit(input.userId, chargeChars, { dateKey });
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

function countInputCharsWithoutWhitespace(value: string): number {
  return value.replace(/\s/g, "").length;
}

function createAppError(code: AppErrorCode, message: string): AppError {
  const error = new Error(message) as AppError;
  error.code = code;
  return error;
}
