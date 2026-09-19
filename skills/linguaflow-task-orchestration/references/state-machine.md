# Work-item state machine

```text
PLANNED
  -> DESIGNED
  -> IMPLEMENTED
  -> VALIDATED
  -> READY_TO_RELEASE -> RELEASED -> VERIFIED -> CLOSED
                   \----------------> VERIFIED -> CLOSED
                         when delivery is not required
```

## State meaning

| State | Required truth |
| --- | --- |
| `PLANNED` | Problem, desired outcome, non-goals, acceptance criteria, and requested terminal state are explicit. |
| `DESIGNED` | Current behavior is evidenced, routes are confirmed, and the linked change or incident record has passed its design/diagnosis gate. |
| `IMPLEMENTED` | The intended source or configuration change exists and its exact files/reference are recorded. |
| `VALIDATED` | Local tests and required simulators passed; linked change work passed `complete`. |
| `READY_TO_RELEASE` | Delivery target, authorization, rollback, and applicable prepublish acceptance records are complete. |
| `RELEASED` | The requested delivery action is live, not merely built, uploaded, or submitted for review. |
| `VERIFIED` | The original flow passed in the intended real environment; linked live-repair or release records pass their final gate. |
| `CLOSED` | Outcome, actual terminal state, remaining risks, and any intentionally deferred work are truthful. |

## Routing

The work-item script recommends Skills from task type and scope. Review the
result because a code path can cross more boundaries than the initial request
suggests.

- Feature, behavior change, bug fix, or refactor: feature delivery.
- Released-version failure: production incident plus live-version repair.
- Backend or Worker rollout: backend deployment.
- Schema or production persistence: production database.
- Payment, subscription, or entitlement: subscription operations.
- Card prompts, generation, jobs, or backfill: Card AI pipeline.
- Performance or capacity: performance engineering.
- Mobile/native/OTA/store/China APK: app release.

## Delivery selection

- Backend-only code: exact-commit backend rollout.
- Schema change: migration first, then compatible process rollout.
- JavaScript or bundled assets compatible with the installed runtime: OTA may
  be eligible; the app-release Skill makes the final compatibility decision.
- Native dependency, Config Plugin, entitlement, permission, signing, SDK, or
  runtime change: native package.
- China Android: immutable APK upload plus live download-pointer validation.
- No external delivery: skip from `VALIDATED` to `VERIFIED`, but still record
  observed acceptance evidence.

Store review waiting time is not `RELEASED`. Keep delivery progress as
`submitted` while the work item remains `READY_TO_RELEASE`; advance only after
the intended population can actually receive the release.
