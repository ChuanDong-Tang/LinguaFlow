/** PaymentNotifyService：编排支付回调处理（验签、幂等、状态更新）。 */

import type { PaymentEventRepository } from "@lf/core/ports/repository/PaymentEventRepository.js";
import type { PaymentOrderRepository } from "@lf/core/ports/repository/PaymentOrderRepository.js";
import type { TrustedCertRepository } from "@lf/core/ports/repository/TrustedCertRepository.js";
import type { BenefitGrantService } from "./BenefitGrantService.js";
import type { PaymentEntitlementService } from "./PaymentEntitlementService.js";
import type { PaymentCertSyncService } from "./PaymentCertSyncService.js";
import {
  decryptWeChatPayResource,
  verifyWeChatPaySignature,
} from "../../providers/payment/wechat/WeChatPaySignature.js";
import { loadWeChatPayConfig } from "../../providers/payment/wechat/WeChatPayConfig.js";
import { getExpectedCurrentStatusesForNextStatus } from "./PaymentOrderStateMachine.js";

export interface WeChatNotifyInput {
  headers: {
    timestamp?: string;
    nonce?: string;
    signature?: string;
    serial?: string;
  };
  rawBody: string;
}

type WeChatNotifyBody = {
  id: string;
  event_type: string;
  resource?: {
    associated_data?: string;
    nonce: string;
    ciphertext: string;
  };
};

type WeChatTransactionResource = {
  out_trade_no: string;
  transaction_id?: string;
  trade_state: string;
};

type WeChatRefundResource = {
  out_trade_no: string;
  out_refund_no?: string;
  refund_id?: string;
  refund_status?: string;
};

export class PaymentNotifyService {
  constructor(
    private readonly paymentEventRepository: PaymentEventRepository,
    private readonly paymentOrderRepository: PaymentOrderRepository,
    private readonly benefitGrantService: BenefitGrantService,
    private readonly paymentEntitlementService: PaymentEntitlementService,
    private readonly trustedCertRepository: TrustedCertRepository,
    private readonly paymentCertSyncService: PaymentCertSyncService
  ) {}

