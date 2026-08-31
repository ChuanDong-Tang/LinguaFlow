import { loadAlipayAutoRenewConfig, type AlipayAutoRenewConfig } from "./AlipayConfig.js";
import { signAlipayFields, verifyAlipayFields, verifyAlipayResponseContent, type AlipayFormFields } from "./AlipaySignature.js";
import type { AlipaySubscriptionChanged, AlipaySubscriptionQueryResponse, AlipaySubscriptionSnapshot } from "./AlipayTypes.js";

export class AlipayApiError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown) { super(message); }
}

export class AlipayAutoRenewClient {
  constructor(private readonly config: AlipayAutoRenewConfig = loadAlipayAutoRenewConfig()) {}

  async createCustomer(input: { name: string; email?: string | null; phone?: string | null; description?: string }): Promise<string> {
    if (!input.email && !input.phone) throw new AlipayApiError("ALIPAY_CUSTOMER_CONTACT_REQUIRED", "Alipay customer requires email or phone");
    const result = await this.call("alipay.trade.customer.create", {
      name: input.name,
      description: input.description ?? "OIO member",
      ...(input.email ? { email: input.email } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
    });
    const customerId = stringValue(result.customer_id ?? result.id);
    if (!customerId) throw new AlipayApiError("ALIPAY_CUSTOMER_ID_MISSING", "Alipay customer response missing customer_id", result);
    return customerId;
  }

  async createSubscription(input: { customerId: string; priceId: string; title: string; metadata: Record<string, unknown> }): Promise<{
    subscriptionId: string; orderNo: string | null; jumpSchema: string; schemaEffectiveEnd: string | null; raw: Record<string, unknown>;
  }> {
    const result = await this.call("alipay.trade.subscription.create", {
      customer_id: input.customerId,
      items: [{ price_id: input.priceId }],
      subscribe_title: input.title,
      deduct_type: "SUBSCRIBE_DEDUCT",
      metadata: JSON.stringify(input.metadata),
    });
    const subscriptionId = stringValue(result.subscription_id);
    const jumpSchema = stringValue(result.alipay_jump_schema);
    if (!subscriptionId || !jumpSchema) throw new AlipayApiError("ALIPAY_SUBSCRIPTION_RESPONSE_INVALID", "Alipay subscription response missing id or jump schema", result);
    return { subscriptionId, jumpSchema, orderNo: stringValue(result.order_no), schemaEffectiveEnd: stringValue(result.schema_effective_end), raw: result };
  }

  async querySubscription(input: { customerId: string; subscriptionId: string }): Promise<AlipaySubscriptionSnapshot> {
    const result = (await this.call("alipay.trade.subscription.query", {
      customer_id: input.customerId,
      subscription_id: input.subscriptionId,
    })) as unknown as AlipaySubscriptionQueryResponse;
    const subscription = result.subscriptions?.find((item) => item.subscription_id === input.subscriptionId);
    if (!subscription) {
      throw new AlipayApiError(
        "ALIPAY_SUBSCRIPTION_QUERY_NOT_FOUND",
        "Alipay subscription query response did not contain the requested subscription",
        result,
      );
    }
    if (subscription.customer_id && subscription.customer_id !== input.customerId) {
      throw new AlipayApiError(
        "ALIPAY_SUBSCRIPTION_CUSTOMER_MISMATCH",
        "Alipay subscription query response customer mismatch",
        result,
      );
    }
    return subscription;
  }

  async cancelAtPeriodEnd(subscriptionId: string): Promise<void> {
    await this.call("alipay.trade.subscription.modify", { subscription_id: subscriptionId, modify_type: "CANCEL", cancel_at_period_end: true });
  }

  parseAndVerifyNotification(fields: AlipayFormFields): AlipaySubscriptionChanged {
    if (!fields.notify_id || !fields.biz_content || !fields.utc_timestamp) {
      throw new AlipayApiError("ALIPAY_NOTIFY_FIELDS_MISSING", "Alipay notification is missing required fields");
    }
    if (fields.app_id !== this.config.appId) throw new AlipayApiError("ALIPAY_NOTIFY_APP_ID_MISMATCH", "Alipay notification app_id mismatch");
    if (fields.msg_method !== "alipay.trade.subscription.changed") throw new AlipayApiError("ALIPAY_NOTIFY_METHOD_INVALID", "Unexpected Alipay notification method");
    if (fields.sign_type?.toUpperCase() !== "RSA2" || !verifyAlipayFields(fields, this.config.alipayPublicKey)) {
      throw new AlipayApiError("ALIPAY_NOTIFY_SIGNATURE_INVALID", "Invalid Alipay notification signature");
    }
    let content: Record<string, unknown>;
    try { content = JSON.parse(fields.biz_content ?? "") as Record<string, unknown>; } catch { throw new AlipayApiError("ALIPAY_NOTIFY_CONTENT_INVALID", "Invalid Alipay biz_content"); }
    const subscription = parseObjectValue(content.subscription);
    const subscriptionId = stringValue(subscription.subscription_id);
    const changeType = stringValue(content.change_type) as AlipaySubscriptionChanged["changeType"] | null;
    if (!subscriptionId || !changeType || !ALIPAY_CHANGE_TYPES.has(changeType)) {
      throw new AlipayApiError("ALIPAY_NOTIFY_CONTENT_INVALID", "Notification missing subscription or has invalid change type");
    }
    return {
      notifyId: fields.notify_id,
      appId: fields.app_id,
      changeType,
      changeDate: stringValue(content.change_date),
      tradeNo: stringValue(content.trade_no),
      orderNo: stringValue(content.order_no),
      outTradeNo: stringValue(content.out_trade_no),
      payAmount: numberValue(content.pay_amount),
      subscription: subscription as unknown as AlipaySubscriptionSnapshot,
      raw: fields,
    };
  }

  private async call(method: string, bizContent: Record<string, unknown>): Promise<Record<string, unknown>> {
    const fields: AlipayFormFields = {
      app_id: this.config.appId, method, format: "JSON", charset: "utf-8", sign_type: "RSA2",
      timestamp: formatAlipayTimestamp(new Date()), version: "1.0",
      notify_url: this.config.notifyUrl,
      biz_content: JSON.stringify(bizContent),
    };
    fields.sign = signAlipayFields(fields, this.config.privateKey);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const response = await fetch(this.config.gatewayUrl, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: new URLSearchParams(fields), signal: controller.signal,
      });
      if (!response.ok) throw new AlipayApiError("ALIPAY_HTTP_ERROR", `Alipay returned HTTP ${response.status}`);
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
        throw new AlipayApiError(stringValue(payload.sub_code) ?? stringValue(payload.code) ?? "ALIPAY_API_ERROR", stringValue(payload.sub_msg) ?? stringValue(payload.msg) ?? "Alipay API failed", payload);
      }
      return payload;
    } finally { clearTimeout(timeout); }
  }
}

function objectValue(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function parseObjectValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try { return objectValue(JSON.parse(value)); } catch { return {}; }
}
function stringValue(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : value === undefined || value === null ? null : String(value); }
function numberValue(value: unknown): number | null { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function formatAlipayTimestamp(date: Date): string { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date).replace("T", " "); }

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

const ALIPAY_CHANGE_TYPES = new Set<AlipaySubscriptionChanged["changeType"]>([
  "active", "period_extend", "cancel", "cancel_at_period_end", "trialing",
  "item_update", "item_downgrade", "item_cancel_revert",
]);
