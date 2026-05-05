import type { SubscriptionService } from "../subscription/SubscriptionService.js";

export type PaymentChannel = "wechat" | "ios_iap";
export type PaymentProductCode = "pro_monthly";

export interface GrantEntitlementInput {
  userId: string;
  sourceOrderId: string;
  productCode: PaymentProductCode;
  channel: PaymentChannel;
}

export interface GrantEntitlementResult {
  alreadyApplied: boolean;
  months: number;
}

/**
 * 统一支付权益发放入口：
 * 各支付渠道只负责“验单/验签”，权益发放规则集中在这里。
 */
export class PaymentEntitlementService {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  async grantAfterPayment(input: GrantEntitlementInput): Promise<GrantEntitlementResult> {
    const months = resolveMonthsByProductCode(input.productCode);
    const result = await this.subscriptionService.openOrRenewPro({
      userId: input.userId,
      sourceOrderId: input.sourceOrderId,
      months,
    });

    return {
      alreadyApplied: result.alreadyApplied,
      months,
    };
  }
}

function resolveMonthsByProductCode(productCode: PaymentProductCode): number {
  if (productCode === "pro_monthly") return 1;
  return 1;
}
