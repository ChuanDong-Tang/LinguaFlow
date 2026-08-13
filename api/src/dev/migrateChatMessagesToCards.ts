import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { countGraphemes, truncateGraphemes } from "@lf/core/text/grapheme.js";
import { inferLearningTextLanguage, segmentLearningSentences } from "@lf/core/text/learningText.js";
import { normalizePhraseSurface, PHRASE_NORMALIZER_VERSION } from "@lf/core/text/phraseNormalization.js";
import { isTargetLanguageCode } from "@lf/core/language/targetLanguages.js";
import { CARD_TOPIC_PROMPT_VERSION } from "@lf/core/Prompts/cardTopicPrompt.js";
import { parseTaggedRewriteOutput } from "@lf/core/Prompts/rewriteAssistantPrompt.js";

type Args = {
  email: string | null;
  all: boolean;
  apply: boolean;
  databaseLine: number | null;
};

type Candidate = {
  userMessageId: string;
  originalText: string;
  rewrittenText: string;
  translationText: string;
  replyText: string;
  topic: string;
  dateKey: string;
  languageCode: string;
  createdAt: Date;
  publishedAt: Date;
  clozeState: MessageClozeState | null;
  clozeVersion: number;
};

type MessageClozeState = {
  groups: Array<{ tokenIndexes: number[]; blankTokenIndexes: number[] }>;
  correctTokenIndexes: number[];
};

type CardSegment = {
  id: string;
  contentVersion: string;
  startUtf16: number;
  endUtf16: number;
};

type CardClozeBlank = {
  id: string;
  segmentId: string;
  startUtf16: number;
  endUtf16: number;
  answer: string;
  mastered: boolean;
};

type CardClozeState = { schemaVersion: 1; blanks: CardClozeBlank[] };

type ClozePhraseAnchor = {
  segmentId: string | null;
  startUtf16: number;
  endUtf16: number;
  surfaceText: string;
  representativeBlankId: string;
};

const CARD_CLIENT_VERSION = "chat-message:v1";
const LEGACY_MIGRATION_VERSION = "legacy_chat_to_card_v1";
const MIGRATION_CONTENT_VERSION = "legacy_chat_to_card_v3";
const APPLY_CONFIRMATION = "chat-to-card-migration";

