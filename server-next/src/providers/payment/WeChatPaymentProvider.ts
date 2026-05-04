/** WeChatPaymentProvider：PaymentProvider 的微信实现，组合各微信子模块。 */

import type {
  CreateProviderOrderInput,
  CreateProviderOrderResult,
  PaymentProvider,
  QueryProviderOrderInput,
  QueryProviderOrderResult,
} from "@lf/core/ports/payment/index.js";
import { WeChatPayClient } from "./wechat/WeChatPayClient.js";
import { loadWeChatPayConfig } from "./wechat/WeChatPayConfig.js";

export class WeChatPaymentProvider implements PaymentProvider {
  readonly providerName = "wechat" as const;

  private client?: WeChatPayClient;

  createOrder(input: CreateProviderOrderInput): Promise<CreateProviderOrderResult> {
    return this.getClient().createAppOrder(input);
  }

  queryOrder(input: QueryProviderOrderInput): Promise<QueryProviderOrderResult> {
    return this.getClient().queryOrder(input);
  }

  private getClient(): WeChatPayClient {
    this.client ??= new WeChatPayClient(loadWeChatPayConfig());
    return this.client;
  }
}
