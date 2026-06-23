import type {
  CreateTtsRequestLogInput,
  TtsRequestLogRepository,
} from "@lf/core/ports/repository/TtsRequestLogRepository.js";

type PrismaTtsRequestLogClient = {
  ttsRequestLog: {
    create: (args: any) => Promise<any>;
  };
};

export class PrismaTtsRequestLogRepository implements TtsRequestLogRepository {
  constructor(private readonly prisma: PrismaTtsRequestLogClient) {}

  async create(input: CreateTtsRequestLogInput): Promise<void> {
    await this.prisma.ttsRequestLog.create({
      data: {
        requestId: input.requestId ?? null,
        userId: input.userId,
        messageId: input.messageId,
        assetId: input.assetId ?? null,
        provider: input.provider,
        voiceCode: input.voiceCode,
        languageCode: input.languageCode,
        sourceTextHash: input.sourceTextHash,
        sourceTextChars: input.sourceTextChars,
        cacheHit: input.cacheHit,
        deduped: input.deduped ?? false,
        status: input.status,
        durationMs: input.durationMs ?? null,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
      },
    });
  }
}
