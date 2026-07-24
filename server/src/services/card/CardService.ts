import { countGraphemes, isUtf16GraphemeBoundary, truncateGraphemes } from "@lf/core/text/grapheme.js";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import type { CardRepository, CardEntryEntity } from "@lf/core/ports/repository/CardRepository.js";
import type { UserPreferenceRepository } from "@lf/core/ports/repository/UserPreferenceRepository.js";
import type {
  CreateCardEntryInput,
  CardRecordDetailView,
  CardRecordSummaryView,
  CardPracticeQueueItemView,
  CardPracticeResult,
  CardClozeState,
  UpdateCardClozeInput,
  CardTaskStatusView,
} from "@lf/core/types/cardRecord.js";
import { cardRecordId, parseCardRecordId } from "@lf/core/types/cardRecord.js";
import type { EntitlementService } from "../entitlement/EntitlementService.js";
import type { ContentSafetyService } from "../contentSafety/ContentSafetyService.js";
import type { ChatGenerationTaskGuard } from "../chat/ChatGenerationTaskGuard.js";
import { formatDateKeyInTimeZone } from "../time/businessClock.js";
import type { CardImageService } from "./CardImageService.js";
import { CARD_EXPRESSION_PROMPT_VERSION } from "@lf/core/Prompts/cardExpressionPrompt.js";
import { normalizePhraseSurface, PHRASE_NORMALIZER_VERSION } from "@lf/core/text/phraseNormalization.js";

const MAX_ORIGINAL_GRAPHEMES = 3_000;
const PREVIEW_GRAPHEMES = 240;
export const CARD_PROMPT_VERSION = CARD_EXPRESSION_PROMPT_VERSION;

export class CardValidationError extends Error {
  readonly code = "CARD_VALIDATION_FAILED";
}

export class CardTaskInProgressError extends Error {
  readonly code = "TASK_IN_PROGRESS";
}

export class CardImageNotReadyError extends Error {
  readonly code = "CARD_IMAGE_NOT_READY";
}

export class CardImageLimitExceededError extends Error {
  readonly code = "CARD_IMAGE_QUOTA_EXCEEDED";
}

export class CardClientIdConsumedError extends Error {
  readonly code = "CARD_CLIENT_ID_CONSUMED";
}

export class CardNotFoundError extends Error {
  readonly code = "CARD_NOT_FOUND";
}

export class CardPracticeConflictError extends Error {
  readonly code = "CARD_PRACTICE_CONFLICT";
}

export class CardService {
  constructor(
    private readonly repository: CardRepository,
    private readonly userPreferenceRepository: UserPreferenceRepository,
    private readonly entitlementService: EntitlementService,
    private readonly taskGuard: ChatGenerationTaskGuard,
    private readonly taskTtlMs: number,
    private readonly contentSafetyService?: ContentSafetyService,
    private readonly imageService?: CardImageService,
  ) {}

  async bootstrap(userId: string): Promise<CardRecordSummaryView[]> {
    if (await this.repository.hasAnyByUser(userId)) return [];
    const preference = await this.userPreferenceRepository.getByUserId(userId);
    const entries = await this.repository.createSamples({
      userId,
      dateKey: formatDateKeyInTimeZone(new Date()),
      languageCode: preference.learningLanguage,
      appLocaleSnapshot: preference.appLocale,
      promptDifficultySnapshot: preference.promptDifficulty,
      promptVersion: CARD_PROMPT_VERSION,
    });
    return entries.map(toSummary);
  }

