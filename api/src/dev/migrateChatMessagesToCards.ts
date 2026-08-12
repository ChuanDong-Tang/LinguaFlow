import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { countGraphemes, truncateGraphemes } from "@lf/core/text/grapheme.js";
import { segmentLearningSentences } from "@lf/core/text/learningText.js";
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

const CARD_CLIENT_VERSION = "chat-message:v1";
const LEGACY_MIGRATION_VERSION = "legacy_chat_to_card_v1";
const MIGRATION_CONTENT_VERSION = "legacy_chat_to_card_v2";

const args = parseArgs(process.argv.slice(2));
loadDatabaseUrl(args.databaseLine);

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const users = await prisma.user.findMany({
    where: args.all
      ? {}
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
    select: { clientId: true },
  });
  const existingClientIds = new Set(existing.map((card) => card.clientId));
  const pending = candidates.filter(
    (candidate) => !migrationClientIds(candidate.userMessageId).some((clientId) => existingClientIds.has(clientId)),
  );
  const withCloze = candidates.filter((candidate) => countMessageBlanks(candidate.clozeState) > 0);

  console.log(JSON.stringify({
    mode: args.apply ? "apply" : "dry-run",
    userId: user.id,
    pairedAssistantMessages: assistantMessages.length,
    candidates: candidates.length,
    alreadyMigrated: existing.length,
    pending: pending.length,
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

  if (!args.apply || pending.length === 0) continue;

  const appLocale = user.preference?.appLocale || "zh-CN";
  const promptDifficulty = user.preference?.promptDifficulty || "native";
  let created = 0;
  let migratedCloze = 0;
  for (const candidate of pending) {
    await prisma.$transaction(async (tx) => {
      const clientIds = migrationClientIds(candidate.userMessageId);
      const duplicate = await tx.card.findFirst({
        where: { userId: user.id, clientId: { in: clientIds } },
        select: { id: true },
      });
      if (duplicate) return;

      const clientId = currentMigrationClientId(candidate.userMessageId);
      const sourceHash = cardContentHash(candidate.originalText);
      const card = await tx.card.create({
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
          clientId,
          inputChars: countGraphemes(candidate.originalText),
          outputChars: countGraphemes(candidate.rewrittenText),
          topic: candidate.topic,
          publishedAt: candidate.publishedAt,
          createdAt: candidate.createdAt,
          updatedAt: candidate.publishedAt,
        },
        select: {
          id: true,
          originalText: true,
          originalContentHash: true,
          rewrittenText: true,
          rewrittenSourceHash: true,
          translationText: true,
          replyText: true,
          promptVersion: true,
        },
      });
      created += 1;

      const blocks = [
        { contentType: "original", text: card.originalText, languageCode: appLocale, sourceHash: card.originalContentHash },
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

      if (card.rewrittenText?.trim() === candidate.rewrittenText && countMessageBlanks(candidate.clozeState) > 0) {
        const practiceExists = await tx.cardContentPracticeState.findUnique({ where: { cardId_contentType: { cardId: card.id, contentType: "rewrite" } }, select: { id: true } });
        if (!practiceExists) {
          const rewriteSegments = await tx.cardContentSegment.findMany({ where: { entryId: card.id, contentType: "rewrite" }, orderBy: { ordinal: "asc" } });
          const clozeState = buildCardClozeState(candidate.rewrittenText, candidate.clozeState, rewriteSegments);
          if (clozeState.blanks.length) {
            const mastered = clozeState.blanks.filter((blank) => blank.mastered).length;
            await tx.cardContentPracticeState.create({
              data: {
                userId: user.id,
                cardId: card.id,
                contentType: "rewrite",
                contentVersion: rewriteSegments[0]!.contentVersion,
                clozeState,
                clozeVersion: Math.max(1, candidate.clozeVersion),
                clozeLastResult: mastered === clozeState.blanks.length ? "correct" : mastered > 0 ? "incorrect" : null,
                clozeCorrectStreak: mastered === clozeState.blanks.length ? 1 : 0,
              },
            });
            migratedCloze += 1;
          }
        }
      }

      const inputHash = createHash("sha256")
        .update(`Original: ${candidate.originalText}\nExpression: ${candidate.rewrittenText}`)
        .digest("hex");
      await tx.cardEnrichmentJob.createMany({
        data: [
          {
            userId: user.id,
            sourceKind: "card",
            sourceId: card.id,
            jobType: "generate_embedding",
            inputHash,
            inputVersion: `card_embedding_input_v1:${inputHash}`,
            payload: { schemaVersion: 1 },
          },
          {
            userId: user.id,
            sourceKind: "card",
            sourceId: card.id,
            jobType: "index_card_phrases",
            inputHash,
            inputVersion: `card_phrase_index_v1:${inputHash}`,
            payload: { schemaVersion: 1 },
          },
          {
            userId: user.id,
            sourceKind: "card",
            sourceId: card.id,
            jobType: "detect_progress_phrases",
            inputHash,
            inputVersion: `progress_phrase_detection_v1:${inputHash}`,
            payload: { schemaVersion: 1 },
          },
        ],
        skipDuplicates: true,
      });
    });
  }
  console.log(JSON.stringify({ created, migratedCloze, skippedAsAlreadyMigrated: candidates.length - created }, null, 2));
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
  segments: Array<{ id: string; startUtf16: number; endUtf16: number }>,
): { schemaVersion: 1; blanks: Array<{ id: string; segmentId: string; startUtf16: number; endUtf16: number; answer: string; mastered: boolean }> } {
  const blankIndexes = new Set(source?.groups.flatMap((group) => group.blankTokenIndexes) ?? []);
  const correctIndexes = new Set(source?.correctTokenIndexes ?? []);
  const blanks = tokenizeClozeText(text).flatMap((token) => {
    if (!token.isWord || !blankIndexes.has(token.index)) return [];
    const segment = segments.find((candidate) => token.start >= candidate.startUtf16 && token.end <= candidate.endUtf16);
    if (!segment) return [];
    return [{
      id: randomUUID(),
      segmentId: segment.id,
      startUtf16: token.start - segment.startUtf16,
      endUtf16: token.end - segment.startUtf16,
      answer: token.text,
      mastered: correctIndexes.has(token.index),
    }];
  });
  return { schemaVersion: 1, blanks };
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
  const email = argv.find((arg) => arg.startsWith("--email="))?.slice("--email=".length).trim() || "";
  const all = argv.includes("--all");
  const databaseLineRaw = argv
    .find((arg) => arg.startsWith("--database-line="))
    ?.slice("--database-line=".length);
  const databaseLine = databaseLineRaw ? Number(databaseLineRaw) : null;
  if ((!email && !all) || (email && all)) throw new Error("Use exactly one of --email=<address> or --all");
  if (databaseLine !== null && (!Number.isInteger(databaseLine) || databaseLine < 1)) {
    throw new Error("--database-line must be a positive integer");
  }
  return {
    email: email || null,
    all,
    apply: argv.includes("--apply"),
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
