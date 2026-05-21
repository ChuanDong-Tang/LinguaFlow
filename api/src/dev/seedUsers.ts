import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

ensureDatabaseUrl();

const prisma = new PrismaClient();

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

async function upsertUser(id: string, nickname: string): Promise<void> {
  await prisma.user.upsert({
    where: { id },
    update: { nickname, status: "active" },
    create: { id, nickname, status: "active" },
  });
}

async function main(): Promise<void> {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  await upsertUser("mock_user_001", "Mock Pro User");
  await upsertUser("mock_user_002", "Mock Free User");
  await upsertUser("mock_user_003", "Mock Expired Pro User");

  await prisma.subscription.deleteMany({
    where: { userId: { in: ["mock_user_001", "mock_user_002", "mock_user_003"] } },
  });

  await prisma.subscription.create({
    data: {
      userId: "mock_user_001",
      plan: "pro_monthly",
      status: "active",
      startedAt: now,
      expiresAt: tomorrow,
    },
  });

  await prisma.subscription.create({
    data: {
      userId: "mock_user_003",
      plan: "pro_monthly",
      status: "expired",
      startedAt: monthAgo,
      expiresAt: yesterday,
    },
  });

  console.log("[seed-users] done");
}

main()
  .catch((error) => {
    console.error("[seed-users] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
