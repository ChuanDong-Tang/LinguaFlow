# Feature design decisions

Use this reference for non-trivial feature work, behavior changes, bug fixes,
or refactors. The goal is not to produce a long proposal. It is to make the
important engineering decision explicit before code makes it expensive to
change.

## Understand before designing

Trace the actual entry point, call chain, state transitions, persisted data,
async work, native boundary, and external provider involved. Cite code paths,
tests, logs, or observed runtime behavior. Historical documents are context,
not proof of the current implementation.

For cross-layer work, read `docs/02-ARCHITECTURE.md` and the relevant flow in
`docs/03-BUSINESS-FLOWS.md`.

## Choose responsibility by layer

- Mobile owns interaction, device state, presentation, and local cache.
- API owns authentication context, protocol validation, rate limits, and error
  mapping.
- Server services own business use cases and state transitions.
- Core owns stable shared contracts, domain types, ports, prompts, and reusable
  text rules without depending on frameworks.
- Providers and repositories own external systems and persistence details
  behind ports.
- Worker owns asynchronous, retryable, scheduled, and maintenance work.
- Prisma schema describes current database structure; migrations describe its
  production evolution.

Avoid putting durable business rules in Screens or Routes, and avoid exposing
provider or Prisma details across their boundary merely to reduce file count.

## Compare solutions

Judge candidate solutions by:

1. correctness for the stated user outcome and boundary cases;
2. fit with existing ownership and dependency direction;
3. compatibility with released clients and existing data;
4. smallest coherent change, not merely the fewest edited lines;
5. testability and observable failure states;
6. retry, concurrency, idempotency, and stale-result behavior where relevant;
7. reversibility and operational cost;
8. maintainability when the feature grows.

Use two or more options when there is a real design choice. Do not invent a
weak alternative to satisfy a template; record why only one coherent option
exists instead.

## Escalate material product choices

Continue autonomously when the user-visible outcome and tradeoff are clear.
Discuss with the user before implementation when alternatives materially change
behavior, data ownership, privacy, recurring cost, destructive migration, or
the scope they requested.

## Keep documents truthful

Update `docs/02-ARCHITECTURE.md`, `docs/03-BUSINESS-FLOWS.md`, or
`docs/DECISIONS.md` only when their long-lived facts actually change. A local
implementation note or speculative future plan does not belong there.
