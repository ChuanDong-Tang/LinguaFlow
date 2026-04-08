function normalizeText(value) {
  return String(value ?? "").toLowerCase();
}

export function findBlockedPattern(text, patterns) {
  const normalized = normalizeText(text);
  return patterns.find((pattern) => normalized.includes(pattern)) ?? null;
}

export function looksLikePromptInjection(text) {
  const normalized = normalizeText(text);
  const signalCount = [
    "ignore previous instructions",
    "system prompt",
    "developer message",
    "reveal your",
    "show hidden",
    "print your",
    "what is your api key",
  ].filter((pattern) => normalized.includes(pattern)).length;

  return signalCount >= 2;
}
