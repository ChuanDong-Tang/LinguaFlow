export type CaptureKeyPhraseSource = "natural_version";

export interface CaptureItem {
  id: string;
  chatSessionId?: string;
  chatTurnId?: string;
  createdAt?: string;
  sourceText?: string;
  naturalVersion?: string;
  reply?: string;
  keyPhrases?: string[];
  keyPhraseSource?: CaptureKeyPhraseSource;
  note?: string;
}

export interface DailyCaptureRecord {
  dateKey: string;
  updatedAt: string;
  items: CaptureItem[];
}

export function getCaptureNaturalVersion(item: CaptureItem): string {
  return item.naturalVersion?.trim() || "";
}

export function getCaptureKeyPhrases(item: CaptureItem): string[] {
  return Array.isArray(item.keyPhrases) ? item.keyPhrases.filter((phrase) => typeof phrase === "string" && phrase.trim()) : [];
}