  async create(input: {
    userId: string;
    requestId: string;
    body: CreateCardEntryInput;
  }): Promise<CardRecordSummaryView> {
    const clientId = input.body.clientId.trim();
    const originalText = input.body.originalText.trim();
    if (!clientId || clientId.length > 128) throw new CardValidationError("Invalid client id");
    const inputChars = countGraphemes(originalText);
    if (inputChars < 1 || inputChars > MAX_ORIGINAL_GRAPHEMES) {
      throw new CardValidationError("Original text must contain 1 to 3000 characters");
    }
    const imageUploadId = input.body.imageUploadId?.trim() || null;

    const duplicate = await this.repository.findByUserClientId(input.userId, clientId);
    if (duplicate) {
      if (duplicate.status === "failed" || duplicate.status === "deleted") {
        throw new CardClientIdConsumedError("Client id belongs to a terminal task");
      }
      return this.summaryWithImage(duplicate);
    }

    this.contentSafetyService?.assertAllowed(originalText, "input");
    await this.contentSafetyService?.assertAllowedRemote({
      text: originalText,
      stage: "input",
      requestId: input.requestId,
      userId: input.userId,
    });

    const preference = await this.userPreferenceRepository.getByUserId(input.userId);
    const dateKey = formatDateKeyInTimeZone(new Date());
    await this.entitlementService.assertCanUse(input.userId, inputChars, { dateKey });
    if (await this.repository.findActiveByUser(input.userId)) {
      throw new CardTaskInProgressError("A card task is already running");
    }

    const taskId = taskGuardId(clientId);
    const acquired = await this.taskGuard.acquire(input.userId, taskId, this.taskTtlMs);
    if (!acquired) throw new CardTaskInProgressError("An AI task is already running");

    try {
      const created = await this.repository.createQueued({
        userId: input.userId,
        dateKey,
        originalText,
        languageCode: preference.learningLanguage,
        appLocaleSnapshot: preference.appLocale,
        promptDifficultySnapshot: preference.promptDifficulty,
        promptVersion: CARD_PROMPT_VERSION,
        clientId,
        inputChars,
        imageUploadId,
      });
      return this.summaryWithImage(created);
    } catch (error) {
      await this.taskGuard.release(input.userId, taskId);
      const racedDuplicate = await this.repository.findByUserClientId(input.userId, clientId);
      if (racedDuplicate) {
        if (racedDuplicate.status === "failed" || racedDuplicate.status === "deleted") {
          throw new CardClientIdConsumedError("Client id belongs to a terminal task");
        }
        return this.summaryWithImage(racedDuplicate);
      }
      if (await this.repository.findActiveByUser(input.userId)) {
        throw new CardTaskInProgressError("A card task is already running");
      }
      if (error instanceof Error && error.message === "CARD_IMAGE_NOT_READY") {
        throw new CardImageNotReadyError("Image upload is not ready");
      }
      if (error instanceof Error && error.message === "CARD_IMAGE_QUOTA_EXCEEDED") {
        throw new CardImageLimitExceededError("Cloud image quota exceeded");
      }
      throw error;
    }
  }

  async listDate(userId: string, dateKey: string): Promise<CardRecordSummaryView[]> {
    assertDateKey(dateKey);
    const entries = await this.repository.listByUserDate(userId, dateKey, 200);
    return Promise.all(entries.map((entry) => this.summaryWithImage(entry)));
  }

  async listLibrary(
    userId: string,
    collectionId: string | null | undefined,
    limit: number,
  ): Promise<CardRecordSummaryView[]> {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 100;
    const entries = await this.repository.listByUser(userId, collectionId, safeLimit);
    return Promise.all(entries.map((entry) => this.summaryWithImage(entry)));
  }

  async listDateKeys(userId: string, fromDateKey: string, toDateKey: string): Promise<string[]> {
    assertDateKey(fromDateKey);
    assertDateKey(toDateKey);
    if (fromDateKey > toDateKey) throw new CardValidationError("Invalid date range");
    return this.repository.listDateKeysByUser(userId, fromDateKey, toDateKey);
  }

