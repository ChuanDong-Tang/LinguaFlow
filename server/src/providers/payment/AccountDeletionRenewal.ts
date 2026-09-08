export type AccountDeletionRenewalAction = "cancel" | "already_inactive" | "defer";

export interface AccountDeletionRenewalResult {
  action: "cancelled" | "already_inactive" | "deferred";
  remoteStatus: string;
  autoRenewEnabled: boolean | null;
  currentPeriodEnd: string | null;
  reason?: string;
}

export class AccountDeletionRenewalError extends Error {
  readonly code: string;

  constructor(
    readonly remoteStatus: string,
    readonly originalError: unknown,
  ) {
    super(originalError instanceof Error ? originalError.message : String(originalError));
    const originalCode = originalError && typeof originalError === "object" && "code" in originalError
      ? String((originalError as { code?: unknown }).code ?? "").trim()
      : "";
    this.code = originalCode || "ACCOUNT_DELETION_RENEWAL_FAILED";
  }
}

export function resolveAlipayAccountDeletionAction(
  remoteStatus: string,
  cancelAtPeriodEnd: boolean,
  incompleteAuthorizationExpired = false,
): AccountDeletionRenewalAction {
  const status = remoteStatus.trim().toUpperCase();
  if (
    cancelAtPeriodEnd ||
    status === "CANCELED" ||
    status === "INCOMPLETE_EXPIRED" ||
    (status === "INCOMPLETE" && incompleteAuthorizationExpired)
  ) {
    return "already_inactive";
  }
  if (status === "ACTIVE") return "cancel";
  return "defer";
}

export function resolveGooglePlayAccountDeletionAction(
  remoteStatus: string,
  autoRenewEnabled: boolean,
): AccountDeletionRenewalAction {
  const status = remoteStatus.trim().toUpperCase();
  if (
    !autoRenewEnabled ||
    status === "SUBSCRIPTION_STATE_CANCELED" ||
    status === "SUBSCRIPTION_STATE_EXPIRED" ||
    status === "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED"
  ) {
    return "already_inactive";
  }
  if (
    status === "SUBSCRIPTION_STATE_ACTIVE" ||
    status === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" ||
    status === "SUBSCRIPTION_STATE_ON_HOLD" ||
    status === "SUBSCRIPTION_STATE_PAUSED"
  ) {
    return "cancel";
  }
  return "defer";
}

export function resolveAppleAccountDeletionAction(
  remoteStatus: number | null,
  autoRenewStatus: number | null,
): Exclude<AccountDeletionRenewalAction, "cancel"> {
  // App Store Server API: 2 = expired, 5 = revoked; autoRenewStatus 0 = renewal off.
  if (remoteStatus === 2 || remoteStatus === 5 || autoRenewStatus === 0) {
    return "already_inactive";
  }
  return "defer";
}
