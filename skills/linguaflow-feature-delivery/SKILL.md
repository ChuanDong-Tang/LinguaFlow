---
name: linguaflow-feature-delivery
description: Implement and validate LinguaFlow features or bug fixes across mobile, API, Server, Core, and Prisma. Use for code changes that need architecture-aware scoping, compatibility checks, tests, and a clean handoff; deployment and store release remain separate actions.
---

# LinguaFlow feature delivery

Trace the current behavior before changing it. Follow the repository direction
`Mobile -> API -> Server Service -> Port -> Infrastructure`, with shared
contracts and prompts in `packages/core`. Use repository documentation when it
is present, but verify every relevant boundary against the current code rather
than treating a diagram or historical note as runtime truth.

## Delivery workflow

1. Resolve the user-visible outcome and important boundary cases.
2. Identify the current call chain, persisted state, async jobs, native
   boundary, and released-client compatibility involved.
3. Inspect `git status` and preserve unrelated user changes. Stage explicit
   paths only.
4. Prefer the smallest coherent change. Put durable rules in services or Core,
   protocol validation in API routes, device behavior in Mobile, and external
   details behind providers or repositories.
5. Add a regression test for a demonstrated logic failure when the boundary is
   deterministic. Version prompts and generated-content contracts when their
   semantics change.
6. Run `scripts/verify-change.sh` with the relevant scope, plus any focused
   provider, native, or UI validation required by the risk.
7. Review the final diff for old-client compatibility, retries, idempotency,
   stale async results, failure states, user data preservation, and accidental
   inclusion of unrelated files.

Use `../linguaflow-production-database/SKILL.md` for schema or production data
work. Use `../linguaflow-backend-deploy/SKILL.md` only when the user asks to
push, deploy, pull remotely, or restart services. Use the app release Skill for
OTA, packages, uploads, or store submission.

## Handoff

State separately what was changed, what passed locally, whether anything was
committed or pushed, whether a migration exists, and which runtime or package
still needs rollout. Never describe local code as deployed.
