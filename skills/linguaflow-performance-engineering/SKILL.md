---
name: linguaflow-performance-engineering
description: Measure, explain, optimize, and guard LinguaFlow performance across Mobile, API, database, Worker, and external providers. Use for latency, startup, rendering, P90/P95/P99, slow queries, connection pools, queue delay, throughput, tracing, or performance regressions.
---

# LinguaFlow performance engineering

Act as a performance engineer and teacher. Establish evidence before changing
code, identify the dominant part of the user-visible path, make the smallest
useful change, and explain the result in plain language.

Read [references/measurement-model.md](references/measurement-model.md) when
defining metrics, traces, dashboards, alerts, or performance budgets. Use
`scripts/latency-report.mjs` to summarize exported timing samples consistently.

## Required method

1. Name the user action and its start and completion boundaries.
2. Capture a baseline with environment, version, time window, sample count,
   concurrency, and cache state.
3. Split the path into Mobile, network, API, database, external provider,
   Worker queue, Worker execution, persistence, and final UI refresh where
   those stages exist.
4. Compare percentiles and error rate, not only averages. Treat low-sample
   percentiles as directional evidence rather than a stable conclusion.
5. Optimize the dominant bottleneck. Do not trade correctness, transaction
   safety, idempotency, accessibility, or observability for a faster number.
6. Repeat the same measurement and report before/after values, uncertainty,
   regressions, and the user-visible effect.

Use one correlation or trace ID across App, API, database/provider spans, jobs,
and completion events. Never log credentials, payment material, full user
content, or unnecessary personal data.

## Safety and interpretation

- Production load tests require explicit authorization and bounded traffic.
- Read-only production metrics do not authorize restarts, indexes, schema
  changes, cache invalidation, or connection-pool changes.
- Database connection count alone is not a diagnosis. Measure pool saturation,
  acquisition wait, timeouts, query duration, transaction duration, and the
  number of application instances together.
- A fast HTTP response is not a fast workflow when work remains queued or the
  UI has not reflected the result.
- Report P50, P90, P95, P99, maximum, errors, and sample count when available.
  Explain which percentile represents the user's complaint and why.

Finish with a compact teaching summary: what was slow, why it was slow, what
changed, the measured improvement, and what should be watched next.
