import { countGraphemes, isUtf16GraphemeBoundary, truncateGraphemes } from "@lf/core/text/grapheme.js";
import { randomUUID } from "node:crypto";
import type { JournalRepository, JournalEntryEntity } from "@lf/core/ports/repository/JournalRepository.js";
import type { UserPreferenceRepository } from "@lf/core/ports/repository/UserPreferenceRepository.js";
import type { MessageEntity, MessageRepository } from "@lf/core/ports/repository/MessageRepository.js";
import type {
  CreateJournalEntryInput,
  JournalRecordDetailView,
  JournalRecordSummaryView,
  JournalPracticeQueueItemView,
  JournalPracticeResult,
  JournalClozeState,
  UpdateJournalClozeInput,
  JournalTaskStatusView,
} from "@lf/core/types/journal.js";
import { journalRecordId, parseJournalRecordId } from "@lf/core/types/journal.js";
import type { EntitlementService } from "../entitlement/EntitlementService.js";
import type { ContentSafetyService } from "../contentSafety/ContentSafetyService.js";
import type { ChatGenerationTaskGuard } from "../chat/ChatGenerationTaskGuard.js";
import { formatDateKeyInTimeZone } from "../time/businessClock.js";
import { dateKeyRangeInBusinessTimeZone } from "../time/businessClock.js";
import { parseTaggedRewriteOutput } from "@lf/core/Prompts/rewriteAssistantPrompt.js";
import { segmentLearningSentences } from "@lf/core/text/learningText.js";
import type { JournalImageService } from "./JournalImageService.js";

const MAX_ORIGINAL_GRAPHEMES = 3_000;
const PREVIEW_GRAPHEMES = 240;
export const JOURNAL_PROMPT_VERSION = "journal_rewrite_v1";

export class JournalValidationError extends Error {
  readonly code = "JOURNAL_VALIDATION_FAILED";
}

export class JournalTaskInProgressError extends Error {
  readonly code = "TASK_IN_PROGRESS";
}

export class JournalImageNotReadyError extends Error {
  readonly code = "JOURNAL_IMAGE_NOT_READY";
}

export class JournalClientIdConsumedError extends Error {
  readonly code = "JOURNAL_CLIENT_ID_CONSUMED";
}

export class JournalNotFoundError extends Error {
  readonly code = "JOURNAL_NOT_FOUND";
}

export class JournalPracticeConflictError extends Error {
  readonly code = "JOURNAL_PRACTICE_CONFLICT";
}

export class JournalCloudSyncRequiredError extends Error {
  readonly code = "JOURNAL_CLOUD_SYNC_REQUIRED";
}

export class JournalService {
  constructor(
    private readonly repository: JournalRepository,
    private readonly userPreferenceRepository: UserPreferenceRepository,
    private readonly entitlementService: EntitlementService,
    private readonly taskGuard: ChatGenerationTaskGuard,
    private readonly taskTtlMs: number,
    private readonly contentSafetyService?: ContentSafetyService,
    private readonly messageRepository?: MessageRepository,
    private readonly imageService?: JournalImageService,
  ) {}

  async assertCloudSyncAccess(userId: string): Promise<void> {
    const entitlement = await this.entitlementService.getCurrentEntitlement(userId);
    if (!entitlement.features.cloudSync) throw new JournalCloudSyncRequiredError("Cloud sync membership required");
  }

  async bootstrap(userId: string, hasLegacyLocalHistory: boolean): Promise<JournalRecordSummaryView[]> {
    if (hasLegacyLocalHistory || await this.repository.hasAnyByUser(userId)) return [];
    if (this.messageRepository) {
      const candidates = await this.messageRepository.listSuccessfulByUserBefore(
        userId,
        new Date(Date.now() + 24 * 60 * 60 * 1_000),
        400,
      );
      if (pairLegacyMessages(candidates).length) return [];
    }
    const preference = await this.userPreferenceRepository.getByUserId(userId);
    const entries = await this.repository.createSamples({
      userId,
      dateKey: formatDateKeyInTimeZone(new Date()),
      languageCode: preference.learningLanguage,
      promptDifficultySnapshot: preference.promptDifficulty,
      promptVersion: JOURNAL_PROMPT_VERSION,
    });
    return entries.map(toSummary);
  }

