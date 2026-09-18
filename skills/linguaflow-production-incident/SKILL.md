---
name: linguaflow-production-incident
description: Diagnose LinguaFlow production failures, wrong user-visible state, task delays, version drift, or provider inconsistencies. Use for evidence-first investigation and targeted recovery; diagnosis alone does not authorize code changes, deployment, production writes, or broad backfill.
---

# LinguaFlow production incident

Begin with a read-only incident snapshot:

```bash
bash skills/linguaflow-production-incident/scripts/incident-snapshot.sh
```

Then narrow the incident by user, platform, app version/build, timestamp,
request or provider identifier, and affected domain object. Treat user-provided
screenshots and descriptions as symptoms, not proof of the failing layer.

## Distinguish the failing layer

Check only the evidence needed to separate:

- installed binary, runtime version, OTA channel, or stale client state;
- mobile rendering or local cache;
- API validation, routing, or stale process code;
- queued, processing, failed, ignored-version, or stale Worker jobs;
- database state and migration/client/process mismatch;
- Apple, Google Play, Alipay, Authing, COS, AI, TTS, or STT provider state.

Use the production database Skill before production Prisma or migration work.
Avoid printing credentials or unnecessary user content. Prefer identifiers,
counts, versions, timestamps, statuses, and error codes.

## Recovery boundary

Explain the root cause before mutating. A recovery must identify an exact
target and assert its expected state and cardinality. Preserve failed or
superseded records when they are useful audit history. A request to repair one
user, order, card, or job does not authorize scanning or backfilling historical
records.

After an authorized fix, verify the real user-visible or persisted outcome,
not only HTTP 200, process `online`, or job `completed`. Report other affected
records discovered during diagnosis without silently repairing them.

If the request expands from diagnosis into repairing a currently released App
version, use `../linguaflow-live-version-repair/SKILL.md` to preserve the exact
release baseline and coordinate the backend, OTA, data, or native release lane.
