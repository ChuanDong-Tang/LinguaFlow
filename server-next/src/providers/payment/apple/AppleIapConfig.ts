import { getRuntimeConfig } from "../../../config/runtimeConfig.js";
import { AppleIapConfigError } from "./AppleIapErrors.js";

export interface AppleIapRuntimeConfig {
  issuerId: string;
  keyId: string;
  bundleId: string;
  privateKeyPem: string;
  rootCaPem: string;
  proProductId: string;
}

export function isAppleIapConfigured(): boolean {
  const config = getRuntimeConfig();
  return Boolean(
    config.appleIapIssuerId &&
      config.appleIapKeyId &&
      config.appleIapBundleId &&
      config.appleIapPrivateKey &&
      config.appleIapRootCa &&
      config.appleIapProMonthlyProductId
  );
}

export function loadAppleIapConfig(): AppleIapRuntimeConfig {
  const config = getRuntimeConfig();
  return {
    issuerId: requireConfig(config.appleIapIssuerId, "APPLE_IAP_ISSUER_ID"),
    keyId: requireConfig(config.appleIapKeyId, "APPLE_IAP_KEY_ID"),
    bundleId: requireConfig(config.appleIapBundleId, "APPLE_IAP_BUNDLE_ID"),
    privateKeyPem: normalizePem(requireConfig(config.appleIapPrivateKey, "APPLE_IAP_PRIVATE_KEY")),
    rootCaPem: normalizePem(requireConfig(config.appleIapRootCa, "APPLE_IAP_ROOT_CA")),
    proProductId: requireConfig(
      config.appleIapProMonthlyProductId,
      "APPLE_IAP_PRO_MONTHLY_PRODUCT_ID"
    ),
  };
}

function requireConfig(value: string | null, key: string): string {
  if (!value) throw new AppleIapConfigError(`${key} is required`);
  return value;
}

function normalizePem(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}