  async listRecent(userId: string, beforeDateKey: string, limit: number): Promise<CardRecordSummaryView[]> {
    assertDateKey(beforeDateKey);
    const safeLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(2, Math.floor(limit)))
      : 2;
    const entries = await this.repository.listRecentCompleted(userId, beforeDateKey, safeLimit);
    const records = (await Promise.all(entries.map((entry) => this.summaryWithImage(entry))))
      .filter((entry) => !entry.isSample)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      .slice(0, safeLimit);
    return records;
  }

  async detail(userId: string, recordId: string): Promise<CardRecordDetailView> {
    const parsed = parseCardRecordId(recordId);
    if (!parsed || parsed.source !== "card") throw new CardNotFoundError();
    const entry = await this.repository.findByIdForUser(parsed.sourceId, userId);
    if (!entry || entry.status !== "completed" || !entry.originalText || !entry.rewrittenText) {
      throw new CardNotFoundError();
    }
    const practiceState = await this.repository.findPracticeState(userId, entry.id);
    const imageViews = entry.image && this.imageService ? await this.imageService.views(entry.image) : null;
    return {
      ...toSummary(entry),
      thumbnail: imageViews?.thumbnail ?? null,
      status: "completed",
      originalText: entry.originalText,
      rewrittenText: entry.rewrittenText,
      rewriteSegments: entry.segments.map((segment) => ({
        id: segment.id,
        ordinal: segment.ordinal,
        text: segment.text,
        startUtf16: segment.startUtf16,
        endUtf16: segment.endUtf16,
      })),
      image: imageViews?.image ?? null,
      practice: toPracticeView(practiceState),
    };
  }

  async taskStatus(userId: string, recordId: string): Promise<CardTaskStatusView> {
    const parsed = parseCardRecordId(recordId);
    if (!parsed || parsed.source !== "card") throw new CardNotFoundError();
    const entry = await this.repository.findByIdForUser(parsed.sourceId, userId);
    if (!entry || entry.status === "deleted") throw new CardNotFoundError();
    return {
      recordId,
      status: entry.status,
      message: entry.status === "failed" ? "发送失败，请稍后重试" : null,
    };
  }

  async delete(userId: string, recordId: string): Promise<void> {
    const parsed = parseCardRecordId(recordId);
    if (!parsed || parsed.source !== "card") throw new CardNotFoundError();
    const deleted = await this.repository.markDeleted(parsed.sourceId, userId, new Date());
    if (!deleted) throw new CardNotFoundError();
  }

  async replaceImage(userId: string, recordId: string, imageUploadId: string | null): Promise<CardRecordDetailView> {
    const parsed = parseCardRecordId(recordId);
    if (!parsed || parsed.source !== "card") throw new CardNotFoundError();
    if (imageUploadId !== null && (!imageUploadId.trim() || imageUploadId.length > 128)) {
      throw new CardValidationError("Invalid image upload id");
    }
    try {
      const updated = await this.repository.replaceEntryImage({
        entryId: parsed.sourceId,
        userId,
        imageUploadId: imageUploadId?.trim() ?? null,
      });
      if (!updated) throw new CardNotFoundError();
    } catch (error) {
      if (error instanceof Error && error.message === "CARD_IMAGE_NOT_READY") {
        throw new CardImageNotReadyError("Image upload is not ready");
      }
      if (error instanceof Error && error.message === "CARD_IMAGE_QUOTA_EXCEEDED") {
        throw new CardImageLimitExceededError("Cloud image quota exceeded");
      }
      throw error;
    }
    return this.detail(userId, recordId);
  }

  async updateDictation(
    userId: string,
    recordId: string,
    result: CardPracticeResult,
  ): Promise<CardRecordDetailView["practice"]> {
    if (result !== "correct" && result !== "incorrect" && result !== "revealed") {
      throw new CardValidationError("Invalid dictation result");
    }
    const parsed = parseCardRecordId(recordId);
    if (!parsed || parsed.source !== "card") throw new CardNotFoundError();
    const entry = await this.repository.findByIdForUser(parsed.sourceId, userId);
    if (!entry || entry.status !== "completed") throw new CardNotFoundError();
    const current = await this.repository.findPracticeState(userId, parsed.sourceId);
    const correctStreak = result === "correct" ? (current?.dictationCorrectStreak ?? 0) + 1 : 0;
    const practicedAt = new Date();
    const nextReviewAt = new Date(practicedAt.getTime() + reviewDelayDays(result, correctStreak) * 86_400_000);
    const saved = await this.repository.saveDictationResult({
      userId,
      cardId: parsed.sourceId,
      result,
      practicedAt,
      nextReviewAt,
      correctStreak,
    });
    return toPracticeView(saved);
  }

  async updateCloze(
    userId: string,
    recordId: string,
    input: UpdateCardClozeInput,
  ): Promise<CardRecordDetailView["practice"]> {
    if (!Number.isInteger(input.baseVersion) || input.baseVersion < 0 || !isClozeOperation(input.operation)) {
      throw new CardValidationError("Invalid cloze update");
    }
    if (input.result !== undefined && !isPracticeResult(input.result)) {
      throw new CardValidationError("Invalid cloze result");
    }
    const parsed = parseCardRecordId(recordId);
    if (!parsed || parsed.source !== "card") throw new CardNotFoundError();
    const detail = await this.detail(userId, recordId);
    const current = await this.repository.findPracticeState(userId, parsed.sourceId);
    if ((current?.clozeVersion ?? 0) !== input.baseVersion) throw new CardPracticeConflictError();
    const state = normalizeClozeState(current?.clozeState);
    const operation = input.operation;
    let phraseMutation: Parameters<CardRepository["saveClozeState"]>[0]["phraseMutation"];
    if (operation.type === "add") {
      const segment = detail.rewriteSegments.find((candidate) => candidate.id === operation.segmentId);
      if (!segment) throw new CardValidationError("Cloze segment does not exist");
      const { startUtf16, endUtf16 } = operation;
      if (
        startUtf16 >= endUtf16 ||
        !isUtf16GraphemeBoundary(segment.text, startUtf16) ||
        !isUtf16GraphemeBoundary(segment.text, endUtf16)
      ) throw new CardValidationError("Invalid cloze range");
      const answer = segment.text.slice(startUtf16, endUtf16);
      if (countGraphemes(answer) > 100 || !answer.trim()) throw new CardValidationError("Invalid cloze range");
      const overlaps = state.blanks.some((blank) => blank.segmentId === segment.id && startUtf16 < blank.endUtf16 && endUtf16 > blank.startUtf16);
      if (overlaps) throw new CardValidationError("Cloze ranges cannot overlap");
      const blank = { id: randomUUID(), segmentId: segment.id, startUtf16, endUtf16, answer };
      state.blanks.push(blank);
      const normalizedText = normalizePhraseSurface(answer, detail.languageCode);
      if (!normalizedText) throw new CardValidationError("Invalid phrase content");
      phraseMutation = {
        type: "add",
        languageCode: detail.languageCode,
        cardCreatedAt: new Date(detail.createdAt),
        segmentId: segment.id,
        startUtf16,
        endUtf16,
        surfaceText: answer,
        normalizedText,
        clozeBlankId: blank.id,
        normalizerVersion: PHRASE_NORMALIZER_VERSION,
        inputHash: createHash("sha256").update(`${detail.languageCode}\n${normalizedText}`).digest("hex"),
      };
    } else if (operation.type === "remove") {
      const index = state.blanks.findIndex((blank) => blank.id === operation.blankId);
      if (index < 0) throw new CardValidationError("Cloze blank does not exist");
      state.blanks.splice(index, 1);
      phraseMutation = { type: "remove", clozeBlankId: operation.blankId };
    }
    const practicedAt = input.result ? new Date() : null;
    const correctStreak = input.result === "correct" ? (current?.clozeCorrectStreak ?? 0) + 1 : 0;
    const nextReviewAt = input.result && practicedAt
      ? new Date(practicedAt.getTime() + reviewDelayDays(input.result, correctStreak) * 86_400_000)
      : null;
    const saved = await this.repository.saveClozeState({
      userId,
      cardId: parsed.sourceId,
      expectedVersion: input.baseVersion,
      state,
      result: input.result ?? null,
      practicedAt,
      nextReviewAt,
      correctStreak,
      phraseMutation,
    });
    if (!saved) throw new CardPracticeConflictError();
    return toPracticeView(saved);
  }

  async practiceQueue(userId: string, limit: number): Promise<CardPracticeQueueItemView[]> {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.floor(limit))) : 20;
    const cardEntries = await this.repository.listRecentCompleted(userId, "9999-12-31", 100);
    const cardRecords = await Promise.all(cardEntries.filter((entry) => !entry.isSample).map((entry) => this.summaryWithImage(entry)));
    const records = cardRecords.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const now = Date.now();
    const items = await Promise.all(records.map(async (record) => {
      const parsed = parseCardRecordId(record.id)!;
      const state = await this.repository.findPracticeState(userId, parsed.sourceId);
      if (!state?.dictationCompleted) {
        return { record, initialTab: "dictation", reason: "try_dictation" } as const;
      }
      if (state.dictationLastResult !== "correct") {
        return { record, initialTab: "dictation", reason: "retry" } as const;
      }
      if ((state.dictationNextReviewAt?.getTime() ?? Infinity) <= now) {
        return { record, initialTab: "dictation", reason: "review" } as const;
      }
      return null;
    }));
    return items.filter((item): item is NonNullable<typeof item> => item !== null).slice(0, safeLimit);
  }

  private async summaryWithImage(entry: CardEntryEntity): Promise<CardRecordSummaryView> {
    const summary = toSummary(entry);
    if (!entry.image || !this.imageService) return summary;
    const views = await this.imageService.views(entry.image);
    return { ...summary, thumbnail: views.thumbnail };
  }
}

