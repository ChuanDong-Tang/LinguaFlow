import { Platform } from "react-native";
import { t, tf } from "../../i18n";

type WeChatNativeModule = {
  isWXAppInstalled: () => Promise<boolean>;
  pay: (params: {
    partnerId: string;
    prepayId: string;
    nonceStr: string;
    timeStamp: string;
    package: "Sign=WXPay";
    sign: string;
  }) => Promise<{ errCode?: number | string; errStr?: string }>;
  registerApp: (appId: string, universalLink?: string) => Promise<boolean>;
};

export type WeChatClientPayParams = {
  appId: string;
  partnerId: string;
  prepayId: string;
  packageValue: "Sign=WXPay";
  nonceStr: string;
  timeStamp: string;
  sign: string;
};

let registeredAppId: string | null = null;

export const WECHAT_PAY_USER_CANCELLED = "WECHAT_PAY_USER_CANCELLED";

export async function payWithWechat(params: WeChatClientPayParams): Promise<void> {
  if (Platform.OS !== "android") {
    // 当前单次购买仍走微信 App 支付；iOS 后续应切到 Apple IAP。
    throw new Error(t("pro.alert.wechat_pay_unsupported"));
  }

  const WeChat = await loadWeChatModule();
  await ensureWeChatRegistered(WeChat, params.appId);

  const installed = await WeChat.isWXAppInstalled();
  if (!installed) {
    throw new Error(t("payment.wechat.not_installed"));
  }

  const result = await WeChat.pay({
    partnerId: params.partnerId,
    prepayId: params.prepayId,
    nonceStr: params.nonceStr,
    timeStamp: params.timeStamp,
    package: params.packageValue,
    sign: params.sign,
  });

  const errCode = Number(result.errCode ?? 0);
  if (errCode === 0) return;
  if (errCode === -2) {
    const error = new Error(t("payment.wechat.cancelled"));
    error.name = WECHAT_PAY_USER_CANCELLED;
    throw error;
  }
  throw new Error(result.errStr || tf("payment.wechat.failed_with_code", { code: errCode }));
}

export function toWeChatClientPayParams(value: Record<string, unknown>): WeChatClientPayParams {
  const params = {
    appId: String(value.appId ?? ""),
    partnerId: String(value.partnerId ?? ""),
    prepayId: String(value.prepayId ?? ""),
    packageValue: value.packageValue,
    nonceStr: String(value.nonceStr ?? ""),
    timeStamp: String(value.timeStamp ?? ""),
    sign: String(value.sign ?? ""),
  };

  if (
    !params.appId ||
    !params.partnerId ||
    !params.prepayId ||
    params.packageValue !== "Sign=WXPay" ||
    !params.nonceStr ||
    !params.timeStamp ||
    !params.sign
  ) {
    throw new Error(t("payment.wechat.params_incomplete"));
  }

  return params as WeChatClientPayParams;
}

async function ensureWeChatRegistered(WeChat: WeChatNativeModule, appId: string): Promise<void> {
  if (registeredAppId === appId) return;
  const universalLink = process.env.EXPO_PUBLIC_WECHAT_UNIVERSAL_LINK || undefined;
  const ok = await WeChat.registerApp(appId, universalLink);
  if (!ok) throw new Error(t("payment.wechat.sdk_register_failed"));
  registeredAppId = appId;
}

async function loadWeChatModule(): Promise<WeChatNativeModule> {
  const mod = await import("react-native-wechat-lib");
  const candidate = (mod.default ?? mod) as Partial<WeChatNativeModule> | null;
  if (!candidate?.registerApp || !candidate.isWXAppInstalled || !candidate.pay) {
    throw new Error(t("payment.wechat.native_missing"));
  }
  return candidate as WeChatNativeModule;
}
