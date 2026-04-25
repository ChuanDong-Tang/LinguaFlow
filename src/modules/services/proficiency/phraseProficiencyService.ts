import { getAuthService } from "../auth/authService";
import { normalizePhraseKey } from "../../domain/proficiency";

interface PhraseScoresPayload {
  scores?: Record<string, number>;
}

export async function fetchPhraseProficiencyScores(phrases: string[]): Promise<Map<string, number>> {
  const normalized = Array.from(
    new Set(
      (Array.isArray(phrases) ? phrases : [])
        .map((phrase) => String(phrase ?? "").trim().replace(/\s+/g, " "))
        .filter(Boolean),
    ),
  ).slice(0, 200);

  if (!normalized.length) {
    return new Map();
  }

  const token = await getAuthService().getSessionToken();
  const response = await fetch("/api/phrase-proficiency", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ phrases: normalized }),
  });
  if (!response.ok) {
    return new Map();
  }
  let payload: PhraseScoresPayload | null = null;
  try {
    payload = (await response.json()) as PhraseScoresPayload;
  } catch {
    payload = null;
  }

  const result = new Map<string, number>();
  const scores = payload?.scores ?? {};
  for (const [key, rawScore] of Object.entries(scores)) {
    const normalizedKey = normalizePhraseKey(key);
    if (!normalizedKey) continue;
    const score = Number(rawScore);
    result.set(normalizedKey, Number.isFinite(score) ? score : 0);
  }
  return result;
}

