/** WeChatPayMapper：做微信字段与系统内部字段的双向映射。 */

import type { PaymentOrderStatus } from "@lf/core/ports/payment/PaymentTypes.js";

export function mapWeChatTradeState(value: string | undefined): PaymentOrderStatus {
  switch (value) {
    case "SUCCESS":
      return "paid";
    case "CLOSED":
      return "closed";
    case "REFUND":
      return "refunded";
    case "PAYERROR":
      return "failed";
    case "NOTPAY":
    case "USERPAYING":
    case "ACCEPT":
    default:
      return "pending";
  }
}
