import {
  cardRecordId as encodeCardRecordId,
  parseCardRecordId as decodeCardRecordId,
  type CardRecordId as OpaqueCardRecordId,
} from "./card.js";

export type CardRecordSource = "card";
export type CardEntryStatus = "queued" | "processing" | "completed" | "failed" | "deleted";
export type CardTaskStatus = Exclude<CardEntryStatus, "deleted">;
export type CardPracticeResult = "correct" | "incorrect" | "revealed";
export type CardLearningContentType = "original" | "rewrite" | "reply";

export interface CardClozeBlank {
  id: string;
  segmentId: string;
  startUtf16: number;
  endUtf16: number;
  answer: string;
  mastered?: boolean;
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

export interface CardContentBlockView {
  contentType: CardLearningContentType;
  contentVersion: string;
  text: string;
  languageCode: string;
  segments: CardRewriteSegmentView[];
  practice: CardPracticeView | null;
}

export interface CardImageThumbnailView {
  id: string;
  url: string;
  urlExpiresAt: string | null;
  width: number;
  height: number;
}

export interface CardImageDetailView extends CardImageThumbnailView {
  aspect: "3:2" | "4:5" | null;
  /** Smaller rendition for inline Card galleries; use `url` for full-screen viewing. */
  thumbnail?: CardImageThumbnailView | null;
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
  title: string | null;
  displayTitle: string;
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
  rewrittenLanguageCode: string | null;
  translationText: string | null;
  translationLanguageCode: string | null;
  replyText: string | null;
  replyLanguageCode: string | null;
  rewriteSegments: CardRewriteSegmentView[];
  contentBlocks: CardContentBlockView[];
  images: CardImageDetailView[];
  /** Compatibility field for clients before multi-image Card support. */
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
  contentType?: CardLearningContentType;
  contentVersion?: string;
}

export type UpdateCardClozeInput = {
  contentType?: CardLearningContentType;
  contentVersion?: string;
  baseVersion: number;
  operation:
    | { type: "add"; segmentId: string; startUtf16: number; endUtf16: number }
    | { type: "remove"; blankId: string }
    | { type: "master"; blankId: string }
    | { type: "result" };
  result?: CardPracticeResult;
};

export interface CreateCardEntryInput {
  clientId: string;
  collectionId?: string | null;
  title?: string | null;
  originalText?: string | null;
  rewrittenText?: string | null;
  translationText?: string | null;
  replyText?: string | null;
  generateRewrite?: boolean;
  imageUploadIds?: string[];
  imageUploadId?: string | null;
}

export interface UpdateCardContentInput {
  collectionId?: string | null;
  title?: string | null;
  originalText?: string | null;
  rewrittenText?: string | null;
  translationText?: string | null;
  replyText?: string | null;
}

export interface SaveCardContentInput {
  collectionId?: string | null;
  title?: string | null;
  originalText: string;
  selectedTargets: Array<"expression" | "translation" | "reply">;
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
