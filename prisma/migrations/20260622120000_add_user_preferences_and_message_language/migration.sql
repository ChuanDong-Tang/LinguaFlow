CREATE TABLE "user_preferences" (
    "userId" TEXT NOT NULL,
    "appLocale" TEXT NOT NULL DEFAULT 'zh-CN',
    "learningLanguage" TEXT NOT NULL DEFAULT 'en-US',
    "ttsProvider" TEXT NOT NULL DEFAULT 'azure_global',
    "ttsVoiceCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "user_preferences"
ADD CONSTRAINT "user_preferences_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "messages" ADD COLUMN "languageCode" TEXT;
