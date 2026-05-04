/** PaymentOrderService：编排创建支付订单的业务流程。 */

import { randomUUID } from "node:crypto";
import type { CreatePaymentOrderResponse } from "@lf/core/contracts/payment/CreatePaymentOrderContract.js";
import type { QueryPaymentOrderResponse } from "@lf/core/contracts/payment/QueryPaymentContract.js";
import type { PaymentProvider } from "@lf/core/ports/payment/PaymentProvider.js";
import type {
  PaymentOrderEntity,
  PaymentOrderRepository,
} from "@lf/core/ports/repository/PaymentOrderRepository.js";

export class PaymentOrderNotFoundError extends Error {
  readonly code = "PAYMENT_ORDER_NOT_FOUND";

  constructor() {
    super("Payment order not found");
  }
}

export class PaymentOrderAccessDeniedError extends Error {
  readonly code = "PAYMENT_ORDER_NOT_FOUND";

  constructor() {
    super("Payment order not found");
  }
}

export class PaymentOrderService {
  constructor(
    private readonly paymentOrderRepository: PaymentOrderRepository,
    private readonly paymentProvider: PaymentProvider
  ) {}

  async createProMonthlyOrder(input: {
    userId: string;
  }): Promise<CreatePaymentOrderResponse> {
    const productCode = "pro_monthly" as const;
    const amount = Number(process.env.LF_PRO_MONTHLY_PRICE_CENTS ?? "1900");
    const reuseWindowMs = Number(process.env.LF_PAYMENT_PENDING_REUSE_WINDOW_MS ?? "300000");
    const since = new Date(Date.now() - reuseWindowMs);
    const existing = await this.paymentOrderRepository.findRecentPending({
      userId: input.userId,
      productCode,
      provider: this.paymentProvider.providerName,
      since,
    });

    if (existing) {
      const providerOrder = await this.paymentProvider.createOrder({
        providerOrderId: existing.providerOrderId,
        userId: input.userId,
        productCode,
        description: "LinguaFlow Pro 月卡",
        amount: existing.amount,
        currency: "CNY",
        notifyUrl: this.resolveNotifyUrl(),
      });

      return this.toCreateResponse(existing, providerOrder.clientPayParams, true);
    }

    const providerOrderId = this.createProviderOrderId();
    const created = await this.paymentOrderRepository.create({
      userId: input.userId,
      productCode,
      provider: this.paymentProvider.providerName,
      providerOrderId,
      amount,
      currency: "CNY",
      status: "pending",
    });
    const providerOrder = await this.paymentProvider.createOrder({
      providerOrderId,
      userId: input.userId,
      productCode,
      description: "LinguaFlow Pro 月卡",
      amount,
      currency: "CNY",
      notifyUrl: this.resolveNotifyUrl(),
    });

    return this.toCreateResponse(created, providerOrder.clientPayParams, false);
  }

  async getOrder(input: {
    id: string;
    userId: string;
  }): Promise<QueryPaymentOrderResponse> {
    const order = await this.paymentOrderRepository.findById(input.id);

    if (!order) throw new PaymentOrderNotFoundError();
    if (order.userId !== input.userId) throw new PaymentOrderAccessDeniedError();

    return {
      id: order.id,
      provider: order.provider,
      providerOrderId: order.providerOrderId,
      productCode: order.productCode,
      amount: order.amount,
      currency: order.currency,
      status: order.status,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }

  async reconcilePendingOrders(input: {
    limit?: number;
    now?: Date;
    onPaid: (order: PaymentOrderEntity) => Promise<void>;
  }): Promise<{
    scanned: number;
    paid: number;
    closed: number;
    failed: number;
  }> {
    const now = input.now ?? new Date();
    const graceMs = Number(process.env.LF_PAYMENT_RECONCILE_GRACE_MS ?? "120000");
    const expireMs = Number(process.env.LF_PAYMENT_PENDING_EXPIRE_MS ?? "1800000");
    const before = new Date(now.getTime() - graceMs);
    const orders = await this.paymentOrderRepository.listPendingCreatedBefore({
      before,
      limit: input.limit ?? Number(process.env.LF_PAYMENT_RECONCILE_BATCH_SIZE ?? "20"),
    });
    const result = {
      scanned: orders.length,
      paid: 0,
      closed: 0,
      failed: 0,
    };

    for (const order of orders) {
      try {
        const providerOrder = await this.paymentProvider.queryOrder({
          providerOrderId: order.providerOrderId,
        });

        if (providerOrder.status === "paid") {
          const updated = await this.paymentOrderRepository.updateStatus({
            id: order.id,
            status: "paid",
            metadata: {
              ...(typeof order.metadata === "object" && order.metadata ? order.metadata : {}),
              reconcile: {
                source: "worker",
                checkedAt: now.toISOString(),
                providerStatus: providerOrder.status,
              },
            },
          });
          await input.onPaid(updated);
          result.paid += 1;
          continue;
        }

        const expired = now.getTime() - order.createdAt.getTime() >= expireMs;
        if (expired && providerOrder.status === "pending") {
          await this.paymentOrderRepository.updateStatus({
            id: order.id,
            status: "closed",
            metadata: {
              ...(typeof order.metadata === "object" && order.metadata ? order.metadata : {}),
              reconcile: {
                source: "worker",
                checkedAt: now.toISOString(),
                providerStatus: providerOrder.status,
                reason: "pending_expired",
              },
            },
          });
          result.closed += 1;
          continue;
        }

        if (["closed", "failed", "refunded"].includes(providerOrder.status)) {
          await this.paymentOrderRepository.updateStatus({
            id: order.id,
            status: providerOrder.status,
            metadata: {
              ...(typeof order.metadata === "object" && order.metadata ? order.metadata : {}),
              reconcile: {
                source: "worker",
                checkedAt: now.toISOString(),
                providerStatus: providerOrder.status,
              },
            },
          });
          if (providerOrder.status === "closed") result.closed += 1;
          else result.failed += 1;
        }
      } catch (error) {
        result.failed += 1;
      }
    }

    return result;
  }

  private createProviderOrderId(): string {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const suffix = randomUUID().replace(/-/g, "").slice(0, 18);
    return `LF${date}${suffix}`.slice(0, 32);
  }

  private resolveNotifyUrl(): string {
    const notifyUrl = process.env.WECHAT_PAY_NOTIFY_URL;
    if (!notifyUrl) throw new Error("WECHAT_PAY_NOTIFY_URL is required");
    return notifyUrl;
  }

  private toCreateResponse(
    order: PaymentOrderEntity,
    clientPayParams: CreatePaymentOrderResponse["clientPayParams"],
    reused: boolean
  ): CreatePaymentOrderResponse {
    return {
      id: order.id,
      provider: order.provider,
      providerOrderId: order.providerOrderId,
      productCode: order.productCode,
      amount: order.amount,
      currency: order.currency,
      status: "pending",
      clientPayParams,
      reused,
    };
  }
}
