import { countGraphemes, isUtf16GraphemeBoundary, truncateGraphemes } from "@lf/core/text/grapheme.js";
import {
  countCardCharacters,
  DEFAULT_CARD_CONTENT_MAX_CHARS,
  DEFAULT_CARD_IMAGES_MAX_PER_CARD,
  DEFAULT_CARD_TITLE_MAX_CHARS,
  normalizeCardBodyText,
  normalizeCardLineEndings,
  normalizeCardTitleText,
} from "@lf/core/text/cardText.js";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import type { CardRepository, CardEntryEntity, CardLearningContentType } from "@lf/core/ports/repository/CardRepository.js";
import type { UserPreferenceRepository } from "@lf/core/ports/repository/UserPreferenceRepository.js";
import type {
  CreateCardEntryInput,
  CardRecordDetailView,
  CardRecordSummaryView,
  CardPracticeQueueItemView,
  CardMemoryRoundCandidateView,
  CardPracticeResult,
  CardClozeState,
  UpdateCardClozeInput,
  UpdateCardContentInput,
  SaveCardContentInput,
  CardTaskStatusView,
} from "@lf/core/types/cardRecord.js";
import { cardRecordId, parseCardRecordId } from "@lf/core/types/cardRecord.js";
import type { EntitlementService } from "../entitlement/EntitlementService.js";
import type { ContentSafetyService } from "../contentSafety/ContentSafetyService.js";
import type { ChatGenerationTaskGuard } from "../chat/ChatGenerationTaskGuard.js";
import { formatDateKeyInTimeZone } from "../time/businessClock.js";
import type { CardImageService } from "./CardImageService.js";
import { CARD_EXPRESSION_PROMPT_VERSION, CARD_TOPIC_MAX_CHARS } from "@lf/core/Prompts/cardExpressionPrompt.js";
import { normalizePhraseSurface, PHRASE_NORMALIZER_VERSION } from "@lf/core/text/phraseNormalization.js";
import { inferLearningTextLanguage } from "@lf/core/text/learningText.js";
import type { AIProvider } from "@lf/core/ports/ai/AIProvider.js";
import { ResourceLimitedError, type ResourceGovernor } from "../resource/ResourceGovernor.js";
import { buildCardContentGenerationPrompt, cardContentMaxOutputTokens, parseCardAuxiliaryOutput, type CardGeneratedContentTarget } from "@lf/core/Prompts/cardContentGenerationPrompt.js";
import { buildCardContentSegments } from "./cardContentSegments.js";
import type { ChatTextGenerationStreamEvent } from "@lf/core/ports/ai/AIProvider.js";
import type { UsageV2Service } from "../usage/UsageV2Service.js";
import { isTargetLanguageCode } from "@lf/core/language/targetLanguages.js";
import {
  LEARNING_SENTENCE_SEGMENTER_VERSION,
  segmentLearningSentences,
} from "../text/learningSentenceSegmenter.js";
import {
  buildCardInspirationPrompt,
  defaultCardInspirationQuestions,
  parseCardInspirationOutput,
} from "@lf/core/Prompts/cardInspirationPrompt.js";

const PREVIEW_GRAPHEMES = 240;
const FOREGROUND_LLM_RETRY_DELAYS_MS = [750, 1_500, 3_000] as const;
export const CARD_PROMPT_VERSION = CARD_EXPRESSION_PROMPT_VERSION;

export type CardServiceLimits = {
  titleMaxChars: number;
  topicMaxChars?: number;
  contentMaxChars: number;
  imagesMaxPerCard: number;
};

const DEFAULT_CARD_SERVICE_LIMITS: CardServiceLimits = {
  titleMaxChars: DEFAULT_CARD_TITLE_MAX_CHARS,
  topicMaxChars: CARD_TOPIC_MAX_CHARS,
  contentMaxChars: DEFAULT_CARD_CONTENT_MAX_CHARS,
  imagesMaxPerCard: DEFAULT_CARD_IMAGES_MAX_PER_CARD,
};

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

export class CardContentConflictError extends Error {
  readonly code = "CARD_CONTENT_CONFLICT";
}

export class CardNotFoundError extends Error {
  readonly code = "CARD_NOT_FOUND";
}

export class CardPracticeConflictError extends Error {
  readonly code = "CARD_PRACTICE_CONFLICT";
}

