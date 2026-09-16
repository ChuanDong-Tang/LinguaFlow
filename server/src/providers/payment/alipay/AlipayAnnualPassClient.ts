import {
  loadAlipayAnnualPassConfig,
  type AlipayAnnualPassConfig,
  type AlipayAnnualPassProduct,
} from "./AlipayAnnualPassConfig.js";
import {
  signAlipayFields,
  verifyAlipayFields,
  verifyAlipayResponseContent,
  type AlipayFormFields,
} from "./AlipaySignature.js";
import { AlipayApiError } from "./AlipayClient.js";

export interface AlipayTradeSnapshot {
  outTradeNo: string;
  tradeNo: string | null;
  tradeStatus: "WAIT_BUYER_PAY" | "TRADE_CLOSED" | "TRADE_SUCCESS" | "TRADE_FINISHED";
  totalAmountCents: number;
  buyerUserId: string | null;
  raw: Record<string, unknown>;
}

export interface AlipayTradeNotification {
  notifyId: string;
  outTradeNo: string;
  tradeNo: string;
  tradeStatus: AlipayTradeSnapshot["tradeStatus"];
  totalAmountCents: number;
  buyerUserId: string | null;
  raw: AlipayFormFields;
}

export class AlipayAnnualPassClient {
  private readonly verifiedProducts = new Map<string, number>();

  constructor(readonly config: AlipayAnnualPassConfig = loadAlipayAnnualPassConfig()) {}

  createOrderString(input: {
    outTradeNo: string;
    product: AlipayAnnualPassProduct;
  }): string {
    const amount = formatAmount(input.product.amount);
    const fields: AlipayFormFields = {
      app_id: this.config.appId,
      method: "alipay.trade.app.pay",
      format: "JSON",
      charset: "utf-8",
      sign_type: "RSA2",
      timestamp: formatAlipayTimestamp(new Date()),
      version: "1.0",
      notify_url: this.config.notifyUrl,
      biz_content: JSON.stringify({
        out_trade_no: input.outTradeNo,
        total_amount: amount,
        subject: input.product.subject,
        body: "一次性购买，到账后有效期 12 个月，不自动续费",
        product_code: "QUICK_MSECURITY_PAY",
        timeout_express: "15m",
        goods_detail: [{
          goods_id: input.product.productId,
          goods_name: input.product.subject,
          quantity: 1,
          price: amount,
        }],
      }),
    };
    fields.sign = signAlipayFields(fields, this.config.privateKey);
    return new URLSearchParams(fields).toString();
  }

  async verifyProduct(product: AlipayAnnualPassProduct): Promise<void> {
    const cachedUntil = this.verifiedProducts.get(product.priceId) ?? 0;
    if (cachedUntil > Date.now()) return;
    const result = await this.call("alipay.trade.price.query", { price_id: product.priceId });
    const recurring = objectValue(result.recurring);
    if (
      stringValue(result.id ?? result.price_id) !== product.priceId
      || stringValue(result.product_id) !== product.productId
      || integerValue(result.unit_amount) !== product.amount
      || booleanValue(result.active) !== true
      || stringValue(result.type)?.toLowerCase() !== "one_time"
      || Object.keys(recurring).length > 0
    ) {
      throw new AlipayApiError(
        "ALIPAY_ANNUAL_PASS_PRODUCT_MISMATCH",
        "Configured Alipay annual pass price does not match the expected one-time product",
        result,
      );
    }
    this.verifiedProducts.set(product.priceId, Date.now() + 5 * 60 * 1000);
  }

  parseAndVerifyNotification(fields: AlipayFormFields): AlipayTradeNotification {
    if (!fields.notify_id || !fields.out_trade_no || !fields.trade_no || !fields.trade_status) {
      throw new AlipayApiError(
        "ALIPAY_ANNUAL_PASS_NOTIFY_FIELDS_MISSING",
        "Alipay trade notification is missing required fields",
      );
    }
    if (fields.app_id !== this.config.appId) {
      throw new AlipayApiError("ALIPAY_NOTIFY_APP_ID_MISMATCH", "Alipay notification app_id mismatch");
    }
    if (fields.seller_id !== this.config.sellerId) {
      throw new AlipayApiError("ALIPAY_NOTIFY_SELLER_ID_MISMATCH", "Alipay notification seller_id mismatch");
    }
    if (fields.sign_type?.toUpperCase() !== "RSA2" || !verifyAlipayFields(fields, this.config.alipayPublicKey)) {
      throw new AlipayApiError("ALIPAY_NOTIFY_SIGNATURE_INVALID", "Invalid Alipay notification signature");
    }
    const tradeStatus = parseTradeStatus(fields.trade_status);
    const totalAmountCents = parseAmountToCents(fields.total_amount);
    if (totalAmountCents === null) {
      throw new AlipayApiError("ALIPAY_NOTIFY_AMOUNT_INVALID", "Invalid Alipay notification amount");
    }
    return {
      notifyId: fields.notify_id,
      outTradeNo: fields.out_trade_no,
      tradeNo: fields.trade_no,
      tradeStatus,
      totalAmountCents,
      buyerUserId: stringValue(fields.buyer_id),
      raw: fields,
    };
  }

