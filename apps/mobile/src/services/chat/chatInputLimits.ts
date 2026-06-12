const DEFAULT_CHAT_GENERATION_MIN_INPUT_CHARS = 10;
const DEFAULT_CHAT_GENERATION_MAX_INPUT_CHARS = 3000;

function readPositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getChatGenerationInputLimits(): { min: number; max: number } {
  return {
    min: readPositiveIntEnv(
      process.env.EXPO_PUBLIC_CHAT_GENERATION_MIN_INPUT_CHARS,
      DEFAULT_CHAT_GENERATION_MIN_INPUT_CHARS
    ),
    max: readPositiveIntEnv(
      process.env.EXPO_PUBLIC_CHAT_GENERATION_MAX_INPUT_CHARS,
      DEFAULT_CHAT_GENERATION_MAX_INPUT_CHARS
    ),
  };
}

export function countChatGenerationInputChars(value: string): number {
  return value.replace(/\s/g, "").length;
}
