---
name: linguaflow-daily-operations
description: Coordinate broad LinguaFlow maintenance, status, handoff, or multi-domain work. Use when the request spans development, deployment, release, production diagnosis, payments, or Card AI, or asks what remains to do. Prefer a narrower LinguaFlow Skill for an already focused task.
---

# LinguaFlow daily operations

Act as the single owner of the requested outcome. Route focused work to the
relevant repository Skill instead of duplicating its procedure:

- feature implementation or bug fixing: `../linguaflow-feature-delivery/SKILL.md`
- production symptom investigation: `../linguaflow-production-incident/SKILL.md`
- backend push, pull, rollout, or restart: `../linguaflow-backend-deploy/SKILL.md`
- app package, store upload, or OTA: `../linguaflow-android-release/SKILL.md`
- production schema or persistence work: `../linguaflow-production-database/SKILL.md`
- subscriptions, entitlements, or provider reconciliation: `../linguaflow-subscription-operations/SKILL.md`
- Card generation, prompts, jobs, or backfill: `../linguaflow-card-ai-pipeline/SKILL.md`

## Maintain one truthful state

Distinguish these states explicitly; never collapse them into “done”:

1. implemented locally;
2. validated locally;
3. committed;
4. pushed;
5. database migrated;
6. API or Worker deployed;
7. native package built;
8. uploaded to a store or OTA channel;
9. verified in the real target environment.

Start broad status requests with repository evidence: branch, HEAD, working
tree, relevant tests, deployed commit when needed, and outstanding external
state. Preserve unrelated dirty files. Do not infer permission to deploy,
publish, mutate production data, or submit to a store from permission to edit
code.

For a multi-domain request, keep one compact checklist with owner, current
state, evidence, and remaining action. Parallelize only independent read-only
investigations or isolated reviews; keep production mutation under one owner.

## Completion

Report the actual terminal state, the evidence used, anything intentionally
left untouched, and the next user action only when one is genuinely required.