const args = parseArgs(process.argv.slice(2));
loadDatabaseUrl(args.databaseLine);

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const users = await prisma.user.findMany({
    where: args.all
      ? { status: "active" }
      : { email: { equals: args.email!, mode: "insensitive" } },
    select: {
      id: true,
      status: true,
      preference: {
        select: {
          appLocale: true,
          learningLanguage: true,
          promptDifficulty: true,
        },
      },
    },
  });
  if (!args.all && users.length !== 1) {
    throw new Error(`Expected one user for email, found ${users.length}`);
  }
  if (!users.length) throw new Error(args.all ? "No users found" : "User not found");
  for (const user of users) {
    if (!args.all && user.status !== "active") throw new Error("User is not active");

  const assistantMessages = await prisma.message.findMany({
    where: {
      userId: user.id,
      role: "assistant",
      status: "success",
      sourceMessageId: { not: null },
    },
    select: {
      content: true,
      createdAt: true,
      sourceMessageId: true,
      clozeState: true,
      clozeVersion: true,
      languageCode: true,
      conversation: {
        select: {
          dateKey: true,
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const sourceIds = assistantMessages
    .map((message) => message.sourceMessageId)
    .filter((id): id is string => Boolean(id));
  const userMessages = await prisma.message.findMany({
    where: {
      id: { in: sourceIds },
      userId: user.id,
      role: "user",
      status: "success",
    },
    select: {
      id: true,
      content: true,
      createdAt: true,
      conversationDateKey: true,
      languageCode: true,
    },
  });
  const userMessagesById = new Map(userMessages.map((message) => [message.id, message]));
  const candidatesBySourceId = new Map<string, Candidate>();
  let skippedMissingSource = 0;
  let skippedEmpty = 0;

  for (const assistant of assistantMessages) {
    const source = assistant.sourceMessageId
      ? userMessagesById.get(assistant.sourceMessageId)
      : undefined;
    if (!source) {
      skippedMissingSource += 1;
      continue;
    }
    const originalText = source.content.trim();
    const tagged = parseTaggedRewriteOutput(assistant.content);
    const rewrittenText = (tagged.en || tagged.rewrite).trim();
    if (!originalText || !rewrittenText) {
      skippedEmpty += 1;
      continue;
    }
    // Messages are ordered oldest first. If the same user message was regenerated,
    // keep only its latest successful assistant result.
    candidatesBySourceId.set(source.id, {
      userMessageId: source.id,
      originalText,
      rewrittenText,
      translationText: (tagged.note || tagged.zh).trim(),
      replyText: tagged.reply.trim(),
      topic: buildNaturalTopic(originalText),
      dateKey: source.conversationDateKey || assistant.conversation.dateKey,
      languageCode: assistant.languageCode || user.preference?.learningLanguage || "en-US",
      createdAt: source.createdAt,
      publishedAt: assistant.createdAt,
      clozeState: normalizeMessageClozeState(assistant.clozeState),
      clozeVersion: Math.max(0, assistant.clozeVersion),
    });
  }
  const candidates = Array.from(candidatesBySourceId.values());

  const clientIds = candidates.flatMap((candidate) => migrationClientIds(candidate.userMessageId));
  const existing = await prisma.card.findMany({
    where: { userId: user.id, clientId: { in: clientIds } },
    select: {
      id: true,
      clientId: true,
      originalText: true,
      rewrittenText: true,
      promptVersion: true,
      status: true,
      deletedAt: true,
    },
  });
  const existingByClientId = new Map(existing.map((card) => [card.clientId, card]));
  const existingCardsFor = (candidate: Candidate) => migrationClientIds(candidate.userMessageId)
    .map((clientId) => existingByClientId.get(clientId))
    .filter((card): card is (typeof existing)[number] => Boolean(card));
  const pending = candidates.filter(
    (candidate) => existingCardsFor(candidate).length === 0,
  );
  const exactExisting = candidates.filter((candidate) => {
    const cards = existingCardsFor(candidate);
    const card = cards[0];
    return cards.length === 1 && card && card.status === "completed" && !card.deletedAt && sameMigratedContent(card, candidate);
  });
  const divergentExisting = candidates.filter((candidate) => {
    const cards = existingCardsFor(candidate);
    const card = cards[0];
    return cards.length === 1 && card && (card.status !== "completed" || Boolean(card.deletedAt) || !sameMigratedContent(card, candidate));
  });
  const duplicateSourceCards = candidates.filter((candidate) => existingCardsFor(candidate).length > 1);
  const withCloze = candidates.filter((candidate) => countMessageBlanks(candidate.clozeState) > 0);

  console.log(JSON.stringify({
    mode: args.apply ? "apply" : "dry-run",
    userId: user.id,
    pairedAssistantMessages: assistantMessages.length,
    candidates: candidates.length,
    alreadyMigrated: existing.length,
    pending: pending.length,
    safelyReconciledOnApply: exactExisting.length,
    skippedDivergedExisting: divergentExisting.length,
    duplicateSourceCards: duplicateSourceCards.length,
    withCloze: withCloze.length,
    skippedMissingSource,
    skippedEmpty,
    dateRange: candidates.length
      ? {
          from: candidates[0].dateKey,
          to: candidates[candidates.length - 1].dateKey,
        }
      : null,
  }, null, 2));

  if (!args.apply || candidates.length === 0) continue;

  const appLocale = user.preference?.appLocale || "zh-CN";
  const promptDifficulty = user.preference?.promptDifficulty || "native";
  let created = 0;
  let migratedCloze = 0;
  let reconciled = 0;
  let verifiedClozePhraseAnchors = 0;
  let skippedDiverged = 0;
  let skippedChangedCloze = 0;
  let skippedDuplicateSource = 0;
  for (const candidate of candidates) {
    const outcome = await prisma.$transaction(async (tx) => {
      const clientIds = migrationClientIds(candidate.userMessageId);
      const matchingCards = await tx.card.findMany({
        where: { userId: user.id, clientId: { in: clientIds } },
        select: {
          id: true,
          clientId: true,
          originalText: true,
          originalContentHash: true,
          rewrittenText: true,
          rewrittenSourceHash: true,
          translationText: true,
          replyText: true,
          promptVersion: true,
          status: true,
          deletedAt: true,
          createdAt: true,
        },
        take: 2,
      });
      if (matchingCards.length > 1) return { kind: "duplicate_source" as const, phraseCount: 0 };
      let card = matchingCards[0] ?? null;
      let wasCreated = false;
      if (!card) {
        const sourceHash = cardContentHash(candidate.originalText);
        card = await tx.card.create({
          data: {
            userId: user.id,
            dateKey: candidate.dateKey,
            originalText: candidate.originalText,
            originalContentHash: sourceHash,
            rewrittenText: candidate.rewrittenText,
            rewrittenLanguageCode: candidate.languageCode,
            rewrittenSourceHash: sourceHash,
            translationText: candidate.translationText || null,
            translationLanguageCode: candidate.translationText ? appLocale : null,
            translationSourceHash: candidate.translationText ? sourceHash : null,
            replyText: candidate.replyText || null,
            replyLanguageCode: candidate.replyText ? candidate.languageCode : null,
            replySourceHash: candidate.replyText ? sourceHash : null,
            languageCode: candidate.languageCode,
            appLocaleSnapshot: appLocale,
            promptDifficultySnapshot: promptDifficulty,
            promptVersion: MIGRATION_CONTENT_VERSION,
            status: "completed",
            clientId: currentMigrationClientId(candidate.userMessageId),
            inputChars: countGraphemes(candidate.originalText),
            outputChars: countGraphemes(candidate.rewrittenText),
            // Keep a readable fallback until the normal asynchronous Topic worker finishes.
            topic: candidate.topic,
            publishedAt: candidate.publishedAt,
            createdAt: candidate.createdAt,
            updatedAt: candidate.publishedAt,
          },
          select: {
            id: true,
            clientId: true,
            originalText: true,
            originalContentHash: true,
            rewrittenText: true,
            rewrittenSourceHash: true,
            translationText: true,
            replyText: true,
            promptVersion: true,
            status: true,
            deletedAt: true,
            createdAt: true,
          },
        });
        wasCreated = true;
      }
      if (card.status !== "completed" || card.deletedAt || !sameMigratedContent(card, candidate)) {
        return { kind: "diverged" as const, phraseCount: 0 };
      }
      if (!card.originalContentHash) {
        const sourceHash = cardContentHash(candidate.originalText);
        await tx.card.update({
          where: { id: card.id },
          data: {
            originalContentHash: sourceHash,
            ...(!card.rewrittenSourceHash ? { rewrittenSourceHash: sourceHash } : {}),
          },
        });
        card.originalContentHash = sourceHash;
        card.rewrittenSourceHash ||= sourceHash;
      }

      const blocks = [
        { contentType: "original", text: card.originalText, languageCode: inferLearningTextLanguage(card.originalText!, appLocale), sourceHash: card.originalContentHash },
        { contentType: "rewrite", text: card.rewrittenText, languageCode: candidate.languageCode, sourceHash: card.rewrittenSourceHash || card.originalContentHash },
        { contentType: "reply", text: card.replyText, languageCode: candidate.languageCode, sourceHash: card.originalContentHash },
      ] as const;
      for (const block of blocks) {
        if (!block.text?.trim()) continue;
        const contentVersion = cardContentVersion(block.contentType, block.text, block.sourceHash);
        if (!await tx.cardContentSegment.count({ where: { entryId: card.id, contentType: block.contentType } })) {
          const segments = segmentLearningSentences({ text: block.text, languageCode: block.languageCode, minSegmentChars: 1, maxSegmentChars: 800 });
          if (segments.length) {
            await tx.cardContentSegment.createMany({
              data: segments.map((segment, ordinal) => ({ entryId: card.id, contentType: block.contentType, contentVersion, ordinal, text: segment.text, startUtf16: segment.textStart, endUtf16: segment.textEnd })),
            });
          }
        }
      }

      if (!await tx.cardRewriteSegment.count({ where: { entryId: card.id } }) && card.rewrittenText?.trim()) {
        const segments = segmentLearningSentences({ text: card.rewrittenText, languageCode: candidate.languageCode, minSegmentChars: 1, maxSegmentChars: 800 });
        if (segments.length) await tx.cardRewriteSegment.createMany({
          data: segments.map((segment, ordinal) => ({ entryId: card.id, ordinal, text: segment.text, startUtf16: segment.textStart, endUtf16: segment.textEnd })),
        });
      }

      let clozeResult: "none" | "created" | "matched" | "changed" = "none";
      let phraseCount = 0;
      if (card.rewrittenText?.trim() === candidate.rewrittenText && countMessageBlanks(candidate.clozeState) > 0) {
        const rewriteSegments = await tx.cardContentSegment.findMany({
          where: { entryId: card.id, contentType: "rewrite" },
          orderBy: { ordinal: "asc" },
          select: { id: true, contentVersion: true, startUtf16: true, endUtf16: true },
        });
        const expected = buildCardClozeState(candidate.rewrittenText, candidate.clozeState, rewriteSegments);
        if (
          expected.state.blanks.length !== countMessageBlanks(candidate.clozeState) ||
          expected.anchors.length !== countMessagePhraseGroups(candidate.clozeState)
        ) {
          throw new Error(`Cloze migration mapping is incomplete for message ${candidate.userMessageId}`);
        }
        const practice = await tx.cardContentPracticeState.findUnique({
          where: { cardId_contentType: { cardId: card.id, contentType: "rewrite" } },
          select: { clozeState: true },
        });
        let persistedState: CardClozeState | null = practice ? normalizeCardClozeState(practice.clozeState) : null;
        if (!practice) {
          if (expected.state.blanks.length) {
            const mastered = expected.state.blanks.filter((blank) => blank.mastered).length;
            await tx.cardContentPracticeState.create({
              data: {
                userId: user.id,
                cardId: card.id,
                contentType: "rewrite",
                contentVersion: rewriteSegments[0]!.contentVersion,
                clozeState: expected.state,
                clozeVersion: Math.max(1, candidate.clozeVersion),
                clozeLastResult: mastered === expected.state.blanks.length ? "correct" : mastered > 0 ? "incorrect" : null,
                clozeCorrectStreak: mastered === expected.state.blanks.length ? 1 : 0,
              },
            });
            persistedState = expected.state;
            clozeResult = "created";
          }
        }
        if (persistedState) {
          const anchors = bindExpectedAnchorsToPersistedState(expected, persistedState);
          if (anchors) {
            for (const anchor of anchors) {
              if (await registerClozePhrase(tx, {
                userId: user.id,
                cardId: card.id,
                cardCreatedAt: card.createdAt,
                languageCode: candidate.languageCode,
                anchor,
              })) phraseCount += 1;
            }
            if (clozeResult === "none") clozeResult = "matched";
          } else {
            clozeResult = "changed";
          }
        }
      }

      const embeddingInputHash = createHash("sha256")
        .update(`Original: ${candidate.originalText}\nExpression: ${candidate.rewrittenText}`)
        .digest("hex");
      for (const job of [
        {
          jobType: "generate_topic",
          inputHash: card.originalContentHash,
          inputVersion: `${CARD_TOPIC_PROMPT_VERSION}:${card.originalContentHash}`,
          payload: { schemaVersion: 1, platformFunded: true },
        },
        {
          jobType: "generate_embedding",
          inputHash: embeddingInputHash,
          inputVersion: `card_embedding_input_v1:${embeddingInputHash}`,
          payload: { schemaVersion: 1 },
        },
        {
          jobType: "index_card_phrases",
          inputHash: embeddingInputHash,
          inputVersion: `card_phrase_index_v1:${embeddingInputHash}`,
          payload: { schemaVersion: 1 },
        },
        {
          jobType: "detect_progress_phrases",
          inputHash: embeddingInputHash,
          inputVersion: `progress_phrase_detection_v1:${embeddingInputHash}`,
          payload: { schemaVersion: 1 },
        },
      ] as const) {
        await ensureEnrichmentJob(tx, {
          userId: user.id,
          sourceKind: "card",
          sourceId: card.id,
          ...job,
        });
      }
      return { kind: wasCreated ? "created" as const : "reconciled" as const, clozeResult, phraseCount };
    });
    if (outcome.kind === "diverged") {
      skippedDiverged += 1;
      continue;
    }
    if (outcome.kind === "duplicate_source") {
      skippedDuplicateSource += 1;
      continue;
    }
    if (outcome.kind === "created") created += 1;
    else reconciled += 1;
    if (outcome.clozeResult === "created") migratedCloze += 1;
    if (outcome.clozeResult === "changed") skippedChangedCloze += 1;
    verifiedClozePhraseAnchors += outcome.phraseCount;
  }
  console.log(JSON.stringify({
    created,
    reconciled,
    migratedCloze,
    verifiedClozePhraseAnchors,
    skippedDiverged,
    skippedChangedCloze,
    skippedDuplicateSource,
  }, null, 2));
  }
}

function normalizeMessageClozeState(value: unknown): MessageClozeState | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { groups?: unknown; correctTokenIndexes?: unknown };
  if (!Array.isArray(row.groups)) return null;
  const groups = row.groups.flatMap((group) => {
    if (!group || typeof group !== "object") return [];
    const item = group as { tokenIndexes?: unknown; blankTokenIndexes?: unknown };
    const tokenIndexes = Array.isArray(item.tokenIndexes) ? uniqueIndexes(item.tokenIndexes) : [];
    const tokenSet = new Set(tokenIndexes);
    const blankTokenIndexes = Array.isArray(item.blankTokenIndexes)
      ? uniqueIndexes(item.blankTokenIndexes).filter((index) => tokenSet.has(index))
      : [];
    return tokenIndexes.length ? [{ tokenIndexes, blankTokenIndexes }] : [];
  });
  if (!groups.length) return null;
  const blankIndexes = new Set(groups.flatMap((group) => group.blankTokenIndexes));
  const correctTokenIndexes = Array.isArray(row.correctTokenIndexes)
    ? uniqueIndexes(row.correctTokenIndexes).filter((index) => blankIndexes.has(index))
    : [];
  return { groups, correctTokenIndexes };
}

function uniqueIndexes(values: unknown[]): number[] {
  return Array.from(new Set(values.filter((value): value is number => Number.isInteger(value) && Number(value) >= 0).map(Number))).sort((left, right) => left - right);
}

function countMessageBlanks(state: MessageClozeState | null): number {
  return new Set(state?.groups.flatMap((group) => group.blankTokenIndexes) ?? []).size;
}

function countMessagePhraseGroups(state: MessageClozeState | null): number {
  return state?.groups.filter((group) => group.blankTokenIndexes.length > 0).length ?? 0;
}

function tokenizeClozeText(text: string): Array<{ index: number; text: string; start: number; end: number; isWord: boolean }> {
  const tokens: Array<{ index: number; text: string; start: number; end: number; isWord: boolean }> = [];
  const tokenPattern = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]+|[\p{L}\p{N}'’-]+|[^\s\p{L}\p{N}'’-]/gu;
  const wordPattern = /[\p{L}\p{N}'’-]/u;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(text))) {
    const token = match[0];
    if (!token) continue;
    tokens.push({ index: tokens.length, text: token, start: match.index, end: match.index + token.length, isWord: wordPattern.test(token) });
  }
  return tokens;
}

function buildCardClozeState(
  text: string,
  source: MessageClozeState | null,
  segments: CardSegment[],
): { state: CardClozeState; anchors: Array<ClozePhraseAnchor & { representativeBlankId: string }> } {
  const correctIndexes = new Set(source?.correctTokenIndexes ?? []);
  const tokens = tokenizeClozeText(text);
  const blanks: CardClozeBlank[] = [];
  const blankByTokenIndex = new Map<number, CardClozeBlank>();
  for (const tokenIndex of new Set(source?.groups.flatMap((group) => group.blankTokenIndexes) ?? [])) {
    const token = tokens[tokenIndex];
    if (!token?.isWord) continue;
    const segment = segments.find((candidate) => token.start >= candidate.startUtf16 && token.end <= candidate.endUtf16);
    if (!segment) continue;
    const blank = {
      id: randomUUID(),
      segmentId: segment.id,
      startUtf16: token.start - segment.startUtf16,
      endUtf16: token.end - segment.startUtf16,
      answer: token.text,
      mastered: correctIndexes.has(token.index),
    };
    blanks.push(blank);
    blankByTokenIndex.set(tokenIndex, blank);
  }
  const anchors = (source?.groups ?? []).flatMap((group) => {
    const groupTokens = group.tokenIndexes.map((index) => tokens[index]).filter(Boolean);
    const representative = group.blankTokenIndexes.map((index) => blankByTokenIndex.get(index)).find(Boolean);
    if (!groupTokens.length || !representative) return [];
    const absoluteStart = Math.min(...groupTokens.map((token) => token.start));
    const absoluteEnd = Math.max(...groupTokens.map((token) => token.end));
    const segment = segments.find((candidate) => absoluteStart >= candidate.startUtf16 && absoluteEnd <= candidate.endUtf16);
    const surfaceText = text.slice(absoluteStart, absoluteEnd);
    if (!surfaceText.trim()) return [];
    return [{
      segmentId: segment?.id === representative.segmentId ? segment.id : null,
      startUtf16: segment?.id === representative.segmentId ? absoluteStart - segment.startUtf16 : absoluteStart,
      endUtf16: segment?.id === representative.segmentId ? absoluteEnd - segment.startUtf16 : absoluteEnd,
      surfaceText,
      representativeBlankId: representative.id,
    }];
  });
  return { state: { schemaVersion: 1, blanks }, anchors };
}

function normalizeCardClozeState(value: unknown): CardClozeState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { blanks?: unknown };
  if (!Array.isArray(raw.blanks)) return null;
  const blanks = raw.blanks.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (
      typeof row.id !== "string" || !row.id ||
      typeof row.segmentId !== "string" || !row.segmentId ||
      !Number.isInteger(row.startUtf16) || !Number.isInteger(row.endUtf16) ||
      Number(row.startUtf16) < 0 || Number(row.endUtf16) <= Number(row.startUtf16) ||
      typeof row.answer !== "string" || !row.answer.trim()
    ) return [];
    return [{
      id: row.id,
      segmentId: row.segmentId,
      startUtf16: Number(row.startUtf16),
      endUtf16: Number(row.endUtf16),
      answer: row.answer,
      mastered: row.mastered === true,
    }];
  });
  return { schemaVersion: 1, blanks };
}

