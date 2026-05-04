import { randomUUID } from "node:crypto";
import type {
  ApiFailure,
  ApiSuccess,
  ErrorCode
} from "@lf/core/contracts/apiContract.js";

export function createRequestId(): string {
  return `req_${randomUUID().replace(/-/g, "")}`;
}

export function resolveRequestId(headerValue: string | string[] | undefined): string {
  if (Array.isArray(headerValue)) {
    return headerValue[0]?.trim() || createRequestId();
  }
  return headerValue?.trim() || createRequestId();
}

export function ok<T>(requestId: string, data: T): ApiSuccess<T> {
  return {
    ok: true,
    request_id: requestId,
    data
  };
}

export function fail(
  requestId: string,
  code: ErrorCode,
  message: string
): ApiFailure {
  return {
    ok: false,
    request_id: requestId,
    error: { code, message }
  };
}