export class CardLearningAccessError extends Error {
  readonly code = "CARD_LEARNING_ACCESS_DENIED";
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
    private readonly listPageSizeMax = 50,
    private readonly limits: CardServiceLimits = DEFAULT_CARD_SERVICE_LIMITS,
    private readonly usageV2Service?: UsageV2Service,
  ) {}

  async inspirationQuestions(input: { userId: string; requestId: string; appLocale?: "zh-CN" | "zh-TW" | "en-US" | "ja-JP" }): Promise<{
    questions: string[];
    source: "personalized" | "starter";
    expiresInSeconds: number;
  }> {
    const preference = await this.userPreferenceRepository.getByUserId(input.userId);
    const appLocale = input.appLocale ?? preference.appLocale;
    const fallback = defaultCardInspirationQuestions(appLocale);
    if (!this.aiProvider) return { questions: fallback, source: "starter", expiresInSeconds: 86_400 };
    const recent = await this.repository.listByUser(input.userId, undefined, 20);
    const themes = [...new Set(recent
      .filter((card) => !card.isSample && card.status === "completed")
      .map((card) => card.topic?.trim() || card.title?.trim() || "")
      .filter(Boolean))]
      .slice(0, 12);
    if (themes.length < 3) return { questions: fallback, source: "starter", expiresInSeconds: 86_400 };

    const prompt = buildCardInspirationPrompt({ themes, appLocale });
    let output = "";
    try {
      await this.executeForegroundLlm(input.userId, input.requestId, "card.inspiration", () => this.aiProvider!.generateChatTextStream({
        userId: input.userId,
        text: prompt.userPrompt,
        appLocale,
        languageCode: preference.learningLanguage,
        promptDifficulty: preference.promptDifficulty,
        companionMode: "platform_inspiration",
        systemPrompt: prompt.systemPrompt,
        rawUserPrompt: true,
        maxOutputTokens: 240,
      }, (event) => {
        if (event.type === "delta") output += event.text;
      }));
      const questions = parseCardInspirationOutput(output);
      const moderatedText = questions.join("\n");
      this.contentSafetyService?.assertAllowed(moderatedText, "output");
      await this.contentSafetyService?.assertAllowedRemote({
        text: moderatedText,
        stage: "output",
        requestId: input.requestId,
        userId: input.userId,
      });
      return { questions, source: "personalized", expiresInSeconds: 86_400 };
    } catch (error) {
      console.warn("[card] inspiration generation fell back to starter questions", error);
      return { questions: fallback, source: "starter", expiresInSeconds: 3_600 };
    }
  }

  async bootstrap(userId: string): Promise<CardRecordSummaryView[]> {
    await this.repository.hideSamplesIfRealCardExists(userId, new Date());
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
    return entries.map((entry) => toSummary(entry, this.limits.topicMaxChars));
  }

  async create(input: {
    userId: string;
    requestId: string;
    body: CreateCardEntryInput;
    trustedSource?: { dateKey: string; createdAt: Date };
  }): Promise<CardRecordSummaryView> {
    const clientId = input.body.clientId.trim();
    const title = normalizeTitle(input.body.title, this.limits.titleMaxChars);
    const originalText = normalizeCardBodyText(input.body.originalText);
    const rewrittenText = normalizeCardBodyText(input.body.rewrittenText);
    const translationText = normalizeCardBodyText(input.body.translationText);
    const replyText = normalizeCardBodyText(input.body.replyText);
    const collectionId = input.body.collectionId?.trim() || null;
    const generateRewrite = input.body.generateRewrite !== false;
    if (!clientId || clientId.length > 128) throw new CardValidationError("Invalid client id");
    const primaryText = rewrittenText || originalText;
    const inputChars = countCardCharacters(originalText || rewrittenText);
    if (inputChars < 1 || inputChars > this.limits.contentMaxChars) {
      throw new CardValidationError(`A Card must contain a record or expression of 1 to ${this.limits.contentMaxChars} characters`);
    }
    if (generateRewrite && !originalText) throw new CardValidationError("Original text is required for AI rewrite");
    const imageUploadId = input.body.imageUploadId?.trim() || null;
    const imageUploadIds = Array.from(new Set([
      ...(Array.isArray(input.body.imageUploadIds) ? input.body.imageUploadIds : []),
      ...(imageUploadId ? [imageUploadId] : []),
    ].map((value) => value.trim()).filter(Boolean)));
    if (imageUploadIds.length > this.limits.imagesMaxPerCard) {
      throw new CardValidationError(`A Card can contain up to ${this.limits.imagesMaxPerCard} images`);
    }

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
    const originalLanguageCode = originalText
      ? inferLearningTextLanguage(originalText, preference.appLocale)
      : preference.appLocale;
    const dateKey = input.trustedSource?.dateKey ?? formatDateKeyInTimeZone(new Date());
    const originalContentHash = originalText ? cardContentHash(originalText) : null;
    if (!generateRewrite) {
      let created;
      try { created = await this.repository.createDirect({
        userId: input.userId,
        collectionId,
        dateKey,
        title,
        originalText: originalText || null,
        originalContentHash,
        rewrittenText: rewrittenText || null,
        rewrittenLanguageCode: rewrittenText ? preference.learningLanguage : null,
        rewrittenSourceHash: rewrittenText ? originalContentHash : null,
        translationText: translationText || null,
        translationLanguageCode: translationText ? preference.appLocale : null,
        translationSourceHash: translationText ? originalContentHash : null,
        replyText: replyText || null,
        replyLanguageCode: replyText ? preference.learningLanguage : null,
        replySourceHash: replyText ? originalContentHash : null,
        languageCode: preference.learningLanguage,
        appLocaleSnapshot: preference.appLocale,
        promptDifficultySnapshot: preference.promptDifficulty,
        promptVersion: CARD_PROMPT_VERSION,
        clientId,
        imageUploadIds,
        segments: buildSegments(primaryText, rewrittenText ? preference.learningLanguage : originalLanguageCode),
        contentSegments: buildCardContentSegments([
          { contentType: "original", text: originalText || null, languageCode: originalLanguageCode, sourceHash: originalContentHash },
          { contentType: "rewrite", text: rewrittenText || null, languageCode: preference.learningLanguage, sourceHash: originalContentHash },
          { contentType: "reply", text: replyText || null, languageCode: preference.learningLanguage, sourceHash: originalContentHash },
        ]),
        createdAt: input.trustedSource?.createdAt,
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
        title,
        originalText,
        originalContentHash: originalContentHash!,
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

  async updateContent(
    userId: string,
    recordId: string,
    patch: UpdateCardContentInput,
    generated?: { target: CardGeneratedContentTarget; languageCode: string; sourceHash: string },
  ): Promise<CardRecordDetailView> {
    const parsed = parseCardRecordId(recordId);
    if (!parsed || parsed.source !== "card") throw new CardNotFoundError();
    const current = await this.repository.findByIdForUser(parsed.sourceId, userId);
    if (!current || current.status !== "completed") throw new CardNotFoundError();
    const currentOriginalContentHash = current.originalContentHash ?? (current.originalText ? cardContentHash(current.originalText) : null);
    if (generated && generated.sourceHash !== currentOriginalContentHash) {
      throw new CardContentConflictError("The original Card content changed while AI generation was running");
    }
    const title = Object.prototype.hasOwnProperty.call(patch, "title") ? normalizeTitle(patch.title, this.limits.titleMaxChars) : current.title;
    const originalText = normalizePatchedText(patch, "originalText", current.originalText, this.limits.contentMaxChars);
    const originalChanged = normalizeCardContent(originalText) !== normalizeCardContent(current.originalText);
    const originalContentHash = originalChanged
      ? (originalText ? cardContentHash(originalText) : null)
      : currentOriginalContentHash;
    const rewrittenText = originalChanged ? null : normalizePatchedText(patch, "rewrittenText", current.rewrittenText, this.limits.contentMaxChars);
    const translationText = originalChanged ? null : normalizePatchedText(patch, "translationText", current.translationText, this.limits.contentMaxChars);
    const replyText = originalChanged ? null : normalizePatchedText(patch, "replyText", current.replyText, this.limits.contentMaxChars);
    const collectionId = Object.prototype.hasOwnProperty.call(patch, "collectionId") ? patch.collectionId?.trim() || null : current.collectionId;
    const rewrittenLanguageCode = resolveContentLanguage({
      patch,
      key: "rewrittenText",
      nextText: rewrittenText,
      currentText: current.rewrittenText,
      currentLanguageCode: current.rewrittenLanguageCode,
      defaultLanguageCode: current.languageCode,
      generated,
      target: "expression",
    });
    const translationLanguageCode = resolveContentLanguage({
      patch,
      key: "translationText",
      nextText: translationText,
      currentText: current.translationText,
      currentLanguageCode: current.translationLanguageCode,
      defaultLanguageCode: current.appLocaleSnapshot,
      generated,
      target: "translation",
    });
    const replyLanguageCode = resolveContentLanguage({
      patch,
      key: "replyText",
      nextText: replyText,
      currentText: current.replyText,
      currentLanguageCode: current.replyLanguageCode,
      defaultLanguageCode: current.languageCode,
      generated,
      target: "reply",
    });
    const rewrittenSourceHash = resolveSourceHash({
      patch,
      key: "rewrittenText",
      nextText: rewrittenText,
      currentSourceHash: current.rewrittenSourceHash,
      sourceHash: originalContentHash,
      originalChanged,
    });
    const translationSourceHash = resolveSourceHash({
      patch,
      key: "translationText",
      nextText: translationText,
      currentSourceHash: current.translationSourceHash,
      sourceHash: originalContentHash,
      originalChanged,
    });
    const replySourceHash = resolveSourceHash({
      patch,
      key: "replyText",
      nextText: replyText,
      currentSourceHash: current.replySourceHash,
      sourceHash: originalContentHash,
      originalChanged,
    });
    const primaryText = rewrittenText || originalText;
    const originalLanguageCode = originalText
      ? inferLearningTextLanguage(originalText, current.appLocaleSnapshot)
      : current.appLocaleSnapshot;
    if (!primaryText) throw new CardValidationError("A Card must contain a record or expression");
    const allContent = [originalText, rewrittenText, translationText, replyText].filter(Boolean).join("\n");
    this.contentSafetyService?.assertAllowed(allContent, "input");
    const clearPractice = originalChanged || current.rewrittenText !== rewrittenText;
    let updated;
    try { updated = await this.repository.updateContent({
      entryId: parsed.sourceId,
      userId,
      collectionId,
      expectedOriginalContentHash: current.originalContentHash,
      title,
      originalText,
      originalContentHash,
      rewrittenText,
      rewrittenLanguageCode,
      rewrittenSourceHash,
      translationText,
      translationLanguageCode,
      translationSourceHash,
      replyText,
      replyLanguageCode,
      replySourceHash,
      segments: buildSegments(primaryText, rewrittenText ? current.languageCode : originalLanguageCode),
      contentSegments: buildCardContentSegments([
        { contentType: "original", text: originalText, languageCode: originalLanguageCode, sourceHash: originalContentHash },
        { contentType: "rewrite", text: rewrittenText, languageCode: rewrittenLanguageCode ?? current.languageCode, sourceHash: rewrittenSourceHash },
        { contentType: "reply", text: replyText, languageCode: replyLanguageCode ?? current.languageCode, sourceHash: replySourceHash },
      ]),
      clearPractice,
    }); } catch (error) {
      if (error instanceof Error && error.message === "CARD_COLLECTION_NOT_FOUND") throw new CardNotFoundError();
      throw error;
    }
    if (!updated) throw new CardContentConflictError("The Card was changed by another request");
    return this.detail(userId, recordId);
  }

  async generateContent(input: {
    userId: string;
    requestId: string;
    recordId: string;
    target: CardGeneratedContentTarget;
    usageApiVersion: "v2";
  }): Promise<CardRecordDetailView> {
    if (!this.aiProvider) throw new CardValidationError("Card generation is unavailable");
    const parsed = parseCardRecordId(input.recordId);
    if (!parsed || parsed.source !== "card") throw new CardNotFoundError();
    const current = await this.repository.findByIdForUser(parsed.sourceId, input.userId);
    if (!current || current.status !== "completed") throw new CardNotFoundError();
    const auxiliarySourceSegments = input.target === "auxiliary"
      ? current.segments.map((segment) => ({ ordinal: segment.ordinal, text: segment.text }))
      : [];
    const sourceText = input.target === "auxiliary"
      ? JSON.stringify(auxiliarySourceSegments)
      : input.target === "reply"
        ? current.rewrittenText || current.originalText
        : current.originalText;
    if (!sourceText) throw new CardValidationError("No source content to generate from");
    const sourceHash = input.target === "auxiliary"
      ? (current.rewrittenText ? cardContentHash(current.rewrittenText) : null)
      : current.originalContentHash ?? (current.originalText ? cardContentHash(current.originalText) : null);
    if (!sourceHash) throw new CardValidationError("No original content version is available");
    if (input.usageApiVersion !== "v2") {
      await this.entitlementService.assertCanUse(input.userId, countCardCharacters(sourceText), { dateKey: current.dateKey });
    }
    const preference = await this.userPreferenceRepository.getByUserId(input.userId);
    const generationLanguageCode = input.target === "auxiliary"
      ? current.appLocaleSnapshot
      : input.target === "translation"
        ? preference.appLocale
        : preference.learningLanguage;
    const prompt = buildCardContentGenerationPrompt({
      target: input.target,
      sourceText,
      languageCode: input.target === "auxiliary" ? current.languageCode : preference.learningLanguage,
      appLocale: input.target === "auxiliary" ? current.appLocaleSnapshot : preference.appLocale,
      difficulty: current.promptDifficultySnapshot,
    });
    const maxOutputTokens = cardContentMaxOutputTokens(input.target, sourceText);
    const meteredPrompt = `${prompt.systemPrompt}\n${prompt.userPrompt}`;
    let output = "";
    let usage: Extract<ChatTextGenerationStreamEvent, { type: "done" }>["usage"];
    if (input.usageApiVersion === "v2") {
      if (!this.usageV2Service) throw new CardValidationError("V2 usage is unavailable");
      await this.usageV2Service.reserveTokens({
        userId: input.userId,
        requestId: input.requestId,
        feature: cardUsageFeature(input.target),
        estimatedTokens: estimateTokenReservation(meteredPrompt, maxOutputTokens),
        provider: this.aiProvider.providerName,
        model: this.aiProvider.modelName,
      });
    }
    const generate = () => this.aiProvider!.generateChatTextStream({
        userId: input.userId,
        text: prompt.userPrompt,
        // The provider prompt profile only accepts learning-language codes.
        // The explicit system prompt above controls the generated language;
        // translation/organization output is still stored with appLocale.
        languageCode: input.target === "auxiliary" ? current.languageCode : preference.learningLanguage,
        appLocale: input.target === "auxiliary" ? current.appLocaleSnapshot : preference.appLocale,
        promptDifficulty: current.promptDifficultySnapshot,
        companionMode: "rewrite_only",
        systemPrompt: prompt.systemPrompt,
        rawUserPrompt: true,
        maxOutputTokens,
      }, (event) => {
        if (event.type === "delta") output += event.text;
        if (event.type === "done") usage = event.usage;
      });
    try {
      if (this.resourceGovernor) {
        await this.executeForegroundLlm(input.userId, input.requestId, `card.generate.${input.target}`, generate);
      }
      else await generate();
    } catch (error) {
      if (input.usageApiVersion === "v2") {
        if (output.length > 0) {
          await settleGeneratedUsage(this.usageV2Service!, input.userId, input.requestId, usage, meteredPrompt, output, this.aiProvider)
            .catch(async () => this.usageV2Service?.releaseTokens(input.userId, input.requestId).catch(() => undefined));
        } else {
          await this.usageV2Service?.releaseTokens(input.userId, input.requestId).catch(() => undefined);
        }
      }
      throw error;
    }
    if (input.usageApiVersion === "v2") {
      await settleGeneratedUsage(this.usageV2Service!, input.userId, input.requestId, usage, meteredPrompt, output, this.aiProvider);
    }
    output = output.trim();
    if (!output) {
      if (input.usageApiVersion === "v2") await this.usageV2Service?.releaseTokens(input.userId, input.requestId).catch(() => undefined);
      throw new CardValidationError("Generated content is empty");
    }
    try {
      this.contentSafetyService?.assertAllowed(output, "output");
      await this.contentSafetyService?.assertAllowedRemote({
        text: output,
        stage: "output",
        requestId: input.requestId,
        userId: input.userId,
      });
    } catch (error) {
      if (input.usageApiVersion === "v2") {
        if (output.length > 0) {
          await settleGeneratedUsage(this.usageV2Service!, input.userId, input.requestId, usage, meteredPrompt, output, this.aiProvider)
            .catch(async () => this.usageV2Service?.releaseTokens(input.userId, input.requestId).catch(() => undefined));
        } else {
          await this.usageV2Service?.releaseTokens(input.userId, input.requestId).catch(() => undefined);
        }
      }
      throw error;
    }
    if (input.usageApiVersion !== "v2") {
      await this.entitlementService.consumeUpToLimit(
        input.userId,
        countCardCharacters(sourceText) + countCardCharacters(output),
        { dateKey: current.dateKey },
      );
    }
    if (input.target === "auxiliary") {
      if (!current.rewrittenText || !auxiliarySourceSegments.length) throw new CardValidationError("No finalized expression is available");
      let auxiliarySegments: Array<{ ordinal: number; text: string }>;
      try {
        auxiliarySegments = parseCardAuxiliaryOutput(output, auxiliarySourceSegments.map((segment) => segment.ordinal));
      } catch {
        throw new CardValidationError("Generated auxiliary content does not match the finalized expression segments");
      }
      const updated = await this.repository.saveAuxiliarySegments({
        entryId: current.id,
        userId: input.userId,
        expectedRewrittenText: current.rewrittenText,
        auxiliarySegments,
        auxiliaryLanguageCode: generationLanguageCode,
        auxiliarySourceHash: sourceHash,
      });
      if (!updated) throw new CardContentConflictError("The Card expression changed while auxiliary text was being generated");
      return this.detail(input.userId, input.recordId);
    }
    const patch: UpdateCardContentInput = input.target === "expression"
      ? { rewrittenText: output }
      : input.target === "translation"
        ? { translationText: output }
        : { replyText: output };
    const updated = await this.updateContent(input.userId, input.recordId, patch, {
      target: input.target,
      languageCode: generationLanguageCode,
      sourceHash,
    });
    if (input.target !== "expression" || !updated.rewrittenText) return updated;
    try {
      return await this.generateContent({
        ...input,
        requestId: `${input.requestId}_auxiliary`,
        target: "auxiliary",
      });
    } catch (error) {
      console.warn("[card] automatic auxiliary generation failed", error);
      return updated;
    }
  }

  async saveContent(input: {
    userId: string;
    requestId: string;
    recordId: string;
    body: SaveCardContentInput;
    usageApiVersion: "v2";
  }): Promise<CardRecordDetailView> {
    const parsed = parseCardRecordId(input.recordId);
    if (!parsed || parsed.source !== "card") throw new CardNotFoundError();
    const current = await this.repository.findByIdForUser(parsed.sourceId, input.userId);
    if (!current || current.status !== "completed") throw new CardNotFoundError();

    const originalText = normalizeCardBodyText(input.body.originalText);
    if (!originalText || countCardCharacters(originalText) > this.limits.contentMaxChars) {
      throw new CardValidationError("Invalid original content");
    }
    const selectedTargets = Array.from(new Set(input.body.selectedTargets));
    if (selectedTargets.some((target) => target !== "expression" && target !== "translation" && target !== "reply")) {
      throw new CardValidationError("Invalid generation target");
    }
    const originalChanged = normalizeCardContent(originalText) !== normalizeCardContent(current.originalText);
    const patch: UpdateCardContentInput = {
      ...(Object.prototype.hasOwnProperty.call(input.body, "title") ? { title: input.body.title } : {}),
      ...(Object.prototype.hasOwnProperty.call(input.body, "collectionId") ? { collectionId: input.body.collectionId } : {}),
      originalText,
      ...(!selectedTargets.includes("expression") ? { rewrittenText: null } : {}),
      ...(!selectedTargets.includes("translation") ? { translationText: null } : {}),
      ...(!selectedTargets.includes("reply") ? { replyText: null } : {}),
    };
    let detail = await this.updateContent(input.userId, input.recordId, patch);
    const existing = {
      expression: current.rewrittenText,
      translation: current.translationText,
      reply: current.replyText,
    };
    for (const target of selectedTargets) {
      if (!originalChanged && existing[target]) continue;
      detail = await this.generateContent({
        userId: input.userId,
        requestId: `${input.requestId}:${target}`,
        recordId: input.recordId,
        target,
        usageApiVersion: input.usageApiVersion,
      });
    }
    return detail;
  }

  async generateDraftContent(input: {
    userId: string;
    requestId: string;
    target: CardGeneratedContentTarget;
    sourceText: string;
    usageApiVersion: "v2";
  }): Promise<{ text: string }> {
    if (!this.aiProvider) throw new CardValidationError("Card generation is unavailable");
    const sourceText = normalizeCardBodyText(input.sourceText);
    if (!sourceText || countCardCharacters(sourceText) > this.limits.contentMaxChars) {
      throw new CardValidationError("Invalid generation source");
    }
    const preference = await this.userPreferenceRepository.getByUserId(input.userId);
    const dateKey = formatDateKeyInTimeZone(new Date());
    if (input.usageApiVersion !== "v2") {
      await this.entitlementService.assertCanUse(input.userId, countCardCharacters(sourceText), { dateKey });
    }
    const prompt = buildCardContentGenerationPrompt({
      target: input.target,
      sourceText,
      languageCode: preference.learningLanguage,
      appLocale: preference.appLocale,
      difficulty: preference.promptDifficulty,
    });
    const maxOutputTokens = cardContentMaxOutputTokens(input.target, sourceText);
    const meteredPrompt = `${prompt.systemPrompt}\n${prompt.userPrompt}`;
    let output = "";
    let usage: Extract<ChatTextGenerationStreamEvent, { type: "done" }>["usage"];
    if (input.usageApiVersion === "v2") {
      if (!this.usageV2Service) throw new CardValidationError("V2 usage is unavailable");
      await this.usageV2Service.reserveTokens({
        userId: input.userId,
        requestId: input.requestId,
        feature: cardUsageFeature(input.target),
        estimatedTokens: estimateTokenReservation(meteredPrompt, maxOutputTokens),
        provider: this.aiProvider.providerName,
        model: this.aiProvider.modelName,
      });
    }
    const generate = () => this.aiProvider!.generateChatTextStream({
        userId: input.userId,
        text: prompt.userPrompt,
        languageCode: preference.learningLanguage,
        appLocale: preference.appLocale,
        promptDifficulty: preference.promptDifficulty,
        companionMode: "rewrite_only",
        systemPrompt: prompt.systemPrompt,
        rawUserPrompt: true,
        maxOutputTokens,
      }, (event) => {
        if (event.type === "delta") output += event.text;
        if (event.type === "done") usage = event.usage;
      });
    try {
      if (this.resourceGovernor) {
        await this.executeForegroundLlm(input.userId, input.requestId, `card.preview.${input.target}`, generate);
      }
      else await generate();
    } catch (error) {
      if (output.length > 0) {
        await settleGeneratedUsage(this.usageV2Service!, input.userId, input.requestId, usage, meteredPrompt, output, this.aiProvider)
          .catch(async () => this.usageV2Service?.releaseTokens(input.userId, input.requestId).catch(() => undefined));
      } else {
        await this.usageV2Service?.releaseTokens(input.userId, input.requestId).catch(() => undefined);
      }
      throw error;
    }
    if (input.usageApiVersion === "v2") {
      await settleGeneratedUsage(this.usageV2Service!, input.userId, input.requestId, usage, meteredPrompt, output, this.aiProvider);
    }
    output = output.trim();
    if (!output) {
      if (input.usageApiVersion === "v2") await this.usageV2Service?.releaseTokens(input.userId, input.requestId).catch(() => undefined);
      throw new CardValidationError("Generated content is empty");
    }
    try {
      this.contentSafetyService?.assertAllowed(output, "output");
      await this.contentSafetyService?.assertAllowedRemote({ text: output, stage: "output", requestId: input.requestId, userId: input.userId });
    } catch (error) {
      if (input.usageApiVersion === "v2") await this.usageV2Service?.releaseTokens(input.userId, input.requestId).catch(() => undefined);
      throw error;
    }
    if (input.usageApiVersion !== "v2") {
      await this.entitlementService.consumeUpToLimit(input.userId, countCardCharacters(sourceText) + countCardCharacters(output), { dateKey });
    }
    return { text: output };
  }

  private async executeForegroundLlm<T>(
    userId: string,
    requestId: string,
    operation: string,
    task: () => Promise<T>,
  ): Promise<T> {
    if (!this.resourceGovernor) return task();
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.resourceGovernor.execute("llm", userId, task, { requestId, operation });
      } catch (error) {
        const retryDelayMs = FOREGROUND_LLM_RETRY_DELAYS_MS[attempt];
        const concurrencyLimited = error instanceof ResourceLimitedError
          && (error.scope === "user_concurrency" || error.scope === "global_concurrency");
        if (!concurrencyLimited || retryDelayMs === undefined) throw error;
        await delay(retryDelayMs);
      }
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
    offset = 0,
    fromDateKey?: string,
  ): Promise<CardRecordSummaryView[]> {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 100;
    const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
    if (fromDateKey) assertDateKey(fromDateKey);
    const entries = await this.repository.listByUser(userId, collectionId, safeLimit, safeOffset, fromDateKey);
    return Promise.all(entries.map((entry) => this.summaryWithImage(entry)));
  }

  async listLibraryPage(userId: string, input: {
    collectionId: string | null | undefined;
    dateKey?: string;
    fromDateKey?: string;
    limit?: number;
    cursor?: string;
    sort?: "newest" | "oldest";
  }) {
    if (input.dateKey) assertDateKey(input.dateKey);
    if (input.fromDateKey) assertDateKey(input.fromDateKey);
    if (input.dateKey && input.fromDateKey) throw new CardValidationError("Conflicting Card date filters");
    const configuredMax = Math.max(1, Math.min(50, Math.floor(this.listPageSizeMax)));
    const requestedLimit = Number.isFinite(input.limit) ? Math.floor(input.limit!) : configuredMax;
    const limit = Math.max(1, Math.min(configuredMax, requestedLimit));
    const cursor = input.cursor ? decodeCardCursor(input.cursor) : undefined;
    const entries = await this.repository.listPageByUser({
      userId,
      collectionId: input.collectionId,
      dateKey: input.dateKey,
      fromDateKey: input.fromDateKey,
      sortDirection: input.sort === "oldest" ? "asc" : "desc",
      limit: limit + 1,
      cursor,
    });
    const hasMore = entries.length > limit;
    const pageEntries = entries.slice(0, limit);
    const items = await Promise.all(pageEntries.map((entry) => this.summaryWithImage(entry)));
    const last = hasMore ? pageEntries[pageEntries.length - 1] : undefined;
    return { items, nextCursor: last ? encodeCardCursor(last.createdAt, last.id) : null };
  }

  async listDateKeys(userId: string, fromDateKey: string, toDateKey: string): Promise<string[]> {
    assertDateKey(fromDateKey);
    assertDateKey(toDateKey);
    if (fromDateKey > toDateKey) throw new CardValidationError("Invalid date range");
    return this.repository.listDateKeysByUser(userId, fromDateKey, toDateKey);
  }

  async calendarSummary(userId: string, fromDateKey: string, toDateKey: string) {
    assertDateKey(fromDateKey);
    assertDateKey(toDateKey);
    if (fromDateKey > toDateKey) throw new CardValidationError("Invalid calendar range");
    if (dateRangeDays(fromDateKey, toDateKey) > 370) throw new CardValidationError("Calendar range is too large");
    const [days, firstRecordDateKey] = await Promise.all([
      this.repository.aggregateCalendarByDate(userId, fromDateKey, toDateKey),
      this.repository.findEarliestCompletedDateKey(userId),
    ]);
    return {
      fromDateKey,
      toDateKey,
      firstRecordDateKey,
      totals: {
        cardCount: days.reduce((sum, day) => sum + day.cardCount, 0),
        originalChars: days.reduce((sum, day) => sum + day.originalChars, 0),
        recordedDays: days.length,
      },
      days,
    };
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
    let entry = await this.repository.findByIdForUser(parsed.sourceId, userId);
    if (!entry || entry.status !== "completed" || (!entry.originalText && !entry.rewrittenText)) {
      throw new CardNotFoundError();
    }
    if (!contentSegmentsUseCurrentVersion(entry)) {
      const expectedContentSegments = buildCardContentSegments([
        {
          contentType: "original",
          text: entry.originalText,
          languageCode: inferLearningTextLanguage(entry.originalText ?? "", entry.appLocaleSnapshot),
          sourceHash: entry.originalContentHash,
        },
        {
          contentType: "rewrite",
          text: entry.rewrittenText,
          languageCode: entry.rewrittenLanguageCode ?? entry.languageCode,
          sourceHash: entry.rewrittenSourceHash,
        },
        {
          contentType: "reply",
          text: entry.replyText,
          languageCode: entry.replyLanguageCode ?? entry.languageCode,
          sourceHash: entry.replySourceHash,
        },
      ]);
      const refreshed = await this.repository.refreshContentSegments({
        entryId: entry.id,
        userId,
        contentSegments: expectedContentSegments,
      });
      if (!refreshed) throw new CardNotFoundError();
      entry = refreshed;
    }
    const practiceState = await this.repository.findPracticeState(userId, entry.id);
    const contentBlocks = await Promise.all(["original", "rewrite", "reply"].flatMap((contentType) => {
      const typedContentType = contentType as CardLearningContentType;
      const segments = entry.contentSegments.filter((segment) => segment.contentType === typedContentType);
      if (!segments.length) return [];
      const contentVersion = segments[0]!.contentVersion;
      const text = contentText(entry, typedContentType);
      if (!text) return [];
      return [this.repository.findContentPracticeState(userId, entry.id, typedContentType).then((state) => ({
        contentType: typedContentType,
        contentVersion,
        text,
        languageCode: contentLanguageCode(entry, typedContentType),
        segments: segments.map((segment) => ({
          id: segment.id,
          ordinal: segment.ordinal,
          text: segment.text,
          startUtf16: segment.startUtf16,
          endUtf16: segment.endUtf16,
        })),
        practice: state?.contentVersion === contentVersion ? toPracticeView(state) : null,
      }))];
    }));
    const imageViews = this.imageService
      ? await Promise.all(entry.images.map((image) => this.imageService!.views(image)))
      : [];
    return {
      ...toSummary(entry, this.limits.topicMaxChars),
      thumbnail: imageViews[0]?.thumbnail ?? null,
      status: "completed",
      originalText: entry.originalText ?? "",
      rewrittenText: entry.rewrittenText,
      rewrittenLanguageCode: entry.rewrittenLanguageCode,
      translationText: entry.translationText,
      translationLanguageCode: entry.translationLanguageCode,
      auxiliarySegments: normalizeAuxiliarySegments(entry.auxiliarySegments),
      auxiliaryLanguageCode: entry.auxiliaryLanguageCode,
      replyText: entry.replyText,
      replyLanguageCode: entry.replyLanguageCode,
      rewriteSegments: entry.segments.map((segment) => ({
        id: segment.id,
        ordinal: segment.ordinal,
        text: segment.text,
        startUtf16: segment.startUtf16,
        endUtf16: segment.endUtf16,
      })),
      contentBlocks,
      images: imageViews.map((views) => ({ ...views.image, thumbnail: views.thumbnail })),
      image: imageViews[0] ? { ...imageViews[0].image, thumbnail: imageViews[0].thumbnail } : null,
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

  async trash(userId: string): Promise<CardRecordSummaryView[]> {
    const expiresBefore = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    while (await this.repository.deleteExpiredTrash(expiresBefore) === 500) {
      // Expired cards are deleted in bounded batches to keep each transaction small.
    }
    const entries = await this.repository.listDeletedByUser(userId);
    return Promise.all(entries.map((entry) => {
      // Deleted cards are still valid, user-visible cards while they are in the
      // trash. The regular summary mapper intentionally rejects `deleted`, so
      // expose them as completed summaries without mutating the stored state.
      const visibleEntry: CardEntryEntity = { ...entry, status: "completed" };
      return this.summaryWithImage(visibleEntry)
        .catch(() => toSummary(visibleEntry, this.limits.topicMaxChars));
    }));
  }

  async restore(userId: string, recordId: string): Promise<void> {
    const parsed = parseCardRecordId(recordId);
    if (!parsed || parsed.source !== "card" || !await this.repository.restoreDeleted(parsed.sourceId, userId)) throw new CardNotFoundError();
  }

  async permanentlyDelete(userId: string, recordId: string): Promise<void> {
    const parsed = parseCardRecordId(recordId);
    if (!parsed || parsed.source !== "card" || !await this.repository.permanentlyDelete(parsed.sourceId, userId)) throw new CardNotFoundError();
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
    const current = await this.repository.findByIdForUser(parsed.sourceId, userId);
    if (!current || current.status !== "completed") throw new CardNotFoundError();
    const trimmedImageUploadId = imageUploadId.trim();
    if (!current.images.some((image) => image.id === trimmedImageUploadId) && current.images.length >= this.limits.imagesMaxPerCard) {
      throw new CardValidationError(`A Card can contain up to ${this.limits.imagesMaxPerCard} images`);
    }
    try {
      const updated = await this.repository.appendEntryImage({
        entryId: parsed.sourceId,
        userId,
        imageUploadId: trimmedImageUploadId,
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

  async updateCoverFocus(userId: string, recordId: string, imageId: string, focusX: number, focusY: number): Promise<CardRecordDetailView> {
    const parsed = parseCardRecordId(recordId);
    if (!parsed || parsed.source !== "card" || !imageId.trim()) throw new CardValidationError("Invalid image");
    if (![focusX, focusY].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
      throw new CardValidationError("Invalid cover position");
    }
    const updated = await this.repository.updateEntryCoverFocus({
      entryId: parsed.sourceId,
      userId,
      imageId: imageId.trim(),
      focusX,
      focusY,
    });
    if (!updated) throw new CardNotFoundError();
    return this.detail(userId, recordId);
  }

  async updateDictation(
    userId: string,
    recordId: string,
    result: CardPracticeResult,
    binding?: { contentType?: unknown; contentVersion?: unknown },
  ): Promise<CardRecordDetailView["practice"]> {
    if (result !== "correct" && result !== "incorrect" && result !== "revealed") {
      throw new CardValidationError("Invalid dictation result");
    }
    const parsed = parseCardRecordId(recordId);
    if (!parsed || parsed.source !== "card") throw new CardNotFoundError();
    const entry = await this.repository.findByIdForUser(parsed.sourceId, userId);
    if (!entry || entry.status !== "completed") throw new CardNotFoundError();
    const contentBinding = resolveContentBinding(entry, binding);
    const entitlement = await this.entitlementService.getCurrentEntitlement(userId);
    if (!entitlement.isPro) throw new CardLearningAccessError("Dictation requires Pro");
    if (contentBinding) {
      const current = await this.repository.findContentPracticeState(userId, parsed.sourceId, contentBinding.contentType);
      if (current && current.contentVersion !== contentBinding.contentVersion) throw new CardPracticeConflictError();
      const correctStreak = result === "correct" ? (current?.dictationCorrectStreak ?? 0) + 1 : 0;
      const practicedAt = new Date();
      const nextReviewAt = new Date(practicedAt.getTime() + reviewDelayDays(result, correctStreak) * 86_400_000);
      return toPracticeView(await this.repository.saveContentDictationResult({
        userId,
        cardId: parsed.sourceId,
        ...contentBinding,
        result,
        practicedAt,
        nextReviewAt,
        correctStreak,
      }));
    }
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
    if (input.operation.type === "memory_result" && input.result !== "correct" && input.result !== "incorrect") {
      throw new CardValidationError("Memory result requires a first-attempt result");
    }
    const parsed = parseCardRecordId(recordId);
    if (!parsed || parsed.source !== "card") throw new CardNotFoundError();
    const detail = await this.detail(userId, recordId);
    const entry = await this.repository.findByIdForUser(parsed.sourceId, userId);
    if (!entry) throw new CardNotFoundError();
    const contentBinding = resolveContentBinding(entry, input);
    const effectiveContentType = contentBinding?.contentType ?? (entry.rewrittenText ? "rewrite" : "original");
    if (effectiveContentType === "original" && !(await this.entitlementService.getCurrentEntitlement(userId)).isPro) {
      throw new CardLearningAccessError("Original text practice requires Pro");
    }
    if (contentBinding) {
      return this.updateContentCloze(userId, parsed.sourceId, detail, input, contentBinding);
    }
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
      if (isTargetLanguageCode(detail.languageCode)) {
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
      }
    } else if (operation.type === "remove") {
      const index = state.blanks.findIndex((blank) => blank.id === operation.blankId);
      if (index < 0) throw new CardValidationError("Cloze blank does not exist");
      state.blanks.splice(index, 1);
      phraseMutation = { type: "remove", clozeBlankId: operation.blankId };
    } else if (operation.type === "master") {
      const blank = state.blanks.find((candidate) => candidate.id === operation.blankId);
      if (!blank) throw new CardValidationError("Cloze blank does not exist");
      blank.mastered = true;
    } else if (operation.type === "memory_result") {
      markMemoryResultBlanks(state, operation.blankIds);
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

  private async updateContentCloze(
    userId: string,
    cardId: string,
    detail: CardRecordDetailView,
    input: UpdateCardClozeInput,
    binding: { contentType: CardLearningContentType; contentVersion: string },
  ): Promise<CardRecordDetailView["practice"]> {
    const block = detail.contentBlocks.find((candidate) =>
      candidate.contentType === binding.contentType && candidate.contentVersion === binding.contentVersion,
    );
    if (!block) throw new CardPracticeConflictError();
    const current = await this.repository.findContentPracticeState(userId, cardId, binding.contentType);
    if (current && current.contentVersion !== binding.contentVersion) throw new CardPracticeConflictError();
    if ((current?.clozeVersion ?? 0) !== input.baseVersion) throw new CardPracticeConflictError();
    const state = normalizeClozeState(current?.clozeState);
    const operation = input.operation;
    let phraseMutation: Parameters<CardRepository["saveContentClozeState"]>[0]["phraseMutation"];
    if (operation.type === "add") {
      const segment = block.segments.find((candidate) => candidate.id === operation.segmentId);
      if (!segment) throw new CardValidationError("Cloze segment does not exist");
      const { startUtf16, endUtf16 } = operation;
      if (startUtf16 >= endUtf16 || !isUtf16GraphemeBoundary(segment.text, startUtf16) || !isUtf16GraphemeBoundary(segment.text, endUtf16)) {
        throw new CardValidationError("Invalid cloze range");
      }
      const answer = segment.text.slice(startUtf16, endUtf16);
      if (countGraphemes(answer) > 100 || !answer.trim()) throw new CardValidationError("Invalid cloze range");
      if (state.blanks.some((blank) => blank.segmentId === segment.id && startUtf16 < blank.endUtf16 && endUtf16 > blank.startUtf16)) {
        throw new CardValidationError("Cloze ranges cannot overlap");
      }
      const blank = { id: randomUUID(), segmentId: segment.id, startUtf16, endUtf16, answer };
      state.blanks.push(blank);
      const normalizedText = normalizePhraseSurface(answer, block.languageCode);
      if (!normalizedText) throw new CardValidationError("Invalid phrase content");
      if (isTargetLanguageCode(block.languageCode)) {
        phraseMutation = {
          type: "add",
          languageCode: block.languageCode,
          cardCreatedAt: new Date(detail.createdAt),
          segmentId: segment.id,
          startUtf16,
          endUtf16,
          surfaceText: answer,
          normalizedText,
          clozeBlankId: blank.id,
          normalizerVersion: PHRASE_NORMALIZER_VERSION,
          inputHash: createHash("sha256").update(`${block.languageCode}\n${normalizedText}`).digest("hex"),
        };
      }
    } else if (operation.type === "remove") {
      const index = state.blanks.findIndex((blank) => blank.id === operation.blankId);
      if (index < 0) throw new CardValidationError("Cloze blank does not exist");
      state.blanks.splice(index, 1);
      phraseMutation = { type: "remove", clozeBlankId: operation.blankId };
    } else if (operation.type === "master") {
      const blank = state.blanks.find((candidate) => candidate.id === operation.blankId);
      if (!blank) throw new CardValidationError("Cloze blank does not exist");
      blank.mastered = true;
    } else if (operation.type === "memory_result") {
      markMemoryResultBlanks(state, operation.blankIds);
    }
    const practicedAt = input.result ? new Date() : null;
    const correctStreak = input.result === "correct" ? (current?.clozeCorrectStreak ?? 0) + 1 : 0;
    const nextReviewAt = input.result && practicedAt
      ? new Date(practicedAt.getTime() + reviewDelayDays(input.result, correctStreak) * 86_400_000)
      : null;
    const saved = await this.repository.saveContentClozeState({
      userId,
      cardId,
      ...binding,
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
    const entryById = new Map(cardEntries.map((entry) => [entry.id, entry]));
    const sourceIds = records.map((record) => parseCardRecordId(record.id)!.sourceId);
    const [practiceStates, contentPracticeStates] = await Promise.all([
      this.repository.listPracticeStates(userId, sourceIds),
      this.repository.listContentPracticeStates(userId, sourceIds),
    ]);
    const practiceStateByCardId = new Map(practiceStates.map((state) => [state.cardId, state]));
    const contentStateByCardAndType = new Map(
      contentPracticeStates.map((state) => [`${state.cardId}:${state.contentType}`, state]),
    );
    const now = Date.now();
    const items = records.map((record) => {
      const parsed = parseCardRecordId(record.id)!;
      const entry = entryById.get(parsed.sourceId);
      const contentType = entry ? defaultLearningContentType(entry) : null;
      const state = contentType
        ? contentStateByCardAndType.get(`${parsed.sourceId}:${contentType}`)
        : practiceStateByCardId.get(parsed.sourceId);
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
    });
    return items.filter((item): item is NonNullable<typeof item> => item !== null).slice(0, safeLimit);
  }

  async memoryRoundCandidates(
    userId: string,
    limit: number,
    requested?: Array<{ recordId: string; contentType: CardLearningContentType | null; contentVersion: string | null }>,
  ): Promise<CardMemoryRoundCandidateView[]> {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(60, Math.floor(limit))) : 40;
    const requestedBySourceId = new Map<string, NonNullable<typeof requested>[number]>();
    const sourceIds = requested?.flatMap((item) => {
      const parsed = parseCardRecordId(item.recordId);
      if (parsed?.source === "card") requestedBySourceId.set(parsed.sourceId, item);
      return parsed?.source === "card" ? [parsed.sourceId] : [];
    });
    const entitlement = await this.entitlementService.getCurrentEntitlement(userId);
    const entries = await this.repository.listMemoryRoundEntries(
      userId,
      sourceIds ? Math.min(60, sourceIds.length || 1) : 500,
      sourceIds,
      entitlement.isPro,
    );
    const eligibleEntries = entries.filter((entry) => !entry.isSample && !entry.deletedAt && entry.status === "completed");
    const cardIds = eligibleEntries.map((entry) => entry.id);
    const [legacyStates, contentStates] = await Promise.all([
      this.repository.listPracticeStates(userId, cardIds),
      this.repository.listContentPracticeStates(userId, cardIds),
    ]);
    const legacyByCard = new Map(legacyStates.map((state) => [state.cardId, state]));
    const contentByCard = new Map<string, typeof contentStates>();
    for (const state of contentStates) {
      const states = contentByCard.get(state.cardId) ?? [];
      states.push(state);
      contentByCard.set(state.cardId, states);
    }
    const now = Date.now();
    const ranked = eligibleEntries.flatMap((entry) => {
      const requestedBinding = requestedBySourceId.get(entry.id);
      const currentContentStates = (contentByCard.get(entry.id) ?? [])
        .filter((state) => {
          const cloze = normalizeClozeState(state.clozeState);
          return (!requestedBinding || requestedBinding.contentType === state.contentType && requestedBinding.contentVersion === state.contentVersion)
            && (state.contentType !== "original" || entitlement.isPro) && cloze.blanks.length > 0 && entry.contentSegments.some((segment) =>
            segment.contentType === state.contentType && segment.contentVersion === state.contentVersion,
          );
        });
      currentContentStates.sort((left, right) =>
        memoryRoundPriority(left.clozeLastResult, left.clozeNextReviewAt, left.updatedAt, now)
        - memoryRoundPriority(right.clozeLastResult, right.clozeNextReviewAt, right.updatedAt, now)
        || memoryContentPriority(left.contentType) - memoryContentPriority(right.contentType),
      );
      const contentState = currentContentStates[0] ?? null;
      const legacyState = contentState || requestedBinding?.contentType ? null : legacyByCard.get(entry.id) ?? null;
      if (!contentState && legacyState && !entry.rewrittenText && !entitlement.isPro) return [];
      const state = contentState ?? legacyState;
      if (!state) return [];
      const clozeState = normalizeClozeState(state.clozeState);
      if (!clozeState.blanks.length) return [];
      const contentType = contentState?.contentType ?? null;
      const contentVersion = contentState?.contentVersion ?? null;
      const segments = contentState
        ? entry.contentSegments.filter((segment) => segment.contentType === contentState.contentType && segment.contentVersion === contentState.contentVersion)
        : entry.segments;
      if (!segments.length) return [];
      return [{
        entry,
        state,
        contentType,
        contentVersion,
        clozeState,
        segments,
        priority: memoryRoundPriority(state.clozeLastResult, state.clozeNextReviewAt, state.updatedAt, now),
        random: Math.random(),
      }];
    }).sort((left, right) => left.priority - right.priority || left.random - right.random)
      .slice(0, safeLimit);

    return Promise.all(ranked.map(async ({ entry, state, contentType, contentVersion, clozeState, segments }) => {
      const summary = await this.summaryWithImage(entry).catch(() => toSummary(entry, this.limits.topicMaxChars));
      return {
        recordId: summary.id,
        title: summary.title,
        displayTitle: summary.displayTitle,
        languageCode: contentType ? contentLanguageCode(entry, contentType) : entry.rewrittenLanguageCode ?? entry.languageCode,
        thumbnail: summary.thumbnail,
        createdAt: summary.createdAt,
        contentType,
        contentVersion,
        segments: segments.map((segment) => ({
          id: segment.id,
          ordinal: segment.ordinal,
          text: segment.text,
          startUtf16: segment.startUtf16,
          endUtf16: segment.endUtf16,
        })),
        clozeState,
        clozeVersion: state.clozeVersion,
        clozeLastResult: state.clozeLastResult,
        clozeNextReviewAt: state.clozeNextReviewAt?.toISOString() ?? null,
      };
    }));
  }

  private async summaryWithImage(entry: CardEntryEntity): Promise<CardRecordSummaryView> {
    const summary = toSummary(entry, this.limits.topicMaxChars);
    const firstImage = entry.images[0];
    if (!firstImage || !this.imageService) return summary;
    const views = await this.imageService.views(firstImage);
    return { ...summary, thumbnail: { ...views.thumbnail, focusX: firstImage.focusX, focusY: firstImage.focusY } };
  }
}

function contentSegmentsUseCurrentVersion(entry: CardEntryEntity): boolean {
  const expectedTypes = new Set<CardLearningContentType>();
  if (entry.originalText?.trim()) expectedTypes.add("original");
  if (entry.rewrittenText?.trim()) expectedTypes.add("rewrite");
  if (entry.replyText?.trim()) expectedTypes.add("reply");
  const actualTypes = new Set(entry.contentSegments.map((segment) => segment.contentType));
  return expectedTypes.size === actualTypes.size &&
    [...expectedTypes].every((contentType) => actualTypes.has(contentType)) &&
    entry.contentSegments.length > 0 &&
    entry.contentSegments.every((segment) => segment.contentVersion.startsWith(`${LEARNING_SENTENCE_SEGMENTER_VERSION}:`));
}

function reviewDelayDays(result: CardPracticeResult, correctStreak: number): number {
  if (result !== "correct") return 1;
  if (correctStreak <= 1) return 3;
  if (correctStreak === 2) return 7;
  return 14;
}

function memoryContentPriority(contentType: CardLearningContentType): number {
  if (contentType === "rewrite") return 0;
  if (contentType === "reply") return 1;
  return 2;
}

function memoryRoundPriority(
  lastResult: CardPracticeResult | null,
  nextReviewAt: Date | null,
  updatedAt: Date,
  now: number,
): number {
  if (nextReviewAt && nextReviewAt.getTime() <= now) return 0;
  if (lastResult === "incorrect" || lastResult === "revealed") return 1;
  if (lastResult === null) return 2;
  if (updatedAt.getTime() <= now - 30 * 86_400_000) return 3;
  return 4;
}

export function markMemoryResultBlanks(state: CardClozeState, blankIds: string[]): void {
  const blanks = new Map(state.blanks.map((blank) => [blank.id, blank]));
  const targets = blankIds.map((blankId) => blanks.get(blankId));
  if (targets.some((blank) => !blank)) throw new CardPracticeConflictError();
  for (const blank of targets) blank!.mastered = true;
}

function normalizePatchedText(
  patch: UpdateCardContentInput,
  key: keyof UpdateCardContentInput,
  current: string | null,
  maxChars: number,
): string | null {
  if (!(key in patch)) return current;
  const value = patch[key];
  if (value == null) return null;
  const trimmed = normalizeCardBodyText(value);
  if (countCardCharacters(trimmed) > maxChars) {
    throw new CardValidationError(`Card content must not exceed ${maxChars} characters`);
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

function contentText(entry: CardEntryEntity, contentType: CardLearningContentType): string | null {
  if (contentType === "original") return entry.originalText;
  if (contentType === "rewrite") return entry.rewrittenText;
  return entry.replyText;
}

function contentLanguageCode(entry: CardEntryEntity, contentType: CardLearningContentType): string {
  if (contentType === "original") return inferLearningTextLanguage(entry.originalText ?? "", entry.appLocaleSnapshot);
  if (contentType === "rewrite") return entry.rewrittenLanguageCode ?? entry.languageCode;
  return entry.replyLanguageCode ?? entry.languageCode;
}

function defaultLearningContentType(entry: CardEntryEntity): CardLearningContentType | null {
  for (const contentType of ["rewrite", "reply", "original"] as const) {
    if (entry.contentSegments.some((segment) => segment.contentType === contentType)) return contentType;
  }
  return null;
}

function resolveContentBinding(
  entry: CardEntryEntity,
  value?: { contentType?: unknown; contentVersion?: unknown },
): { contentType: CardLearningContentType; contentVersion: string } | null {
  const hasType = value?.contentType !== undefined;
  const hasVersion = value?.contentVersion !== undefined;
  if (!hasType && !hasVersion) return null;
  if (!hasType || !hasVersion ||
    (value?.contentType !== "original" && value?.contentType !== "rewrite" && value?.contentType !== "reply") ||
    typeof value.contentVersion !== "string" || !value.contentVersion) {
    throw new CardValidationError("Invalid content binding");
  }
  const exists = entry.contentSegments.some((segment) =>
    segment.contentType === value.contentType && segment.contentVersion === value.contentVersion,
  );
  if (!exists) throw new CardPracticeConflictError();
  return { contentType: value.contentType, contentVersion: value.contentVersion };
}

function isPracticeResult(value: unknown): value is CardPracticeResult {
  return value === "correct" || value === "incorrect" || value === "revealed";
}

function isClozeOperation(value: unknown): value is UpdateCardClozeInput["operation"] {
  if (!value || typeof value !== "object" || !("type" in value)) return false;
  if (value.type === "result") return true;
  if (value.type === "master") return "blankId" in value && typeof value.blankId === "string" && Boolean(value.blankId.trim());
  if (value.type === "remove") return "blankId" in value && typeof value.blankId === "string" && Boolean(value.blankId.trim());
  if (value.type === "memory_result") return "blankIds" in value && Array.isArray(value.blankIds) && value.blankIds.length > 0 && value.blankIds.length <= 100 && value.blankIds.every((blankId) => typeof blankId === "string" && Boolean(blankId.trim()));
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
  return { schemaVersion: 1, blanks: blanks.map((blank) => ({ ...blank, mastered: blank.mastered === true })) };
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

export function toSummary(entry: CardEntryEntity, topicMaxChars = CARD_TOPIC_MAX_CHARS): CardRecordSummaryView {
  if (entry.status !== "queued" && entry.status !== "processing" && entry.status !== "completed") {
    throw new CardNotFoundError();
  }
  return {
    id: cardRecordId("card", entry.id),
    title: entry.title,
    displayTitle: effectiveCardTitle(entry, topicMaxChars),
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

function normalizeTitle(value: string | null | undefined, maxChars = DEFAULT_CARD_TITLE_MAX_CHARS): string | null {
  const normalized = normalizeCardTitleText(value);
  if (!normalized) return null;
  if (countCardCharacters(normalized) > maxChars) {
    throw new CardValidationError(`Card title must not exceed ${maxChars} characters`);
  }
  return normalized;
}

function effectiveCardTitle(entry: CardEntryEntity, topicMaxChars = CARD_TOPIC_MAX_CHARS): string {
  const title = entry.title?.trim();
  if (title) return title;
  const topic = entry.topic?.trim();
  if (topic) return truncateGraphemes(topic, topicMaxChars);
  const firstLine = (entry.originalText ?? entry.rewrittenText ?? "")
    .split(/\n/u)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
  return truncateGraphemes(firstLine, topicMaxChars);
}

function resolveContentLanguage(input: {
  patch: UpdateCardContentInput;
  key: "rewrittenText" | "translationText" | "replyText";
  nextText: string | null;
  currentText: string | null;
  currentLanguageCode: string | null;
  defaultLanguageCode: string;
  generated?: { target: CardGeneratedContentTarget; languageCode: string; sourceHash: string };
  target: CardGeneratedContentTarget;
}): string | null {
  if (!input.nextText) return null;
  if (!Object.prototype.hasOwnProperty.call(input.patch, input.key)) return input.currentLanguageCode;
  if (input.generated?.target === input.target) return input.generated.languageCode;
  if (input.nextText === input.currentText && input.currentLanguageCode) return input.currentLanguageCode;
  return input.currentLanguageCode ?? input.defaultLanguageCode;
}

function resolveSourceHash(input: {
  patch: UpdateCardContentInput;
  key: "rewrittenText" | "translationText" | "replyText";
  nextText: string | null;
  currentSourceHash: string | null;
  sourceHash: string | null;
  originalChanged: boolean;
}): string | null {
  if (input.originalChanged || !input.nextText) return null;
  if (!Object.prototype.hasOwnProperty.call(input.patch, input.key)) return input.currentSourceHash;
  return input.sourceHash;
}

function cardContentHash(text: string): string {
  return `sha256:${createHash("sha256").update(normalizeCardContent(text)).digest("hex")}`;
}

function normalizeCardContent(text: string | null): string {
  return normalizeCardLineEndings(text ?? "").normalize("NFKC").trim();
}

function normalizeAuxiliarySegments(value: unknown): Array<{ ordinal: number; text: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const ordinal = (row as { ordinal?: unknown }).ordinal;
    const text = (row as { text?: unknown }).text;
    return Number.isInteger(ordinal) && typeof text === "string" && text.trim()
      ? [{ ordinal: ordinal as number, text: text.trim() }]
      : [];
  }).sort((left, right) => left.ordinal - right.ordinal);
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

function cardUsageFeature(target: CardGeneratedContentTarget): "rewrite" | "organization" | "reply" {
  if (target === "expression") return "rewrite";
  if (target === "translation" || target === "auxiliary") return "organization";
  return "reply";
}

function estimateTokenReservation(prompt: string, maxOutputTokens: number): number {
  return Math.max(1, Array.from(prompt).length + maxOutputTokens);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function settleGeneratedUsage(
  service: UsageV2Service,
  userId: string,
  requestId: string,
  usage: Extract<ChatTextGenerationStreamEvent, { type: "done" }>["usage"],
  prompt: string,
  output: string,
  provider: AIProvider,
): Promise<void> {
  const inputTokens = usage?.inputTokens ?? Math.ceil(Array.from(prompt).length / 2);
  const outputTokens = usage?.outputTokens ?? Math.ceil(Array.from(output).length / 2);
  await service.settleTokens({
    userId,
    requestId,
    inputTokens,
    outputTokens,
    meteringSource: usage ? "provider" : "tokenizer",
    provider: provider.providerName,
    model: provider.modelName,
  });
}

function dateRangeDays(fromDateKey: string, toDateKey: string): number {
  const from = Date.parse(`${fromDateKey}T00:00:00.000Z`);
  const to = Date.parse(`${toDateKey}T00:00:00.000Z`);
  return Math.floor((to - from) / 86_400_000) + 1;
}

function encodeCardCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ v: 1, createdAt: createdAt.toISOString(), id }), "utf8").toString("base64url");
}

function decodeCardCursor(value: string): { createdAt: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    const createdAt = new Date(String(parsed.createdAt ?? ""));
    const id = typeof parsed.id === "string" ? parsed.id : "";
    if (parsed.v !== 1 || !id || !Number.isFinite(createdAt.getTime())) throw new Error("invalid");
    return { createdAt, id };
  } catch {
    throw new CardValidationError("Invalid Card cursor");
  }
}
