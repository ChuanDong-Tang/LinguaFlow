import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

ensureDatabaseUrl();

const prisma = new PrismaClient();

const TARGET_DATE_KEYS = ["2026-05-14", "2026-05-15"] as const;

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

async function main(): Promise<void> {
  const userIdArg = process.argv.find((arg) => arg.startsWith("--userId="));
  const userId = userIdArg?.split("=")[1]?.trim();

  const where = userId
    ? { dateKey: { in: [...TARGET_DATE_KEYS] }, userId }
    : { dateKey: { in: [...TARGET_DATE_KEYS] } };

  const beforeCount = await prisma.conversation.count({ where });

  if (beforeCount === 0) {
    console.log("[cleanup-fake-conversations] no matching conversations found");
    return;
  }

  console.log(
    `[cleanup-fake-conversations] deleting ${beforeCount} conversation(s) for ${TARGET_DATE_KEYS.join(
      ", "
    )}${userId ? ` (userId=${userId})` : ""}`
  );

  const result = await prisma.conversation.deleteMany({ where });
  console.log(`[cleanup-fake-conversations] deleted ${result.count} conversation(s)`);
  console.log("[cleanup-fake-conversations] messages removed via cascade");
}

main()
  .catch((error) => {
    console.error("[cleanup-fake-conversations] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
