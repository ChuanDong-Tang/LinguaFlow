import type { CardEntryStatus, CardPracticeResult } from "../../types/cardRecord.js";
import type { AppLocale } from "./UserPreferenceRepository.js";

export interface CardSegmentEntity {
  id: string;
  entryId: string;
  ordinal: number;
  text: string;
  startUtf16: number;
  endUtf16: number;
  createdAt: Date;
}

export interface CardEntryEntity {
  id: string;
  userId: string;
  dateKey: string;
  originalText: string | null;
  rewrittenText: string | null;
  languageCode: string;
  appLocaleSnapshot: AppLocale;
  promptDifficultySnapshot: string;
  promptVersion: string;
  status: CardEntryStatus;
  clientId: string;
  inputChars: number;
  outputChars: number;
  isSample: boolean;
  topic: string | null;
  topicEditedAt: Date | null;
  collectionId: string | null;
  publishedAt: Date | null;
  processingAt: Date | null;
  leaseExpiresAt: Date | null;
  workerId: string | null;
  failedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  segments: CardSegmentEntity[];
  image: CardImageAssetEntity | null;
}

export interface CardPracticeStateEntity {
  id: string;
  userId: string;
  cardId: string;
  clozeState: unknown | null;
  clozeVersion: number;
  clozeLastResult: CardPracticeResult | null;
  clozeNextReviewAt: Date | null;
  clozeCorrectStreak: number;
  dictationCompleted: boolean;
  dictationLastResult: CardPracticeResult | null;
  dictationCorrectStreak: number;
  dictationNextReviewAt: Date | null;
}

export interface CardSpeechAssetEntity {
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

export interface CardImageAssetEntity {
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
}

export interface CreateQueuedCardEntryInput {
  userId: string;
  dateKey: string;
  originalText: string;
  languageCode: string;
  appLocaleSnapshot: AppLocale;
  promptDifficultySnapshot: string;
  promptVersion: string;
  clientId: string;
  inputChars: number;
  imageUploadId?: string | null;
}

export interface CompleteCardEntryInput {
  entryId: string;
  workerId: string;
  rewrittenText: string;
  topic: string;
  embeddingInputHash: string;
  embeddingInputVersion: string;
  outputChars: number;
  publishedAt: Date;
  segments: Array<{
    ordinal: number;
    text: string;
    startUtf16: number;
    endUtf16: number;
  }>;
}

export interface CardRepository {
  hasAnyByUser(userId: string): Promise<boolean>;
  createSamples(input: {
    userId: string;
    dateKey: string;
    languageCode: string;
    appLocaleSnapshot: AppLocale;
    promptDifficultySnapshot: string;
    promptVersion: string;
  }): Promise<CardEntryEntity[]>;
  createQueued(input: CreateQueuedCardEntryInput): Promise<CardEntryEntity>;
  findByUserClientId(userId: string, clientId: string): Promise<CardEntryEntity | null>;
  findByIdForUser(entryId: string, userId: string): Promise<CardEntryEntity | null>;
  findActiveByUser(userId: string): Promise<CardEntryEntity | null>;
  listByUserDate(userId: string, dateKey: string, limit: number): Promise<CardEntryEntity[]>;
  listByUser(
    userId: string,
    collectionId: string | null | undefined,
    limit: number,
  ): Promise<CardEntryEntity[]>;
  listDateKeysByUser(userId: string, fromDateKey: string, toDateKey: string): Promise<string[]>;
  listRecentCompleted(userId: string, beforeDateKey: string, limit: number): Promise<CardEntryEntity[]>;
  claimNextQueued(workerId: string, leaseExpiresAt: Date): Promise<CardEntryEntity | null>;
  renewLease(entryId: string, workerId: string, leaseExpiresAt: Date): Promise<boolean>;
  complete(input: CompleteCardEntryInput): Promise<CardEntryEntity>;
  markFailedAndScrub(
    entryId: string,
    workerId: string | null,
    failedAt: Date,
    leaseExpiredBefore?: Date,
  ): Promise<CardEntryEntity | null>;
  listExpiredProcessing(now: Date, limit: number): Promise<CardEntryEntity[]>;
  markDeleted(entryId: string, userId: string, deletedAt: Date): Promise<boolean>;
  findPracticeState(userId: string, cardId: string): Promise<CardPracticeStateEntity | null>;
  saveDictationResult(input: {
    userId: string;
    cardId: string;
    result: CardPracticeResult;
    practicedAt: Date;
    nextReviewAt: Date;
    correctStreak: number;
  }): Promise<CardPracticeStateEntity>;
  saveClozeState(input: {
    userId: string;
    cardId: string;
    expectedVersion: number;
    state: unknown;
    result: CardPracticeResult | null;
    practicedAt: Date | null;
    nextReviewAt: Date | null;
    correctStreak: number;
    phraseMutation?:
      | {
          type: "add";
          languageCode: string;
          cardCreatedAt: Date;
          segmentId: string;
          startUtf16: number;
          endUtf16: number;
          surfaceText: string;
          normalizedText: string;
          clozeBlankId: string;
          normalizerVersion: string;
          inputHash: string;
        }
      | { type: "remove"; clozeBlankId: string };
  }): Promise<CardPracticeStateEntity | null>;
  deleteFailedTombstonesBefore(before: Date, limit: number): Promise<number>;
  findReadySpeechAsset(cacheKey: string): Promise<CardSpeechAssetEntity | null>;
  saveReadySpeechAsset(input: Omit<CardSpeechAssetEntity, "id">): Promise<CardSpeechAssetEntity>;
  updateSpeechAssetUrl(
    id: string,
    objectUrl: string | null,
    objectUrlExpiresAt: Date | null,
  ): Promise<CardSpeechAssetEntity>;
  listSpeechAssetsForCleanup(staleDictionaryBefore: Date, limit: number): Promise<CardSpeechAssetEntity[]>;
  claimSpeechAssetCleanup(id: string, staleDictionaryBefore: Date): Promise<boolean>;
  deleteSpeechAsset(id: string, staleDictionaryBefore: Date): Promise<boolean>;
  createImageUploadWithinQuota(input: {
    id: string;
    userId: string;
    quotaDateKey: string;
    objectKey: string;
    mimeType: string;
    fileSize: number;
    width: number;
    height: number;
    expiresAt: Date;
  }): Promise<CardImageAssetEntity | null>;
  findImageUpload(id: string, userId: string): Promise<CardImageAssetEntity | null>;
  updateImageUploadModeration(input: {
    id: string;
    userId: string;
    status: string;
    fileMd5: string;
    moderationRequestId?: string | null;
    moderationSuggestion?: string | null;
    moderationLabel?: string | null;
    originalObjectKey?: string;
  }): Promise<CardImageAssetEntity | null>;
  markImageUploadCleanup(id: string, userId: string): Promise<CardImageAssetEntity | null>;
  updateImageThumbnail(input: {
    id: string;
    userId: string;
    thumbnailObjectKey: string;
    thumbnailVersion: number;
  }): Promise<CardImageAssetEntity | null>;
  listImageAssetsForCleanup(now: Date, limit: number): Promise<CardImageAssetEntity[]>;
  deleteUnclaimedImageAsset(id: string): Promise<boolean>;
  listImageUploadObjectsForCleanup(limit: number): Promise<CardImageAssetEntity[]>;
  clearImageUploadObjectKey(id: string, objectKey: string): Promise<boolean>;
  replaceEntryImage(input: {
    entryId: string;
    userId: string;
    imageUploadId: string | null;
  }): Promise<CardEntryEntity | null>;
}
