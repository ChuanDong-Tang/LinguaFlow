import { TTS_POINTS_PER_CHARACTER, type UsageV2Service } from "./UsageV2Service.js";
import { countGraphemes } from "@lf/core/text/grapheme.js";

export async function generateWithTtsPointBilling<T>(input: {
  usageService?: UsageV2Service;
  userId: string;
  requestId: string;
  text: string;
  provider: string;
  operation: string;
  generate: () => Promise<T>;
}): Promise<T> {
  if (!input.usageService) return input.generate();
  const characterCount = countGraphemes(input.text);
  await input.usageService.reserveTokens({
    userId: input.userId,
    requestId: input.requestId,
    feature: "tts",
    estimatedTokens: Math.max(1, characterCount * TTS_POINTS_PER_CHARACTER),
    provider: input.provider,
    metadata: { operation: input.operation, characterCount },
  });
  try {
    const result = await input.generate();
    await input.usageService.settleTokens({
      userId: input.userId,
      requestId: input.requestId,
      inputTokens: 0,
      outputTokens: 0,
      billableCharacters: characterCount,
      meteringSource: "tokenizer",
      provider: input.provider,
      metadata: { operation: input.operation, characterCount },
    });
    return result;
  } catch (error) {
    await input.usageService.releaseTokens(input.userId, input.requestId).catch(() => undefined);
    throw error;
  }
}
