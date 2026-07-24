import { getTargetLanguageProfile } from "../language/targetLanguages.js";

export const PHRASE_NORMALIZER_VERSION = "phrase_normalizer_v1" as const;

export function normalizePhraseSurface(surfaceText: string, languageCode: string): string {
  let normalized = surfaceText.normalize("NFKC").trim().replace(/\s+/gu, " ");
  normalized = normalized.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "").trim();
  const profile = getTargetLanguageProfile(languageCode);
  if (profile.matcher.caseInsensitive) {
    normalized = normalized.toLocaleLowerCase(profile.matcher.caseLocale);
  }
  return normalized;
}
