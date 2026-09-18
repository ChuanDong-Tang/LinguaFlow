---
name: linguaflow-subscription-operations
description: Develop, test, diagnose, or operate LinguaFlow subscriptions and entitlements across Apple, Google Play, Alipay, and manual grants. Use for products, purchase verification, upgrades/downgrades, cancellation, transfer, notifications, reconciliation, audit, or payment recovery.
---

# LinguaFlow subscription operations

Treat the backend entitlement and audited provider evidence as authoritative;
never grant or revoke access solely from a client success dialog. Keep provider
transactions idempotent and recoverable through notification handling plus
active reconciliation.

Read [references/test-matrix.md](references/test-matrix.md) before changing or
validating plan transitions, cancellation, ownership transfer, or annual
products. Provider APIs and store policy are time-sensitive: verify uncertain
behavior against current official provider documentation and the configured
product model rather than assuming Apple, Google Play, and Alipay are equal.

## Stable invariants

- Product IDs, prices, package flags, credentials, and sandbox/production
  environments must not cross providers or distributions.
- Verification, account linking or transfer, entitlement mutation, and audit
  recording form one coherent server-side operation or recoverable workflow.
- Notifications are hints that trigger verification; they are not trusted as
  the only source of truth. Reconciliation must recover missed or delayed
  notifications.
- Manual Pro grants are a separate auditable source. Closing a manual grant
  must not cancel or erase a valid store subscription; provider expiration
  must not erase an active manual grant.
- A pending plan change must record the current plan, requested plan,
  effective time, provider operation, and cancellation/replacement state.
- A failed verification never grants benefits. A successful payment that is
  linked to another OIO account must follow the explicit provider-account
  transfer policy instead of silently losing the purchase.
- Production mutations require an exact user/order/subscription target and
  explicit authorization. Never bulk-repair nearby records during one-user
  recovery.

## Change and diagnosis

Trace Mobile purchase UI -> API route -> provider service -> repository ->
entitlement -> audit/reconciliation Worker. Inspect both immediate verification
and asynchronous recovery. Preserve released-client behavior and provider
fallbacks during rolling deployment.

Use the production incident Skill for live symptoms, the production database
Skill for Prisma or production data work, and the app release Skill when native
billing libraries, product configuration, or distribution flags require a new
binary.
