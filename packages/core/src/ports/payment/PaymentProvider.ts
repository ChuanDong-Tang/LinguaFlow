/** PaymentProvider：定义支付能力接口（下单、查单、回调处理）。 */

import type {
  CreateProviderOrderInput,
  CreateProviderOrderResult,
  PaymentProviderName,
  QueryProviderOrderInput,
  QueryProviderOrderResult,
} from "./PaymentTypes.js";

export interface PaymentProvider {
  readonly providerName: PaymentProviderName;
  createOrder(input: CreateProviderOrderInput): Promise<CreateProviderOrderResult>;
  queryOrder(input: QueryProviderOrderInput): Promise<QueryProviderOrderResult>;
}