  async create(input: {
    userId: string;
    requestId: string;
    body: CreateJournalEntryInput;
  }): Promise<JournalRecordSummaryView> {
    const clientId = input.body.clientId.trim();
    const originalText = input.body.originalText.trim();
    if (!clientId || clientId.length > 128) throw new JournalValidationError("Invalid client id");
    const inputChars = countGraphemes(originalText);
    if (inputChars < 1 || inputChars > MAX_ORIGINAL_GRAPHEMES) {
      throw new JournalValidationError("Original text must contain 1 to 3000 characters");
    }
    const imageUploadId = input.body.imageUploadId?.trim() || null;

    const duplicate = await this.repository.findByUserClientId(input.userId, clientId);
    if (duplicate) {
      if (duplicate.status === "failed" || duplicate.status === "deleted") {
        throw new JournalClientIdConsumedError("Client id belongs to a terminal task");
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
      throw new JournalTaskInProgressError("A journal task is already running");
    }

    const taskId = taskGuardId(clientId);
    const acquired = await this.taskGuard.acquire(input.userId, taskId, this.taskTtlMs);
    if (!acquired) throw new JournalTaskInProgressError("An AI task is already running");

    try {
      const created = await this.repository.createQueued({
        userId: input.userId,
        dateKey,
        originalText,
        languageCode: preference.learningLanguage,
        promptDifficultySnapshot: preference.promptDifficulty,
        promptVersion: JOURNAL_PROMPT_VERSION,
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
          throw new JournalClientIdConsumedError("Client id belongs to a terminal task");
        }
        return this.summaryWithImage(racedDuplicate);
      }
      if (await this.repository.findActiveByUser(input.userId)) {
        throw new JournalTaskInProgressError("A journal task is already running");
      }
      if (error instanceof Error && error.message === "JOURNAL_IMAGE_NOT_READY") {
        throw new JournalImageNotReadyError("Image upload is not ready");
      }
      throw error;
    }
  }

  async listDate(userId: string, dateKey: string): Promise<JournalRecordSummaryView[]> {
    assertDateKey(dateKey);
    const entries = await this.repository.listByUserDate(userId, dateKey, 200);
    const legacy = this.messageRepository
      ? await this.legacySummariesForDate(userId, dateKey)
      : [];
    const journal = await Promise.all(entries.map((entry) => this.summaryWithImage(entry)));
    return [...journal, ...legacy]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      .slice(0, 200);
  }

  async listDateKeys(userId: string, fromDateKey: string, toDateKey: string): Promise<string[]> {
    assertDateKey(fromDateKey);
    assertDateKey(toDateKey);
    if (fromDateKey > toDateKey) throw new JournalValidationError("Invalid date range");
    return this.repository.listDateKeysByUser(userId, fromDateKey, toDateKey);
  }

  async listRecent(userId: string, beforeDateKey: string, limit: number): Promise<JournalRecordSummaryView[]> {
    assertDateKey(beforeDateKey);
    const safeLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(2, Math.floor(limit)))
      : 2;
    const entries = await this.repository.listRecentCompleted(userId, beforeDateKey, safeLimit);
    const legacy = this.messageRepository
      ? await this.legacySummariesBefore(userId, beforeDateKey)
      : [];
    const journal = await Promise.all(entries.map((entry) => this.summaryWithImage(entry)));
    return [...journal, ...legacy]
      .filter((entry) => !entry.isSample)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      .slice(0, safeLimit);
  }

