import React, { useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useIAP, type Purchase } from "expo-iap";
import * as WebBrowser from "expo-web-browser";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  cancelAutoRenewSubscription,
  createWeChatAutoRenewPreSign,
  createProMonthlyOrder,
  getCurrentAutoRenewSubscription,
  verifyAppleProMonthlyTransaction,
  type MobileAutoRenewSubscription,
  type MobileWeChatAutoRenewPreSignResult,
} from "../services/api/paymentApi";
import {
  clearPendingPaymentOrder,
  pollPaymentOrderUntilSettled,
  recoverPendingPaymentIfAny,
  savePendingPaymentOrder,
} from "../services/payment/paymentRecovery";
import {
  APPLE_PRO_MONTHLY_PRODUCT_ID,
  assertAppleIapAvailable,
  getAppleTransactionId,
} from "../services/payment/appleIap";
import { useMountedGuard } from "../hooks/useMountedGuard";

type ProScreenProps = { onBack: () => void };
type AppleIapBridgeState = Pick<
  ReturnType<typeof useIAP>,
  "connected" | "fetchProducts" | "finishTransaction" | "requestPurchase"
>;
type AppleIapBridgeProps = {
  onReady: (bridge: AppleIapBridgeState) => void;
  onPurchaseSuccess: (purchase: Purchase) => void;
  onPurchaseError: (error: unknown) => void;
};

