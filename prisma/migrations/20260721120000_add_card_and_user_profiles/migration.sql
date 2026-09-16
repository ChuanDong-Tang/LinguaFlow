-- Historical reconciliation placeholder.
--
-- Production briefly attempted a migration with this name, then marked it as
-- rolled back. The intended schema was subsequently applied by:
--   20260721120000_add_journal_and_user_profiles
--   20260721130000_replace_journal_with_card
--
-- Keep this no-op migration in the repository so Prisma's filesystem history
-- matches the preserved production ledger without replaying the obsolete DDL.
SELECT 1;