  async handleWeChatNotify(input: WeChatNotifyInput): Promise<{ status: "success" | "ignored" }> {
    const config = loadWeChatPayConfig();

    if (
      !input.headers.timestamp ||
      !input.headers.nonce ||
      !input.headers.signature
    ) {
      throw new Error("WECHAT_NOTIFY_HEADERS_INVALID");
    }
    if (!input.headers.serial) throw new Error("WECHAT_NOTIFY_SERIAL_MISSING");

    const platformPublicKey = await this.resolveWeChatPublicKeyBySerial(input.headers.serial);

    const valid = verifyWeChatPaySignature({
      timestamp: input.headers.timestamp,
      nonce: input.headers.nonce,
      signature: input.headers.signature,
      body: input.rawBody,
      platformPublicKey,
    });

    if (!valid) throw new Error("WECHAT_NOTIFY_SIGNATURE_INVALID");

    let body: WeChatNotifyBody;
    try {
      body = JSON.parse(input.rawBody) as WeChatNotifyBody;
    } catch (error) {
      throw new Error(`WECHAT_NOTIFY_PARSE_FAILED: ${toErrorMessage(error)}`);
    }
    const existingEvent = await this.paymentEventRepository.findByProviderEventId({
      provider: "wechat",
      providerEventId: body.id,
      eventType: body.event_type,
    });

    if (existingEvent && existingEvent.status !== "received") {
      return { status: "ignored" };
    }

    const event =
      existingEvent ??
      (await this.paymentEventRepository.create({
        provider: "wechat",
        providerEventId: body.id,
        providerOrderId: null,
        eventType: body.event_type,
        rawPayload: {
          body,
          rawBody: input.rawBody,
        },
      }));

    try {
      const resourceText = body.resource
        ? decryptWeChatPayResource({
            associatedData: body.resource.associated_data,
            nonce: body.resource.nonce,
            ciphertext: body.resource.ciphertext,
            apiV3Key: config.apiV3Key,
          })
        : "{}";
      let resource: WeChatTransactionResource;
      try {
        resource = JSON.parse(resourceText) as WeChatTransactionResource;
      } catch (error) {
        throw new Error(`WECHAT_NOTIFY_DECRYPT_PARSE_FAILED: ${toErrorMessage(error)}`);
      }
      // todo:只靠out_trade_no找订单，没有校验金额，币种等
      const providerOrderId = resource.out_trade_no;

      if (body.event_type !== "TRANSACTION.SUCCESS" || resource.trade_state !== "SUCCESS") {
        await this.paymentEventRepository.markIgnored(
          event.id,
          `Unsupported event ${body.event_type}/${resource.trade_state}`
        );
        return { status: "ignored" };
      }

      const order = await this.paymentOrderRepository.findByProviderOrderId(providerOrderId);

      if (!order) {
        await this.paymentEventRepository.markFailed(event.id, "Payment order not found");
        throw new Error("PAYMENT_ORDER_NOT_FOUND");
      }   
      let paidOrder = order.status === "paid" ? order : null;
      if (order.status !== "paid") {
        paidOrder = await this.paymentOrderRepository.updateStatus({
          id: order.id,
          status: "paid",
          expectedCurrentStatuses: getExpectedCurrentStatusesForNextStatus("paid"),
          metadata: {
            ...(typeof order.metadata === "object" && order.metadata ? order.metadata : {}),
            wechatTransactionId: resource.transaction_id ?? null,
          },
        });
      }
      if (!paidOrder) {
        await this.paymentEventRepository.markIgnored(
          event.id,
          `Payment order status ${order.status} cannot transition to paid`
        );
        return { status: "ignored" };
      }

      try {
        await this.paymentEntitlementService.grantAfterPayment({
          userId: paidOrder.userId,
          sourceOrderId: paidOrder.id,
          productCode: paidOrder.productCode,
          channel: paidOrder.provider,
        });
      } catch (_error) {
        await this.benefitGrantService.enqueueGrant({
          userId: paidOrder.userId,
          sourceOrderId: paidOrder.id,
          productCode: paidOrder.productCode,
          channel: paidOrder.provider,
          payload: { fallbackReason: "sync_grant_failed", source: "wechat_notify" },
        });
      }

      await this.paymentEventRepository.markProcessed(event.id);
      return { status: "success" };
    } catch (error) {
      await this.paymentEventRepository.markFailed(
        event.id,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  async verifyWeChatNotifySignature(input: WeChatNotifyInput): Promise<void> {
    if (
      !input.headers.timestamp ||
      !input.headers.nonce ||
      !input.headers.signature
    ) {
      throw new Error("WECHAT_NOTIFY_HEADERS_INVALID");
    }
    if (!input.headers.serial) throw new Error("WECHAT_NOTIFY_SERIAL_MISSING");

    const platformPublicKey = await this.resolveWeChatPublicKeyBySerial(input.headers.serial);
    const valid = verifyWeChatPaySignature({
      timestamp: input.headers.timestamp,
      nonce: input.headers.nonce,
      signature: input.headers.signature,
      body: input.rawBody,
      platformPublicKey,
    });

    if (!valid) throw new Error("WECHAT_NOTIFY_SIGNATURE_INVALID");
  }

  async handleWeChatRefundNotify(
    input: WeChatNotifyInput
  ): Promise<{ status: "success" | "ignored" }> {
    const config = loadWeChatPayConfig();

    if (
      !input.headers.timestamp ||
      !input.headers.nonce ||
      !input.headers.signature
    ) {
      throw new Error("WECHAT_REFUND_NOTIFY_HEADERS_INVALID");
    }
    if (!input.headers.serial) throw new Error("WECHAT_REFUND_NOTIFY_SERIAL_MISSING");

    const platformPublicKey = await this.resolveWeChatPublicKeyBySerial(input.headers.serial);

    const valid = verifyWeChatPaySignature({
      timestamp: input.headers.timestamp,
      nonce: input.headers.nonce,
      signature: input.headers.signature,
      body: input.rawBody,
      platformPublicKey,
    });

    if (!valid) throw new Error("WECHAT_REFUND_NOTIFY_SIGNATURE_INVALID");

    let body: WeChatNotifyBody;
    try {
      body = JSON.parse(input.rawBody) as WeChatNotifyBody;
    } catch (error) {
      throw new Error(`WECHAT_REFUND_NOTIFY_PARSE_FAILED: ${toErrorMessage(error)}`);
    }
    const existingEvent = await this.paymentEventRepository.findByProviderEventId({
      provider: "wechat",
      providerEventId: body.id,
      eventType: body.event_type,
    });

    if (existingEvent && existingEvent.status !== "received") {
      return { status: "ignored" };
    }

    const event =
      existingEvent ??
      (await this.paymentEventRepository.create({
        provider: "wechat",
        providerEventId: body.id,
        providerOrderId: null,
        eventType: body.event_type,
        rawPayload: {
          body,
          rawBody: input.rawBody,
        },
      }));

    try {
      const resourceText = body.resource
        ? decryptWeChatPayResource({
            associatedData: body.resource.associated_data,
            nonce: body.resource.nonce,
            ciphertext: body.resource.ciphertext,
            apiV3Key: config.apiV3Key,
          })
        : "{}";
      let resource: WeChatRefundResource;
      try {
        resource = JSON.parse(resourceText) as WeChatRefundResource;
      } catch (error) {
        throw new Error(`WECHAT_REFUND_NOTIFY_DECRYPT_PARSE_FAILED: ${toErrorMessage(error)}`);
      }

      // todo:退款只改订单状态，没有撤销权益
      const providerOrderId = resource.out_trade_no;

      const isRefundSuccess =
        body.event_type.includes("REFUND") &&
        (!resource.refund_status || resource.refund_status === "SUCCESS");

      if (!isRefundSuccess) {
        await this.paymentEventRepository.markIgnored(
          event.id,
          `Unsupported refund event ${body.event_type}/${resource.refund_status ?? "unknown"}`
        );
        return { status: "ignored" };
      }

      const order = await this.paymentOrderRepository.findByProviderOrderId(providerOrderId);

      if (!order) {
        await this.paymentEventRepository.markFailed(event.id, "Payment order not found");
        throw new Error("PAYMENT_ORDER_NOT_FOUND");
      }

      await this.paymentOrderRepository.updateStatus({
        id: order.id,
        status: "refunded",
        expectedCurrentStatuses: getExpectedCurrentStatusesForNextStatus("refunded"),
        metadata: {
          ...(typeof order.metadata === "object" && order.metadata ? order.metadata : {}),
          refund: {
            refundId: resource.refund_id ?? null,
            outRefundNo: resource.out_refund_no ?? null,
            refundStatus: resource.refund_status ?? null,
            handledManually: true,
          },
        },
      });

      await this.paymentEventRepository.markProcessed(event.id);
      return { status: "success" };
    } catch (error) {
      await this.paymentEventRepository.markFailed(
        event.id,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  private async resolveWeChatPublicKeyBySerial(serial: string): Promise<string> {
    let certs = await this.trustedCertRepository.listActiveByProvider("wechat");
    let matched = certs.find(
      (item) => item.materialType === "platform_public_key" && item.keyId === serial
    );
    if (!matched) {
      await this.paymentCertSyncService.syncWeChatPlatformCerts();
      certs = await this.trustedCertRepository.listActiveByProvider("wechat");
      matched = certs.find(
        (item) => item.materialType === "platform_public_key" && item.keyId === serial
      );
    }
    if (!matched) {
      throw new Error("WECHAT_NOTIFY_SERIAL_INVALID");
    }
    return matched.pem;
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
