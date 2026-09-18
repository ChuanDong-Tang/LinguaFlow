# Measurement model

## End-to-end event shape

Export measurements as a JSON array or newline-delimited JSON. Each record must
contain a metric name and duration in milliseconds:

```json
{"metric":"api.card.create","durationMs":384,"ok":true,"traceId":"opaque-id"}
```

Optional fields may identify the platform, route, stage, version, status code,
provider, database operation, or cache state. Keep labels bounded; never use a
user ID, card ID, URL query string, raw SQL, or error message as a metric name.

## Boundaries

For an asynchronous workflow, measure both foreground and eventual completion:

```text
tap -> request sent -> API accepted -> job queued
job queued -> job claimed -> provider completed -> persisted -> App observed
```

For Mobile, distinguish cold launch, warm launch, first screen rendered, first
screen interactive, navigation, data visible, and media ready. For API, split
middleware, handler/service, database, provider, serialization, and response.

For the database, keep separate metrics for connection acquisition, query,
transaction, and result mapping. Group queries by a stable operation name or
normalized fingerprint rather than raw SQL.

## Percentiles

P95 is the duration at or below which roughly 95 percent of samples completed.
Always show the sample count and measurement window. Fewer than 20 samples is
insufficient for enforcing a percentile budget; 20-99 samples is provisional.

Suggested initial budgets are hypotheses, not permanent truths:

- interactive API P95: 500 ms, excluding intentionally long provider calls;
- database connection acquisition P95: 50 ms;
- ordinary database query P95: 100 ms;
- user interaction response: 100 ms for immediate feedback;
- sustained Worker queue delay: alert when it grows across consecutive windows.

Set final budgets from real healthy baselines and product expectations. Track
P99 for rare severe pain even when P95 passes.

## Comparison report

Every optimization report should contain:

| Field | Meaning |
| --- | --- |
| Scope | Exact user action, endpoint, query, or job |
| Build | App/runtime/backend commit and environment |
| Window | Measurement start/end and cache state |
| Samples | Total, successes, and errors |
| Before/after | P50, P90, P95, P99, maximum, error rate |
| Bottleneck | Dominant measured stage |
| Change | What was changed and the expected mechanism |
| Guard | Test, metric, or budget that detects regression |

Do not claim an improvement when the datasets use different traffic,
environments, concurrency, or cache state without explicitly qualifying it.
