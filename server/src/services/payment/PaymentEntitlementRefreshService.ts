import type { CurrentEntitlementView } from "../entitlement/EntitlementService.js";
import type { EntitlementService } from "../entitlement/EntitlementService.js";
import type { AutoRenewService } from "./AutoRenewService.js";
import type { BenefitGrantService } from "./BenefitGrantService.js";
import type { PaymentEntitlementService } from "./PaymentEntitlementService.js";
import type { PaymentOrderService } from "./PaymentOrderService.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import { createEntitlementGrantPayload } from "./EntitlementGrantSnapshot.js";


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
  private readonly recentRefreshByUser = new Map<string, { at: number; result: RefreshPaymentEntitlementResult }>();

  constructor(
    private readonly paymentOrderService: PaymentOrderService,
    private readonly autoRenewService: AutoRenewService,
    private readonly entitlementService: EntitlementService,
    private readonly paymentEntitlementService: PaymentEntitlementService,
    private readonly benefitGrantService: BenefitGrantService
  ) {}

  async refreshForUser(userId: string): Promise<RefreshPaymentEntitlementResult> {
    const now = Date.now();
    const cached = this.recentRefreshByUser.get(userId);
    if (cached && now - cached.at < 15_000) {
      return {
        ...cached.result,
        entitlement: await this.entitlementService.getCurrentEntitlement(userId),
      };
    }

    const runtime = getRuntimeConfig();
    const paymentOrders = runtime.payment.wechatPayEnabled
      ? await this.paymentOrderService.reconcileUserPendingOrders({
          userId,
          // 用户手动刷新普通支付订单：如果微信查单已支付，就走统一权益发放入口。
          onPaid: async (order) => {
            try {
              await this.paymentEntitlementService.grantAfterPayment({
                userId: order.userId,
                sourceOrderId: order.id,
                productCode: "pro_monthly",
                channel: "wechat",
                grantMode: "fixed_duration",
              });
            } catch (_error) {
              // 订单已经确认 paid 后，权益发放失败不能丢在半路；
              // 入队给 BenefitGrantWorker 后续补发，和全局支付对账 worker 的兜底策略保持一致。
              await this.benefitGrantService.enqueueGrant({
                userId: order.userId,
                sourceOrderId: order.id,
                productCode: "pro_monthly",
                channel: "wechat",
                payload: createEntitlementGrantPayload({
                  fallbackReason: "sync_grant_failed",
                  source: "user_entitlement_refresh",
                  grant: {
                    grantMode: "fixed_duration",
                    prepaidLimit: "enforce",
                  },
                }),
              });
            }
          },
        })
      : { scanned: 0, paid: 0, closed: 0, failed: 0 };

    // 自动续费扣款也要按当前用户做局部对账，避免用户手动刷新触发全局 worker 级扫描。
    const autoRenewCharges = runtime.payment.wechatPayEnabled
      ? await this.autoRenewService.reconcilePendingWeChatCharges({
          userId,
        })
      : { scanned: 0, paid: 0, failed: 0 };

    const entitlement = await this.entitlementService.getCurrentEntitlement(userId);

    const result = {
      entitlement,
      paymentOrders,
      autoRenewCharges,
    };
    this.recentRefreshByUser.set(userId, { at: now, result });
    return result;
  }
}
