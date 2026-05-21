import type { PaymentOrderStatus } from "@lf/core/ports/payment/PaymentTypes.js";

const ALLOWED_TRANSITIONS: Record<PaymentOrderStatus, PaymentOrderStatus[]> = {
  pending: ["paid", "closed", "failed", "refunded"],
  paid: ["refunded"],
  closed: [],
  failed: [],
  refunded: [],
};

export function getExpectedCurrentStatusesForNextStatus(
  nextStatus: PaymentOrderStatus
): PaymentOrderStatus[] {
  const expected = (Object.keys(ALLOWED_TRANSITIONS) as PaymentOrderStatus[]).filter((from) =>
    ALLOWED_TRANSITIONS[from].includes(nextStatus)
  );
  return expected;
}

