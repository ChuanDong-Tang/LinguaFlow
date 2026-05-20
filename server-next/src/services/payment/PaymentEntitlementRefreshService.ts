import type { CurrentEntitlementView } from "../entitlement/EntitlementService.js";
import type { EntitlementService } from "../entitlement/EntitlementService.js";
import type { AutoRenewService } from "./AutoRenewService.js";
import type { BenefitGrantService } from "./BenefitGrantService.js";
import type { PaymentEntitlementService } from "./PaymentEntitlementService.js";
import type { PaymentOrderService } from "./PaymentOrderService.js";


export interface RefreshPaymentEntitlementResult {
  entitlement: CurrentEntitlementView;
  paymentOrders: {
    scanned: number;
    paid: number;
    closed: number;
    failed: number;
  };
  autoRenewCharges: {
    scanned: number;
    paid: number;
    failed: number;
  };
}


export class PaymentEntitlementRefreshService {
  constructor(
    private readonly paymentOrderService: PaymentOrderService,
    private readonly autoRenewService: AutoRenewService,
    private readonly entitlementService: EntitlementService,
    private readonly paymentEntitlementService: PaymentEntitlementService,
    private readonly benefitGrantService: BenefitGrantService
  ) {}

  async refreshForUser(userId: string): Promise<RefreshPaymentEntitlementResult> {
    const paymentOrders = await this.paymentOrderService.reconcileUserPendingOrders({
      userId,
      // 用户手动刷新普通支付订单：如果微信查单已支付，就走统一权益发放入口。
      onPaid: async (order) => {
        try {
          await this.paymentEntitlementService.grantAfterPayment({
            userId: order.userId,
            sourceOrderId: order.id,
            productCode: "pro_monthly",
            channel: "wechat",
          });
        } catch (_error) {
          // 订单已经确认 paid 后，权益发放失败不能丢在半路；
          // 入队给 BenefitGrantWorker 后续补发，和全局支付对账 worker 的兜底策略保持一致。
          await this.benefitGrantService.enqueueGrant({
            userId: order.userId,
            sourceOrderId: order.id,
            productCode: "pro_monthly",
            channel: "wechat",
            payload: { fallbackReason: "sync_grant_failed", source: "user_entitlement_refresh" },
          });
        }
      },
    });

    // 自动续费扣款也要按当前用户做局部对账，避免用户手动刷新触发全局 worker 级扫描。
    const autoRenewCharges = await this.autoRenewService.reconcilePendingWeChatCharges({
      userId,
    });

    const entitlement = await this.entitlementService.getCurrentEntitlement(userId);

    return {
      entitlement,
      paymentOrders,
      autoRenewCharges,
    };
  }
}
