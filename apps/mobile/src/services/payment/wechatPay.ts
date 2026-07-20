import { t } from "../../i18n";

export type WeChatClientPayParams = {
  appId: string;
  partnerId: string;
  prepayId: string;
  packageValue: "Sign=WXPay";
  nonceStr: string;
  timeStamp: string;
  sign: string;
};

export const WECHAT_PAY_USER_CANCELLED = "WECHAT_PAY_USER_CANCELLED";

export async function payWithWechat(
  params: WeChatClientPayParams,
): Promise<void> {
  // 保留支付适配器边界，未来重新接入 native SDK 时无需改动调用方。
  void params;
  throw new Error(t("payment.wechat.native_missing"));
}

export function toWeChatClientPayParams(
  value: Record<string, unknown>,
): WeChatClientPayParams {
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
