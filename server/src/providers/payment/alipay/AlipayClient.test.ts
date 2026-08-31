import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import test from "node:test";
import { AlipayAutoRenewClient } from "./AlipayClient.js";
import { buildAlipaySignContent, type AlipayFormFields } from "./AlipaySignature.js";

const appKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const alipayKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const notifyUrl = "https://api.yueyantech.com/payment/autorenew/alipay/notify";

function createClient(): AlipayAutoRenewClient {
  return new AlipayAutoRenewClient({
    appId: "app-1",
    privateKey: appKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    alipayPublicKey: alipayKeys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    gatewayUrl: "https://openapi.alipay.com/gateway.do",
    notifyUrl,
    plusMonthlyPriceId: "price-plus",
    proMonthlyPriceId: "price-pro",
    requestTimeoutMs: 1_000,
  });
}

function createSignedApiResponse(method: string, payload: Record<string, unknown>): Response {
  const responseContent = JSON.stringify({ code: "10000", msg: "Success", ...payload });
  const signer = createSign("RSA-SHA256");
  signer.update(responseContent, "utf8");
  signer.end();
  const sign = signer.sign(alipayKeys.privateKey, "base64");
  return new Response(`{"${method.replaceAll(".", "_")}_response":${responseContent},"sign":"${sign}"}`, { status: 200 });
}

test("Alipay client signs and sends the configured notification URL", async () => {
  let requestBody = "";
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (_url, init) => {
    requestBody = String(init?.body ?? "");
    return createSignedApiResponse("alipay.trade.customer.create", { customer_id: "customer-1" });
  };

  try {
    const client = createClient();

    assert.equal(await client.createCustomer({ name: "OIO", email: "test@example.com" }), "customer-1");
    const fields = new URLSearchParams(requestBody);
    assert.equal(fields.get("notify_url"), notifyUrl);
    assert.equal(fields.get("sign_type"), "RSA2");
    assert.ok(fields.get("sign"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Alipay subscription query unwraps the requested subscription from subscriptions", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => createSignedApiResponse("alipay.trade.subscription.query", {
    subscriptions: [
      { subscription_id: "subscription-other", customer_id: "customer-1", subscription_status: "ACTIVE" },
      { subscription_id: "subscription-1", customer_id: "customer-1", subscription_status: "ACTIVE", current_period_end: "2026-10-01 12:00:00" },
    ],
  });

  try {
    const result = await createClient().querySubscription({ customerId: "customer-1", subscriptionId: "subscription-1" });
    assert.equal(result.subscription_id, "subscription-1");
    assert.equal(result.current_period_end, "2026-10-01 12:00:00");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Alipay cancellation requests period-end cancellation", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = "";
  globalThis.fetch = async (_url, init) => {
    requestBody = String(init?.body ?? "");
    return createSignedApiResponse("alipay.trade.subscription.modify", { subscription_id: "subscription-1" });
  };

  try {
    await createClient().cancelAtPeriodEnd("subscription-1");
    const fields = new URLSearchParams(requestBody);
    assert.deepEqual(JSON.parse(fields.get("biz_content") ?? "{}"), {
      subscription_id: "subscription-1",
      modify_type: "CANCEL",
      cancel_at_period_end: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Alipay notification requires a valid RSA2 signature and exposes the subscription event", () => {
  const fields: AlipayFormFields = {
    notify_id: "notify-1",
    utc_timestamp: "1788166800000",
    msg_method: "alipay.trade.subscription.changed",
    app_id: "app-1",
    version: "1.1",
    charset: "UTF-8",
    sign_type: "RSA2",
    biz_content: JSON.stringify({
      change_type: "active",
      change_date: "2026-09-01 12:00:00",
      trade_no: "trade-1",
      pay_amount: "1500",
      subscription: {
        subscription_id: "subscription-1",
        current_period_start: "2026-09-01 12:00:00",
        current_period_end: "2026-10-01 12:00:00",
      },
    }),
  };
  const signer = createSign("RSA-SHA256");
  signer.update(buildAlipaySignContent(fields), "utf8");
  signer.end();
  fields.sign = signer.sign(alipayKeys.privateKey, "base64");

  const parsed = createClient().parseAndVerifyNotification(fields);
  assert.equal(parsed.notifyId, "notify-1");
  assert.equal(parsed.subscription.subscription_id, "subscription-1");
  assert.equal(parsed.payAmount, 1500);

  assert.throws(
    () => createClient().parseAndVerifyNotification({ ...fields, biz_content: fields.biz_content.replace("1500", "1") }),
    /Invalid Alipay notification signature/,
  );
});
