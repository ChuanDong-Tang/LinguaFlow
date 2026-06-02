/** PaymentOrderService：编排创建支付订单的业务流程。 */

import { randomUUID } from "node:crypto";
import type { CreatePaymentOrderResponse } from "@lf/core/contracts/payment/CreatePaymentOrderContract.js";
import type { QueryPaymentOrderResponse } from "@lf/core/contracts/payment/QueryPaymentContract.js";
import type { PaymentProvider } from "@lf/core/ports/payment/PaymentProvider.js";
import type {
  PaymentOrderEntity,
  PaymentOrderRepository,
} from "@lf/core/ports/repository/PaymentOrderRepository.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import { addCalendarMonthsClamped } from "../time/calendarMath.js";
import { getExpectedCurrentStatusesForNextStatus } from "./PaymentOrderStateMachine.js";
import type { SubscriptionService } from "../subscription/SubscriptionService.js";

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

export class ProRenewalTooEarlyError extends Error {
  readonly code = "PRO_RENEWAL_TOO_EARLY";
  readonly expiresAt: Date;
  readonly maxAllowedExpiresAt: Date;

  constructor(input: { expiresAt: Date; maxAllowedExpiresAt: Date }) {
    super("Pro prepaid months limit reached");
    this.expiresAt = input.expiresAt;
    this.maxAllowedExpiresAt = input.maxAllowedExpiresAt;
  }
}

export class PaymentOrderService {
  private static readonly REUSE_RECREATE_WARN_THRESHOLD = 3;

  constructor(
    private readonly paymentOrderRepository: PaymentOrderRepository,
    private readonly paymentProvider: PaymentProvider,
    private readonly subscriptionService?: SubscriptionService
  ) {}

