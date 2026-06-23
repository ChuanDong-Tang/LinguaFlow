import type {
  CreateReadyTtsAssetInput,
  CreateFailedTtsAssetInput,
  FindReadyTtsAssetInput,
  TtsAssetEntity,
  TtsAssetRepository,
  TtsAssetStatus,
  TtsSentenceMark,
  TtsWordMark,
} from "@lf/core/ports/repository/TtsAssetRepository.js";

type PrismaTtsAssetClient = {
  ttsAsset: {
    create: (args: any) => Promise<any>;
    findFirst: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<{ count: number }>;
    upsert: (args: any) => Promise<any>;
  };
};

export class PrismaTtsAssetRepository implements TtsAssetRepository {
  constructor(private readonly prisma: PrismaTtsAssetClient) {}

  async findReady(input: FindReadyTtsAssetInput): Promise<TtsAssetEntity | null> {
    const row = await this.prisma.ttsAsset.findFirst({
      where: {
        messageId: input.messageId,
        provider: input.provider,
        voiceCode: input.voiceCode,
        languageCode: input.languageCode,
        sourceKey: input.sourceKey,
        sourceTextHash: input.sourceTextHash,
        status: "ready",
      },
    });
    return row ? this.toEntity(row) : null;
  }

  async createReady(input: CreateReadyTtsAssetInput): Promise<TtsAssetEntity> {
    try {
      const row = await this.prisma.ttsAsset.create({
        data: {
          userId: input.userId,
          messageId: input.messageId,
          provider: input.provider,
          voiceCode: input.voiceCode,
          languageCode: input.languageCode,
          sourceKey: input.sourceKey,
          sourceText: input.sourceText,
          sourceTextHash: input.sourceTextHash,
          format: input.format,
          status: "ready",
          objectKey: input.objectKey,
          objectUrl: input.objectUrl ?? null,
          objectUrlExpiresAt: input.objectUrlExpiresAt ?? null,
          durationMs: input.durationMs ?? null,
          wordMarks: input.wordMarks ?? undefined,
          sentenceMarks: input.sentenceMarks ?? undefined,
        },
      });
      return this.toEntity(row);
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const row = await this.prisma.ttsAsset.update({
        where: uniqueWhere(input),
        data: {
          userId: input.userId,
          languageCode: input.languageCode,
          sourceKey: input.sourceKey,
          sourceText: input.sourceText,
          format: input.format,
          status: "ready",
          objectKey: input.objectKey,
          objectUrl: input.objectUrl ?? null,
          objectUrlExpiresAt: input.objectUrlExpiresAt ?? null,
          durationMs: input.durationMs ?? null,
          wordMarks: input.wordMarks ?? undefined,
          sentenceMarks: input.sentenceMarks ?? undefined,
          errorMessage: null,
        },
      });
      return this.toEntity(row);
    }
  }

  async createFailed(input: CreateFailedTtsAssetInput): Promise<TtsAssetEntity> {
    try {
      const row = await this.prisma.ttsAsset.create({
        data: {
          userId: input.userId,
          messageId: input.messageId,
          provider: input.provider,
          voiceCode: input.voiceCode,
          languageCode: input.languageCode,
          sourceKey: input.sourceKey,
          sourceText: input.sourceText,
          sourceTextHash: input.sourceTextHash,
          format: input.format,
          status: "failed",
          objectKey: input.objectKey,
          errorMessage: input.errorMessage,
        },
      });
      return this.toEntity(row);
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
    }

    const ready = await this.findReady(input);
    if (ready) return ready;

    await this.prisma.ttsAsset.updateMany({
      where: {
        ...identityWhere(input),
        status: { not: "ready" },
      },
      data: {
        userId: input.userId,
        languageCode: input.languageCode,
        sourceKey: input.sourceKey,
        sourceText: input.sourceText,
        format: input.format,
        status: "failed",
        objectKey: input.objectKey,
        objectUrl: null,
        objectUrlExpiresAt: null,
        durationMs: null,
        wordMarks: undefined,
        sentenceMarks: undefined,
        errorMessage: input.errorMessage,
      },
    });
    const row = await this.prisma.ttsAsset.findFirst({
      where: identityWhere(input),
    });
    if (!row) {
      throw new Error("TTS failed asset not found after create/update");
    }
    return this.toEntity(row);
  }

  private toEntity(row: {
    id: string;
    userId: string;
    messageId: string;
    provider: string;
    voiceCode: string;
    languageCode: string;
    sourceKey: string | null;
    sourceText: string;
    sourceTextHash: string;
    format: string;
    status: string;
    objectKey: string;
    objectUrl: string | null;
    objectUrlExpiresAt: Date | null;
    durationMs: number | null;
    wordMarks: unknown;
    sentenceMarks: unknown;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): TtsAssetEntity {
    return {
      id: row.id,
      userId: row.userId,
      messageId: row.messageId,
      provider: row.provider,
      voiceCode: row.voiceCode,
      languageCode: row.languageCode,
      sourceKey: row.sourceKey === "reply" ? "reply" : "rewrite",
      sourceText: row.sourceText,
      sourceTextHash: row.sourceTextHash,
      format: row.format,
      status: (row.status === "failed" ? "failed" : "ready") as TtsAssetStatus,
      objectKey: row.objectKey,
      objectUrl: row.objectUrl,
      objectUrlExpiresAt: row.objectUrlExpiresAt,
      durationMs: row.durationMs,
      wordMarks: normalizeWordMarks(row.wordMarks),
      sentenceMarks: normalizeSentenceMarks(row.sentenceMarks),
      errorMessage: row.errorMessage,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

function normalizeWordMarks(value: unknown): TtsWordMark[] | null {
  return Array.isArray(value)
    ? value.filter((row): row is TtsWordMark =>
      typeof row?.text === "string" &&
      typeof row?.startMs === "number" &&
      typeof row?.durationMs === "number"
    ).map((row) => ({
      text: row.text,
      startMs: row.startMs,
      durationMs: row.durationMs,
      ...(typeof row.textStart === "number" ? { textStart: row.textStart } : {}),
      ...(typeof row.textEnd === "number" ? { textEnd: row.textEnd } : {}),
    }))
    : null;
}

function normalizeSentenceMarks(value: unknown): TtsSentenceMark[] | null {
  return Array.isArray(value)
    ? value.filter((row): row is TtsSentenceMark =>
      typeof row?.text === "string" &&
      typeof row?.textStart === "number" &&
      typeof row?.textEnd === "number" &&
      typeof row?.startMs === "number" &&
      typeof row?.durationMs === "number"
    )
    : null;
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}

function uniqueWhere(input: {
  messageId: string;
  provider: string;
  voiceCode: string;
  languageCode: string;
  sourceKey: string;
  sourceTextHash: string;
}): Record<string, unknown> {
  return {
    messageId_provider_voiceCode_languageCode_sourceKey_sourceTextHash: {
      messageId: input.messageId,
      provider: input.provider,
      voiceCode: input.voiceCode,
      languageCode: input.languageCode,
      sourceKey: input.sourceKey,
      sourceTextHash: input.sourceTextHash,
    },
  };
}

function identityWhere(input: {
  messageId: string;
  provider: string;
  voiceCode: string;
  languageCode: string;
  sourceKey: string;
  sourceTextHash: string;
}): Record<string, unknown> {
  return {
    messageId: input.messageId,
    provider: input.provider,
    voiceCode: input.voiceCode,
    languageCode: input.languageCode,
    sourceKey: input.sourceKey,
    sourceTextHash: input.sourceTextHash,
  };
}
