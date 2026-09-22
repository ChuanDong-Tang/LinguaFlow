-- Existing accounts must never be forced through the new post-login onboarding.
-- Future users are not present at migration time, so their guideState remains empty.
INSERT INTO "user_preferences" ("userId", "guideState", "updatedAt")
SELECT "id", jsonb_build_object('account_onboarding_v1', jsonb_build_object('completedAt', now()::text)), now()
FROM "users"
ON CONFLICT ("userId") DO UPDATE
SET "guideState" = COALESCE("user_preferences"."guideState", '{}'::jsonb)
  || jsonb_build_object('account_onboarding_v1', jsonb_build_object('completedAt', now()::text))
WHERE NOT COALESCE("user_preferences"."guideState", '{}'::jsonb) ? 'account_onboarding_v1';
