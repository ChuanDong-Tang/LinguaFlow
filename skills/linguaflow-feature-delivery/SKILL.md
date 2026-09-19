---
name: linguaflow-feature-delivery
description: Analyze, design, implement, and validate LinguaFlow features, behavior changes, bug fixes, and refactors across Mobile, API, Server, Core, Prisma, Worker, and native boundaries. Use when a code change needs requirements, architecture placement, solution tradeoffs, compatibility checks, tests, and a truthful handoff; deployment and store release remain separate actions.
---

# LinguaFlow feature delivery

Trace the current behavior before changing it. Follow the repository direction
`Mobile -> API -> Server Service -> Port -> Infrastructure`, with shared
contracts and prompts in `packages/core`. Use repository documentation when it
is present, but verify every relevant boundary against the current code rather
than treating a diagram or historical note as runtime truth.

For every non-trivial feature, behavior change, bug fix, or refactor, use the
change record harness. A typo, formatting-only change, or mechanical metadata
edit does not need a record. Read
[references/design-decisions.md](references/design-decisions.md) when choosing
architecture placement or comparing solutions.

```bash
node skills/linguaflow-feature-delivery/scripts/change-record.mjs init \
  --output .tmp/changes/<id>.json \
  --type feature|behavior-change|bug-fix|refactor \
  --problem "<current problem>" \
  --outcome "<user-visible outcome>"

node skills/linguaflow-feature-delivery/scripts/change-record.mjs check \
  --file .tmp/changes/<id>.json --stage ready

node skills/linguaflow-feature-delivery/scripts/change-record.mjs check \
  --file .tmp/changes/<id>.json --stage complete
```

The record is an engineering aid, not ceremony. Keep it concise, cite actual
code or runtime evidence, and do not invent alternatives. If there is only one
coherent solution, explain why. A `ready` pass confirms that implementation is
well-scoped; it does not authorize production changes.

## Delivery workflow

1. Resolve the problem, user-visible outcome, non-goals, acceptance criteria,
   and important boundary cases.
2. Identify the actual current call chain, persisted state, async jobs, native
   boundary, and released-client compatibility involved. Record evidence.
3. Compare coherent solutions against correctness, architecture ownership,
   compatibility, testability, operational safety, and long-term maintenance.
   Escalate only choices that materially change product behavior or scope.
4. Pass the change record's `ready` stage before implementing a non-trivial
   change.
5. Inspect `git status` and preserve unrelated user changes. Stage explicit
   paths only.
6. Prefer the smallest coherent change. Put durable rules in services or Core,
   protocol validation in API routes, device behavior in Mobile, and external
   details behind providers or repositories.
7. Add a regression test for a demonstrated logic failure when the boundary is
   deterministic. Version prompts and generated-content contracts when their
   semantics change.
8. Run `scripts/verify-change.sh` with the relevant scope, plus any focused
   provider, native, or UI validation required by the risk.
9. Review the final diff for old-client compatibility, retries, idempotency,
   stale async results, failure states, user data preservation, and accidental
   inclusion of unrelated files.
10. Record observed acceptance evidence and pass `complete`. This means the
    requested code outcome is locally complete, not deployed or published.

Use `../linguaflow-production-database/SKILL.md` for schema or production data
work. Use `../linguaflow-backend-deploy/SKILL.md` only when the user asks to
push, deploy, pull remotely, or restart services. Use the app release Skill for
OTA, packages, uploads, or store submission.

When the bug already affects a released App version, use
`../linguaflow-live-version-repair/SKILL.md` to preserve the exact released
baseline, choose the repair lane, and coordinate real-environment verification.

## Handoff

State separately what was changed, what passed locally, whether anything was
committed or pushed, whether a migration exists, and which runtime or package
still needs rollout. Never describe local code as deployed.

Do not call non-trivial feature work complete unless its record passes
`--stage complete`.
