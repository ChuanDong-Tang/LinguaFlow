export type TtsAssetStatus = "ready" | "failed";
export type TtsSourceKey = "rewrite" | "reply";

export type TtsWordMark = {
  text: string;
  textStart?: number;
  textEnd?: number;
  startMs: number;
  durationMs: number;
};

export type TtsSentenceMark = {
  text: string;
  textStart: number;
  textEnd: number;
  startMs: number;
  durationMs: number;
};

export interface TtsAssetEntity {
  id: string;
  userId: string;
  messageId: string;
  provider: string;
  voiceCode: string;
  languageCode: string;
  sourceKey: TtsSourceKey;
  sourceText: string;
  sourceTextHash: string;
  format: string;
  status: TtsAssetStatus;
  objectKey: string;
  objectUrl: string | null;
  objectUrlExpiresAt: Date | null;
  durationMs: number | null;
  wordMarks: TtsWordMark[] | null;
  sentenceMarks: TtsSentenceMark[] | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FindReadyTtsAssetInput {
  messageId: string;
  provider: string;
  voiceCode: string;
  languageCode: string;
  sourceKey: TtsSourceKey;
  sourceTextHash: string;
}

export interface CreateReadyTtsAssetInput {
  userId: string;
  messageId: string;
  provider: string;
  voiceCode: string;
  languageCode: string;
  sourceKey: TtsSourceKey;
  sourceText: string;
  sourceTextHash: string;
  format: string;
  objectKey: string;
  objectUrl?: string | null;
  objectUrlExpiresAt?: Date | null;
  durationMs?: number | null;
  wordMarks?: TtsWordMark[] | null;
  sentenceMarks?: TtsSentenceMark[] | null;
}

export interface CreateFailedTtsAssetInput {
  userId: string;
  messageId: string;
  provider: string;
  voiceCode: string;
  languageCode: string;
  sourceKey: TtsSourceKey;
  sourceText: string;
  sourceTextHash: string;
  format: string;
  objectKey: string;
  errorMessage: string;
}

export interface TtsAssetRepository {
  findReady(input: FindReadyTtsAssetInput): Promise<TtsAssetEntity | null>;
  createReady(input: CreateReadyTtsAssetInput): Promise<TtsAssetEntity>;
  createFailed(input: CreateFailedTtsAssetInput): Promise<TtsAssetEntity>;
}
