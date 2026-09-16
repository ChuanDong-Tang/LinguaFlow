import type { PaymentProductCode } from "@lf/core/ports/payment/PaymentTypes.js";
import { getRuntimeConfig } from "../../../config/runtimeConfig.js";

export type AlipayAnnualPassProductCode = Extract<
  PaymentProductCode,
  "plus_yearly" | "pro_yearly"
>;

export interface AlipayAnnualPassProduct {
  productCode: AlipayAnnualPassProductCode;
  productId: string;
  priceId: string;
  amount: number;
  subject: string;
}

export interface AlipayAnnualPassConfig {
  appId: string;
  privateKey: string;
  alipayPublicKey: string;
  gatewayUrl: string;
  notifyUrl: string;
  sellerId: string;
  requestTimeoutMs: number;
  products: Record<AlipayAnnualPassProductCode, AlipayAnnualPassProduct>;
  testPriceUserIds: string[];
  testProducts: Record<AlipayAnnualPassProductCode, AlipayAnnualPassProduct> | null;
}

export class AlipayAnnualPassConfigError extends Error {
  readonly code = "ALIPAY_ANNUAL_PASS_CONFIG_INVALID";
}

export function loadAlipayAnnualPassConfig(): AlipayAnnualPassConfig {
  const config = getRuntimeConfig().payment.alipayAnnualPass;
  if (!config.enabled) {
    throw new AlipayAnnualPassConfigError("Alipay annual pass is disabled");
  }
  const missing = [
    ["ALIPAY_APP_ID", config.appId],
    ["ALIPAY_APP_PRIVATE_KEY", config.privateKey],
    ["ALIPAY_PUBLIC_KEY", config.alipayPublicKey],
    ["ALIPAY_ANNUAL_PASS_NOTIFY_URL", config.notifyUrl],
    ["ALIPAY_SELLER_ID", config.sellerId],
    ["ALIPAY_PLUS_ANNUAL_PASS_PRODUCT_ID", config.plusProductId],
    ["ALIPAY_PLUS_ANNUAL_PASS_PRICE_ID", config.plusPriceId],
    ["ALIPAY_PRO_ANNUAL_PASS_PRODUCT_ID", config.proProductId],
    ["ALIPAY_PRO_ANNUAL_PASS_PRICE_ID", config.proPriceId],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new AlipayAnnualPassConfigError(`Missing ${missing.join(", ")}`);
  }
  const testMissing = config.testPriceUserIds.length > 0
    ? [
        ["ALIPAY_PLUS_ANNUAL_PASS_TEST_PRICE_ID", config.plusTestPriceId],
        ["ALIPAY_PRO_ANNUAL_PASS_TEST_PRICE_ID", config.proTestPriceId],
      ].filter(([, value]) => !value).map(([name]) => name)
    : [];
  if (testMissing.length > 0) {
    throw new AlipayAnnualPassConfigError(`Missing ${testMissing.join(", ")}`);
  }

  return {
    appId: config.appId!,
    privateKey: config.privateKey!,
    alipayPublicKey: config.alipayPublicKey!,
    gatewayUrl: config.gatewayUrl,
    notifyUrl: config.notifyUrl!,
    sellerId: config.sellerId!,
    requestTimeoutMs: config.requestTimeoutMs,
    testPriceUserIds: config.testPriceUserIds,
    products: {
      plus_yearly: {
        productCode: "plus_yearly",
        productId: config.plusProductId!,
        priceId: config.plusPriceId!,
        amount: 36_800,
        subject: "OIO Plus 年卡",
      },
      pro_yearly: {
        productCode: "pro_yearly",
        productId: config.proProductId!,
        priceId: config.proPriceId!,
        amount: 46_800,
        subject: "OIO Pro 年卡",
      },
    },
    testProducts: config.testPriceUserIds.length > 0 ? {
      plus_yearly: {
        productCode: "plus_yearly",
        productId: config.plusProductId!,
        priceId: config.plusTestPriceId!,
        amount: 100,
        subject: "OIO Plus 年卡（测试）",
      },
      pro_yearly: {
        productCode: "pro_yearly",
        productId: config.proProductId!,
        priceId: config.proTestPriceId!,
        amount: 100,
        subject: "OIO Pro 年卡（测试）",
      },
    } : null,
  };
}

export function isAlipayAnnualPassConfigured(): boolean {
  try {
    loadAlipayAnnualPassConfig();
    return true;
  } catch {
    return false;
  }
}

export function isAlipayAnnualPassProductCode(
  value: unknown,
): value is AlipayAnnualPassProductCode {
  return value === "plus_yearly" || value === "pro_yearly";
}
