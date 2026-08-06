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
  UpdateCardContentInput,
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
import { segmentLearningSentences } from "@lf/core/text/learningText.js";
import type { AIProvider } from "@lf/core/ports/ai/AIProvider.js";
import type { ResourceGovernor } from "../resource/ResourceGovernor.js";
import { buildCardContentGenerationPrompt, type CardGeneratedContentTarget } from "@lf/core/Prompts/cardContentGenerationPrompt.js";

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
    private readonly aiProvider?: AIProvider,
    private readonly resourceGovernor?: ResourceGovernor,
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
    const originalText = input.body.originalText?.trim() ?? "";
    const rewrittenText = input.body.rewrittenText?.trim() ?? "";
    const translationText = input.body.translationText?.trim() ?? "";
    const replyText = input.body.replyText?.trim() ?? "";
    const collectionId = input.body.collectionId?.trim() || null;
    const generateRewrite = input.body.generateRewrite !== false;
    if (!clientId || clientId.length > 128) throw new CardValidationError("Invalid client id");
    const primaryText = rewrittenText || originalText;
    const inputChars = countGraphemes(originalText || rewrittenText);
    if (inputChars < 1 || inputChars > MAX_ORIGINAL_GRAPHEMES) {
      throw new CardValidationError("A Card must contain a record or expression of 1 to 3000 characters");
    }
    if (generateRewrite && !originalText) throw new CardValidationError("Original text is required for AI rewrite");
    const imageUploadId = input.body.imageUploadId?.trim() || null;
    const imageUploadIds = Array.from(new Set([
      ...(Array.isArray(input.body.imageUploadIds) ? input.body.imageUploadIds : []),
      ...(imageUploadId ? [imageUploadId] : []),
    ].map((value) => value.trim()).filter(Boolean))).slice(0, 12);

    const duplicate = await this.repository.findByUserClientId(input.userId, clientId);
    if (duplicate) {
      if (duplicate.status === "failed" || duplicate.status === "deleted") {
        throw new CardClientIdConsumedError("Client id belongs to a terminal task");
      }
      return this.summaryWithImage(duplicate);
    }

    const allContent = [originalText, rewrittenText, translationText, replyText].filter(Boolean).join("\n");
    this.contentSafetyService?.assertAllowed(allContent, "input");
    await this.contentSafetyService?.assertAllowedRemote({
      text: allContent,
      stage: "input",
      requestId: input.requestId,
      userId: input.userId,
    });

    const preference = await this.userPreferenceRepository.getByUserId(input.userId);
    const dateKey = formatDateKeyInTimeZone(new Date());
    if (!generateRewrite) {
      let created;
      try { created = await this.repository.createDirect({
        userId: input.userId,
        collectionId,
        dateKey,
        originalText: originalText || null,
        rewrittenText: rewrittenText || null,
        translationText: translationText || null,
        replyText: replyText || null,
        languageCode: preference.learningLanguage,
        appLocaleSnapshot: preference.appLocale,
        promptDifficultySnapshot: preference.promptDifficulty,
        promptVersion: CARD_PROMPT_VERSION,
        clientId,
        imageUploadIds,
        segments: buildSegments(primaryText, preference.learningLanguage),
      }); } catch (error) {
        if (error instanceof Error && error.message === "CARD_COLLECTION_NOT_FOUND") throw new CardNotFoundError();
        throw error;
      }
      return this.summaryWithImage(created);
    }
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
        collectionId,
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
      if (error instanceof Error && error.message === "CARD_COLLECTION_NOT_FOUND") throw new CardNotFoundError();
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

  async updateContent(userId: string, recordId: string, patch: UpdateCardContentInput): Promise<CardRecordDetailView> {
    const parsed = parseCardRecordId(recordId);
    if (!parsed || parsed.source !== "card") throw new CardNotFoundError();
    const current = await this.repository.findByIdForUser(parsed.sourceId, userId);
    if (!current || current.status !== "completed") throw new CardNotFoundError();
    const originalText = normalizePatchedText(patch, "originalText", current.originalText);
    const rewrittenText = normalizePatchedText(patch, "rewrittenText", current.rewrittenText);
    const translationText = normalizePatchedText(patch, "translationText", current.translationText);
    const replyText = normalizePatchedText(patch, "replyText", current.replyText);
    const collectionId = Object.prototype.hasOwnProperty.call(patch, "collectionId") ? patch.collectionId?.trim() || null : current.collectionId;
    const primaryText = rewrittenText || originalText;
    if (!primaryText) throw new CardValidationError("A Card must contain a record or expression");
    const allContent = [originalText, rewrittenText, translationText, replyText].filter(Boolean).join("\n");
    this.contentSafetyService?.assertAllowed(allContent, "input");
    const clearPractice = current.rewrittenText !== rewrittenText || (!rewrittenText && current.originalText !== originalText);
    let updated;
    try { updated = await this.repository.updateContent({
      entryId: parsed.sourceId,
      userId,
      collectionId,
      originalText,
      rewrittenText,
      translationText,
      replyText,
      segments: buildSegments(primaryText, current.languageCode),
      clearPractice,
    }); } catch (error) {
      if (error instanceof Error && error.message === "CARD_COLLECTION_NOT_FOUND") throw new CardNotFoundError();
      throw error;
    }
    if (!updated) throw new CardNotFoundError();
    return this.detail(userId, recordId);
  }

  async generateContent(input: {
    userId: string;
    requestId: string;
    recordId: string;
    target: CardGeneratedContentTarget;
  }): Promise<CardRecordDetailView> {
    if (!this.aiProvider) throw new CardValidationError("Card generation is unavailable");
    const parsed = parseCardRecordId(input.recordId);
    if (!parsed || parsed.source !== "card") throw new CardNotFoundError();
    const current = await this.repository.findByIdForUser(parsed.sourceId, input.userId);
    if (!current || current.status !== "completed") throw new CardNotFoundError();
    const sourceText = input.target === "reply"
      ? current.rewrittenText || current.originalText
      : current.originalText;
    if (!sourceText) throw new CardValidationError("No source content to generate from");
    await this.entitlementService.assertCanUse(input.userId, countGraphemes(sourceText), { dateKey: current.dateKey });
    const preference = await this.userPreferenceRepository.getByUserId(input.userId);
    const prompt = buildCardContentGenerationPrompt({
      target: input.target,
      sourceText,
      languageCode: current.languageCode,
      appLocale: preference.appLocale,
      difficulty: current.promptDifficultySnapshot,
    });
    let output = "";
    const generate = () => this.aiProvider!.generateChatTextStream({
        userId: input.userId,
        text: prompt.userPrompt,
        languageCode: current.languageCode,
        appLocale: preference.appLocale,
        promptDifficulty: current.promptDifficultySnapshot,
        companionMode: "rewrite_only",
        systemPrompt: prompt.systemPrompt,
        rawUserPrompt: true,
        maxOutputTokens: 1_000,
      }, (event) => { if (event.type === "delta") output += event.text; });
    if (this.resourceGovernor) await this.resourceGovernor.execute("llm", input.userId, generate);
    else await generate();
    output = output.trim();
    if (!output) throw new CardValidationError("Generated content is empty");
    this.contentSafetyService?.assertAllowed(output, "output");
    await this.contentSafetyService?.assertAllowedRemote({
      text: output,
      stage: "output",
      requestId: input.requestId,
      userId: input.userId,
    });
    await this.entitlementService.consumeUpToLimit(
      input.userId,
      countGraphemes(sourceText) + countGraphemes(output),
      { dateKey: current.dateKey },
    );
    const patch: UpdateCardContentInput = input.target === "expression"
      ? { rewrittenText: output }
      : input.target === "translation"
        ? { translationText: output }
        : { replyText: output };
    return this.updateContent(input.userId, input.recordId, patch);
  }

  async generateDraftContent(input: {
    userId: string;
    requestId: string;
    target: CardGeneratedContentTarget;
    sourceText: string;
  }): Promise<{ text: string }> {
    if (!this.aiProvider) throw new CardValidationError("Card generation is unavailable");
    const sourceText = input.sourceText.trim();
    if (!sourceText || countGraphemes(sourceText) > MAX_ORIGINAL_GRAPHEMES) {
      throw new CardValidationError("Invalid generation source");
    }
    const preference = await this.userPreferenceRepository.getByUserId(input.userId);
    const dateKey = formatDateKeyInTimeZone(new Date());
    await this.entitlementService.assertCanUse(input.userId, countGraphemes(sourceText), { dateKey });
    const prompt = buildCardContentGenerationPrompt({
      target: input.target,
      sourceText,
      languageCode: preference.learningLanguage,
      appLocale: preference.appLocale,
      difficulty: preference.promptDifficulty,
    });
    let output = "";
    const generate = () => this.aiProvider!.generateChatTextStream({
        userId: input.userId,
        text: prompt.userPrompt,
        languageCode: preference.learningLanguage,
        appLocale: preference.appLocale,
        promptDifficulty: preference.promptDifficulty,
        companionMode: "rewrite_only",
        systemPrompt: prompt.systemPrompt,
        rawUserPrompt: true,
        maxOutputTokens: 1_000,
      }, (event) => { if (event.type === "delta") output += event.text; });
    if (this.resourceGovernor) await this.resourceGovernor.execute("llm", input.userId, generate);
    else await generate();
    output = output.trim();
    if (!output) throw new CardValidationError("Generated content is empty");
    this.contentSafetyService?.assertAllowed(output, "output");
    await this.contentSafetyService?.assertAllowedRemote({ text: output, stage: "output", requestId: input.requestId, userId: input.userId });
    await this.entitlementService.consumeUpToLimit(input.userId, countGraphemes(sourceText) + countGraphemes(output), { dateKey });
    return { text: output };
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
    offset = 0,
    fromDateKey?: string,
  ): Promise<CardRecordSummaryView[]> {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 100;
    const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
    if (fromDateKey) assertDateKey(fromDateKey);
    const entries = await this.repository.listByUser(userId, collectionId, safeLimit, safeOffset, fromDateKey);
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
    if (!entry || entry.status !== "completed" || (!entry.originalText && !entry.rewrittenText)) {
      throw new CardNotFoundError();
    }
    const practiceState = await this.repository.findPracticeState(userId, entry.id);
    const imageViews = this.imageService
      ? await Promise.all(entry.images.map((image) => this.imageService!.views(image)))
      : [];
    return {
      ...toSummary(entry),
      thumbnail: imageViews[0]?.thumbnail ?? null,
      status: "completed",
      originalText: entry.originalText ?? "",
      rewrittenText: entry.rewrittenText,
      translationText: entry.translationText,
      replyText: entry.replyText,
      rewriteSegments: entry.segments.map((segment) => ({
        id: segment.id,
        ordinal: segment.ordinal,
        text: segment.text,
        startUtf16: segment.startUtf16,
        endUtf16: segment.endUtf16,
      })),
      images: imageViews.map((views) => views.image),
      image: imageViews[0]?.image ?? null,
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

  async appendImage(userId: string, recordId: string, imageUploadId: string): Promise<CardRecordDetailView> {
    const parsed = parseCardRecordId(recordId);
    if (!parsed || parsed.source !== "card" || !imageUploadId.trim()) throw new CardValidationError("Invalid image");
    try {
      const updated = await this.repository.appendEntryImage({
        entryId: parsed.sourceId,
        userId,
        imageUploadId: imageUploadId.trim(),
      });
      if (!updated) throw new CardNotFoundError();
      return this.detail(userId, recordId);
    } catch (error) {
      if (error instanceof Error && error.message === "CARD_IMAGE_NOT_READY") throw new CardImageNotReadyError();
      throw error;
    }
  }

  async removeImage(userId: string, recordId: string, imageId: string): Promise<CardRecordDetailView> {
    const parsed = parseCardRecordId(recordId);
    if (!parsed || parsed.source !== "card" || !imageId.trim()) throw new CardValidationError("Invalid image");
    const updated = await this.repository.removeEntryImage({
      entryId: parsed.sourceId,
      userId,
      imageId: imageId.trim(),
    });
    if (!updated) throw new CardNotFoundError();
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
    const firstImage = entry.images[0];
    if (!firstImage || !this.imageService) return summary;
    const views = await this.imageService.views(firstImage);
    return { ...summary, thumbnail: views.thumbnail };
  }
}

function reviewDelayDays(result: CardPracticeResult, correctStreak: number): number {
  if (result !== "correct") return 1;
  if (correctStreak <= 1) return 3;
  if (correctStreak === 2) return 7;
  return 14;
}

function normalizePatchedText(
  patch: UpdateCardContentInput,
  key: keyof UpdateCardContentInput,
  current: string | null,
): string | null {
  if (!(key in patch)) return current;
  const value = patch[key];
  if (value == null) return null;
  const trimmed = value.trim();
  if (countGraphemes(trimmed) > MAX_ORIGINAL_GRAPHEMES) {
    throw new CardValidationError("Card content must not exceed 3000 characters");
  }
  return trimmed || null;
}

function buildSegments(text: string, languageCode: string): Array<{
  ordinal: number;
  text: string;
  startUtf16: number;
  endUtf16: number;
}> {
  return segmentLearningSentences({
    text,
    languageCode,
    minSegmentChars: 1,
    maxSegmentChars: 800,
  }).map((segment, ordinal) => ({
    ordinal,
    text: segment.text,
    startUtf16: segment.textStart,
    endUtf16: segment.textEnd,
  }));
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
