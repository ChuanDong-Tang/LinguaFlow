import type { AIProvider, ChatTextGenerationStreamEvent } from "@lf/core/ports/ai/AIProvider.js";
import type { UsageV2Service } from "./UsageV2Service.js";

export type LlmUsageFeature = "rewrite" | "organization" | "reply" | "dictionary";
export type ProviderTokenUsage = Extract<ChatTextGenerationStreamEvent, { type: "done" }>["usage"];
export const CHAT_HISTORY_MIGRATION_BILLING_EXEMPTION = "chat_history_migration";

export function isPlatformMigrationBillingExempt(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  return (payload as { billingExemptReason?: unknown }).billingExemptReason
    === CHAT_HISTORY_MIGRATION_BILLING_EXEMPTION;
}

export function estimateLlmTokenReservation(prompt: string, maxOutputTokens: number): number {
  return Math.max(1, Array.from(prompt).length + maxOutputTokens);
}

export async function reserveLlmTokenUsage(input: {
  usageService: UsageV2Service;
  userId: string;
  requestId: string;
  feature: LlmUsageFeature;
  prompt: string;
  maxOutputTokens: number;
  provider: AIProvider;
}): Promise<void> {
  await input.usageService.reserveTokens({
    userId: input.userId,
    requestId: input.requestId,
    feature: input.feature,
    estimatedTokens: estimateLlmTokenReservation(input.prompt, input.maxOutputTokens),
    provider: input.provider.providerName,
    model: input.provider.modelName,
  });
}

export async function settleLlmTokenUsage(input: {
  usageService: UsageV2Service;
  userId: string;
  requestId: string;
  prompt: string;
  output: string;
  usage?: ProviderTokenUsage;
  provider: AIProvider;
}): Promise<void> {
  await input.usageService.settleTokens({
    userId: input.userId,
    requestId: input.requestId,
    inputTokens: input.usage?.inputTokens ?? Math.ceil(Array.from(input.prompt).length / 2),
    outputTokens: input.usage?.outputTokens ?? Math.ceil(Array.from(input.output).length / 2),
    meteringSource: input.usage ? "provider" : "tokenizer",
    provider: input.provider.providerName,
    model: input.provider.modelName,
  });
}

/** Charge partial output when the provider started streaming, otherwise release. */
export async function settleOrReleaseFailedLlmUsage(input: {
  usageService: UsageV2Service;
  userId: string;
  requestId: string;
  prompt: string;
  output: string;
  usage?: ProviderTokenUsage;
  provider: AIProvider;
}): Promise<void> {
  if (input.output.length > 0) {
    try {
      await settleLlmTokenUsage(input);
      return;
    } catch {
      // Fall through so a failed settlement never leaves quota reserved forever.
    }
  }
  await input.usageService.releaseTokens(input.userId, input.requestId).catch(() => undefined);
}
