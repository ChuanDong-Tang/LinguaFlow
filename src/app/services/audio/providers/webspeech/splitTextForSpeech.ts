export function splitTextForSpeech(text: string): string[] {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const parts = normalized
    .split(/(?<=[.!?。！？])\s+|\n+/g)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length) return parts;
  return [normalized];
}
