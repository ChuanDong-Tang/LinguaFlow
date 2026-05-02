/*
  Warnings:

  - A unique constraint covering the columns `[userId,contactId,dateKey]` on the table `conversations` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[sourceMessageId]` on the table `messages` will be added. If there are existing duplicate values, this will fail.
  - Made the column `dateKey` on table `conversations` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "conversations" ALTER COLUMN "dateKey" SET NOT NULL;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "sourceMessageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "conversations_userId_contactId_dateKey_key" ON "conversations"("userId", "contactId", "dateKey");

-- CreateIndex
CREATE UNIQUE INDEX "messages_sourceMessageId_key" ON "messages"("sourceMessageId");
