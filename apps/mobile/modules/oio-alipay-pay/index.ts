import { Platform } from "react-native";
import { requireNativeModule } from "expo-modules-core";

export type AlipayPayResult = {
  resultStatus: string | null;
  memo: string | null;
  result: string | null;
};

type OioAlipayPayModule = {
  pay(orderString: string): Promise<AlipayPayResult>;
};

export async function payWithAlipay(orderString: string): Promise<AlipayPayResult> {
  if (Platform.OS !== "android") {
    throw new Error("Alipay annual pass is only available on Android");
  }
  const module = requireNativeModule<OioAlipayPayModule>("OioAlipayPay");
  return module.pay(orderString);
}
