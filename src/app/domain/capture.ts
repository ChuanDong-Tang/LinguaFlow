export type CaptureMode = "rewrite" | "ask";
export type CaptureKeyPhraseSource = "natural_version" | "answer";

export interface CaptureItem {
  id: string;
  mode?: CaptureMode;
  sourceText: string;
  naturalVersion?: string;
  correctedText?: string;
  answer?: string;
  keyPhrases?: string[];
  keyPhraseSource?: CaptureKeyPhraseSource;
  quickNote?: string;
  note?: string;
}

export interface DailyCaptureRecord {
  dateKey: string;
  updatedAt: string;
  items: CaptureItem[];
}

export function getCaptureNaturalVersion(item: CaptureItem): string {
  return item.naturalVersion?.trim() || item.correctedText?.trim() || "";
}

export function getCaptureKeyPhrases(item: CaptureItem): string[] {
  return Array.isArray(item.keyPhrases) ? item.keyPhrases.filter((phrase) => typeof phrase === "string" && phrase.trim()) : [];
}
