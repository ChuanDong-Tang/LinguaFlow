export type AiRequestLogStatus =
  | "failed"
  | "cancelled"
  | "quota_exceeded"
  | "task_in_progress"
  | "rate_limited";

export interface CreateAiRequestLogInput {
  requestId: string;
  userId: string;
  conversationId?: string | null;
  userMessageId?: string | null;
  provider: string;
  model: string;
  status: AiRequestLogStatus;
  inputChars: number;
  outputChars: number;
  durationMs?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface AiRequestLogRepository {
  create(input: CreateAiRequestLogInput): Promise<void>;
}
