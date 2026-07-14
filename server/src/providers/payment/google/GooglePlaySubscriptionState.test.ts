import assert from "node:assert/strict";
import test from "node:test";
import {
  googlePlayStateGrantsEntitlement,
  resolveGooglePlayNotificationAction,
} from "./GooglePlaySubscriptionState.js";

test("Google Play lifecycle actions follow entitlement semantics", () => {
  const cases = [
    [4, "SUBSCRIPTION_STATE_ACTIVE", "sync"],
    [6, "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", "sync"],
    [9, "SUBSCRIPTION_STATE_ACTIVE", "sync"],
    [1, "SUBSCRIPTION_STATE_ACTIVE", "sync"],
    [3, "SUBSCRIPTION_STATE_CANCELED", "cancel"],
    [5, "SUBSCRIPTION_STATE_ON_HOLD", "suspend"],
    [10, "SUBSCRIPTION_STATE_PAUSED", "suspend"],
    [12, "SUBSCRIPTION_STATE_CANCELED", "revoke"],
    [13, "SUBSCRIPTION_STATE_EXPIRED", "cancel"],
  ] as const;

  for (const [notificationType, subscriptionState, expected] of cases) {
    assert.equal(
      resolveGooglePlayNotificationAction({ notificationType, subscriptionState }),
      expected
    );
  }
});

test("active, grace, and unexpired canceled states can grant entitlement", () => {
  assert.equal(googlePlayStateGrantsEntitlement("SUBSCRIPTION_STATE_ACTIVE"), true);
  assert.equal(googlePlayStateGrantsEntitlement("SUBSCRIPTION_STATE_IN_GRACE_PERIOD"), true);
  assert.equal(googlePlayStateGrantsEntitlement("SUBSCRIPTION_STATE_CANCELED"), true);
  assert.equal(googlePlayStateGrantsEntitlement("SUBSCRIPTION_STATE_ON_HOLD"), false);
  assert.equal(googlePlayStateGrantsEntitlement("SUBSCRIPTION_STATE_EXPIRED"), false);
});