  async detail(userId: string, recordId: string): Promise<JournalRecordDetailView> {
    const parsed = parseJournalRecordId(recordId);
    if (!parsed) throw new JournalNotFoundError();
    if (parsed.source === "legacy_cloud") {
      return this.legacyDetail(userId, parsed.sourceId);
    }
    if (parsed.source !== "journal") throw new JournalNotFoundError();
    const entry = await this.repository.findByIdForUser(parsed.sourceId, userId);
    if (!entry || entry.status !== "completed" || !entry.originalText || !entry.rewrittenText) {
      throw new JournalNotFoundError();
    }
    const practiceState = await this.repository.findPracticeState(userId, "journal", entry.id);
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
      practice: toPracticeView(practiceState, false),
    };
  }

  async taskStatus(userId: string, recordId: string): Promise<JournalTaskStatusView> {
    const parsed = parseJournalRecordId(recordId);
    if (!parsed || parsed.source !== "journal") throw new JournalNotFoundError();
    const entry = await this.repository.findByIdForUser(parsed.sourceId, userId);
    if (!entry || entry.status === "deleted") throw new JournalNotFoundError();
    return {
      recordId,
      status: entry.status,
      message: entry.status === "failed" ? "发送失败，请稍后重试" : null,
    };
  }

  async delete(userId: string, recordId: string): Promise<void> {
    const parsed = parseJournalRecordId(recordId);
    if (!parsed) throw new JournalNotFoundError();
    if (parsed.source === "legacy_cloud") {
      await this.legacyDetail(userId, parsed.sourceId);
      await this.repository.hideLegacy(userId, parsed.sourceId);
      return;
    }
    if (parsed.source !== "journal") throw new JournalNotFoundError();
    const deleted = await this.repository.markDeleted(parsed.sourceId, userId, new Date());
    if (!deleted) throw new JournalNotFoundError();
  }

  async replaceImage(userId: string, recordId: string, imageUploadId: string | null): Promise<JournalRecordDetailView> {
    const parsed = parseJournalRecordId(recordId);
    if (!parsed || parsed.source !== "journal") throw new JournalNotFoundError();
    if (imageUploadId !== null && (!imageUploadId.trim() || imageUploadId.length > 128)) {
      throw new JournalValidationError("Invalid image upload id");
    }
    try {
      const updated = await this.repository.replaceEntryImage({
        entryId: parsed.sourceId,
        userId,
        imageUploadId: imageUploadId?.trim() ?? null,
      });
      if (!updated) throw new JournalNotFoundError();
    } catch (error) {
      if (error instanceof Error && error.message === "JOURNAL_IMAGE_NOT_READY") {
        throw new JournalImageNotReadyError("Image upload is not ready");
      }
      throw error;
    }
    return this.detail(userId, recordId);
  }

  async hideLegacy(userId: string, assistantMessageId: string): Promise<void> {
    const normalizedId = assistantMessageId.trim();
    if (!normalizedId) throw new JournalValidationError("Invalid legacy message id");
    if (await this.repository.isLegacyHidden(userId, normalizedId)) return;
    await this.legacyDetail(userId, normalizedId);
    await this.repository.hideLegacy(userId, normalizedId);
  }

  async updateDictation(
    userId: string,
    recordId: string,
    result: JournalPracticeResult,
  ): Promise<JournalRecordDetailView["practice"]> {
    if (result !== "correct" && result !== "incorrect" && result !== "revealed") {
      throw new JournalValidationError("Invalid dictation result");
    }
    const parsed = parseJournalRecordId(recordId);
    if (!parsed || parsed.source === "legacy_local") throw new JournalNotFoundError();
    if (parsed.source === "journal") {
      const entry = await this.repository.findByIdForUser(parsed.sourceId, userId);
      if (!entry || entry.status !== "completed") throw new JournalNotFoundError();
    } else {
      await this.legacyDetail(userId, parsed.sourceId);
    }
    const current = await this.repository.findPracticeState(userId, parsed.source, parsed.sourceId);
    const correctStreak = result === "correct" ? (current?.dictationCorrectStreak ?? 0) + 1 : 0;
    const practicedAt = new Date();
    const nextReviewAt = new Date(practicedAt.getTime() + reviewDelayDays(result, correctStreak) * 86_400_000);
    const saved = await this.repository.saveDictationResult({
      userId,
      sourceKind: parsed.source,
      sourceId: parsed.sourceId,
      result,
      practicedAt,
      nextReviewAt,
      correctStreak,
    });
    return toPracticeView(saved, false);
  }

  async updateCloze(
    userId: string,
    recordId: string,
    input: UpdateJournalClozeInput,
  ): Promise<JournalRecordDetailView["practice"]> {
    if (!Number.isInteger(input.baseVersion) || input.baseVersion < 0 || !isClozeOperation(input.operation)) {
      throw new JournalValidationError("Invalid cloze update");
    }
    if (input.result !== undefined && !isPracticeResult(input.result)) {
      throw new JournalValidationError("Invalid cloze result");
    }
    const parsed = parseJournalRecordId(recordId);
    if (!parsed || parsed.source === "legacy_local") throw new JournalNotFoundError();
    const detail = await this.detail(userId, recordId);
    const current = await this.repository.findPracticeState(userId, parsed.source, parsed.sourceId);
    if ((current?.clozeVersion ?? 0) !== input.baseVersion) throw new JournalPracticeConflictError();
    const state = normalizeClozeState(current?.clozeState);
    const operation = input.operation;
    if (operation.type === "add") {
      const segment = detail.rewriteSegments.find((candidate) => candidate.id === operation.segmentId);
      if (!segment) throw new JournalValidationError("Cloze segment does not exist");
      const { startUtf16, endUtf16 } = operation;
      if (
        startUtf16 >= endUtf16 ||
        !isUtf16GraphemeBoundary(segment.text, startUtf16) ||
        !isUtf16GraphemeBoundary(segment.text, endUtf16)
      ) throw new JournalValidationError("Invalid cloze range");
      const answer = segment.text.slice(startUtf16, endUtf16);
      if (countGraphemes(answer) > 100 || !answer.trim()) throw new JournalValidationError("Invalid cloze range");
      const overlaps = state.blanks.some((blank) => blank.segmentId === segment.id && startUtf16 < blank.endUtf16 && endUtf16 > blank.startUtf16);
      if (overlaps) throw new JournalValidationError("Cloze ranges cannot overlap");
      state.blanks.push({ id: randomUUID(), segmentId: segment.id, startUtf16, endUtf16, answer });
    } else if (operation.type === "remove") {
      const index = state.blanks.findIndex((blank) => blank.id === operation.blankId);
      if (index < 0) throw new JournalValidationError("Cloze blank does not exist");
      state.blanks.splice(index, 1);
    }
    const practicedAt = input.result ? new Date() : null;
    const correctStreak = input.result === "correct" ? (current?.clozeCorrectStreak ?? 0) + 1 : 0;
    const nextReviewAt = input.result && practicedAt
      ? new Date(practicedAt.getTime() + reviewDelayDays(input.result, correctStreak) * 86_400_000)
      : null;
    const saved = await this.repository.saveClozeState({
      userId,
      sourceKind: parsed.source,
      sourceId: parsed.sourceId,
      expectedVersion: input.baseVersion,
      state,
      result: input.result ?? null,
      practicedAt,
      nextReviewAt,
      correctStreak,
    });
    if (!saved) throw new JournalPracticeConflictError();
    return toPracticeView(saved, false);
  }

  async practiceQueue(userId: string, limit: number): Promise<JournalPracticeQueueItemView[]> {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.floor(limit))) : 20;
    const journalEntries = await this.repository.listRecentCompleted(userId, "9999-12-31", 100);
    const legacyMessages = this.messageRepository
      ? await this.messageRepository.listSuccessfulByUserBefore(userId, new Date(Date.now() + 86_400_000), 400)
      : [];
    const legacy = await this.filterVisibleLegacy(userId, pairLegacyMessages(legacyMessages));
    const journalRecords = await Promise.all(journalEntries.filter((entry) => !entry.isSample).map((entry) => this.summaryWithImage(entry)));
    const records = [...journalRecords, ...legacy]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const now = Date.now();
    const items = await Promise.all(records.map(async (record) => {
      const parsed = parseJournalRecordId(record.id)!;
      const state = await this.repository.findPracticeState(userId, parsed.source as "journal" | "legacy_cloud", parsed.sourceId);
      const hasLegacyCloze = record.practiceSummary?.hasCloze === true;
      if (hasLegacyCloze && !state?.clozeState) {
        return { record, initialTab: "cloze", reason: "continue_cloze" } as const;
      }
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

  private async legacySummariesForDate(userId: string, dateKey: string): Promise<JournalRecordSummaryView[]> {
    if (!this.messageRepository) return [];
    const range = dateKeyRangeInBusinessTimeZone(dateKey);
    const messages = await this.messageRepository.listByUserAndDay(userId, range.start, range.end);
    const pairs = pairLegacyMessages(messages).filter((pair) => legacyDateKey(pair.assistant) === dateKey);
    return this.filterVisibleLegacy(userId, pairs);
  }

  private async summaryWithImage(entry: JournalEntryEntity): Promise<JournalRecordSummaryView> {
    const summary = toSummary(entry);
    if (!entry.image || !this.imageService) return summary;
    const views = await this.imageService.views(entry.image);
    return { ...summary, thumbnail: views.thumbnail };
  }

  private async legacySummariesBefore(userId: string, beforeDateKey: string): Promise<JournalRecordSummaryView[]> {
    if (!this.messageRepository) return [];
    const before = dateKeyRangeInBusinessTimeZone(beforeDateKey).start;
    const messages = await this.messageRepository.listSuccessfulByUserBefore(userId, before, 400);
    const pairs = pairLegacyMessages(messages).filter((pair) => legacyDateKey(pair.assistant) < beforeDateKey);
    return this.filterVisibleLegacy(userId, pairs);
  }

  private async filterVisibleLegacy(
    userId: string,
    pairs: LegacyMessagePair[],
  ): Promise<JournalRecordSummaryView[]> {
    const rows = await Promise.all(pairs.map(async (pair) => (
      await this.repository.isLegacyHidden(userId, pair.assistant.id)
        ? null
        : toLegacySummary(pair)
    )));
    return rows.filter((row): row is JournalRecordSummaryView => row !== null);
  }

  private async legacyDetail(userId: string, assistantMessageId: string): Promise<JournalRecordDetailView> {
    if (!this.messageRepository || await this.repository.isLegacyHidden(userId, assistantMessageId)) {
      throw new JournalNotFoundError();
    }
    const assistant = await this.messageRepository.findById(assistantMessageId);
    if (!assistant || assistant.userId !== userId || assistant.role !== "assistant" || assistant.status !== "success") {
      throw new JournalNotFoundError();
    }
    let pair: LegacyMessagePair | undefined;
    if (assistant.sourceMessageId) {
      const source = await this.messageRepository.findById(assistant.sourceMessageId);
      if (isValidLegacySource(source, assistant)) pair = { user: source, assistant };
    } else {
      const conversation = await this.messageRepository.listByConversation(assistant.conversationId, 500);
      pair = pairLegacyMessages(conversation).find((candidate) => candidate.assistant.id === assistant.id);
    }
    if (!pair) throw new JournalNotFoundError();
    const summary = toLegacySummary(pair);
    const rewrittenText = parseTaggedRewriteOutput(assistant.content).rewrite.trim();
    const segments = segmentLearningSentences({
      text: rewrittenText,
      languageCode: summary.languageCode,
      minSegmentChars: 1,
      maxSegmentChars: 800,
    });
    return {
      ...summary,
      originalText: pair.user.content,
      rewrittenText,
      rewriteSegments: segments.map((segment, ordinal) => ({
        id: `legacy:${assistant.id}:${ordinal}`,
        ordinal,
        text: segment.text,
        startUtf16: segment.textStart,
        endUtf16: segment.textEnd,
      })),
      image: null,
      practice: toPracticeView(
        await this.repository.findPracticeState(userId, "legacy_cloud", assistant.id),
        assistant.clozeState,
      ),
    };
  }
}

type LegacyMessagePair = { user: MessageEntity; assistant: MessageEntity };

export function pairLegacyMessages(messages: MessageEntity[]): LegacyMessagePair[] {
  const sorted = [...messages]
    .filter((message) => message.status === "success")
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id));
  const users = new Map(sorted.filter((message) => message.role === "user").map((message) => [message.id, message]));
  const bySource = new Map<string, LegacyMessagePair>();
  const result: LegacyMessagePair[] = [];
  const explicitlyPairedAssistants = new Set<string>();
  for (const assistant of sorted) {
    if (assistant.role !== "assistant" || !assistant.sourceMessageId) continue;
    const user = users.get(assistant.sourceMessageId);
    if (!isValidLegacySource(user, assistant)) continue;
    const current = bySource.get(user.id);
    if (!current || compareMessageOrder(current.assistant, assistant) < 0) {
      bySource.set(user.id, { user, assistant });
    }
    explicitlyPairedAssistants.add(assistant.id);
  }
  result.push(...bySource.values());
  const claimedUsers = new Set(bySource.keys());
  for (let index = 1; index < sorted.length; index += 1) {
    const assistant = sorted[index]!;
    const user = sorted[index - 1]!;
    if (assistant.role !== "assistant" || assistant.sourceMessageId || explicitlyPairedAssistants.has(assistant.id)) continue;
    if (!isValidLegacySource(user, assistant) || claimedUsers.has(user.id)) continue;
    claimedUsers.add(user.id);
    result.push({ user, assistant });
  }
  return result.sort((left, right) => compareMessageOrder(right.assistant, left.assistant));
}

