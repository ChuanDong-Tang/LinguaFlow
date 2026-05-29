DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "apple_iap_account_links"
    WHERE "originalTransactionId" IS NOT NULL
    GROUP BY "originalTransactionId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate apple_iap_account_links.originalTransactionId values must be resolved before adding unique constraint';
  END IF;
END $$;

DROP INDEX IF EXISTS "apple_iap_account_links_originalTransactionId_idx";

CREATE UNIQUE INDEX "apple_iap_account_links_originalTransactionId_key"
ON "apple_iap_account_links"("originalTransactionId");
