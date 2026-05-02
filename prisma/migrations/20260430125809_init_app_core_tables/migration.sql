/*
  Warnings:

  - The values [human,system] on the enum `ContactKind` will be removed. If these variants are still used in the database, this will fail.
  - The values [system] on the enum `MessageRole` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `lastMessageAt` on the `conversations` table. All the data in the column will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "ContactKind_new" AS ENUM ('ai_assistant');
ALTER TABLE "public"."contacts" ALTER COLUMN "kind" DROP DEFAULT;
ALTER TABLE "contacts" ALTER COLUMN "kind" TYPE "ContactKind_new" USING ("kind"::text::"ContactKind_new");
ALTER TYPE "ContactKind" RENAME TO "ContactKind_old";
ALTER TYPE "ContactKind_new" RENAME TO "ContactKind";
DROP TYPE "public"."ContactKind_old";
ALTER TABLE "contacts" ALTER COLUMN "kind" SET DEFAULT 'ai_assistant';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "MessageRole_new" AS ENUM ('user', 'assistant');
ALTER TABLE "messages" ALTER COLUMN "role" TYPE "MessageRole_new" USING ("role"::text::"MessageRole_new");
ALTER TYPE "MessageRole" RENAME TO "MessageRole_old";
ALTER TYPE "MessageRole_new" RENAME TO "MessageRole";
DROP TYPE "public"."MessageRole_old";
COMMIT;

-- AlterTable
ALTER TABLE "conversations" DROP COLUMN "lastMessageAt";
