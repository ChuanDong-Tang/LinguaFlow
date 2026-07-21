export type JournalRecordSource = "journal" | "legacy_cloud" | "legacy_local";
export type JournalEntryStatus = "queued" | "processing" | "completed" | "failed" | "deleted";
export type JournalTaskStatus = Exclude<JournalEntryStatus, "deleted">;
export type JournalPracticeResult = "correct" | "incorrect" | "revealed";

export interface JournalClozeBlank {
  id: string;
  segmentId: string;
  startUtf16: number;
  endUtf16: number;
  answer: string;
}

export interface JournalClozeState {
  schemaVersion: 1;
  blanks: JournalClozeBlank[];
}

export type JournalRecordId = string;

export interface JournalRewriteSegmentView {
  id: string;
  ordinal: number;
  text: string;
  startUtf16: number;
  endUtf16: number;
}

export interface JournalImageThumbnailView {
  url: string;
  urlExpiresAt: string | null;
  width: number;
  height: number;
}

export interface JournalImageDetailView extends JournalImageThumbnailView {
  aspect: "3:2" | "4:5" | null;
}

export interface JournalPracticeSummaryView {
  hasCloze: boolean;
  dictationCompleted: boolean;
  nextReviewAt: string | null;
}

export interface JournalPracticeView extends JournalPracticeSummaryView {
  clozeState: JournalClozeState | unknown | null;
  clozeVersion: number;
  clozeLastResult: JournalPracticeResult | null;
  dictationLastResult: JournalPracticeResult | null;
}

export interface JournalRecordSummaryView {
  id: JournalRecordId;
  source: JournalRecordSource;
  dateKey: string;
  originalPreview: string;
  rewrittenPreview: string | null;
  languageCode: string;
  status: "queued" | "processing" | "completed";
  thumbnail: JournalImageThumbnailView | null;
  practiceSummary: JournalPracticeSummaryView | null;
  isSample: boolean;
  createdAt: string;
}

export interface JournalRecordDetailView extends JournalRecordSummaryView {
  originalText: string;
  rewrittenText: string | null;
  rewriteSegments: JournalRewriteSegmentView[];
  image: JournalImageDetailView | null;
  practice: JournalPracticeView | null;
}

export interface JournalTaskStatusView {
  recordId: JournalRecordId;
  status: JournalTaskStatus;
  message: string | null;
}

export interface JournalPracticeQueueItemView {
  record: JournalRecordSummaryView;
  initialTab: "cloze" | "dictation";
  reason: "continue_cloze" | "retry" | "try_dictation" | "review";
}

export interface UpdateJournalDictationInput {
  result: JournalPracticeResult;
}

export type UpdateJournalClozeInput = {
  baseVersion: number;
  operation:
    | { type: "add"; segmentId: string; startUtf16: number; endUtf16: number }
    | { type: "remove"; blankId: string }
    | { type: "result" };
  result?: JournalPracticeResult;
};

export interface CreateJournalEntryInput {
  clientId: string;
  originalText: string;
  imageUploadId?: string | null;
}

export interface RecordDetailOpenOptions {
  recordId: JournalRecordId;
  initialTab: "review" | "cloze" | "dictation";
  practiceSession?: {
    recordIds: JournalRecordId[];
    currentIndex: number;
  };
}

export function journalRecordId(source: JournalRecordSource, sourceId: string): JournalRecordId {
  return `${source}:${sourceId}`;
}

export function parseJournalRecordId(value: string): { source: JournalRecordSource; sourceId: string } | null {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) return null;
  const source = value.slice(0, separator);
  if (source !== "journal" && source !== "legacy_cloud" && source !== "legacy_local") return null;
  return { source, sourceId: value.slice(separator + 1) };
}