function bindExpectedAnchorsToPersistedState(
  expected: ReturnType<typeof buildCardClozeState>,
  persisted: CardClozeState,
): ClozePhraseAnchor[] | null {
  if (expected.state.blanks.length !== persisted.blanks.length) return null;
  const persistedByPosition = new Map(persisted.blanks.map((blank) => [clozePositionKey(blank), blank]));
  const expectedToPersistedId = new Map<string, string>();
  for (const blank of expected.state.blanks) {
    const persistedBlank = persistedByPosition.get(clozePositionKey(blank));
    if (!persistedBlank || persistedBlank.answer !== blank.answer) return null;
    expectedToPersistedId.set(blank.id, persistedBlank.id);
  }
  return expected.anchors.flatMap((anchor) => {
    const representativeBlankId = expectedToPersistedId.get(anchor.representativeBlankId);
    return representativeBlankId ? [{ ...anchor, representativeBlankId }] : [];
  });
}

function clozePositionKey(blank: Pick<CardClozeBlank, "segmentId" | "startUtf16" | "endUtf16">): string {
  return `${blank.segmentId}:${blank.startUtf16}:${blank.endUtf16}`;
}

async function registerClozePhrase(tx: any, input: {
  userId: string;
  cardId: string;
  cardCreatedAt: Date;
  languageCode: string;
  anchor: ClozePhraseAnchor;
}): Promise<boolean> {
  if (!isTargetLanguageCode(input.languageCode)) return false;
  const normalizedText = normalizePhraseSurface(input.anchor.surfaceText, input.languageCode);
  if (!normalizedText) return false;
  const phrase = await tx.phrase.upsert({
    where: {
      userId_languageCode_canonicalKey: {
        userId: input.userId,
        languageCode: input.languageCode,
        canonicalKey: normalizedText,
      },
    },
    create: {
      userId: input.userId,
      languageCode: input.languageCode,
      canonicalText: input.anchor.surfaceText.trim(),
      canonicalKey: normalizedText,
      status: "pending_normalization",
      normalizerVersion: PHRASE_NORMALIZER_VERSION,
    },
    update: {},
  });
  await tx.phraseVariant.upsert({
    where: { phraseId_normalizedText: { phraseId: phrase.id, normalizedText } },
    create: {
      phraseId: phrase.id,
      userId: input.userId,
      languageCode: input.languageCode,
      surfaceText: input.anchor.surfaceText,
      normalizedText,
      source: "observed_cloze",
      normalizerVersion: PHRASE_NORMALIZER_VERSION,
    },
    update: { source: "observed_cloze" },
  });
  await tx.phraseOccurrence.upsert({
    where: {
      phraseId_cardId_sourceField_segmentKey_startUtf16_endUtf16: {
        phraseId: phrase.id,
        cardId: input.cardId,
        sourceField: "ai_expression",
        segmentKey: input.anchor.segmentId ?? "",
        startUtf16: input.anchor.startUtf16,
        endUtf16: input.anchor.endUtf16,
      },
    },
    create: {
      phraseId: phrase.id,
      userId: input.userId,
      cardId: input.cardId,
      cardCreatedAt: input.cardCreatedAt,
      sourceField: "ai_expression",
      segmentId: input.anchor.segmentId,
      segmentKey: input.anchor.segmentId ?? "",
      startUtf16: input.anchor.startUtf16,
      endUtf16: input.anchor.endUtf16,
      surfaceText: input.anchor.surfaceText,
      matchType: "normalized",
      clozeBlankId: input.anchor.representativeBlankId,
    },
    update: {
      surfaceText: input.anchor.surfaceText,
      matchType: "normalized",
      clozeBlankId: input.anchor.representativeBlankId,
    },
  });
  const inputHash = createHash("sha256").update(`${input.languageCode}\n${normalizedText}`).digest("hex");
  await ensureEnrichmentJob(tx, {
    userId: input.userId,
    sourceKind: "card",
    sourceId: input.cardId,
    jobType: "normalize_phrase",
    inputHash,
    inputVersion: `${PHRASE_NORMALIZER_VERSION}:${phrase.id}`,
    payload: { phraseId: phrase.id, schemaVersion: 1 },
  });
  return true;
}

