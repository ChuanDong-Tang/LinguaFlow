import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { countGraphemes, truncateGraphemes } from "@lf/core/text/grapheme.js";
import { segmentLearningSentences } from "@lf/core/text/learningText.js";
import { parseTaggedRewriteOutput } from "@lf/core/Prompts/rewriteAssistantPrompt.js";

type Args = {
  email: string;
  apply: boolean;
  databaseLine: number | null;
};

type Candidate = {
  userMessageId: string;
  originalText: string;
  rewrittenText: string;
  topic: string;
  dateKey: string;
  languageCode: string;
  createdAt: Date;
  publishedAt: Date;
};

const MIGRATION_VERSION = "legacy_chat_to_card_v1";

const args = parseArgs(process.argv.slice(2));
loadDatabaseUrl(args.databaseLine);

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { equals: args.email, mode: "insensitive" } },
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
  if (users.length !== 1) {
    throw new Error(`Expected one user for email, found ${users.length}`);
  }
  const user = users[0];
  if (user.status !== "active") throw new Error("User is not active");

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
  const candidates: Candidate[] = [];
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
    candidates.push({
      userMessageId: source.id,
      originalText,
      rewrittenText,
      topic: buildNaturalTopic(originalText),
      dateKey: source.conversationDateKey || assistant.conversation.dateKey,
      languageCode: source.languageCode || user.preference?.learningLanguage || "en-US",
      createdAt: source.createdAt,
      publishedAt: assistant.createdAt,
    });
  }

  const clientIds = candidates.map((candidate) => migrationClientId(candidate.userMessageId));
  const existing = await prisma.card.findMany({
    where: { userId: user.id, clientId: { in: clientIds } },
    select: { clientId: true },
  });
  const existingClientIds = new Set(existing.map((card) => card.clientId));
  const pending = candidates.filter(
    (candidate) => !existingClientIds.has(migrationClientId(candidate.userMessageId)),
  );

  console.log(JSON.stringify({
    mode: args.apply ? "apply" : "dry-run",
    userId: user.id,
    pairedAssistantMessages: assistantMessages.length,
    candidates: candidates.length,
    alreadyMigrated: existing.length,
    pending: pending.length,
    skippedMissingSource,
    skippedEmpty,
    dateRange: candidates.length
      ? {
          from: candidates[0].dateKey,
          to: candidates[candidates.length - 1].dateKey,
        }
      : null,
  }, null, 2));

  if (!args.apply || pending.length === 0) return;

  const appLocale = user.preference?.appLocale || "zh-CN";
  const promptDifficulty = user.preference?.promptDifficulty || "native";
  let created = 0;
  for (const candidate of pending) {
    await prisma.$transaction(async (tx) => {
      const clientId = migrationClientId(candidate.userMessageId);
      const duplicate = await tx.card.findFirst({
        where: { userId: user.id, clientId },
        select: { id: true },
      });
      if (duplicate) return;

      const card = await tx.card.create({
        data: {
          userId: user.id,
          dateKey: candidate.dateKey,
          originalText: candidate.originalText,
          rewrittenText: candidate.rewrittenText,
          languageCode: candidate.languageCode,
          appLocaleSnapshot: appLocale,
          promptDifficultySnapshot: promptDifficulty,
          promptVersion: MIGRATION_VERSION,
          status: "completed",
          clientId,
          inputChars: countGraphemes(candidate.originalText),
          outputChars: countGraphemes(candidate.rewrittenText),
          topic: candidate.topic,
          publishedAt: candidate.publishedAt,
          createdAt: candidate.createdAt,
          updatedAt: candidate.publishedAt,
        },
      });
      const segments = segmentLearningSentences({
        text: candidate.rewrittenText,
        languageCode: candidate.languageCode,
        minSegmentChars: 1,
        maxSegmentChars: 800,
      });
      if (segments.length) {
        await tx.cardRewriteSegment.createMany({
          data: segments.map((segment, ordinal) => ({
            entryId: card.id,
            ordinal,
            text: segment.text,
            startUtf16: segment.textStart,
            endUtf16: segment.textEnd,
          })),
        });
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
      });
      created += 1;
    });
  }
  console.log(JSON.stringify({ created, skippedAsDuplicate: pending.length - created }, null, 2));
}

function buildNaturalTopic(text: string): string {
  const firstLine = text
    .replace(/\s+/g, " ")
    .split(/(?<=[。！？!?])\s*/u)[0]
    ?.trim() || text.trim();
  const topic = truncateGraphemes(firstLine, 30).trim();
  return countGraphemes(firstLine) > 30 ? `${topic}…` : topic;
}

function migrationClientId(messageId: string): string {
  return `${MIGRATION_VERSION}:${messageId}`;
}

function parseArgs(argv: string[]): Args {
  const email = argv.find((arg) => arg.startsWith("--email="))?.slice("--email=".length).trim() || "";
  const databaseLineRaw = argv
    .find((arg) => arg.startsWith("--database-line="))
    ?.slice("--database-line=".length);
  const databaseLine = databaseLineRaw ? Number(databaseLineRaw) : null;
  if (!email) throw new Error("--email is required");
  if (databaseLine !== null && (!Number.isInteger(databaseLine) || databaseLine < 1)) {
    throw new Error("--database-line must be a positive integer");
  }
  return {
    email,
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

main()
  .catch((error) => {
    console.error("[migrate-chat-messages-to-cards] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
