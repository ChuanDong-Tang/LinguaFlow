import { requestAppApi } from "../../infrastructure/remote/remoteApiClient";

interface ChatUsagePayload {
  usage?: {
    daily_used?: number;
    daily_limit?: number;
  } | null;
}

export interface ChatUsageSnapshot {
  used: number;
  limit: number;
}

export async function fetchChatUsageSnapshot(): Promise<ChatUsageSnapshot | null> {
  const payload = await requestAppApi<ChatUsagePayload>("/api/chat-usage");
  const used = payload?.usage?.daily_used;
  const limit = payload?.usage?.daily_limit;
  if (!Number.isFinite(used) || !Number.isFinite(limit)) return null;
  if ((used as number) < 0 || (limit as number) <= 0) return null;
  return {
    used: used as number,
    limit: limit as number,
  };
}