async function ensureEnrichmentJob(tx: any, input: {
  userId: string;
  sourceKind: string;
  sourceId: string;
  jobType: string;
  inputHash: string;
  inputVersion: string;
  payload: unknown;
}): Promise<void> {
  const key = {
    userId: input.userId,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    jobType: input.jobType,
    inputVersion: input.inputVersion,
  };
  const existing = await tx.cardEnrichmentJob.findUnique({
    where: { userId_sourceKind_sourceId_jobType_inputVersion: key },
    select: { id: true, status: true },
  });
  if (!existing) {
    await tx.cardEnrichmentJob.create({ data: input });
    return;
  }
  if (existing.status === "failed") {
    await tx.cardEnrichmentJob.update({
      where: { id: existing.id },
      data: {
        status: "queued",
        availableAt: new Date(),
        inputHash: input.inputHash,
        payload: input.payload,
        attempts: 0,
        processingAt: null,
        leaseExpiresAt: null,
        workerId: null,
        lastError: null,
        completedAt: null,
        failedAt: null,
      },
    });
  }
}

function sameMigratedContent(
  card: { originalText: string | null; rewrittenText: string | null },
  candidate: Candidate,
): boolean {
  return card.originalText?.trim() === candidate.originalText && card.rewrittenText?.trim() === candidate.rewrittenText;
}

