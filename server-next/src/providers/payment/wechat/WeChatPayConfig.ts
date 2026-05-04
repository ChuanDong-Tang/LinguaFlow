/** WeChatPayConfig：读取并校验微信支付所需配置项。 */

export interface WeChatPayConfig {
  appId: string;
  mchId: string;
  merchantSerialNo: string;
  merchantPrivateKey: string;
  apiV3Key: string;
  platformPublicKey: string;
  notifyUrl: string;
  baseUrl: string;
}

export class WeChatPayConfigError extends Error {
  readonly code = "WECHAT_PAY_CONFIG_INVALID";

  constructor(message: string) {
    super(message);
  }
}

export interface WeChatPayConfigCheck {
  ok: boolean;
  missing: string[];
  warnings: string[];
  configured: {
    appId: boolean;
    mchId: boolean;
    merchantSerialNo: boolean;
    merchantPrivateKey: boolean;
    apiV3Key: boolean;
    platformPublicKey: boolean;
    notifyUrl: boolean;
    baseUrl: string;
  };
}

export function loadWeChatPayConfig(env: NodeJS.ProcessEnv = process.env): WeChatPayConfig {
  const config = {
    appId: env.WECHAT_PAY_APP_ID ?? "",
    mchId: env.WECHAT_PAY_MCH_ID ?? "",
    merchantSerialNo: env.WECHAT_PAY_MERCHANT_SERIAL_NO ?? "",
    merchantPrivateKey: normalizePrivateKey(env.WECHAT_PAY_MERCHANT_PRIVATE_KEY ?? ""),
    apiV3Key: env.WECHAT_PAY_API_V3_KEY ?? "",
    platformPublicKey: normalizePrivateKey(env.WECHAT_PAY_PLATFORM_PUBLIC_KEY ?? ""),
    notifyUrl: env.WECHAT_PAY_NOTIFY_URL ?? "",
    baseUrl: env.WECHAT_PAY_BASE_URL ?? "https://api.mch.weixin.qq.com",
  };

  const missing = Object.entries(config)
    .filter(([key, value]) => key !== "baseUrl" && !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new WeChatPayConfigError(`Missing WeChat Pay config: ${missing.join(", ")}`);
  }

  return config;
}

export function checkWeChatPayConfig(
  env: NodeJS.ProcessEnv = process.env
): WeChatPayConfigCheck {
  const merchantPrivateKey = normalizePrivateKey(env.WECHAT_PAY_MERCHANT_PRIVATE_KEY ?? "");
  const platformPublicKey = normalizePrivateKey(env.WECHAT_PAY_PLATFORM_PUBLIC_KEY ?? "");
  const notifyUrl = env.WECHAT_PAY_NOTIFY_URL ?? "";
  const baseUrl = env.WECHAT_PAY_BASE_URL ?? "https://api.mch.weixin.qq.com";
  const configured = {
    appId: Boolean(env.WECHAT_PAY_APP_ID),
    mchId: Boolean(env.WECHAT_PAY_MCH_ID),
    merchantSerialNo: Boolean(env.WECHAT_PAY_MERCHANT_SERIAL_NO),
    merchantPrivateKey: Boolean(merchantPrivateKey),
    apiV3Key: Boolean(env.WECHAT_PAY_API_V3_KEY),
    platformPublicKey: Boolean(platformPublicKey),
    notifyUrl: Boolean(notifyUrl),
    baseUrl,
  };
  const missing = Object.entries(configured)
    .filter(([key, value]) => key !== "baseUrl" && value === false)
    .map(([key]) => key);
  const warnings: string[] = [];

  if (merchantPrivateKey && !merchantPrivateKey.includes("BEGIN PRIVATE KEY")) {
    warnings.push("merchantPrivateKey should be a PEM private key");
  }

  if (platformPublicKey && !platformPublicKey.includes("BEGIN PUBLIC KEY")) {
    warnings.push("platformPublicKey should be a PEM public key");
  }

  if (notifyUrl && !notifyUrl.startsWith("https://")) {
    warnings.push("notifyUrl should use https in staging/production");
  }

  return {
    ok: missing.length === 0 && warnings.length === 0,
    missing,
    warnings,
    configured,
  };
}

function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}
