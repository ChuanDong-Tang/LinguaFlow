export type GooglePlayNotificationAction = "sync" | "cancel" | "suspend" | "revoke" | "ignore";

export function googlePlayStateGrantsEntitlement(subscriptionState: string | null | undefined): boolean {
  const state = normalizeState(subscriptionState);
  return (
    state === "SUBSCRIPTION_STATE_ACTIVE" ||
    state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" ||
    state === "SUBSCRIPTION_STATE_CANCELED"
  );
}

export function resolveGooglePlayNotificationAction(input: {
  notificationType: number | null;
  subscriptionState: string | null | undefined;
}): GooglePlayNotificationAction {
  const state = normalizeState(input.subscriptionState);
  if (input.notificationType === 12) return "revoke";
  if (
    input.notificationType === 5 ||
    input.notificationType === 10 ||
    state === "SUBSCRIPTION_STATE_ON_HOLD" ||
    state === "SUBSCRIPTION_STATE_PAUSED"
  ) {
    return "suspend";
  }
  if (
    input.notificationType === 3 ||
    input.notificationType === 13 ||
    state === "SUBSCRIPTION_STATE_CANCELED" ||
    state === "SUBSCRIPTION_STATE_EXPIRED"
  ) {
    return "cancel";
  }
  if (
    state === "SUBSCRIPTION_STATE_ACTIVE" ||
    state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" ||
    (input.notificationType !== null &&
      [1, 2, 4, 6, 7, 9, 11, 17, 18, 19, 22].includes(input.notificationType))
  ) {
    return "sync";
  }
  return "ignore";
}

function normalizeState(value: string | null | undefined): string {
  return String(value ?? "").toUpperCase();
}
