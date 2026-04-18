export type CaptureKeyPhraseSource = "natural_version" | "user_selected";

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
  practiceBlankIndexes?: number[];
  note?: string;
}

export interface DailyCaptureRecord {
  dateKey: string;
  updatedAt: string;
  items: CaptureItem[];
}

export function getCapturePracticeBlankIndexes(item: CaptureItem): number[] {
  return Array.isArray(item.practiceBlankIndexes)
    ? item.practiceBlankIndexes
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value >= 0)
      .map((value) => Math.floor(value))
    : [];
}
