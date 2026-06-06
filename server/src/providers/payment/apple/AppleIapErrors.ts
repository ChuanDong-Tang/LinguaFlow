export class AppleIapConfigError extends Error {
  readonly code = "IAP_NOT_CONFIGURED";

  constructor(message: string) {
    super(message);
  }
}

export class AppleIapVerifyError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown> | null;

  constructor(message: string, code = "IAP_VERIFY_FAILED", details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details ?? null;
  }
}
