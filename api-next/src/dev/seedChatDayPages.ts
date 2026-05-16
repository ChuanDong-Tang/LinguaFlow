import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

ensureDatabaseUrl();

const prisma = new PrismaClient();

const USER_ID = "mock_user_001";
const CONTACT_ID = "rewrite_assistant";
const DAYS = ["2026-05-14", "2026-05-15"] as const;
const PAIRS_PER_DAY = 100; // 100 user + 100 assistant = 200 rows/day

function ensureDatabaseUrl(): void {
  if (process.env.LF_DATABASE_URL?.trim()) return;

  const envPath = resolve(process.cwd(), "..", ".env");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");
  const line = content
    .split(/\r?\n/)
    .find((row) => row.trim().startsWith("LF_DATABASE_URL="));
  if (!line) return;
  const raw = line.slice(line.indexOf("=") + 1).trim();
  const value = raw.replace(/^"/, "").replace(/"$/, "");
  if (value) process.env.LF_DATABASE_URL = value;
}

function dayTime(dateKey: string, seconds: number): Date {
  const base = new Date(`${dateKey}T00:00:00.000+08:00`);
  return new Date(base.getTime() + seconds * 1000);
}

async function ensureContact(): Promise<void> {
  const exists = await prisma.contact.findUnique({ where: { id: CONTACT_ID } });
  if (exists) return;
  await prisma.contact.create({
    data: {
      id: CONTACT_ID,
      code: CONTACT_ID,
      name: "Rewrite Assistant",
      kind: "ai_assistant",
      enabled: true,
    },
  });
}

async function ensureUser(): Promise<void> {
  await prisma.user.upsert({
    where: { id: USER_ID },
    update: { status: "active", nickname: "Mock Pro User" },
    create: { id: USER_ID, status: "active", nickname: "Mock Pro User" },
  });
}

async function seedOneDay(dateKey: string): Promise<string> {
  const conversation = await prisma.conversation.upsert({
    where: {
      userId_contactId_dateKey: {
        userId: USER_ID,
        contactId: CONTACT_ID,
        dateKey,
      },
    },
    update: {},
    create: {
      userId: USER_ID,
      contactId: CONTACT_ID,
      dateKey,
      title: `Seed ${dateKey}`,
    },
  });

  await prisma.message.deleteMany({
    where: { conversationId: conversation.id },
  });

  const data: {
    conversationId: string;
    userId: string;
    role: "user" | "assistant";
    status: "success";
    content: string;
    inputChars: number;
    outputChars: number;
    sourceMessageId?: string;
    createdAt: Date;
    updatedAt: Date;
  }[] = [];

  for (let i = 0; i < PAIRS_PER_DAY; i += 1) {
    const userText = `[${dateKey}] user message #${String(i + 1).padStart(3, "0")}`;
    const assistantText = `[${dateKey}] assistant reply #${String(i + 1).padStart(3, "0")}`;
    const userCreatedAt = dayTime(dateKey, i * 60);
    const assistantCreatedAt = dayTime(dateKey, i * 60 + 20);
    const userSourceId = `seed-${dateKey}-${String(i + 1).padStart(3, "0")}-user`;

    data.push({
      conversationId: conversation.id,
      userId: USER_ID,
      role: "user",
      status: "success",
      content: userText,
      inputChars: userText.length,
      outputChars: 0,
      createdAt: userCreatedAt,
      updatedAt: userCreatedAt,
    });

    data.push({
      conversationId: conversation.id,
      userId: USER_ID,
      role: "assistant",
      status: "success",
      content: assistantText,
      inputChars: 0,
      outputChars: assistantText.length,
      sourceMessageId: userSourceId,
      createdAt: assistantCreatedAt,
      updatedAt: assistantCreatedAt,
    });
  }

  await prisma.message.createMany({ data });
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { updatedAt: dayTime(dateKey, PAIRS_PER_DAY * 60) },
  });

  return conversation.id;
}

async function main(): Promise<void> {
  await ensureUser();
  await ensureContact();

  const ids: Record<string, string> = {};
  for (const dateKey of DAYS) {
    ids[dateKey] = await seedOneDay(dateKey);
  }

  console.log("[seed-chat-day-pages] done");
  for (const dateKey of DAYS) {
    console.log(`${dateKey} conversationId=${ids[dateKey]}`);
  }
}

main()
  .catch((error) => {
    console.error("[seed-chat-day-pages] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
