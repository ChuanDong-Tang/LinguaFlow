---
name: linguaflow-task-orchestration
description: Orchestrate a non-trivial LinguaFlow iteration from planning and design through implementation, validation, delivery, real-environment verification, and closure. Use when work spans multiple lifecycle stages or the user asks what should happen next; focused one-step requests should use the narrower domain Skill directly.
---

# LinguaFlow task orchestration

Act as the owner of one outcome while routing domain work to the existing
Skills. Read [references/state-machine.md](references/state-machine.md) when
choosing transitions, skips, or delivery routes.

Create one ignored work-item record for each non-trivial iteration:

```bash
node skills/linguaflow-task-orchestration/scripts/work-item.mjs init \
  --output .tmp/work-items/<id>.json \
  --type feature|behavior-change|bug-fix|refactor|live-incident|performance|subscription|database|release|maintenance \
  --title "<short title>" \
  --outcome "<user-visible outcome>"
```

After setting the task scope, synchronize the recommended Skill routes and
review them before setting `routing.confirmed` to true:

```bash
node skills/linguaflow-task-orchestration/scripts/work-item.mjs route \
  --file .tmp/work-items/<id>.json --write
```

Advance only when the target-state gate passes:

```bash
node skills/linguaflow-task-orchestration/scripts/work-item.mjs advance \
  --file .tmp/work-items/<id>.json --to DESIGNED
```

Use `status --file <record>` for a compact state and routing summary, or
`check --file <record> --state <state>` without changing it.

## Orchestration rules

- The work item stores lifecycle truth; linked feature, repair, and release
  records store domain evidence. Do not duplicate detailed evidence.
- A failed gate means remain in the current state and complete the missing
  work. Never edit `state` by hand to bypass it.
- `READY_TO_RELEASE` is a readiness state, not permission. Record explicit user
  authorization immediately before external mutation.
- A build, upload, deployment, migration, or store submission is not
  real-environment verification.
- Tasks with no delivery requirement may move from `VALIDATED` directly to
  `VERIFIED`; record why delivery is not required.
- Keep iOS, Google Android, and China Android release acceptance records
  separate.
- Preserve truthful terminal state: locally complete, committed, pushed,
  deployed, and published are different outcomes.

The orchestrator does not publish, deploy, migrate, or mutate production. It
only selects routes and enforces evidence gates; use the routed Skill for the
actual authorized action.
