import type { CurrentEntitlementView } from "../entitlement/EntitlementService.js";
import type { EntitlementService } from "../entitlement/EntitlementService.js";


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
    private readonly entitlementService: EntitlementService
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

    const paymentOrders = { scanned: 0, paid: 0, closed: 0, failed: 0 };
    const autoRenewCharges = { scanned: 0, paid: 0, failed: 0 };

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
