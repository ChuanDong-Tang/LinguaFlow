export type TtsRequestLogStatus = "success" | "failed";

export interface CreateTtsRequestLogInput {
  requestId?: string | null;
  userId: string;
  messageId: string;
  assetId?: string | null;
  provider: string;
  voiceCode: string;
  languageCode: string;
  sourceTextHash: string;
  sourceTextChars: number;
  cacheHit: boolean;
  deduped?: boolean;
  status: TtsRequestLogStatus;
  durationMs?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface TtsRequestLogRepository {
  create(input: CreateTtsRequestLogInput): Promise<void>;
}
