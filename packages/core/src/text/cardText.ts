import { countGraphemes, truncateGraphemes } from "./grapheme.js";

export const DEFAULT_CARD_TITLE_MAX_CHARS = 100;
export const DEFAULT_CARD_CONTENT_MAX_CHARS = 5_000;
export const DEFAULT_CARD_IMAGES_MAX_PER_CARD = 10;

export type CardTextLimits = {
  titleMaxChars: number;
  contentMaxChars: number;
  imagesMaxPerCard: number;
};

export function normalizeCardLineEndings(value: string): string {
  return value.replace(/\r\n?/gu, "\n");
}

export function normalizeCardBodyText(value: string | null | undefined): string {
  return normalizeCardLineEndings(value ?? "").trim();
}

export function countCardCharacters(value: string): number {
  return countGraphemes(normalizeCardLineEndings(value));
}

export function truncateCardCharacters(value: string, maxLength: number): string {
  return truncateGraphemes(normalizeCardLineEndings(value), maxLength);
}

export function normalizeCardTitleText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = normalizeCardLineEndings(value).normalize("NFKC").trim().replace(/\s+/gu, " ");
  return normalized || null;
}
