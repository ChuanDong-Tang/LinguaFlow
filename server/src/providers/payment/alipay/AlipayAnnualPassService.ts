import { randomUUID } from "node:crypto";
import type { PaymentOrderEntity, PaymentOrderRepository } from "@lf/core/ports/repository/PaymentOrderRepository.js";
import type { PaymentEventRepository } from "@lf/core/ports/repository/PaymentEventRepository.js";
import type { AutoRenewRepository } from "@lf/core/ports/repository/AutoRenewRepository.js";
import type { BenefitGrantService } from "../../../services/payment/BenefitGrantService.js";
import { createEntitlementGrantPayload } from "../../../services/payment/EntitlementGrantSnapshot.js";
import type { PaymentEntitlementService } from "../../../services/payment/PaymentEntitlementService.js";
import type { SubscriptionService } from "../../../services/subscription/SubscriptionService.js";
import {
  AlipayAnnualPassClient,
  type AlipayTradeNotification,
  type AlipayTradeSnapshot,
} from "./AlipayAnnualPassClient.js";
import {
  isAlipayAnnualPassProductCode,
  type AlipayAnnualPassProductCode,
} from "./AlipayAnnualPassConfig.js";

const PENDING_REUSE_MS = 14 * 60 * 1000;

export class AlipayAnnualPassPurchaseBlockedError extends Error {
  readonly code = "ALIPAY_ANNUAL_PASS_PURCHASE_BLOCKED";
}

export class AlipayAnnualPassPendingError extends Error {
  readonly code = "ALIPAY_ANNUAL_PASS_PENDING";
}

