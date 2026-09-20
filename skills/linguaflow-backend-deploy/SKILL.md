---
name: linguaflow-backend-deploy
description: Inspect or deploy the LinguaFlow production backend on oio-main. Use for push/pull rollout, exact-commit deployment, API or Worker restart, and post-rollout health verification; production mutation requires explicit user authorization.
---

# LinguaFlow backend deployment

Use the scripts in this Skill instead of assembling ad hoc SSH, Git, and PM2
commands.

Read-only status:

```bash
bash skills/linguaflow-backend-deploy/scripts/backend-status.sh
```

Preview an exact rollout:

```bash
bash skills/linguaflow-backend-deploy/scripts/deploy-backend.sh \
  --commit <git-commit> --restart api|worker|both|none --dry-run
```

Only after the user explicitly authorizes the production rollout:

```bash
bash skills/linguaflow-backend-deploy/scripts/deploy-backend.sh \
  --commit <git-commit> --restart api|worker|both|none --confirm-production
```

## Restart selection

- API routes, request validation, foreground services, API-loaded constants:
  restart `api`.
- background jobs, scanners, reconciliation, Worker-loaded constants: restart
  `worker`.
- shared Core rules, prompts, repositories, or job-version constants used by
  both enqueue and claim paths: restart `both`.
- documentation or non-runtime changes: `none`.

Run the relevant feature checks before deployment. Schema changes additionally
require the production database Skill; migration, generated Prisma Client, and
process rollout are separate states.

When the rollout contains a Prisma migration, enforce this order:

1. inspect, deploy, and verify the production migration with the production
   database Skill;
2. deploy the exact compatible backend commit so the remote build generates
   the matching Prisma Client;
3. restart the affected API/Worker processes;
4. verify process health and the migrated feature.

Do not restart new backend code before the required production migration has
been applied and verified. An additive migration may remain compatible with
the old process during step 1; the reverse order can expose new code to an old
schema and is a deployment failure.

The deployment script deliberately requires a clean remote tree, a
fast-forward update, an exact deployed commit, allowlisted PM2 process names,
and post-rollout API/Worker health. Stop rather than bypassing a failed guard.
Report the deployed full commit, restarted processes, and health result.
