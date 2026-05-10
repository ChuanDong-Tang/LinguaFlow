import type { BenefitGrantRepository } from "@lf/core/ports/repository/BenefitGrantRepository.js";
import type { PaymentProductCode } from "@lf/core/ports/payment/PaymentTypes.js";

export class BenefitGrantService {
  constructor(private readonly repository: BenefitGrantRepository) {}

  async enqueueGrant(input: {
    userId: string;
    sourceOrderId: string;
    productCode: PaymentProductCode;
    channel: "wechat" | "ios_iap";
    payload?: unknown;
  }): Promise<{ created: boolean; id: string }> {
    const result = await this.repository.enqueue(input);
    return { created: result.created, id: result.grant.id };
  }
}
