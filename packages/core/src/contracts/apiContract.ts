export const ERROR_CODES =[
  "AUTH_UNAUTHORIZED",
  "AUTH_FORBIDDEN",
  "VALIDATION_FAILED",
  "RATE_LIMITED",
  "RESOURCE_NOT_FOUND",
  "SUBSCRIPTION_REQUIRED",
  "PAYMENT_FAILED",
  "INTERNAL_ERROR"
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ApiSuccess<T> = {
  ok: true;
  request_id: string;
  data: T;
};

export type ApiFailure = {
  ok: false;
  request_id: string;
  error: {
    code: ErrorCode;
    message: string;
  };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;