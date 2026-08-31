import { getRuntimeConfig } from "../../../config/runtimeConfig.js";

export interface AlipayAutoRenewConfig {
  appId: string;
  privateKey: string;
  alipayPublicKey: string;
  gatewayUrl: string;
  notifyUrl: string;
  plusMonthlyPriceId: string | null;
  proMonthlyPriceId: string | null;
  requestTimeoutMs: number;
}

export class AlipayConfigError extends Error {
  readonly code = "ALIPAY_AUTORENEW_CONFIG_INVALID";
}

export function loadAlipayAutoRenewConfig(): AlipayAutoRenewConfig {
  const config = getRuntimeConfig().payment.alipayAutoRenew;
  if (!config.enabled) throw new AlipayConfigError("Alipay auto renew is disabled");
  const missing = [
    ["ALIPAY_APP_ID", config.appId],
    ["ALIPAY_APP_PRIVATE_KEY", config.privateKey],
    ["ALIPAY_PUBLIC_KEY", config.alipayPublicKey],
    ["ALIPAY_NOTIFY_URL", config.notifyUrl],
    ["ALIPAY_PLUS_MONTHLY_PRICE_ID", config.plusMonthlyPriceId],
    ["ALIPAY_PRO_MONTHLY_PRICE_ID", config.proMonthlyPriceId],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) throw new AlipayConfigError(`Missing ${missing.join(", ")}`);
  return {
    appId: config.appId!,
    privateKey: config.privateKey!,
    alipayPublicKey: config.alipayPublicKey!,
    gatewayUrl: config.gatewayUrl,
    notifyUrl: config.notifyUrl!,
    plusMonthlyPriceId: config.plusMonthlyPriceId,
    proMonthlyPriceId: config.proMonthlyPriceId,
    requestTimeoutMs: config.requestTimeoutMs,
  };
}

export function isAlipayAutoRenewConfigured(): boolean {
  try { loadAlipayAutoRenewConfig(); return true; } catch { return false; }
}
