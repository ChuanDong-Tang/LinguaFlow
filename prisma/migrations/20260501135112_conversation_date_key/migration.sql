/*
  Warnings:

  - A unique constraint covering the columns `[userId,contactId,dateKey]` on the table `conversations` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "dateKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "conversations_userId_contactId_dateKey_key" ON "conversations"("userId", "contactId", "dateKey");
