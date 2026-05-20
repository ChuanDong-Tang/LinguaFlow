import { Platform } from "react-native";
import * as WeChat from "react-native-wechat-lib";

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

export async function payWithWechat(params: WeChatClientPayParams): Promise<void> {
  if (Platform.OS !== "android") {
    // 当前单次购买仍走微信 App 支付；iOS 后续应切到 Apple IAP。
    throw new Error("当前平台不支持微信支付");
  }

  await ensureWeChatRegistered(params.appId);

  const installed = await WeChat.isWXAppInstalled();
  if (!installed) {
    throw new Error("未安装微信，无法发起微信支付");
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
  if (errCode === -2) throw new Error("用户取消微信支付");
  throw new Error(result.errStr || `微信支付失败：${errCode}`);
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
    throw new Error("微信支付参数不完整");
  }

  return params as WeChatClientPayParams;
}

async function ensureWeChatRegistered(appId: string): Promise<void> {
  if (registeredAppId === appId) return;
  const universalLink = process.env.EXPO_PUBLIC_WECHAT_UNIVERSAL_LINK || undefined;
  const ok = await WeChat.registerApp(appId, universalLink);
  if (!ok) throw new Error("微信 SDK 注册失败");
  registeredAppId = appId;
}