  async queryTrade(outTradeNo: string): Promise<AlipayTradeSnapshot | null> {
    let result: Record<string, unknown>;
    try {
      result = await this.call("alipay.trade.query", { out_trade_no: outTradeNo });
    } catch (error) {
      if (error instanceof AlipayApiError && error.code === "ACQ.TRADE_NOT_EXIST") return null;
      throw error;
    }
    const returnedOutTradeNo = stringValue(result.out_trade_no);
    const totalAmountCents = parseAmountToCents(result.total_amount);
    if (returnedOutTradeNo !== outTradeNo || totalAmountCents === null) {
      throw new AlipayApiError("ALIPAY_TRADE_QUERY_INVALID", "Alipay trade query response mismatch", result);
    }
    return {
      outTradeNo: returnedOutTradeNo,
      tradeNo: stringValue(result.trade_no),
      tradeStatus: parseTradeStatus(result.trade_status),
      totalAmountCents,
      buyerUserId: stringValue(result.buyer_user_id),
      raw: result,
    };
  }

  async closeTrade(outTradeNo: string): Promise<void> {
    await this.call("alipay.trade.close", { out_trade_no: outTradeNo });
  }

  private async call(method: string, bizContent: Record<string, unknown>): Promise<Record<string, unknown>> {
    const fields: AlipayFormFields = {
      app_id: this.config.appId,
      method,
      format: "JSON",
      charset: "utf-8",
      sign_type: "RSA2",
      timestamp: formatAlipayTimestamp(new Date()),
      version: "1.0",
      biz_content: JSON.stringify(bizContent),
    };
    fields.sign = signAlipayFields(fields, this.config.privateKey);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const response = await fetch(this.config.gatewayUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: new URLSearchParams(fields),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new AlipayApiError("ALIPAY_HTTP_ERROR", `Alipay returned HTTP ${response.status}`);
      }
      const responseText = await response.text();
      const body = JSON.parse(responseText) as Record<string, unknown>;
      const responseKey = `${method.replaceAll(".", "_")}_response`;
      const signature = stringValue(body.sign);
      const signedContent = extractTopLevelObject(responseText, responseKey);
      if (!signature || !signedContent || !verifyAlipayResponseContent(signedContent, signature, this.config.alipayPublicKey)) {
        throw new AlipayApiError("ALIPAY_RESPONSE_SIGNATURE_INVALID", "Invalid Alipay API response signature");
      }
      const payload = objectValue(body[responseKey]);
      if (String(payload.code ?? "") !== "10000") {
        const traceId = response.headers.get("trace_id");
        throw new AlipayApiError(
          stringValue(payload.sub_code) ?? stringValue(payload.code) ?? "ALIPAY_API_ERROR",
          stringValue(payload.sub_msg) ?? stringValue(payload.msg) ?? "Alipay API failed",
          traceId ? { ...payload, trace_id: traceId } : payload,
        );
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseTradeStatus(value: unknown): AlipayTradeSnapshot["tradeStatus"] {
  const status = String(value ?? "");
  if (
    status === "WAIT_BUYER_PAY" ||
    status === "TRADE_CLOSED" ||
    status === "TRADE_SUCCESS" ||
    status === "TRADE_FINISHED"
  ) return status;
  throw new AlipayApiError("ALIPAY_TRADE_STATUS_INVALID", `Unexpected Alipay trade status: ${status}`);
}

function parseAmountToCents(value: unknown): number | null {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [yuan, fraction = ""] = text.split(".");
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

function formatAmount(amountCents: number): string {
  return `${Math.floor(amountCents / 100)}.${String(amountCents % 100).padStart(2, "0")}`;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : value === undefined || value === null
      ? null
      : String(value);
}

function integerValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function booleanValue(value: unknown): boolean | null {
  if (value === true || value === "true" || value === "TRUE" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === "FALSE" || value === 0 || value === "0") return false;
  return null;
}

function formatAlipayTimestamp(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date).replace("T", " ");
}

function extractTopLevelObject(json: string, key: string): string | null {
  const marker = `"${key}"`;
  const keyIndex = json.indexOf(marker);
  if (keyIndex < 0) return null;
  const start = json.indexOf("{", keyIndex + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < json.length; index += 1) {
    const char = json[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return json.slice(start, index + 1);
  }
  return null;
}
