import type { JournalEntryStatus } from "../../types/journal.js";
import type { JournalPracticeResult } from "../../types/journal.js";

export interface JournalSegmentEntity {
  id: string;
  entryId: string;
  ordinal: number;
  text: string;
  startUtf16: number;
  endUtf16: number;
  createdAt: Date;
}

export interface JournalEntryEntity {
  id: string;
  userId: string;
  dateKey: string;
  originalText: string | null;
  rewrittenText: string | null;
  languageCode: string;
  promptDifficultySnapshot: string;
  promptVersion: string;
  status: JournalEntryStatus;
  clientId: string;
  inputChars: number;
  outputChars: number;
  isSample: boolean;
  sampleImageKey: string | null;
  publishedAt: Date | null;
  processingAt: Date | null;
  leaseExpiresAt: Date | null;
  workerId: string | null;
  failedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  segments: JournalSegmentEntity[];
  image: JournalImageAssetEntity | null;
}

export interface JournalPracticeStateEntity {
  id: string;
  userId: string;
  sourceKind: "journal" | "legacy_cloud";
  sourceId: string;
  clozeState: unknown | null;
  clozeVersion: number;
  clozeLastResult: JournalPracticeResult | null;
  clozeNextReviewAt: Date | null;
  clozeCorrectStreak: number;
  dictationCompleted: boolean;
  dictationLastResult: JournalPracticeResult | null;
  dictationPracticeCount: number;
  dictationCorrectStreak: number;
  dictationNextReviewAt: Date | null;
}

export interface JournalSpeechAssetEntity {
  id: string;
  userId: string;
  entryId: string | null;
  segmentId: string | null;
  sourceKind: "review_segment" | "dictation_sentence" | "dictionary_term";
  cacheKey: string;
  provider: string;
  voiceCode: string;
  languageCode: string;
  sourceText: string;
  sourceTextHash: string;
  objectKey: string;
  objectUrl: string | null;
  objectUrlExpiresAt: Date | null;
  durationMs: number | null;
  wordMarks: unknown;
  sentenceMarks: unknown;
}

export interface JournalImageAssetEntity {
  id: string;
  userId: string;
  entryId: string | null;
  status: string;
  originalObjectKey: string;
  uploadObjectKey: string | null;
  thumbnailObjectKey: string | null;
  thumbnailStatus: string;
  thumbnailVersion: number;
  mimeType: string;
  fileSize: number;
  width: number;
  height: number;
  fileMd5: string | null;
  moderationRequestId: string | null;
  moderationSuggestion: string | null;
  moderationLabel: string | null;
  expiresAt: Date;
  claimedAt: Date | null;
  focalPointX: number | null;
  focalPointY: number | null;
}

export interface CreateQueuedJournalEntryInput {
  userId: string;
  dateKey: string;
  originalText: string;
  languageCode: string;
  promptDifficultySnapshot: string;
  promptVersion: string;
  clientId: string;
  inputChars: number;
  imageUploadId?: string | null;
}

export interface CompleteJournalEntryInput {
  entryId: string;
  workerId: string;
  rewrittenText: string;
  outputChars: number;
  publishedAt: Date;
  segments: Array<{
    ordinal: number;
    text: string;
    startUtf16: number;
    endUtf16: number;
  }>;
}

