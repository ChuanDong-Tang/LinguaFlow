export class AppleIapConfigError extends Error {
  readonly code = "IAP_NOT_CONFIGURED";

  constructor(message: string) {
    super(message);
  }
}

export class AppleIapVerifyError extends Error {
  readonly code = "IAP_VERIFY_FAILED";

  constructor(message: string) {
    super(message);
  }
}
