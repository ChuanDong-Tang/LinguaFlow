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

Functional API audit keeps liveness separate from user-visible AI behavior.
It reports rolling production dictionary P50/P95/error rate and the latest
synthetic result without reading user text:

```bash
bash skills/linguaflow-backend-deploy/scripts/api-functional-audit.sh --status
```

When continuous monitoring is authorized, use the bounded probe mode. It runs
one fixed, non-user dictionary probe only when no real lookup has occurred for
10 minutes, records only timing/provider/status metadata, and uses the
maintenance resource identity:

```bash
bash skills/linguaflow-backend-deploy/scripts/api-functional-audit.sh \
  --probe-if-idle --confirm-production
```

Do not treat `/health` alone as proof that lookup, rewrite, or another provider
workflow is healthy.

The production Worker must not contain persistent historical Card AI scanners.
New cards and changed cloze phrases enqueue their own event-driven enrichment
jobs. If historical repair is needed, use or add a bounded one-shot script with
an explicit job type, user scope, and maximum count. Never add or enable a
continuous history-scanning daemon as part of routine deployment.

Phrase relations use the V3 semantic-judge path. Do not enqueue new V2
occurrence-meaning jobs. For the production canary, keep
`RELATED_PHRASE_JUDGE_USER_ID` scoped to the internal id resolved from
`tangchuandong1@gmail.com`, then enqueue at most 20 historical jobs explicitly:

```bash
bash skills/linguaflow-backend-deploy/scripts/enqueue-phrase-relation-v3-canary.sh \
  --email tangchuandong1@gmail.com --count 20 --confirm-production
```

The V3 historical Worker acquires its maintenance budget before claiming a
job. Upstream 429 responses open a Redis-backed 30/60/120 minute circuit. Do
not bypass that gate, repeatedly probe during the cooldown, or convert this
command back into a scanner.

Pause or resume only the already-queued V3 canary jobs with the bounded
management script. `--resume` changes `availableAt` on matching queued jobs;
it does not enqueue new work:

```bash
bash skills/linguaflow-backend-deploy/scripts/manage-phrase-relation-judge-canary.sh \
  --resume tangchuandong1@gmail.com --confirm-production
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
- background jobs, reconciliation, Worker-loaded constants: restart
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

For a coordinated app release, update the three independent public version
pointers and the immutable China APK URL with the bounded configuration script.
It backs up the production `.env`, changes only the four allowlisted settings,
restarts only the API with `--update-env`, and restores the backup if restart
fails:

```bash
bash skills/linguaflow-backend-deploy/scripts/update-app-version-config.sh \
  --ios <version> --google <version> --china <version> \
  --china-url <immutable-apk-url> --confirm-production
```

Afterward, verify every platform-specific public `/app/version` response. Do
not use `LF_APP_LATEST_VERSION` as a shortcut.

Change the production Grok default only with the allowlisted configuration
script. It preserves the existing allowed-model list, backs up `.env`, restarts
API and Worker with the updated environment, verifies both process environments
and API health, and restores the backup if verification fails:

```bash
bash skills/linguaflow-backend-deploy/scripts/update-grok-model-config.sh \
  --model grok-4-20-non-reasoning --confirm-production
```

The deployment script deliberately requires a clean remote tree, a
fast-forward update, an exact deployed commit, allowlisted PM2 process names,
and post-rollout API/Worker health. Stop rather than bypassing a failed guard.
Report the deployed full commit, restarted processes, and health result.