  async createProMonthlyOrder(input: {
    userId: string;
  }): Promise<CreatePaymentOrderResponse> {
    const productCode = "pro_monthly" as const;
    const config = getRuntimeConfig();
    const now = new Date();
    if (this.subscriptionService) {
      const current = await this.subscriptionService.getCurrentSubscription(input.userId, now);
      if (current.isPro && current.expiresAt) {
        const maxAllowedExpiresAt = addCalendarMonthsClamped(
          now,
          config.payment.proMonthlyMaxPrepaidMonths - 1
        );
        if (current.expiresAt > maxAllowedExpiresAt) {
          // 单次月卡最多只能把 Pro 权益预存到“现在 + maxPrepaidMonths”附近。
          // 因为本次购买会再顺延 1 个月，所以这里用 maxPrepaidMonths - 1 判断当前剩余权益。
          // 这样既允许用户提前续一个月，又避免未来调价后用旧价格长期囤月卡。
          throw new ProRenewalTooEarlyError({
            expiresAt: current.expiresAt,
            maxAllowedExpiresAt,
          });
        }
      }
    }
    const amount = config.payment.proMonthlyPriceCents;
    const description = config.payment.descriptionProMonthly;
    const reuseWindowMs = config.payment.pendingReuseWindowMs;
    const since = new Date(Date.now() - reuseWindowMs);
    const existing = await this.paymentOrderRepository.findRecentPending({
      userId: input.userId,
      productCode,
      provider: this.paymentProvider.providerName,
      since,
    });

    if (existing) {
      const providerSnapshot = await this.paymentProvider.queryOrder({
        providerOrderId: existing.providerOrderId,
      });

      if (providerSnapshot.status !== "pending") {
        await this.paymentOrderRepository.updateStatus({
          id: existing.id,
          status: providerSnapshot.status,
          expectedCurrentStatuses: getExpectedCurrentStatusesForNextStatus(providerSnapshot.status),
          metadata: {
            ...this.getOrderMetadata(existing),
            reuseDecision: {
              checkedAt: new Date().toISOString(),
              providerStatus: providerSnapshot.status,
              action: "skip_recreate",
            },
          },
        });
      } else {
        const nowIso = new Date().toISOString();
        const cachedClientPayParams = this.getCachedClientPayParams(existing);
        if (cachedClientPayParams) {
          await this.paymentOrderRepository.updateStatus({
            id: existing.id,
            status: "pending",
            expectedCurrentStatuses: ["pending"],
            metadata: {
              ...this.getOrderMetadata(existing),
              reuseDecision: {
                checkedAt: nowIso,
                providerStatus: providerSnapshot.status,
                action: "reuse_cached_client_pay_params",
              },
            },
          });
          return this.toCreateResponse(existing, cachedClientPayParams, true);
        }

        const nextAttempts = this.getProviderCreateAttempts(existing) + 1;
        const metadata = {
          ...this.getOrderMetadata(existing),
          providerCreateAttempts: nextAttempts,
          lastProviderCreateAt: nowIso,
          reuseDecision: {
            checkedAt: nowIso,
            providerStatus: providerSnapshot.status,
            action: "recreate_without_cached_client_pay_params",
          },
        };

        const providerOrder = await this.paymentProvider.createOrder({
          providerOrderId: existing.providerOrderId,
          userId: input.userId,
          productCode,
          description,
          amount: existing.amount,
          currency: "CNY",
          notifyUrl: this.resolveNotifyUrl(),
        });
        await this.paymentOrderRepository.updateStatus({
          id: existing.id,
          status: "pending",
          expectedCurrentStatuses: ["pending"],
          metadata,
        });

        if (nextAttempts >= PaymentOrderService.REUSE_RECREATE_WARN_THRESHOLD) {
          console.warn("[payment] repeated provider createOrder on reused pending order", {
            orderId: existing.id,
            userId: existing.userId,
            provider: existing.provider,
            providerOrderId: existing.providerOrderId,
            attempts: nextAttempts,
          });
        }

        return this.toCreateResponse(existing, providerOrder.clientPayParams, true);
      }
    }

    const providerOrderId = this.createProviderOrderId();
    let created: PaymentOrderEntity;
    try {
      created = await this.paymentOrderRepository.create({
        userId: input.userId,
        productCode,
        provider: this.paymentProvider.providerName,
        providerOrderId,
        amount,
        currency: "CNY",
        status: "pending",
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const pending = await this.paymentOrderRepository.findPendingByUserProductProvider({
        userId: input.userId,
        productCode,
        provider: this.paymentProvider.providerName,
      });
      if (!pending) throw error;
      const cachedClientPayParams = this.getCachedClientPayParams(pending);
      if (cachedClientPayParams) {
        return this.toCreateResponse(pending, cachedClientPayParams, true);
      }
      // 双端同时创建单次订单时，数据库 pending 唯一索引是最后防线；
      // 这里回查并复用已经创建成功的待支付单，避免同一用户拿到两张待支付月卡订单。
      const providerOrder = await this.paymentProvider.createOrder({
        providerOrderId: pending.providerOrderId,
        userId: input.userId,
        productCode,
        description,
        amount: pending.amount,
        currency: "CNY",
        notifyUrl: this.resolveNotifyUrl(),
      });
      return this.toCreateResponse(pending, providerOrder.clientPayParams, true);
    }
    const providerOrder = await this.paymentProvider.createOrder({
      providerOrderId,
      userId: input.userId,
      productCode,
      description,
      amount,
      currency: "CNY",
      notifyUrl: this.resolveNotifyUrl(),
    });
    await this.paymentOrderRepository.updateStatus({
      id: created.id,
      status: "pending",
      expectedCurrentStatuses: ["pending"],
      metadata: {
        ...this.getOrderMetadata(created),
        providerCreateAttempts: 1,
        clientPayParams: providerOrder.clientPayParams,
        lastProviderCreateAt: new Date().toISOString(),
      },
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
    const config = getRuntimeConfig();
    const graceMs = config.payment.reconcileGraceMs;
    const expireMs = config.payment.pendingExpireMs;
    const before = new Date(now.getTime() - graceMs);
    const orders = await this.paymentOrderRepository.listPendingCreatedBefore({
      before,
      limit: input.limit ?? config.payment.reconcileBatchSize,
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
            expectedCurrentStatuses: getExpectedCurrentStatusesForNextStatus("paid"),
            metadata: {
              ...(typeof order.metadata === "object" && order.metadata ? order.metadata : {}),
              reconcile: {
                source: "worker",
                checkedAt: now.toISOString(),
                providerStatus: providerOrder.status,
              },
            },
          });

          if (!updated) {
            continue;
          }

          await input.onPaid(updated);
          result.paid += 1;
          continue;
        }

        const expired = now.getTime() - order.createdAt.getTime() >= expireMs;
        if (expired && providerOrder.status === "pending") {
          const closed = await this.paymentOrderRepository.updateStatus({
            id: order.id,
            status: "closed",
            expectedCurrentStatuses: getExpectedCurrentStatusesForNextStatus("closed"),
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

          if (!closed) {
            continue;
          }

          result.closed += 1;
          continue;
        }

        if (["closed", "failed", "refunded"].includes(providerOrder.status)) {
          const finalized = await this.paymentOrderRepository.updateStatus({
            id: order.id,
            status: providerOrder.status,
            expectedCurrentStatuses: getExpectedCurrentStatusesForNextStatus(providerOrder.status),
            metadata: {
              ...(typeof order.metadata === "object" && order.metadata ? order.metadata : {}),
              reconcile: {
                source: "worker",
                checkedAt: now.toISOString(),
                providerStatus: providerOrder.status,
              },
            },
          });

          if (!finalized) {
            continue;
          }
          
          if (providerOrder.status === "closed") result.closed += 1;
          else result.failed += 1;
        }
      } catch (error) {
        result.failed += 1;
      }
    }

    return result;
  }

  async reconcileUserPendingOrders(input: {
    userId: string;
    limit?: number;
    onPaid: (order: PaymentOrderEntity) => Promise<void>;
  }): Promise<{
    scanned: number;
    paid: number;
    closed: number;
    failed: number;
  }> {
    const config = getRuntimeConfig();
    // 用户手动刷新也是一次局部对账，先复用支付对账批量上限；后续压力大再拆独立配置。
    const orders = await this.paymentOrderRepository.listUserPending({
      userId: input.userId,
      limit: input.limit ?? config.payment.reconcileBatchSize,
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
            expectedCurrentStatuses: getExpectedCurrentStatusesForNextStatus("paid"),
            metadata: {
              ...(typeof order.metadata === "object" && order.metadata ? order.metadata : {}),
              reconcile: {
                source: "user_refresh",
                checkedAt: new Date().toISOString(),
                providerStatus: providerOrder.status,
              },
            },
          });

          if (!updated) continue;

          await input.onPaid(updated);
          result.paid += 1;
          continue;
        }

        if (providerOrder.status === "closed" || providerOrder.status === "failed") {
          const updated = await this.paymentOrderRepository.updateStatus({
            id: order.id,
            status: providerOrder.status,
            expectedCurrentStatuses: getExpectedCurrentStatusesForNextStatus(providerOrder.status),
            metadata: {
              ...(typeof order.metadata === "object" && order.metadata ? order.metadata : {}),
              reconcile: {
                source: "user_refresh",
                checkedAt: new Date().toISOString(),
                providerStatus: providerOrder.status,
              },
            },
          });

          if (!updated) continue;

          if (providerOrder.status === "closed") result.closed += 1;
          else result.failed += 1;
          continue;
        }
      } catch {
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
    const notifyUrl = getRuntimeConfig().payment.wechatPayNotifyUrl;
    if (!notifyUrl) throw new Error("WECHAT_PAY_NOTIFY_URL is required");
    return notifyUrl;
  }

  private getOrderMetadata(order: PaymentOrderEntity): Record<string, unknown> {
    if (!order.metadata || typeof order.metadata !== "object" || Array.isArray(order.metadata)) {
      return {};
    }
    return order.metadata as Record<string, unknown>;
  }

  private getProviderCreateAttempts(order: PaymentOrderEntity): number {
    const metadata = this.getOrderMetadata(order);
    const raw = metadata.providerCreateAttempts;
    return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : 1;
  }

  private getCachedClientPayParams(
    order: PaymentOrderEntity
  ): CreatePaymentOrderResponse["clientPayParams"] | null {
    const raw = this.getOrderMetadata(order).clientPayParams;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    return raw as CreatePaymentOrderResponse["clientPayParams"];
  }

  private toCreateResponse(
    order: PaymentOrderEntity,
    clientPayParams: CreatePaymentOrderResponse["clientPayParams"],
    reused: boolean
  ): CreatePaymentOrderResponse {
    return {
      id: order.id,
      provider: toWechatProvider(order.provider),
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

function toWechatProvider(provider: PaymentOrderEntity["provider"]): "wechat" {
  if (provider !== "wechat") {
    throw new Error(`Unsupported create payment order provider: ${provider}`);
  }
  return provider;
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeCode = (error as { code?: unknown }).code;
  return maybeCode === "P2002";
}
