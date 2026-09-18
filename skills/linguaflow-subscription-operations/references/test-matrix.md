# Subscription validation matrix

Select only the provider and cases relevant to the request. Record provider
transaction identifiers and OIO audit identifiers without copying credentials
or unnecessary personal data.

## Common lifecycle

For each supported product family, verify:

1. new purchase and immediate entitlement;
2. repeated verification and notification idempotency;
3. app restart and restore/reconciliation;
4. renewal;
5. billing retry, grace, hold, refund, revocation, and expiration where the
   provider sandbox supports them;
6. cancellation of auto-renew without premature entitlement loss;
7. resubscription after cancellation;
8. purchase associated with another OIO account and the explicit transfer
   result;
9. missed, duplicated, delayed, and out-of-order notifications;
10. audit visibility of provider, product, order, old state, new state, and
    reason.

## Plan changes

Verify separately rather than inferring symmetry:

- Plus monthly -> Pro monthly;
- Pro monthly -> Plus monthly;
- monthly -> annual at the same tier;
- annual -> monthly at the same tier;
- Plus annual -> Pro annual;
- Pro annual -> Plus annual;
- changing an already pending transition;
- returning to the current plan to cancel a pending transition;
- cancellation while a transition is pending;
- renewal or expiration at the exact transition boundary.

Confirm the provider's charge timing, proration, replacement mode, effective
time, and API support from current official documentation and an actual sandbox
result. The UI explanation must match the server and provider outcome.

## LinguaFlow provider boundaries

- Apple and Google Play use native store subscriptions and provider management
  surfaces. Store account state and OIO account linkage are distinct.
- Alipay monthly auto-renew and the one-time annual pass are separate product
  models. Do not present the annual pass as a renewable subscription or assume
  it can participate in monthly plan replacement.
- Manual grants can coexist with provider purchases. Effective entitlement is
  derived from all active sources; audit and close only the intended source.
