function parseInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const oioChatConfig = {
  maxInputChars: parseInteger(import.meta.env.VITE_OIO_CHAT_MAX_INPUT_CHARS, 1000),
  newConversationTitle: "New conversation",
} as const;