function reviewDelayDays(result: CardPracticeResult, correctStreak: number): number {
  if (result !== "correct") return 1;
  if (correctStreak <= 1) return 3;
  if (correctStreak === 2) return 7;
  return 14;
}

function isPracticeResult(value: unknown): value is CardPracticeResult {
  return value === "correct" || value === "incorrect" || value === "revealed";
}

function isClozeOperation(value: unknown): value is UpdateCardClozeInput["operation"] {
  if (!value || typeof value !== "object" || !("type" in value)) return false;
  if (value.type === "result") return true;
  if (value.type === "remove") return "blankId" in value && typeof value.blankId === "string" && Boolean(value.blankId.trim());
  return value.type === "add" &&
    "segmentId" in value && typeof value.segmentId === "string" && Boolean(value.segmentId.trim()) &&
    "startUtf16" in value && Number.isInteger(value.startUtf16) &&
    "endUtf16" in value && Number.isInteger(value.endUtf16);
}

function normalizeClozeState(value: unknown): CardClozeState {
  if (!value || typeof value !== "object" || !("schemaVersion" in value) || value.schemaVersion !== 1 || !("blanks" in value) || !Array.isArray(value.blanks)) {
    return { schemaVersion: 1, blanks: [] };
  }
  const blanks = value.blanks.filter((blank): blank is CardClozeState["blanks"][number] =>
    Boolean(blank) && typeof blank === "object" &&
    "id" in blank && typeof blank.id === "string" &&
    "segmentId" in blank && typeof blank.segmentId === "string" &&
    "startUtf16" in blank && Number.isInteger(blank.startUtf16) &&
    "endUtf16" in blank && Number.isInteger(blank.endUtf16) &&
    "answer" in blank && typeof blank.answer === "string"
  );
  return { schemaVersion: 1, blanks: [...blanks] };
}

