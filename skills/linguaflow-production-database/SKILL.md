---
name: linguaflow-production-database
description: Safely inspect, diagnose, migrate, or verify the LinguaFlow production PostgreSQL database and Prisma deployment state. Use for production database migrations, Prisma schema/client mismatches, failed persistence, migration-history drift, or database-related release checks.
---

# LinguaFlow production database

Use this Skill for production database work in this repository. The Prisma
schema is `prisma/schema.prisma`, migrations are under `prisma/migrations/`, and
Prisma reads `LF_DATABASE_URL` from the repository `.env`.

For routine status checks and migrations, use:

```bash
bash skills/linguaflow-production-database/scripts/production-db.sh --check
bash skills/linguaflow-production-database/scripts/production-db.sh --deploy --confirm-production
```

Run from the repository root. Do not reproduce the database URL or credentials
in messages, logs, command arguments, commits, or generated files.

## Separate the three deployment states

Treat these as independent and verify each relevant one:

1. **Schema migration:** `prisma migrate deploy` changes the database. Run it
   once against production before code that requires a new non-optional field.
2. **Generated client:** `prisma generate` updates the Prisma Client in the
   runtime filesystem. Running it locally does not update a remote API or
   Worker. Every deployed runtime that imports Prisma must generate the client
   during its own build/install process.
3. **Process rollout:** restart or redeploy the API and affected Workers after
   generation. A migrated database plus a stale process can still fail.

Never claim a production fix merely because local type checking or local
`prisma generate` passed.

## Read-only diagnosis

Start with repository status, the relevant migration SQL, and `--check`. Use
read-only database queries only when they materially distinguish causes. Do not
read or print user content; select counts, timestamps, error codes, schema
metadata, and migration records where possible.

For persistence failures, distinguish:

- **New client → old API:** the request contains a new key rejected by the old
  request validator, commonly returning `VALIDATION_FAILED`.
- **New API → old Prisma Client:** Prisma rejects a new field with an error such
  as `Unknown argument` even if the column exists in PostgreSQL.
- **New Prisma Client → unmigrated database:** PostgreSQL reports a missing
  column or relation.
- **Migrated and generated but stale process:** the running API/Worker has not
  restarted and still holds the previous generated client/code.
- **Migration-history drift:** production records a migration absent locally.
  Inspect Git history and replacement migrations before acting. Do not delete,
  edit, mark rolled back, or resolve an applied production migration merely to
  silence `migrate status`.

Application stdout/stderr and provider logs are distinct from
`system_event_logs`. Check whether the failing route catches and persists its
exception before assuming the database event table contains the error.

## Mutation rules

Before `--deploy`:

- inspect the exact pending SQL and confirm it matches the current schema;
- run `git diff --check`, Prisma schema validation, and relevant type checks;
- let the status output identify the production host/database without exposing
  credentials;
- obtain explicit authorization for the live database mutation;
- prefer additive, backward-compatible migrations and deploy them before the
  server code that requires them.

Use `prisma migrate deploy`, never `prisma migrate dev`, `db push`, or an ad-hoc
DDL command against production. Do not modify already-applied migration files.
Stop on destructive SQL, unexpected targets, failed migrations, checksum
conflicts, or unexplained history divergence.

After deployment, rerun `--check`. A known historical migration that exists
only in production may keep `migrate status` non-zero; report it precisely and
verify that the newly pending migration is no longer listed. Then ensure the
remote API/Worker build runs `prisma generate` and restarts before declaring the
feature healthy.

## Reporting

Report the database target in non-secret form, exact migration name, whether it
was applied or already present, generated-client status for each deployed
runtime, restart/rollout status, validation results, and any remaining risk.