export interface JournalRepository {
  hasAnyByUser(userId: string): Promise<boolean>;
  createSamples(input: {
    userId: string;
    dateKey: string;
    languageCode: string;
    promptDifficultySnapshot: string;
    promptVersion: string;
  }): Promise<JournalEntryEntity[]>;
  createQueued(input: CreateQueuedJournalEntryInput): Promise<JournalEntryEntity>;
  findByUserClientId(userId: string, clientId: string): Promise<JournalEntryEntity | null>;
  findByIdForUser(entryId: string, userId: string): Promise<JournalEntryEntity | null>;
  findActiveByUser(userId: string): Promise<JournalEntryEntity | null>;
  listByUserDate(userId: string, dateKey: string, limit: number): Promise<JournalEntryEntity[]>;
  listDateKeysByUser(userId: string, fromDateKey: string, toDateKey: string): Promise<string[]>;
  listRecentCompleted(userId: string, beforeDateKey: string, limit: number): Promise<JournalEntryEntity[]>;
  claimNextQueued(workerId: string, leaseExpiresAt: Date): Promise<JournalEntryEntity | null>;
  renewLease(entryId: string, workerId: string, leaseExpiresAt: Date): Promise<boolean>;
  complete(input: CompleteJournalEntryInput): Promise<JournalEntryEntity>;
  markFailedAndScrub(
    entryId: string,
    workerId: string | null,
    failedAt: Date,
    leaseExpiredBefore?: Date,
  ): Promise<JournalEntryEntity | null>;
  listExpiredProcessing(now: Date, limit: number): Promise<JournalEntryEntity[]>;
  markDeleted(entryId: string, userId: string, deletedAt: Date): Promise<boolean>;
  hideLegacy(userId: string, assistantMessageId: string): Promise<void>;
  isLegacyHidden(userId: string, assistantMessageId: string): Promise<boolean>;
  findPracticeState(
    userId: string,
    sourceKind: "journal" | "legacy_cloud",
    sourceId: string,
  ): Promise<JournalPracticeStateEntity | null>;
  saveDictationResult(input: {
    userId: string;
    sourceKind: "journal" | "legacy_cloud";
    sourceId: string;
    result: JournalPracticeResult;
    practicedAt: Date;
    nextReviewAt: Date;
    correctStreak: number;
  }): Promise<JournalPracticeStateEntity>;
  saveClozeState(input: {
    userId: string;
    sourceKind: "journal" | "legacy_cloud";
    sourceId: string;
    expectedVersion: number;
    state: unknown;
    result: JournalPracticeResult | null;
    practicedAt: Date | null;
    nextReviewAt: Date | null;
    correctStreak: number;
  }): Promise<JournalPracticeStateEntity | null>;
  deleteFailedTombstonesBefore(before: Date, limit: number): Promise<number>;
  findReadySpeechAsset(cacheKey: string): Promise<JournalSpeechAssetEntity | null>;
  saveReadySpeechAsset(input: Omit<JournalSpeechAssetEntity, "id">): Promise<JournalSpeechAssetEntity>;
  updateSpeechAssetUrl(
    id: string,
    objectUrl: string | null,
    objectUrlExpiresAt: Date | null,
  ): Promise<JournalSpeechAssetEntity>;
  listSpeechAssetsForCleanup(staleDictionaryBefore: Date, limit: number): Promise<JournalSpeechAssetEntity[]>;
  claimSpeechAssetCleanup(id: string, staleDictionaryBefore: Date): Promise<boolean>;
  deleteSpeechAsset(id: string, staleDictionaryBefore: Date): Promise<boolean>;
  createImageUpload(input: {
    id: string;
    userId: string;
    objectKey: string;
    mimeType: string;
    fileSize: number;
    width: number;
    height: number;
    expiresAt: Date;
  }): Promise<JournalImageAssetEntity>;
  findImageUpload(id: string, userId: string): Promise<JournalImageAssetEntity | null>;
  updateImageUploadModeration(input: {
    id: string;
    userId: string;
    status: string;
    fileMd5: string;
    moderationRequestId?: string | null;
    moderationSuggestion?: string | null;
    moderationLabel?: string | null;
    originalObjectKey?: string;
  }): Promise<JournalImageAssetEntity | null>;
  markImageUploadCleanup(id: string, userId: string): Promise<JournalImageAssetEntity | null>;
  updateImageThumbnail(input: {
    id: string;
    userId: string;
    thumbnailObjectKey: string;
    thumbnailVersion: number;
  }): Promise<JournalImageAssetEntity | null>;
  listImageAssetsForCleanup(now: Date, limit: number): Promise<JournalImageAssetEntity[]>;
  deleteUnclaimedImageAsset(id: string): Promise<boolean>;
  listImageUploadObjectsForCleanup(limit: number): Promise<JournalImageAssetEntity[]>;
  clearImageUploadObjectKey(id: string, objectKey: string): Promise<boolean>;
  replaceEntryImage(input: {
    entryId: string;
    userId: string;
    imageUploadId: string | null;
  }): Promise<JournalEntryEntity | null>;
}