function toPracticeView(
  state: Awaited<ReturnType<CardRepository["findPracticeState"]>>,
): CardRecordDetailView["practice"] {
  if (!state) return null;
  const nextDates = [state?.clozeNextReviewAt, state?.dictationNextReviewAt]
    .filter((value): value is Date => Boolean(value))
    .sort((left, right) => left.getTime() - right.getTime());
  return {
    hasCloze: Boolean(state.clozeState),
    dictationCompleted: state.dictationCompleted,
    nextReviewAt: nextDates[0]?.toISOString() ?? null,
    clozeState: state.clozeState,
    clozeVersion: state.clozeVersion,
    clozeLastResult: state.clozeLastResult,
    dictationLastResult: state.dictationLastResult,
  };
}

export function toSummary(entry: CardEntryEntity): CardRecordSummaryView {
  if (entry.status !== "queued" && entry.status !== "processing" && entry.status !== "completed") {
    throw new CardNotFoundError();
  }
  return {
    id: cardRecordId("card", entry.id),
    topic: entry.topic,
    collectionId: entry.collectionId,
    source: "card",
    dateKey: entry.dateKey,
    originalPreview: truncateGraphemes(entry.originalText ?? "", PREVIEW_GRAPHEMES),
    rewrittenPreview: entry.rewrittenText
      ? truncateGraphemes(entry.rewrittenText, PREVIEW_GRAPHEMES)
      : null,
    languageCode: entry.languageCode,
    status: entry.status,
    thumbnail: null,
    practiceSummary: null,
    isSample: entry.isSample,
    createdAt: entry.createdAt.toISOString(),
  };
}

export function taskGuardId(clientId: string): string {
  return `card:${clientId}`;
}

function assertDateKey(value: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new CardValidationError("Invalid date key");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  if (
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() !== month - 1 ||
    normalized.getUTCDate() !== day
  ) {
    throw new CardValidationError("Invalid date key");
  }
}
