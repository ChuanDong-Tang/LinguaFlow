export interface CreateAiUsageEventInput {
  requestId: string;
  userId: string | null;
  billingMode: "platform" | "user";
  operation: string;
  feature: string;
  status: "success" | "failed";
  inputTokens: number;
  outputTokens: number;
  imageCount: number;
  meteringSource: "provider" | "estimate";
  provider: string | null;
  model: string | null;
  metadata?: Record<string, string | number | boolean | null>;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface AiUsageEventRepository {
  upsert(input: CreateAiUsageEventInput): Promise<void>;
}