function isValidLegacySource(user: MessageEntity | null | undefined, assistant: MessageEntity): user is MessageEntity {
  return Boolean(
    user &&
    user.role === "user" &&
    user.status === "success" &&
    user.userId === assistant.userId &&
    user.conversationId === assistant.conversationId,
  );
}

function compareMessageOrder(left: MessageEntity, right: MessageEntity): number {
  return left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id);
}

function legacyDateKey(assistant: MessageEntity): string {
  return assistant.conversationDateKey ?? formatDateKeyInTimeZone(assistant.createdAt);
}

function toLegacySummary(pair: LegacyMessagePair): JournalRecordSummaryView {
  return {
    id: journalRecordId("legacy_cloud", pair.assistant.id),
    source: "legacy_cloud",
    dateKey: legacyDateKey(pair.assistant),
    originalPreview: truncateGraphemes(pair.user.content, PREVIEW_GRAPHEMES),
    rewrittenPreview: truncateGraphemes(
      parseTaggedRewriteOutput(pair.assistant.content).rewrite,
      PREVIEW_GRAPHEMES,
    ),
    languageCode: pair.assistant.languageCode ?? "en-US",
    status: "completed",
    thumbnail: null,
    practiceSummary: pair.assistant.clozeState ? {
      hasCloze: true,
      dictationCompleted: false,
      nextReviewAt: null,
    } : null,
    isSample: false,
    createdAt: pair.user.createdAt.toISOString(),
  };
}

