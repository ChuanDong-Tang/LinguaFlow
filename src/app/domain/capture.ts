export interface CaptureItem {
  id: string;
  sourceText: string;
  correctedText: string;
  note: string;
}

export interface DailyCaptureRecord {
  dateKey: string;
  updatedAt: string;
  items: CaptureItem[];
}
