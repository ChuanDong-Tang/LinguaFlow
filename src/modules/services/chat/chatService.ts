import { type OioChatMode } from "../../modules/oioChat/oioChatTypes";
import { RewriteApiError, requestOioChat, type PhraseProficiencyHintPayload } from "../rewrite/rewriteClient";

export interface ChatReply {
  mode: OioChatMode;
  naturalVersion: string;
  reply: string;
  keyPhrases: string[];
  usageDailyUsed?: number;
  usageDailyLimit?: number;
  proficiencyHint?: PhraseProficiencyHintPayload;
}

export async function createChatReply(sourceText: string, mode: OioChatMode): Promise<ChatReply> {
  const payload = await requestOioChat(sourceText, mode);

  return {
    mode,
    naturalVersion: payload.natural_version.trim(),
    reply: payload.reply.trim(),
    keyPhrases: [],
    usageDailyUsed: typeof payload.usage?.daily_used === "number" ? payload.usage.daily_used : undefined,
    usageDailyLimit: typeof payload.usage?.daily_limit === "number" ? payload.usage.daily_limit : undefined,
    proficiencyHint: payload.proficiency_hint ?? undefined,
  };
}

export function toChatErrorMessage(error: unknown): string {
  if (error instanceof RewriteApiError) {
    if (error.code === "UNAUTHORIZED" || error.code === "INVALID_TOKEN") {
      return "Please sign in to chat with OIO to continue.";
    }
    if (error.code === "DAILY_LIMIT_REACHED") {
      return "Daily character limit reached for your current plan. Please come back tomorrow.";
    }
    if (error.code === "REQUEST_TIMEOUT") {
      return "The request timed out. Please try again.";
    }
    if (error.code === "NETWORK_ERROR") {
      return "Network error. Please check your connection and retry.";
    }
    if (error.code === "MODEL_REQUEST_FAILED") {
      return "The model request failed before a reply was returned. Please try again.";
    }
    return error.message || "The chat reply failed.";
  }
  return "The chat reply failed.";
}
