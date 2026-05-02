import type { PrismaClient } from "@prisma/client";
import type {
  AiRequestLogRepository,
  CreateAiRequestLogInput,
} from "@lf/core/ports/repository/AiRequestLogRepository";

export class PrismaAiRequestLogRepository implements AiRequestLogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateAiRequestLogInput): Promise<void> {
    await this.prisma.aiRequestLog.create({
      data: {
        requestId: input.requestId,
        userId: input.userId,
        conversationId: input.conversationId ?? null,
        userMessageId: input.userMessageId ?? null,
        provider: input.provider,
        model: input.model,
        status: input.status,
        inputChars: input.inputChars,
        outputChars: input.outputChars,
        durationMs: input.durationMs ?? null,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
      },
    });
  }
}