export class AlipayAnnualPassOrderError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class AlipayAnnualPassService {
  constructor(
    private readonly paymentOrderRepository: PaymentOrderRepository,
    private readonly paymentEventRepository: PaymentEventRepository,
    private readonly benefitGrantService: BenefitGrantService,
    private readonly paymentEntitlementService: PaymentEntitlementService,
    private readonly subscriptionService: SubscriptionService,
    private readonly autoRenewRepository: AutoRenewRepository,
    private readonly client?: AlipayAnnualPassClient,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.client);
  }

  getQuote(productCode: AlipayAnnualPassProductCode): {
    productCode: AlipayAnnualPassProductCode;
    amount: number;
    currency: "CNY";
    displayPrice: string;
  } | null {
    if (!this.client) return null;
    const product = this.client.config.products[productCode];
    return {
      productCode,
      amount: product.amount,
      currency: "CNY",
      displayPrice: formatCnyPrice(product.amount),
    };
  }

  async create(input: {
    userId: string;
    productCode: AlipayAnnualPassProductCode;
  }): Promise<{ order: PaymentOrderEntity; orderString: string; reused: boolean }> {
    const client = this.requireClient();
    await this.assertCanPurchase(input.userId);

    const pending = await this.paymentOrderRepository.findPendingByUserProvider({
      userId: input.userId,
      provider: "alipay",
    });
    if (pending) {
      const resolved = await this.resolvePendingBeforeCreate(pending);
      if (resolved?.status === "pending") {
        if (resolved.productCode !== input.productCode) {
          throw new AlipayAnnualPassPendingError("Another Alipay annual pass order is pending");
        }
        return {
          order: resolved,
          orderString: client.createOrderString({
            outTradeNo: resolved.providerOrderId,
            product: client.config.products[input.productCode],
          }),
          reused: true,
        };
      }
      await this.assertCanPurchase(input.userId);
    }

    const product = client.config.products[input.productCode];
    await client.verifyProduct(product);
    const providerOrderId = createOutTradeNo();
    let order: PaymentOrderEntity;
    try {
      order = await this.paymentOrderRepository.create({
        userId: input.userId,
        productCode: input.productCode,
        provider: "alipay",
        providerOrderId,
        amount: product.amount,
        currency: "CNY",
        status: "pending",
        metadata: {
          purchaseKind: "annual_pass",
          productId: product.productId,
          priceId: product.priceId,
        },
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const raced = await this.paymentOrderRepository.findPendingByUserProvider({
        userId: input.userId,
        provider: "alipay",
      });
      if (!raced || raced.productCode !== input.productCode) {
        throw new AlipayAnnualPassPendingError("Another Alipay annual pass order is pending");
      }
      order = raced;
    }

    return {
      order,
      orderString: client.createOrderString({ outTradeNo: order.providerOrderId, product }),
      reused: order.providerOrderId !== providerOrderId,
    };
  }

  async queryAndApply(input: {
    userId: string;
    orderId: string;
  }): Promise<PaymentOrderEntity> {
    const order = await this.paymentOrderRepository.findById(input.orderId);
    if (!order || order.userId !== input.userId || order.provider !== "alipay") {
      throw new AlipayAnnualPassOrderError("ALIPAY_ANNUAL_PASS_ORDER_NOT_FOUND", "Annual pass order not found");
    }
    if (!isAlipayAnnualPassProductCode(order.productCode)) {
      throw new AlipayAnnualPassOrderError("ALIPAY_ANNUAL_PASS_ORDER_INVALID", "Order is not an annual pass");
    }
    if (order.status !== "pending") return order;
    const trade = await this.requireClient().queryTrade(order.providerOrderId);
    if (!trade) return order;
    return this.applyTrade(order, trade);
  }

  async cancelPending(input: { userId: string; orderId: string }): Promise<PaymentOrderEntity> {
    const order = await this.paymentOrderRepository.findById(input.orderId);
    if (!order || order.userId !== input.userId || order.provider !== "alipay") {
      throw new AlipayAnnualPassOrderError("ALIPAY_ANNUAL_PASS_ORDER_NOT_FOUND", "Annual pass order not found");
    }
    if (!isAlipayAnnualPassProductCode(order.productCode) || order.status !== "pending") return order;
    const client = this.requireClient();
    const trade = await client.queryTrade(order.providerOrderId);
    if (trade?.tradeStatus === "TRADE_SUCCESS" || trade?.tradeStatus === "TRADE_FINISHED") {
      return this.applyTrade(order, trade);
    }
    if (trade?.tradeStatus === "WAIT_BUYER_PAY") {
      await client.closeTrade(order.providerOrderId);
    }
    return (await this.paymentOrderRepository.updateStatus({
      id: order.id,
      status: "closed",
      expectedCurrentStatuses: ["pending"],
      metadata: mergeMetadata(order.metadata, {
        closedReason: "client_cancelled_checkout",
        closedAt: new Date().toISOString(),
      }),
    })) ?? (await this.paymentOrderRepository.findById(order.id)) ?? order;
  }

  async handleNotification(fields: Record<string, string>): Promise<void> {
    const notification = this.requireClient().parseAndVerifyNotification(fields);
    const event = await this.paymentEventRepository.findOrCreate({
      provider: "alipay_annual_pass",
      providerEventId: notification.notifyId,
      providerOrderId: notification.outTradeNo,
      eventType: notification.tradeStatus,
      rawPayload: sanitizeNotification(notification),
    });
    if (event.status === "processed" || event.status === "ignored") return;

    try {
      const order = await this.paymentOrderRepository.findByProviderOrderId(notification.outTradeNo);
      if (!order || order.provider !== "alipay" || !isAlipayAnnualPassProductCode(order.productCode)) {
        await this.paymentEventRepository.markIgnored(event.id, "annual pass order not found");
        return;
      }
      await this.applyTrade(order, notification);
      await this.paymentEventRepository.markProcessed(event.id);
    } catch (error) {
      await this.paymentEventRepository.markFailed(
        event.id,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  private async assertCanPurchase(userId: string): Promise<void> {
    const [membership, autoRenew] = await Promise.all([
      this.subscriptionService.getCurrentSubscription(userId),
      this.autoRenewRepository.findCurrentByUserId(userId),
    ]);
    if (membership.billingSubscription || autoRenew) {
      throw new AlipayAnnualPassPurchaseBlockedError(
        "An active paid membership or auto-renew agreement already exists",
      );
    }
  }

  private async resolvePendingBeforeCreate(order: PaymentOrderEntity): Promise<PaymentOrderEntity | null> {
    if (Date.now() - order.createdAt.getTime() < PENDING_REUSE_MS) return order;
    const trade = await this.requireClient().queryTrade(order.providerOrderId);
    if (trade) {
      const applied = await this.applyTrade(order, trade);
      if (applied.status !== "pending") return applied;
      await this.requireClient().closeTrade(order.providerOrderId);
    }
    return this.paymentOrderRepository.updateStatus({
      id: order.id,
      status: "closed",
      expectedCurrentStatuses: ["pending"],
      metadata: mergeMetadata(order.metadata, {
        closedReason: trade ? "stale_waiting_payment" : "trade_not_created",
        closedAt: new Date().toISOString(),
      }),
    });
  }

  private async applyTrade(
    order: PaymentOrderEntity,
    trade: AlipayTradeSnapshot | AlipayTradeNotification,
  ): Promise<PaymentOrderEntity> {
    if (trade.outTradeNo !== order.providerOrderId || trade.totalAmountCents !== order.amount) {
      throw new AlipayAnnualPassOrderError(
        "ALIPAY_ANNUAL_PASS_TRADE_MISMATCH",
        "Alipay trade does not match the local order",
      );
    }
    if (!isAlipayAnnualPassProductCode(order.productCode)) {
      throw new AlipayAnnualPassOrderError("ALIPAY_ANNUAL_PASS_ORDER_INVALID", "Order is not an annual pass");
    }

    const platformMetadata = {
      tradeNo: trade.tradeNo,
      tradeStatus: trade.tradeStatus,
      verifiedAt: new Date().toISOString(),
    };
    if (trade.tradeStatus === "WAIT_BUYER_PAY") return order;

    if (trade.tradeStatus === "TRADE_CLOSED") {
      const nextStatus = order.status === "paid" ? "refunded" : "closed";
      const updated = await this.paymentOrderRepository.updateStatus({
        id: order.id,
        status: nextStatus,
        expectedCurrentStatuses: order.status === "paid" ? ["paid"] : ["pending"],
        metadata: mergeMetadata(order.metadata, platformMetadata),
      });
      if (nextStatus === "refunded") {
        await this.subscriptionService.supersedePaymentGrant({
          sourceOrderId: order.id,
          provider: "alipay",
          supersededAt: new Date(),
        });
      }
      return updated ?? (await this.paymentOrderRepository.findById(order.id)) ?? order;
    }

    const paid = order.status === "paid"
      ? order
      : await this.paymentOrderRepository.updateStatus({
          id: order.id,
          status: "paid",
          expectedCurrentStatuses: ["pending"],
          metadata: mergeMetadata(order.metadata, platformMetadata),
        });
    const current = paid ?? (await this.paymentOrderRepository.findById(order.id));
    if (!current || current.status !== "paid") {
      throw new AlipayAnnualPassOrderError(
        "ALIPAY_ANNUAL_PASS_ORDER_STATE_INVALID",
        "Paid trade could not be applied to the local order",
      );
    }

    try {
      await this.paymentEntitlementService.grantAfterPayment({
        userId: current.userId,
        sourceOrderId: current.id,
        productCode: current.productCode,
        channel: "alipay",
        grantMode: "fixed_duration",
        prepaidLimit: "skip",
        syncAutoRenewBilling: false,
      });
    } catch {
      await this.benefitGrantService.enqueueGrant({
        userId: current.userId,
        sourceOrderId: current.id,
        productCode: current.productCode,
        channel: "alipay",
        payload: createEntitlementGrantPayload({
          fallbackReason: "sync_grant_failed",
          source: "alipay_annual_pass",
          grant: {
            grantMode: "fixed_duration",
            prepaidLimit: "skip",
            syncAutoRenewBilling: false,
          },
        }),
      });
    }
    return current;
  }

  private requireClient(): AlipayAnnualPassClient {
    if (!this.client) {
      throw new AlipayAnnualPassOrderError(
        "ALIPAY_ANNUAL_PASS_NOT_CONFIGURED",
        "Alipay annual pass is not configured",
      );
    }
    return this.client;
  }
}

function createOutTradeNo(): string {
  return `OIOA${new Date().toISOString().slice(0, 10).replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`;
}

function formatCnyPrice(amountCents: number): string {
  const yuan = amountCents / 100;
  return Number.isInteger(yuan) ? `¥${yuan}` : `¥${yuan.toFixed(2)}`;
}

function mergeMetadata(existing: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(existing && typeof existing === "object" && !Array.isArray(existing)
      ? existing as Record<string, unknown>
      : {}),
    ...patch,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}

function sanitizeNotification(notification: AlipayTradeNotification): Record<string, unknown> {
  return {
    notifyId: notification.notifyId,
    outTradeNo: notification.outTradeNo,
    tradeNo: notification.tradeNo,
    tradeStatus: notification.tradeStatus,
    totalAmountCents: notification.totalAmountCents,
  };
}
