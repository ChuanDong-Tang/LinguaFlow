import {
  cardRecordId as encodeCardRecordId,
  parseCardRecordId as decodeCardRecordId,
  type CardRecordId as OpaqueCardRecordId,
} from "./card.js";

export type CardRecordSource = "card";
export type CardEntryStatus = "queued" | "processing" | "completed" | "failed" | "deleted";
export type CardTaskStatus = Exclude<CardEntryStatus, "deleted">;
export type CardPracticeResult = "correct" | "incorrect" | "revealed";

export interface CardClozeBlank {
  id: string;
  segmentId: string;
  startUtf16: number;
  endUtf16: number;
  answer: string;
}

export interface CardClozeState {
  schemaVersion: 1;
  blanks: CardClozeBlank[];
}

export type CardRecordId = OpaqueCardRecordId;

export interface CardRewriteSegmentView {
  id: string;
  ordinal: number;
  text: string;
  startUtf16: number;
  endUtf16: number;
}

export interface CardImageThumbnailView {
  url: string;
  urlExpiresAt: string | null;
  width: number;
  height: number;
}

export interface CardImageDetailView extends CardImageThumbnailView {
  aspect: "3:2" | "4:5" | null;
}

export interface CardPracticeSummaryView {
  hasCloze: boolean;
  dictationCompleted: boolean;
  nextReviewAt: string | null;
}

export interface CardPracticeView extends CardPracticeSummaryView {
  clozeState: CardClozeState | unknown | null;
  clozeVersion: number;
  clozeLastResult: CardPracticeResult | null;
  dictationLastResult: CardPracticeResult | null;
}

export interface CardRecordSummaryView {
  id: CardRecordId;
  topic: string | null;
  collectionId: string | null;
  source: CardRecordSource;
  dateKey: string;
  originalPreview: string;
  rewrittenPreview: string | null;
  languageCode: string;
  status: "queued" | "processing" | "completed";
  thumbnail: CardImageThumbnailView | null;
  practiceSummary: CardPracticeSummaryView | null;
  isSample: boolean;
  createdAt: string;
}

export interface CardRecordDetailView extends CardRecordSummaryView {
  originalText: string;
  rewrittenText: string | null;
  rewriteSegments: CardRewriteSegmentView[];
  image: CardImageDetailView | null;
  practice: CardPracticeView | null;
}

export interface CardTaskStatusView {
  recordId: CardRecordId;
  status: CardTaskStatus;
  message: string | null;
}

export interface CardPracticeQueueItemView {
  record: CardRecordSummaryView;
  initialTab: "cloze" | "dictation";
  reason: "continue_cloze" | "retry" | "try_dictation" | "review";
}

export interface UpdateCardDictationInput {
  result: CardPracticeResult;
}

export type UpdateCardClozeInput = {
  baseVersion: number;
  operation:
    | { type: "add"; segmentId: string; startUtf16: number; endUtf16: number }
    | { type: "remove"; blankId: string }
    | { type: "result" };
  result?: CardPracticeResult;
};

export interface CreateCardEntryInput {
  clientId: string;
  originalText: string;
  imageUploadId?: string | null;
}

export interface RecordDetailOpenOptions {
  recordId: CardRecordId;
  initialTab: "review" | "cloze" | "dictation";
  practiceSession?: {
    recordIds: CardRecordId[];
    currentIndex: number;
  };
}

export function cardRecordId(source: CardRecordSource, sourceId: string): CardRecordId {
  return encodeCardRecordId({ sourceKind: source, sourceId });
}

export function parseCardRecordId(value: string): { source: CardRecordSource; sourceId: string } | null {
  const parsed = decodeCardRecordId(value);
  if (!parsed) return null;
  return { source: parsed.sourceKind, sourceId: parsed.sourceId };
}