function cardContentVersion(contentType: string, text: string, sourceHash: string | null): string {
  const normalized = text.normalize("NFKC").replace(/\r\n?/gu, "\n").trim();
  return `sha256:${createHash("sha256").update(`${contentType}\n${sourceHash ?? ""}\n${normalized}`).digest("hex")}`;
}

function buildNaturalTopic(text: string): string {
  const firstLine = text
    .replace(/\s+/g, " ")
    .split(/(?<=[。！？!?])\s*/u)[0]
    ?.trim() || text.trim();
  const topic = truncateGraphemes(firstLine, 30).trim();
  return countGraphemes(firstLine) > 30 ? `${topic}…` : topic;
}

function currentMigrationClientId(messageId: string): string {
  return `${CARD_CLIENT_VERSION}:${messageId}`;
}

function migrationClientIds(messageId: string): string[] {
  return [
    currentMigrationClientId(messageId),
    `${LEGACY_MIGRATION_VERSION}:${messageId}`,
  ];
}

function parseArgs(argv: string[]): Args {
  const allowed = argv.every((arg) =>
    arg === "--all" ||
    arg === "--apply" ||
    arg.startsWith("--email=") ||
    arg.startsWith("--database-line=") ||
    arg.startsWith("--confirm="),
  );
  if (!allowed) throw new Error("Unknown argument");
  const email = argv.find((arg) => arg.startsWith("--email="))?.slice("--email=".length).trim() || "";
  const all = argv.includes("--all");
  const apply = argv.includes("--apply");
  const confirmation = argv.find((arg) => arg.startsWith("--confirm="))?.slice("--confirm=".length) ?? "";
  const databaseLineRaw = argv
    .find((arg) => arg.startsWith("--database-line="))
    ?.slice("--database-line=".length);
  const databaseLine = databaseLineRaw ? Number(databaseLineRaw) : null;
  if ((!email && !all) || (email && all)) throw new Error("Use exactly one of --email=<address> or --all");
  if (databaseLine !== null && (!Number.isInteger(databaseLine) || databaseLine < 1)) {
    throw new Error("--database-line must be a positive integer");
  }
  if (apply && confirmation !== APPLY_CONFIRMATION) {
    throw new Error(`--apply requires --confirm=${APPLY_CONFIRMATION}`);
  }
  if (!apply && confirmation) throw new Error("--confirm is only valid together with --apply");
  return {
    email: email || null,
    all,
    apply,
    databaseLine,
  };
}

function loadDatabaseUrl(databaseLine: number | null): void {
  if (databaseLine === null && process.env.LF_DATABASE_URL?.trim()) return;
  const envPath = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "..", ".env")]
    .find((path) => existsSync(path));
  if (!envPath) throw new Error("Cannot find .env");
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  const line = databaseLine === null
    ? lines.find((row) => row.trim().startsWith("LF_DATABASE_URL="))
    : lines[databaseLine - 1];
  if (!line?.trim().startsWith("LF_DATABASE_URL=")) {
    throw new Error("Selected line is not LF_DATABASE_URL");
  }
  const value = line
    .slice(line.indexOf("=") + 1)
    .trim()
    .replace(/^"/, "")
    .replace(/"$/, "");
  if (!value) throw new Error("Selected LF_DATABASE_URL is empty");
  process.env.LF_DATABASE_URL = value;
}

function cardContentHash(text: string): string {
  const normalized = text.normalize("NFKC").replace(/\r\n?/gu, "\n").trim();
  return `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
}

main()
  .catch((error) => {
    console.error("[migrate-chat-messages-to-cards] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
