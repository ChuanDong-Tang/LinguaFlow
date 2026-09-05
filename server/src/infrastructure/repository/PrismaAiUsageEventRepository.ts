import type {
  AiUsageEventRepository,
  CreateAiUsageEventInput,
} from "@lf/core/ports/repository/AiUsageEventRepository.js";
import type { PrismaClient } from "@prisma/client";

export class PrismaAiUsageEventRepository implements AiUsageEventRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsert(input: CreateAiUsageEventInput): Promise<void> {
    const data = {
      userId: input.userId,
      billingMode: input.billingMode,
      operation: input.operation,
      feature: input.feature,
      status: input.status,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      totalTokens: input.inputTokens + input.outputTokens,
      imageCount: input.imageCount,
      meteringSource: input.meteringSource,
      provider: input.provider,
      model: input.model,
      metadata: input.metadata,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
    };
    await this.prisma.aiUsageEvent.upsert({
      where: { requestId: input.requestId },
      create: { requestId: input.requestId, ...data },
      update: data,
    });
  }
}
