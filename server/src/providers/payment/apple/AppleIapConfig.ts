import { getRuntimeConfig } from "../../../config/runtimeConfig.js";
import { AppleIapConfigError } from "./AppleIapErrors.js";

export interface AppleIapRuntimeConfig {
  issuerId: string;
  keyId: string;
  bundleId: string;
  privateKeyPem: string;
  rootCaPem: string;
  plusProductId: string | null;
  proProductId: string;
  proMonthlyOneTimeProductId: string | null;
}

export function isAppleIapConfigured(): boolean {
  const config = getRuntimeConfig();
  return Boolean(
    config.payment.appleIap.issuerId &&
      config.payment.appleIap.keyId &&
      config.payment.appleIap.bundleId &&
      config.payment.appleIap.privateKey &&
      config.payment.appleIap.rootCa &&
      config.payment.appleIap.plusMonthlyProductId &&
      config.payment.appleIap.proMonthlyProductId
  );
}

export function loadAppleIapConfig(): AppleIapRuntimeConfig {
  const config = getRuntimeConfig();
  return {
    issuerId: requireConfig(config.payment.appleIap.issuerId, "APPLE_IAP_ISSUER_ID"),
    keyId: requireConfig(config.payment.appleIap.keyId, "APPLE_IAP_KEY_ID"),
    bundleId: requireConfig(config.payment.appleIap.bundleId, "APPLE_IAP_BUNDLE_ID"),
    privateKeyPem: normalizePem(requireConfig(config.payment.appleIap.privateKey, "APPLE_IAP_PRIVATE_KEY")),
    rootCaPem: normalizePem(requireConfig(config.payment.appleIap.rootCa, "APPLE_IAP_ROOT_CA")),
    plusProductId: requireConfig(
      config.payment.appleIap.plusMonthlyProductId,
      "APPLE_IAP_PLUS_MONTHLY_PRODUCT_ID"
    ),
    proProductId: requireConfig(
      config.payment.appleIap.proMonthlyProductId,
      "APPLE_IAP_PRO_MONTHLY_PRODUCT_ID"
    ),
    proMonthlyOneTimeProductId: config.payment.appleIap.proMonthlyOneTimeProductId,
  };
}

function requireConfig(value: string | null, key: string): string {
  if (!value) throw new AppleIapConfigError(`${key} is required`);
  return value;
}

function normalizePem(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}