export function ProScreen({ onBack }: ProScreenProps) {
  const { isMounted: isScreenAlive, safeAlert } = useMountedGuard();
  const [isPaying, setIsPaying] = useState(false);
  const [isRenew, setIsRenew] = useState(false);
  const [autoRenew, setAutoRenew] = useState<MobileAutoRenewSubscription | null>(null);
  const [isAutoRenewLoading, setIsAutoRenewLoading] = useState(false);
  const [isApplePurchaseFinishing, setIsApplePurchaseFinishing] = useState(false);
  const [appleIap, setAppleIap] = useState<AppleIapBridgeState | null>(null);

  useEffect(() => {
    void (async () => {
      // 页面打开时先恢复未完成订单，处理用户支付后返回 App 的场景。
      const recovered = await recoverPendingPaymentIfAny();
      if (!isScreenAlive()) return;
      if (recovered.status === "paid") {
        setIsRenew(true);
        safeAlert("开通成功", "Pro 权益已生效。");
      }
      try {
        const currentAutoRenew = await getCurrentAutoRenewSubscription();
        if (!isScreenAlive()) return;
        setAutoRenew(currentAutoRenew);
      } catch {}
    })();
  }, [isScreenAlive, safeAlert]);

  async function handleSubscribe(): Promise<void> {
    if (isPaying) return;

    if (Platform.OS === "ios") {
      await startAppleIapPurchase("single_purchase");
      return;
    }

    if (Platform.OS === "android") {
      await startWechatOneTimePurchase();
      return;
    }

    safeAlert("暂不支持", "当前平台暂不支持购买 Pro。");
  }

  async function startWechatOneTimePurchase(): Promise<void> {
    assertWechatPayAvailable();
    setIsPaying(true);
    try {
      const order = await createProMonthlyOrder();
      await savePendingPaymentOrder({ orderId: order.id, providerOrderId: order.providerOrderId });

      await payWithWechatParams(order.clientPayParams);
      if (!isScreenAlive()) return;

      // 支付完成通常需要后端确认，这里轮询到终态再更新本地展示。
      const settled = await pollPaymentOrderUntilSettled(order.id);
      if (!isScreenAlive()) return;
      if (settled.status === "paid") {
        await clearPendingPaymentOrder();
        if (!isScreenAlive()) return;
        setIsRenew(true);
        safeAlert("开通成功", "Pro 权益已生效。");
        return;
      }
      if (settled.status === "pending") {
        safeAlert("支付处理中", "订单状态仍在确认中，稍后会自动继续同步。");
        return;
      }
      await clearPendingPaymentOrder();
      if (!isScreenAlive()) return;
      safeAlert("支付未完成", `当前状态：${settled.status}`);
    } catch (error) {
      if (!isScreenAlive()) return;
      const message = error instanceof Error ? error.message : "请稍后重试";
      safeAlert("支付发起失败", message);
    } finally {
      if (isScreenAlive()) setIsPaying(false);
    }
  }

  async function handleStartAutoRenew(): Promise<void> {
    if (isAutoRenewLoading) return;

    if (hasActiveAutoRenew(autoRenew)) {
      safeAlert("已开通自动续费", `当前已通过${formatProviderName(autoRenew.provider)}开通自动续费。`);
      return;
    }

    if (Platform.OS === "ios") {
      await startAppleIapPurchase("auto_renew");
      return;
    }

    if (Platform.OS === "android") {
      await startWechatAutoRenew();
      return;
    }

    safeAlert("暂不支持", "当前平台暂不支持自动续费。");
  }

  async function startWechatAutoRenew(): Promise<void> {
    assertWechatPayAvailable();
    setIsAutoRenewLoading(true);
    let preSign: MobileWeChatAutoRenewPreSignResult | null = null;

    try {
      preSign = await createWeChatAutoRenewPreSign();

      if (preSign.clientPayParams) {
        // App-with-contract：用户支付首期时同时完成微信自动续费签约。
        await payWithWechatParams(preSign.clientPayParams);
      } else {
        await openWechatContractOnlyFlow(preSign.redirectUrl);
      }
      if (!isScreenAlive()) return;

      const currentAutoRenew = await getCurrentAutoRenewSubscription();
      if (!isScreenAlive()) return;
      setAutoRenew(currentAutoRenew);
    } catch (error) {
      if (preSign && isWechatUserCancelError(error)) {
        await cancelAutoRenewSubscription(preSign.autoRenewSubscriptionId).catch(() => { });
      }
    } finally {
      if (isScreenAlive()) setIsAutoRenewLoading(false);
    }
  }

  async function openWechatContractOnlyFlow(redirectUrl: string | null): Promise<void> {
    if (redirectUrl) {
      // 已有 Pro 时不能再扣首期，走 H5 预签约只建立下周期自动续费协议。
      await WebBrowser.openBrowserAsync(redirectUrl);
    }
    if (!isScreenAlive()) return;
    safeAlert("签约处理中", "已有 Pro 权益，本次只创建自动续费签约，后续周期会自动衔接。");
  }

  function handleManageAutoRenew(): void {
    if (!autoRenew) return;
    if (autoRenew.provider === "apple") {
      // Apple 订阅只能去 Apple ID 订阅管理里取消，服务端不能替用户直接取消平台订阅。
      safeAlert("前往 Apple 管理", "请在 iOS 的 Apple ID 订阅管理中取消自动续费。");
      return;
    }
    // 微信签约也应该回到微信支付/签约记录里取消；App 只展示入口提示，不直接代替用户解约。
    safeAlert("前往微信管理", "请在微信支付的自动续费/扣费服务中取消本服务。");
  }

  async function startAppleIapPurchase(_source: "single_purchase" | "auto_renew"): Promise<void> {
    assertAppleIapAvailable();
    if (!appleIap?.connected) {
      safeAlert("Apple 支付初始化中", "请稍后重试。");
      return;
    }
    setIsPaying(true);
    setIsAutoRenewLoading(true);
    try {
      // iOS 侧统一购买 Apple 的 Pro 月度自动续费商品；真正权益以后端验单结果为准。
      await appleIap.requestPurchase({
        type: "subs",
        request: {
          apple: {
            sku: APPLE_PRO_MONTHLY_PRODUCT_ID,
            andDangerouslyFinishTransactionAutomatically: false,
          },
        },
      });
    } catch (error) {
      if (!isScreenAlive()) return;
      const message = error instanceof Error ? error.message : "请稍后重试";
      safeAlert("Apple 支付发起失败", message);
      setIsPaying(false);
      setIsAutoRenewLoading(false);
    }
  }

  async function handleApplePurchaseSuccess(purchase: Purchase): Promise<void> {
    if (isApplePurchaseFinishing) return;
    setIsApplePurchaseFinishing(true);
    try {
      const transactionId = getAppleTransactionId(purchase);
      // 先让服务端用 App Store Server API 验单并发权益，再 finish transaction。
      await verifyAppleProMonthlyTransaction(transactionId);
      if (!appleIap) throw new Error("Apple 支付未初始化");
      await appleIap.finishTransaction({ purchase, isConsumable: false });
      if (!isScreenAlive()) return;
      setIsRenew(true);
      const currentAutoRenew = await getCurrentAutoRenewSubscription();
      if (!isScreenAlive()) return;
      setAutoRenew(currentAutoRenew);
      safeAlert("开通成功", "Pro 权益已生效。");
    } catch (error) {
      if (!isScreenAlive()) return;
      const message = error instanceof Error ? error.message : "请稍后重试";
      safeAlert("Apple 验单失败", message);
    } finally {
      if (isScreenAlive()) {
        setIsApplePurchaseFinishing(false);
        setIsPaying(false);
        setIsAutoRenewLoading(false);
      }
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      {Platform.OS === "ios" ? (
        <AppleIapBridge
          onReady={setAppleIap}
          onPurchaseSuccess={(purchase) => {
            void handleApplePurchaseSuccess(purchase);
          }}
          onPurchaseError={(error) => {
            if (!isScreenAlive()) return;
            const message = error instanceof Error ? error.message : "Apple 支付失败";
            safeAlert("Apple 支付失败", message);
            setIsPaying(false);
            setIsAutoRenewLoading(false);
          }}
        />
      ) : null}
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={onBack} hitSlop={10}>
          <Ionicons name="arrow-back" size={24} color="#111111" />
        </Pressable>
        <Text style={styles.headerTitle}>OIO Pro</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.heroCard}>
          <View>
            <Text style={styles.heroTitle}>OIO Pro</Text>
            <Text style={styles.heroCopy}>更充足的字符额度，</Text>
            <Text style={styles.heroCopy}>让表达练习更自由。</Text>
          </View>
          <View style={styles.heroShape}>
            <View style={styles.heroCircle} />
            <View style={styles.heroSquare} />
          </View>
        </View>

        <Text style={styles.sectionTitle}>Pro 权益</Text>
        <View style={styles.benefitCard}>
        <BenefitItem icon="text-outline" title="更多每日字符额度" subtitle="普通版：每日 10,000 字\nPro 版：每日 100,000 字" />
          <BenefitItem icon="leaf-outline" title="支持更长文本改写" subtitle="更适合长句、长段落改写" />
          <BenefitItem icon="flash-outline" title="更高频使用" subtitle="适合每天持续练习和记录" isLast />
        </View>

        <View style={styles.priceCard}>
          <View style={styles.priceHead}>
            <Text style={styles.priceTitle}>Pro 月度</Text>
            {isRenew ? <Text style={styles.expire}>到期时间：2026年6月11日</Text> : null}
          </View>
          <View style={styles.priceRow}>
            <Text style={styles.price}>¥ xx</Text>
            <Text style={styles.priceUnit}> / 月</Text>
          </View>
          <View style={styles.noteBox}>
            <Text style={styles.noteText}>
              测试说明：后续接入更多功能后，{"\n"}Pro 权益与价格可能会调整，具体请以当前页面展示为准。
            </Text>
          </View>
          <View style={styles.autoRenewBox}>
            <View style={styles.autoRenewCopy}>
              <Text style={styles.autoRenewTitle}>自动续费</Text>
              <Text style={styles.autoRenewText}>
                {autoRenew?.status === "pending"
                  ? "签约处理中，如未完成可稍后重试。"
                  : hasActiveAutoRenew(autoRenew)
                    ? `已通过${formatProviderName(autoRenew.provider)}开启，${formatNullableDate(autoRenew.nextBillingAt) || "下次扣款时间待同步"}`
                    : `${formatAutoRenewProviderLabel()}自动续费，可随时取消。`}
              </Text>
            </View>
            {hasActiveAutoRenew(autoRenew) ? (
              <Pressable
                style={[styles.secondaryButton, isAutoRenewLoading && styles.subscribeButtonDisabled]}
                onPress={handleManageAutoRenew}
                disabled={isAutoRenewLoading}
              >
                {isAutoRenewLoading ? (
                  <ActivityIndicator color="#111111" />
                ) : (
                  <Text style={styles.secondaryButtonText}>管理</Text>
                )}
              </Pressable>
            ) : (
              <Pressable
                style={[styles.secondaryButton, isAutoRenewLoading && styles.subscribeButtonDisabled]}
                onPress={() => void handleStartAutoRenew()}
                disabled={isAutoRenewLoading}
              >
                {isAutoRenewLoading ? (
                  <ActivityIndicator color="#111111" />
                ) : (
                  <Text style={styles.secondaryButtonText}>{formatAutoRenewButtonLabel()}</Text>
                )}
              </Pressable>
            )}
          </View>

          <Pressable
            style={[styles.subscribeButton, isPaying && styles.subscribeButtonDisabled]}
            onPress={() => void handleSubscribe()}
            disabled={isPaying}
          >
            {isPaying ? (
              <ActivityIndicator color="#111111" />
            ) : (
              <Text style={styles.subscribeText}>{isRenew ? "仅续费 1 个月" : "仅购买 1 个月"}</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function AppleIapBridge({ onReady, onPurchaseSuccess, onPurchaseError }: AppleIapBridgeProps) {
  const iap = useIAP({
    onPurchaseSuccess,
    onPurchaseError,
  });

  useEffect(() => {
    onReady({
      connected: iap.connected,
      fetchProducts: iap.fetchProducts,
      finishTransaction: iap.finishTransaction,
      requestPurchase: iap.requestPurchase,
    });
  }, [iap.connected, iap.fetchProducts, iap.finishTransaction, iap.requestPurchase, onReady]);

  useEffect(() => {
    if (!iap.connected) return;
    void iap.fetchProducts({ skus: [APPLE_PRO_MONTHLY_PRODUCT_ID], type: "subs" });
  }, [iap.connected, iap.fetchProducts]);

  return null;
}

function assertWechatPayAvailable(): void {
  if (Platform.OS !== "android") {
    throw new Error("当前平台不支持微信支付");
  }
}

async function payWithWechatParams(clientPayParams: Record<string, unknown>): Promise<void> {
  assertWechatPayAvailable();
  const { payWithWechat, toWeChatClientPayParams } = await import("../services/payment/wechatPay");
  await payWithWechat(toWeChatClientPayParams(clientPayParams));
}

function formatNullableDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `下次扣款：${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatProviderName(provider: MobileAutoRenewSubscription["provider"]): string {
  return provider === "apple" ? "Apple" : "微信";
}

function hasActiveAutoRenew(autoRenew: MobileAutoRenewSubscription | null): autoRenew is MobileAutoRenewSubscription {
  return Boolean(autoRenew && (autoRenew.status === "active" || autoRenew.status === "billing_retry"));
}

function isWechatUserCancelError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("用户取消微信支付");
}

function formatAutoRenewProviderLabel(): string {
  if (Platform.OS === "ios") return "Apple ";
  if (Platform.OS === "android") return "微信";
  return "";
}

function formatAutoRenewButtonLabel(): string {
  if (Platform.OS === "ios") return "Apple 开通";
  if (Platform.OS === "android") return "微信开通";
  return "开通";
}

function BenefitItem({
  icon,
  title,
  subtitle,
  isLast,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  subtitle: string;
  isLast?: boolean;
}) {
  return (
    <View style={[styles.benefitItem, !isLast && styles.benefitItemBorder]}>
      <View style={styles.benefitIcon}>
        <Ionicons name={icon} size={18} color="#111111" />
      </View>
      <View style={styles.benefitCopy}>
        <Text style={styles.benefitTitle}>{title}</Text>
        <Text style={styles.benefitSubtitle}>{subtitle}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FCFCFD",
  },

  header: {
    height: 56,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    color: "#111111",
    fontSize: 17,
    fontWeight: "500",
  },

  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingBottom: 26,
  },

  heroCard: {
    minHeight: 124,
    paddingHorizontal: 16,
    paddingVertical: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E2FF",
    backgroundColor: "#F8F7FF",
    overflow: "hidden",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  heroTitle: {
    color: "#111111",
    fontSize: 18,
    fontWeight: "500",
  },
  heroCopy: {
    marginTop: 7,
    color: "#44527E",
    fontSize: 13,
    lineHeight: 19,
  },
  heroShape: {
    width: 92,
    alignItems: "center",
    justifyContent: "center",
  },
  heroCircle: {
    position: "absolute",
    top: 14,
    left: 14,
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1.5,
    borderColor: "#6C62FF",
  },
  heroSquare: {
    position: "absolute",
    top: 38,
    left: 42,
    width: 46,
    height: 46,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#6C62FF",
  },

  sectionTitle: {
    marginTop: 18,
    marginBottom: 10,
    color: "#111111",
    fontSize: 15,
    fontWeight: "500",
  },
  benefitCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E5EB",
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
  },
  benefitItem: {
    minHeight: 70,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  benefitItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: "#ECEEF2",
  },
  benefitIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#DDE2EC",
    alignItems: "center",
    justifyContent: "center",
  },
  benefitCopy: {
    flex: 1,
    marginLeft: 14,
  },
  benefitTitle: {
    color: "#111111",
    fontSize: 14,
    fontWeight: "500",
  },
  benefitSubtitle: {
    marginTop: 4,
    color: "#44527E",
    fontSize: 12,
    lineHeight: 17,
  },

  priceCard: {
    marginTop: 16,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E5EB",
    backgroundColor: "#FFFFFF",
  },
  priceHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  priceTitle: {
    color: "#111111",
    fontSize: 15,
    fontWeight: "500",
  },
  expire: {
    color: "#6A7290",
    fontSize: 12,
  },
  priceRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "baseline",
  },
  price: {
    color: "#6E63FF",
    fontSize: 32,
    fontWeight: "500",
  },
  priceUnit: {
    color: "#3E4761",
    fontSize: 15,
  },
  noteBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: "#F5F4FF",
  },
  noteText: {
    color: "#59617B",
    fontSize: 12,
    lineHeight: 18,
  },
  autoRenewBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#DDE2EC",
    backgroundColor: "#FAFBFF",
    flexDirection: "row",
    alignItems: "center",
  },
  autoRenewCopy: {
    flex: 1,
    paddingRight: 12,
  },
  autoRenewTitle: {
    color: "#111111",
    fontSize: 14,
    fontWeight: "500",
  },
  autoRenewText: {
    marginTop: 5,
    color: "#59617B",
    fontSize: 13,
    lineHeight: 18,
  },
  secondaryButton: {
    minWidth: 66,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  secondaryButtonText: {
    color: "#111111",
    fontSize: 13,
    fontWeight: "500",
  },
  subscribeButton: {
    marginTop: 14,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#111111",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  subscribeButtonDisabled: {
    opacity: 0.7,
  },
  subscribeText: {
    color: "#111111",
    fontSize: 15,
    fontWeight: "500",
  },
});