function reviewDelayDays(result: JournalPracticeResult, correctStreak: number): number {
  if (result !== "correct") return 1;
  if (correctStreak <= 1) return 3;
  if (correctStreak === 2) return 7;
  return 14;
}

function isPracticeResult(value: unknown): value is JournalPracticeResult {
  return value === "correct" || value === "incorrect" || value === "revealed";
}

function isClozeOperation(value: unknown): value is UpdateJournalClozeInput["operation"] {
  if (!value || typeof value !== "object" || !("type" in value)) return false;
  if (value.type === "result") return true;
  if (value.type === "remove") return "blankId" in value && typeof value.blankId === "string" && Boolean(value.blankId.trim());
  return value.type === "add" &&
    "segmentId" in value && typeof value.segmentId === "string" && Boolean(value.segmentId.trim()) &&
    "startUtf16" in value && Number.isInteger(value.startUtf16) &&
    "endUtf16" in value && Number.isInteger(value.endUtf16);
}

function normalizeClozeState(value: unknown): JournalClozeState {
  if (!value || typeof value !== "object" || !("schemaVersion" in value) || value.schemaVersion !== 1 || !("blanks" in value) || !Array.isArray(value.blanks)) {
    return { schemaVersion: 1, blanks: [] };
  }
  const blanks = value.blanks.filter((blank): blank is JournalClozeState["blanks"][number] =>
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
  state: Awaited<ReturnType<JournalRepository["findPracticeState"]>>,
  legacyClozeState: unknown,
): JournalRecordDetailView["practice"] {
  const hasLegacyCloze = Boolean(legacyClozeState);
  if (!state && !hasLegacyCloze) return null;
  const nextDates = [state?.clozeNextReviewAt, state?.dictationNextReviewAt]
    .filter((value): value is Date => Boolean(value))
    .sort((left, right) => left.getTime() - right.getTime());
  return {
    hasCloze: hasLegacyCloze || Boolean(state?.clozeState),
    dictationCompleted: state?.dictationCompleted ?? false,
    nextReviewAt: nextDates[0]?.toISOString() ?? null,
    clozeState: state?.clozeState ?? legacyClozeState ?? null,
    clozeVersion: state?.clozeVersion ?? 0,
    clozeLastResult: state?.clozeLastResult ?? null,
    dictationLastResult: state?.dictationLastResult ?? null,
  };
}

export function toSummary(entry: JournalEntryEntity): JournalRecordSummaryView {
  if (entry.status !== "queued" && entry.status !== "processing" && entry.status !== "completed") {
    throw new JournalNotFoundError();
  }
  return {
    id: journalRecordId("journal", entry.id),
    source: "journal",
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
  return `journal:${clientId}`;
}

function assertDateKey(value: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new JournalValidationError("Invalid date key");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  if (
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() !== month - 1 ||
    normalized.getUTCDate() !== day
  ) {
    throw new JournalValidationError("Invalid date key");
  }
}
