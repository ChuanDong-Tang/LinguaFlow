export function splitTextForSpeech(text: string): string[] {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const parts = normalized
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.endsWith(".") ? part : `${part}.`));

  if (parts.length) return parts;
  return [normalized];
}
