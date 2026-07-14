export class GooglePlayBillingConfigError extends Error {
  readonly code = "GOOGLE_PLAY_BILLING_NOT_CONFIGURED";

  constructor(message: string) {
    super(message);
  }
}

export class GooglePlayBillingVerifyError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown> | null;

  constructor(message: string, code = "GOOGLE_PLAY_VERIFY_FAILED", details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details ?? null;
  }
}

export class GooglePlaySubscriptionAlreadyBoundError extends Error {
  readonly code = "GOOGLE_PLAY_SUBSCRIPTION_ALREADY_BOUND";
  readonly purchaseToken: string;

  constructor(input: { purchaseToken: string }) {
    super("Google Play subscription is already bound to another OIO account");
    this.purchaseToken = input.purchaseToken;
  }
}
