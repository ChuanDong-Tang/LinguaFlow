import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeGoogleBillingDiagnostic } from "./googleBillingDiagnostics.js";
test("diagnostics allowlist drops credentials, redacts text and bounds messages", () => {
  const result = sanitizeGoogleBillingDiagnostic({ stage: "callback", code: "E_ITEM_UNAVAILABLE", responseCode: 4,
    purchaseToken: "private", receipt: "secret", userId: "spoof", message: "a@b.com token=secret https://bad.test?q=secret " + "x".repeat(600) });
  assert.equal(result?.responseCode, 4);
  assert.equal(result?.code, "E_ITEM_UNAVAILABLE");
  assert.ok(!JSON.stringify(result).includes("secret"));
  assert.ok(!JSON.stringify(result).includes("spoof"));
  assert.ok(String(result?.message).length <= 400);
  assert.equal(sanitizeGoogleBillingDiagnostic({ stage: "anything" }), null);
});
