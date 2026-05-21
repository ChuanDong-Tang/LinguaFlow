/** WeChatPayClient：封装微信支付 API 调用（下单、查单、关单等）。 */

import type {
  CreateProviderOrderInput,
  CreateProviderOrderResult,
  QueryProviderOrderInput,
  QueryProviderOrderResult,
} from "@lf/core/ports/payment/PaymentTypes.js";
import type { WeChatPayConfig } from "./WeChatPayConfig.js";
import {
  createAppPaySign,
  createAuthorizationHeader,
  createNonceStr,
  createTimestamp,
} from "./WeChatPaySignature.js";
import { mapWeChatTradeState } from "./WeChatPayMapper.js";

type WeChatAppOrderResponse = {
  prepay_id: string;
};

type WeChatQueryOrderResponse = {
  out_trade_no?: string;
  trade_state?: string;
};

export class WeChatPayClient {
  constructor(private readonly config: WeChatPayConfig) {}

  async createAppOrder(input: CreateProviderOrderInput): Promise<CreateProviderOrderResult> {
    const path = "/v3/pay/transactions/app";
    const body = JSON.stringify({
      appid: this.config.appId,
      mchid: this.config.mchId,
      description: input.description,
      out_trade_no: input.providerOrderId,
      notify_url: input.notifyUrl,
      amount: {
        total: input.amount,
        currency: input.currency,
      },
      attach: JSON.stringify({
        userId: input.userId,
        productCode: input.productCode,
      }),
    });

    const raw = await this.requestJson<WeChatAppOrderResponse>("POST", path, body);
    const timeStamp = createTimestamp();
    const nonceStr = createNonceStr();

    return {
      provider: "wechat",
      providerOrderId: input.providerOrderId,
      clientPayParams: {
        appId: this.config.appId,
        partnerId: this.config.mchId,
        prepayId: raw.prepay_id,
        packageValue: "Sign=WXPay",
        nonceStr,
        timeStamp,
        sign: createAppPaySign({
          appId: this.config.appId,
          timeStamp,
          nonceStr,
          prepayId: raw.prepay_id,
          privateKey: this.config.merchantPrivateKey,
        }),
      },
      raw,
    };
  }

  async queryOrder(input: QueryProviderOrderInput): Promise<QueryProviderOrderResult> {
    const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(
      input.providerOrderId
    )}?mchid=${encodeURIComponent(this.config.mchId)}`;
    const raw = await this.requestJson<WeChatQueryOrderResponse>("GET", path, "");

    return {
      provider: "wechat",
      providerOrderId: raw.out_trade_no ?? input.providerOrderId,
      status: mapWeChatTradeState(raw.trade_state),
      raw,
    };
  }

  private async requestJson<T>(method: string, path: string, body: string): Promise<T> {
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: createAuthorizationHeader({
          method,
          urlPathWithQuery: path,
          body,
          mchId: this.config.mchId,
          merchantSerialNo: this.config.merchantSerialNo,
          privateKey: this.config.merchantPrivateKey,
        }),
        "Content-Type": "application/json",
        "User-Agent": "LinguaFlow/1.0",
      },
      body: method === "GET" ? undefined : body,
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`WECHAT_PAY_REQUEST_FAILED: ${response.status} ${text}`);
    }

    return JSON.parse(text) as T;
  }
}
