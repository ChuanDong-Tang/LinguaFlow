/** WeChatAutoRenewProvider：微信 V3 扣费服务 provider，负责支付中签约、受理扣款、查单和解约。 */

import { randomUUID } from "node:crypto";
import type { WeChatAppPayParams } from "@lf/core/ports/payment/PaymentTypes.js";
import type { AutoRenewProductCode } from "@lf/core/ports/repository/AutoRenewRepository.js";
import type { WeChatAutoRenewConfig } from "./WeChatPayConfig.js";
import { loadWeChatAutoRenewConfig } from "./WeChatPayConfig.js";
import {
  createAppPaySign,
  createAuthorizationHeader,
  createNonceStr,
  createTimestamp,
  decryptWeChatPayResource,
} from "./WeChatPaySignature.js";

export interface WeChatPreSignResult {
  outContractCode: string;
  outTradeNo: string;
  clientPayParams: WeChatAppPayParams;
  raw: unknown;
}

export interface WeChatContractNotification {
  providerEventId: string;
  eventType: string;
  outContractCode: string;
  contractId: string | null;
  contractState: string | null;
  raw: unknown;
}

export interface WeChatDebitNotification {
  providerEventId: string;
  eventType: string;
  outTradeNo: string;
  contractId: string | null;
  tradeState: string | null;
  transactionId: string | null;
  amount: number | null;
  currency: string | null;
  raw: unknown;
}

export interface WeChatAutoRenewOrderSnapshot {
  outTradeNo: string;
  contractId: string | null;
  tradeState: string | null;
  transactionId: string | null;
  amount: number | null;
  currency: string | null;
  raw: unknown;
}

type WeChatEncryptedNotifyBody = {
  id: string;
  event_type: string;
  resource?: {
    associated_data?: string;
    nonce: string;
    ciphertext: string;
  };
};

export class WeChatAutoRenewProvider {
  readonly providerName = "wechat" as const;
  private client?: WeChatAutoRenewClient;

  async createH5PreSign(input: {
    userId: string;
    productCode: AutoRenewProductCode;
    planId: string;
    description: string;
    amount: number;
    currency: "CNY";
  }): Promise<WeChatPreSignResult> {
    return this.getClient().createH5PreSign(input);
  }

  async createScheduledH5PreSign(input: {
    userId: string;
    productCode: AutoRenewProductCode;
    planId: string;
  }): Promise<{ outContractCode: string; redirectUrl: string; raw: unknown }> {
    return this.getClient().createScheduledH5PreSign(input);
  }

  async cancelContract(input: {
    outContractCode: string;
    contractId?: string | null;
    reason: string;
  }): Promise<void> {
    await this.getClient().cancelContract(input);
  }

  async applyDeduct(input: {
    contractId: string;
    outTradeNo: string;
    description: string;
    amount: number;
    currency: "CNY";
  }): Promise<unknown> {
    return this.getClient().applyDeduct(input);
  }

  async queryDeductOrder(input: { outTradeNo: string }): Promise<WeChatAutoRenewOrderSnapshot> {
    return this.getClient().queryDeductOrder(input);
  }

  parseContractNotification(rawBody: string): WeChatContractNotification {
    return this.getClient().parseContractNotification(rawBody);
  }

  parseDebitNotification(rawBody: string): WeChatDebitNotification {
    return this.getClient().parseDebitNotification(rawBody);
  }

  private getClient(): WeChatAutoRenewClient {
    this.client ??= new WeChatAutoRenewClient(loadWeChatAutoRenewConfig());
    return this.client;
  }
}

class WeChatAutoRenewClient {
  constructor(private readonly config: WeChatAutoRenewConfig) {}

  async createH5PreSign(input: {
    userId: string;
    productCode: AutoRenewProductCode;
    planId: string;
    description: string;
    amount: number;
    currency: "CNY";
  }): Promise<WeChatPreSignResult> {
    const outContractCode = this.createOutContractCode();
    const outTradeNo = this.createOutTradeNo();
    const path = "/v3/pay/transactions/app-with-contract";
    const raw = await this.requestJson<{ prepay_id?: string }>(
      "POST",
      path,
      JSON.stringify({
        appid: this.config.appId,
        mchid: this.config.mchId,
        description: input.description,
        out_trade_no: outTradeNo,
        notify_url: this.config.debitNotifyUrl,
        amount: {
          total: input.amount,
          currency: input.currency,
        },
        // 支付中签约：用户支付首期时同时完成自动续费签约，避免“签约后还要等预约扣费”的体验。
        // 首期支付是否成功仍以后续扣款/支付通知为准，不能因为拿到 prepay_id 就直接发权益。
        contract_info: {
          plan_id: input.planId,
          out_contract_code: outContractCode,
          contract_display_account: input.userId,
          notify_url: this.config.contractNotifyUrl,
          contract_return_url: this.config.contractReturnUrl,
        },
        attach: JSON.stringify({ userId: input.userId, productCode: input.productCode }),
      })
    );
    if (!raw.prepay_id) {
      throw new Error("WECHAT_AUTORENEW_PREPAY_ID_MISSING");
    }
    const timeStamp = createTimestamp();
    const nonceStr = createNonceStr();

    return {
      outContractCode,
      outTradeNo,
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
      raw: { path, response: raw },
    };
  }

