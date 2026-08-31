import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import test from "node:test";
import { AlipayAutoRenewClient } from "./AlipayClient.js";

test("Alipay client signs and sends the configured notification URL", async () => {
  const appKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const alipayKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const notifyUrl = "https://api.yueyantech.com/payment/autorenew/alipay/notify";
  let requestBody = "";
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (_url, init) => {
    requestBody = String(init?.body ?? "");
    const responseContent = JSON.stringify({ code: "10000", msg: "Success", customer_id: "customer-1" });
    const signer = createSign("RSA-SHA256");
    signer.update(responseContent, "utf8");
    signer.end();
    const sign = signer.sign(alipayKeys.privateKey, "base64");
    return new Response(`{"alipay_trade_customer_create_response":${responseContent},"sign":"${sign}"}`, { status: 200 });
  };

  try {
    const client = new AlipayAutoRenewClient({
      appId: "app-1",
      privateKey: appKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      alipayPublicKey: alipayKeys.publicKey.export({ type: "spki", format: "pem" }).toString(),
      gatewayUrl: "https://openapi.alipay.com/gateway.do",
      notifyUrl,
      plusMonthlyPriceId: "price-plus",
      proMonthlyPriceId: "price-pro",
      requestTimeoutMs: 1_000,
    });

    assert.equal(await client.createCustomer({ name: "OIO", email: "test@example.com" }), "customer-1");
    const fields = new URLSearchParams(requestBody);
    assert.equal(fields.get("notify_url"), notifyUrl);
    assert.equal(fields.get("sign_type"), "RSA2");
    assert.ok(fields.get("sign"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
