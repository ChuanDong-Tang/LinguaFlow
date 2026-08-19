ALTER TABLE "tts_request_logs"
  ADD COLUMN "preparationMs" INTEGER,
  ADD COLUMN "cacheLookupMs" INTEGER,
  ADD COLUMN "lockWaitMs" INTEGER,
  ADD COLUMN "queueWaitMs" INTEGER,
  ADD COLUMN "synthesisMs" INTEGER,
  ADD COLUMN "storageMs" INTEGER,
  ADD COLUMN "persistenceMs" INTEGER;