  async createScheduledH5PreSign(input: {
    userId: string;
    productCode: AutoRenewProductCode;
    planId: string;
  }): Promise<{ outContractCode: string; redirectUrl: string; raw: unknown }> {
    const outContractCode = this.createOutContractCode();
    const path = "/v3/papay/scheduled-deduct-sign/contracts/pre-entrust-sign/h5";
    const raw = await this.requestJson<Record<string, unknown>>(
      "POST",
      path,
      JSON.stringify({
        appid: this.config.appId,
        mchid: this.config.mchId,
        out_contract_code: outContractCode,
        plan_id: input.planId,
        contract_display_account: input.userId,
        notify_url: this.config.contractNotifyUrl,
        contract_return_url: this.config.contractReturnUrl,
        attach: JSON.stringify({ userId: input.userId, productCode: input.productCode }),
      })
    );
    const redirectUrl = String(
      raw.redirect_url ?? raw.h5_url ?? raw.contract_url ?? raw.pre_entrust_web_url ?? ""
    );
    if (!redirectUrl) {
      throw new Error("WECHAT_AUTORENEW_PRE_SIGN_URL_MISSING");
    }

    return {
      outContractCode,
      redirectUrl,
      raw: { path, response: raw },
    };
  }

  async cancelContract(input: {
    outContractCode: string;
    contractId?: string | null;
    reason: string;
  }): Promise<void> {
    const contractKey = input.contractId || input.outContractCode;
    const path = `/v3/papay/scheduled-deduct-sign/contracts/${encodeURIComponent(
      contractKey
    )}/terminate`;
    await this.requestJson<unknown>(
      "POST",
      path,
      JSON.stringify({
        mchid: this.config.mchId,
        contract_termination_remark: input.reason,
      })
    );
  }

  async applyDeduct(input: {
    contractId: string;
    outTradeNo: string;
    description: string;
    amount: number;
    currency: "CNY";
  }): Promise<unknown> {
    const path = "/v3/papay/pay/transactions/apply";
    // V3 扣费服务语义是“受理扣款”：接口成功只代表微信受理，最终是否扣款成功仍以回调/查单为准。
    return this.requestJson<unknown>(
      "POST",
      path,
      JSON.stringify({
        appid: this.config.appId,
        mchid: this.config.mchId,
        contract_id: input.contractId,
        out_trade_no: input.outTradeNo,
        description: input.description,
        notify_url: this.config.debitNotifyUrl,
        amount: {
          total: input.amount,
          currency: input.currency,
        },
      })
    );
  }

  async queryDeductOrder(input: { outTradeNo: string }): Promise<WeChatAutoRenewOrderSnapshot> {
    const path = `/v3/papay/pay/transactions/out-trade-no/${encodeURIComponent(
      input.outTradeNo
    )}?mchid=${encodeURIComponent(this.config.mchId)}`;
    const raw = await this.requestJson<Record<string, unknown>>("GET", path, "");
    return {
      outTradeNo: String(raw.out_trade_no ?? input.outTradeNo),
      contractId: trimToNull(raw.contract_id),
      tradeState: normalizeTradeState(raw),
      transactionId: trimToNull(raw.transaction_id),
      amount: readAmountTotal(raw.amount),
      currency: readAmountCurrency(raw.amount),
      raw,
    };
  }

  parseContractNotification(rawBody: string): WeChatContractNotification {
    const body = JSON.parse(rawBody) as WeChatEncryptedNotifyBody;
    const resource = this.decryptNotifyResource<Record<string, unknown>>(body);
    return {
      providerEventId: body.id,
      eventType: body.event_type,
      outContractCode: String(resource.out_contract_code ?? resource.contract_code ?? "").trim(),
      contractId: trimToNull(resource.contract_id),
      contractState: trimToNull(resource.contract_state ?? resource.contract_status),
      raw: { body, resource },
    };
  }

  parseDebitNotification(rawBody: string): WeChatDebitNotification {
    const body = JSON.parse(rawBody) as WeChatEncryptedNotifyBody;
    const resource = this.decryptNotifyResource<Record<string, unknown>>(body);
    return {
      providerEventId: body.id,
      eventType: body.event_type,
      outTradeNo: String(resource.out_trade_no ?? "").trim(),
      contractId: trimToNull(resource.contract_id),
      tradeState: trimToNull(resource.trade_state ?? resource.result_code),
      transactionId: trimToNull(resource.transaction_id),
      amount: readAmountTotal(resource.amount),
      currency: readAmountCurrency(resource.amount),
      raw: { body, resource },
    };
  }

  private decryptNotifyResource<T>(body: WeChatEncryptedNotifyBody): T {
    if (!body.resource) throw new Error("WECHAT_AUTORENEW_NOTIFY_RESOURCE_MISSING");
    const text = decryptWeChatPayResource({
      associatedData: body.resource.associated_data,
      nonce: body.resource.nonce,
      ciphertext: body.resource.ciphertext,
      apiV3Key: this.config.apiV3Key,
    });
    return JSON.parse(text) as T;
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
      throw new Error(`WECHAT_AUTORENEW_REQUEST_FAILED: ${response.status} ${text}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  private createOutContractCode(): string {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const suffix = randomUUID().replace(/-/g, "").slice(0, 18);
    return `LFC${date}${suffix}`.slice(0, 32);
  }

  private createOutTradeNo(): string {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const suffix = randomUUID().replace(/-/g, "").slice(0, 18);
    return `LFA${date}${suffix}`.slice(0, 32);
  }
}

function normalizeTradeState(raw: Record<string, unknown>): string | null {
  const tradeState = trimToNull(raw.trade_state);
  if (tradeState) return tradeState;
  const resultCode = trimToNull(raw.result_code);
  if (resultCode === "SUCCESS") return "SUCCESS";
  if (resultCode === "FAIL") return "FAILED";
  return trimToNull(raw.return_code);
}

function trimToNull(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function readAmountTotal(value: unknown): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const total = (value as Record<string, unknown>).total;
  if (typeof total === "number" && Number.isFinite(total)) return total;
  if (typeof total === "string" && total.trim()) {
    const parsed = Number(total);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readAmountCurrency(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return trimToNull((value as Record<string, unknown>).currency);
}
