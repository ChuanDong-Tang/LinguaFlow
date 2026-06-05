import React, { useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Ionicons from "@expo/vector-icons/Ionicons";
import { getAvailablePurchases, restorePurchases as restoreIapPurchases, useIAP, type Purchase } from "expo-iap";
import * as WebBrowser from "expo-web-browser";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  cancelAutoRenewSubscription,
  createWeChatAutoRenewPreSign,
  getProMonthlyProductQuote,
  createProMonthlyOrder,
  getCurrentAutoRenewSubscription,
  registerAppleAppAccountToken,
  verifyAppleProMonthlyTransaction,
  type MobileAutoRenewSubscription,
  type MobileWeChatAutoRenewPreSignResult,
} from "../services/api/paymentApi";
import {
  clearPendingAutoRenewFlow,
  clearPendingPaymentOrder,
  pollPaymentOrderUntilSettled,
  recoverPendingAutoRenewIfAny,
  recoverPendingPaymentIfAny,
  savePendingAutoRenewFlow,
  savePendingPaymentOrder,
} from "../services/payment/paymentRecovery";
import { refreshEntitlementAndSession } from "../services/entitlement/entitlementSync";
import { getCachedEntitlement, isSameEntitlement, setCachedEntitlement } from "../services/entitlement/entitlementCache";
import { getCurrentEntitlement, type CurrentEntitlement } from "../services/api/meApi";
import { getSession, setSession } from "../services/auth/authStorage";
import {
  APPLE_PRO_MONTHLY_ONE_TIME_PRODUCT_ID,
  APPLE_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID,
  type ApplePurchaseSource,
  assertAppleIapAvailable,
  createAppleAppAccountToken,
  getAppleTransactionId,
  getAppleProductIdForSource,
} from "../services/payment/appleIap";
import { useMountedGuard } from "../hooks/useMountedGuard";

type ProScreenProps = { onBack: () => void };
type AppleIapBridgeState = Pick<
  ReturnType<typeof useIAP>,
  "connected" | "fetchProducts" | "finishTransaction" | "products" | "requestPurchase" | "subscriptions"
>;
type AppleIapBridgeProps = {
  onReady: (bridge: AppleIapBridgeState) => void;
  onPurchaseSuccess: (purchase: Purchase) => void;
  onPurchaseError: (error: unknown) => void;
};

const ENABLE_APPLE_ONE_TIME_PURCHASE = process.env.EXPO_PUBLIC_ENABLE_APPLE_ONE_TIME_PURCHASE === "true";
const ENABLE_WECHAT_ONE_TIME_PURCHASE = process.env.EXPO_PUBLIC_ENABLE_WECHAT_ONE_TIME_PURCHASE === "true";
const ENABLE_WECHAT_AUTO_RENEW = process.env.EXPO_PUBLIC_ENABLE_WECHAT_AUTO_RENEW === "true";
const ENABLE_APPLE_AUTO_RENEW = process.env.EXPO_PUBLIC_ENABLE_APPLE_AUTO_RENEW === "true";
const PRODUCT_PRICE_CACHE_KEY = "lf_pro_product_price_v1";
const PRODUCT_PRICE_CACHE_TTL_MS = readPositiveIntEnv(
  process.env.EXPO_PUBLIC_PRO_PRICE_CACHE_TTL_MS,
  24 * 60 * 60 * 1000
);

export function ProScreen({ onBack }: ProScreenProps) {
  const { isMounted: isScreenAlive, safeAlert } = useMountedGuard();
  const [isPaying, setIsPaying] = useState(false);
  const [isRenew, setIsRenew] = useState(false);
  const [proExpiresAt, setProExpiresAt] = useState<string | null>(null);
  const [autoRenew, setAutoRenew] = useState<MobileAutoRenewSubscription | null>(null);
  const [isAutoRenewLoading, setIsAutoRenewLoading] = useState(false);
  const [isApplePurchaseFinishing, setIsApplePurchaseFinishing] = useState(false);
  const [isRestoringApplePurchases, setIsRestoringApplePurchases] = useState(false);
  const [appleIap, setAppleIap] = useState<AppleIapBridgeState | null>(null);
  const [wechatPriceLabel, setWechatPriceLabel] = useState<string | null>(null);
  const [cachedProductPrices, setCachedProductPrices] = useState<ProductPriceLabels | null>(null);
  const [currentEntitlement, setCurrentEntitlement] = useState<CurrentEntitlement | null>(null);
  const activeAutoRenew = hasActiveAutoRenew(autoRenew);
  const liveProductPrices = resolveProMonthlyPriceLabels({ appleIap, wechatPriceLabel });
  const productPrices = liveProductPrices.primary ? liveProductPrices : cachedProductPrices ?? liveProductPrices;
  const quotaBenefit = resolveQuotaBenefit(currentEntitlement);
  const statusLabel = resolveProStatusLabel({
    isPro: isRenew,
    expiresAt: proExpiresAt,
    autoRenew,
  });
  const autoRenewDescription = resolveAutoRenewDescription({
    isPro: isRenew,
    expiresAt: proExpiresAt,
    autoRenew,
  });
  const canStartOneTimePurchase =
    (Platform.OS === "ios" && ENABLE_APPLE_ONE_TIME_PURCHASE) ||
    (Platform.OS === "android" && ENABLE_WECHAT_ONE_TIME_PURCHASE);
  const canStartAutoRenew =
    activeAutoRenew ||
    (Platform.OS === "ios" && ENABLE_APPLE_AUTO_RENEW) ||
    (Platform.OS === "android" && ENABLE_WECHAT_AUTO_RENEW);

  function applyEntitlementToState(entitlement: CurrentEntitlement): void {
    setIsRenew(entitlement.isPro);
    setProExpiresAt(entitlement.expiresAt);
    setCurrentEntitlement(entitlement);
  }

  async function syncSessionProFlag(entitlement: CurrentEntitlement): Promise<void> {
    const session = await getSession();
    if (!session) return;
    await setSession({
      ...session,
      sessionFlags: {
        ...(session.sessionFlags ?? {}),
        isPro: entitlement.isPro,
      },
    });
  }

  async function loadProEntitlementState(): Promise<CurrentEntitlement | null> {
    const cached = await getCachedEntitlement();
    if (cached && isScreenAlive()) {
      applyEntitlementToState(cached.data);
    }

    try {
      const entitlement = await getCurrentEntitlement();
      if (!isScreenAlive()) return entitlement;
      applyEntitlementToState(entitlement);
      if (!cached || !isSameEntitlement(cached.data, entitlement)) {
        await setCachedEntitlement(entitlement);
      }
      await syncSessionProFlag(entitlement);
      return entitlement;
    } catch {
      return cached?.data ?? null;
    }
  }

  async function refreshProEntitlementState(): Promise<Awaited<ReturnType<typeof refreshEntitlementAndSession>> | null> {
    try {
      const result = await refreshEntitlementAndSession();
      if (isScreenAlive()) {
        applyEntitlementToState(result.entitlement);
      }
      return result;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    void (async () => {
      let didRefreshEntitlement = false;
      const cached = await getCachedEntitlement();
      if (cached && isScreenAlive()) {
        applyEntitlementToState(cached.data);
      }

      // 页面打开时先恢复未完成订单，处理用户支付后返回 App 的场景。
      const recovered = await recoverPendingPaymentIfAny();
      if (!isScreenAlive()) return;
      if (recovered.status === "paid") {
        setIsRenew(true);
        await refreshProEntitlementState();
        didRefreshEntitlement = true;
        if (!isScreenAlive()) return;
        safeAlert("开通成功", "Pro 权益已生效。");
      }
      const recoveredAutoRenew = await recoverPendingAutoRenewIfAny();
      if (!isScreenAlive()) return;
      if (recoveredAutoRenew.subscription) {
        setAutoRenew(recoveredAutoRenew.subscription);
      }
      if (recoveredAutoRenew.entitlementIsPro === true) {
        setIsRenew(true);
        await refreshProEntitlementState();
        didRefreshEntitlement = true;
        if (!isScreenAlive()) return;
        safeAlert("开通成功", "Pro 权益已生效。");
      }
      try {
        const currentAutoRenew = await getCurrentAutoRenewSubscription();
        if (!isScreenAlive()) return;
        setAutoRenew(currentAutoRenew);
      } catch {}
      if (!didRefreshEntitlement) {
        await loadProEntitlementState();
      }
    })();
  }, [isScreenAlive, safeAlert]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cached = await loadCachedProductPrices();
      if (!cancelled && cached && isScreenAlive()) {
        setCachedProductPrices(cached);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isScreenAlive]);

  useEffect(() => {
    if (!liveProductPrices.primary) return;
    setCachedProductPrices(liveProductPrices);
    void saveCachedProductPrices(liveProductPrices);
  }, [liveProductPrices.primary, liveProductPrices.primarySuffix, liveProductPrices.oneTime, liveProductPrices.autoRenew]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    let cancelled = false;
    void (async () => {
      try {
        const quote = await getProMonthlyProductQuote();
        if (!cancelled && isScreenAlive()) {
          setWechatPriceLabel(quote.displayPrice);
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [isScreenAlive]);

  async function handleSubscribe(): Promise<void> {
    if (isPaying) return;
    if (!canStartOneTimePurchase) {
      safeAlert("暂未开放", "购买 1 个月暂未开放。");
      return;
    }

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
        const entitlementResult = await refreshProEntitlementState();
        if (!isScreenAlive()) return;
        setIsRenew(entitlementResult?.entitlement.isPro ?? true);
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
      if (!ENABLE_APPLE_AUTO_RENEW) {
        safeAlert("暂未开放", "Apple 自动续费暂未开放。");
        return;
      }
      await startAppleIapPurchase("auto_renew");
      return;
    }

    if (Platform.OS === "android") {
      if (!ENABLE_WECHAT_AUTO_RENEW) {
        safeAlert("暂未开放", "微信自动续费暂未开放。");
        return;
      }
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
      await savePendingAutoRenewFlow({
        autoRenewSubscriptionId: preSign.autoRenewSubscriptionId,
        provider: preSign.provider,
        providerOrderId: preSign.providerOrderId,
      });

      if (preSign.clientPayParams) {
        // App-with-contract：用户支付首期时同时完成微信自动续费签约。
        await payWithWechatParams(preSign.clientPayParams);
      } else {
        await openWechatContractOnlyFlow(preSign.redirectUrl);
      }
      if (!isScreenAlive()) return;

      const currentAutoRenew = await getCurrentAutoRenewSubscription();
      const entitlementResult = await refreshProEntitlementState();
      if (!isScreenAlive()) return;
      setAutoRenew(currentAutoRenew);
      if (entitlementResult?.entitlement.isPro) {
        setIsRenew(true);
        await clearPendingAutoRenewFlow();
        safeAlert("开通成功", "Pro 权益已生效。");
      } else if (currentAutoRenew?.status === "active" || currentAutoRenew?.status === "pending") {
        safeAlert("签约处理中", "自动续费状态已同步，首期权益到账后会自动刷新。");
      }
    } catch (error) {
      if (preSign && isWechatUserCancelError(error)) {
        await cancelAutoRenewSubscription(preSign.autoRenewSubscriptionId).catch(() => { });
        await clearPendingAutoRenewFlow();
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

  async function handleManageAutoRenew(): Promise<void> {
    if (!autoRenew) return;
    if (autoRenew.provider === "apple") {
      // Apple 订阅只能去 Apple ID 订阅管理里取消，服务端不能替用户直接取消平台订阅。
      safeAlert("前往 Apple 管理", "请在 iOS 的 Apple ID 订阅管理中取消自动续费。");
      return;
    }
    setIsAutoRenewLoading(true);
    try {
      const cancelled = await cancelAutoRenewSubscription(autoRenew.id);
      if (!isScreenAlive()) return;
      setAutoRenew((current) =>
        current && current.id === cancelled.id
          ? { ...current, status: cancelled.status, cancelledAt: cancelled.cancelledAt }
          : current
      );
      safeAlert("已取消自动续费", "后续不会再自动扣费，当前 Pro 权益可继续使用至到期。");
    } catch (error) {
      if (!isScreenAlive()) return;
      const message = error instanceof Error ? error.message : "请稍后重试";
      safeAlert("取消失败", message);
    } finally {
      if (isScreenAlive()) setIsAutoRenewLoading(false);
    }
  }

  async function startAppleIapPurchase(source: ApplePurchaseSource): Promise<void> {
    assertAppleIapAvailable(source);
    if (!appleIap?.connected) {
      safeAlert("Apple 支付初始化中", "请稍后重试。");
      return;
    }
    setIsPaying(true);
    setIsAutoRenewLoading(true);
    try {
      // iOS 一次性月卡与自动续费是两个 App Store 商品；真正权益以后端验单结果为准。
      const session = await getSession();
      const appAccountToken = session?.user?.id
        ? await createAppleAppAccountToken(session.user.id)
        : null;
      if (appAccountToken) {
        await registerAppleAppAccountToken(appAccountToken);
      }
      const productId = getAppleProductIdForSource(source);
      await appleIap.requestPurchase({
        type: source === "single_purchase" ? "in-app" : "subs",
        request: {
          apple: {
            sku: productId,
            appAccountToken,
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
      const verified = await verifyAppleProMonthlyTransaction(transactionId);
      if (!appleIap) throw new Error("Apple 支付未初始化");
      const isOneTimePurchase = verified.purchaseKind === "single_purchase";
      await appleIap.finishTransaction({ purchase, isConsumable: false });
      const entitlementResult = await refreshProEntitlementState();
      if (!isScreenAlive()) return;
      setIsRenew(entitlementResult?.entitlement.isPro ?? true);
      if (!isOneTimePurchase) {
        const currentAutoRenew = await getCurrentAutoRenewSubscription();
        if (!isScreenAlive()) return;
        setAutoRenew(currentAutoRenew);
      }
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

  async function handleRestoreApplePurchases(): Promise<void> {
    if (Platform.OS !== "ios") return;
    assertAppleIapAvailable();
    if (!appleIap?.connected) {
      safeAlert("Apple 支付初始化中", "请稍后重试。");
      return;
    }
    if (isRestoringApplePurchases) return;

    setIsRestoringApplePurchases(true);
    try {
      await restoreIapPurchases();
      const purchases = await getAvailablePurchases({ onlyIncludeActiveItemsIOS: true });
      const candidates = purchases
        .filter(isAppleProPurchase)
        .sort((left, right) => Number(right.transactionDate ?? 0) - Number(left.transactionDate ?? 0));

      if (candidates.length === 0) {
        if (!isScreenAlive()) return;
        safeAlert("未找到可恢复购买", "没有找到当前 Apple ID 下可恢复的 Pro 购买。");
        return;
      }

      let lastError: unknown = null;
      for (const purchase of candidates) {
        try {
          const transactionId = getAppleTransactionId(purchase);
          const verified = await verifyAppleProMonthlyTransaction(transactionId);
          await appleIap.finishTransaction({ purchase, isConsumable: false }).catch(() => {});
          const entitlementResult = await refreshProEntitlementState();
          if (!isScreenAlive()) return;
          setIsRenew(entitlementResult?.entitlement.isPro ?? true);
          if (verified.purchaseKind === "auto_renew") {
            const currentAutoRenew = await getCurrentAutoRenewSubscription();
            if (!isScreenAlive()) return;
            setAutoRenew(currentAutoRenew);
          }
          safeAlert("恢复成功", "Pro 权益已同步。");
          return;
        } catch (error) {
          lastError = error;
        }
      }

      const message = lastError instanceof Error ? lastError.message : "请稍后重试";
      safeAlert("恢复购买失败", message);
    } catch (error) {
      if (!isScreenAlive()) return;
      const message = error instanceof Error ? error.message : "请稍后重试";
      safeAlert("恢复购买失败", message);
    } finally {
      if (isScreenAlive()) setIsRestoringApplePurchases(false);
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
        <View style={styles.benefitCard}>
          <BenefitItem icon="text-outline" title={quotaBenefit.title} subtitle={quotaBenefit.subtitle} />
          <BenefitItem icon="leaf-outline" title="支持云端同步" subtitle="适合持续练习和记录" />
        </View>

        <View style={styles.priceCard}>
          <View style={styles.priceHead}>
            <Text style={styles.priceTitle}>Pro 月度</Text>
            {statusLabel ? <Text style={styles.expire}>{statusLabel}</Text> : null}
          </View>
          <View style={styles.priceRow}>
            <Text style={styles.price}>{productPrices.primary ?? "--"}</Text>
            <Text style={styles.priceUnit}>{productPrices.primary ? productPrices.primarySuffix : ""}</Text>
          </View>
          <View style={styles.autoRenewBox}>
            <View style={styles.autoRenewCopy}>
              <Text style={styles.autoRenewTitle}>自动续费</Text>
              <Text style={styles.autoRenewText}>{autoRenewDescription}</Text>
            </View>
          </View>

          <View style={styles.actionRow}>
            <Pressable
              style={[
                styles.subscribeButton,
                styles.actionButton,
                (!canStartOneTimePurchase || isPaying) && styles.subscribeButtonDisabled,
              ]}
              onPress={() => void handleSubscribe()}
              disabled={!canStartOneTimePurchase || isPaying}
            >
              {isPaying ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.subscribeText}>
                  {canStartOneTimePurchase
                    ? formatOneTimePurchaseButtonLabel(isRenew, productPrices.oneTime)
                    : "暂未开放"}
                </Text>
              )}
            </Pressable>
            <Pressable
              style={[
                styles.secondaryButton,
                styles.actionButton,
                (!canStartAutoRenew || isAutoRenewLoading) && styles.subscribeButtonDisabled,
              ]}
              onPress={activeAutoRenew ? () => void handleManageAutoRenew() : () => void handleStartAutoRenew()}
              disabled={!canStartAutoRenew || isAutoRenewLoading}
            >
              {isAutoRenewLoading ? (
                <ActivityIndicator color="#111111" />
              ) : (
                <Text style={styles.secondaryButtonText}>
                  {activeAutoRenew
                    ? "取消自动续费"
                    : canStartAutoRenew
                      ? formatAutoRenewButtonLabel(productPrices.autoRenew)
                      : "暂未开放"}
                </Text>
              )}
            </Pressable>
          </View>
          {Platform.OS === "ios" ? (
            <Pressable
              style={[styles.restoreButton, isRestoringApplePurchases && styles.subscribeButtonDisabled]}
              onPress={() => void handleRestoreApplePurchases()}
              disabled={isRestoringApplePurchases}
            >
              {isRestoringApplePurchases ? (
                <ActivityIndicator color="#111111" />
              ) : (
                <>
                  <Text style={styles.restoreHintText}>已通过 Apple 购买？</Text>
                  <Text style={styles.restoreButtonText}>恢复权益</Text>
                </>
              )}
            </Pressable>
          ) : null}
        </View>

        <View style={styles.ruleCard}>
          <Text style={styles.ruleTitle}>付款与权益规则</Text>
          {PAYMENT_RULES.map((rule) => (
            <View key={rule} style={styles.ruleItem}>
              <View style={styles.ruleDot} />
              <Text style={styles.ruleText}>{rule}</Text>
            </View>
          ))}
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
      products: iap.products,
      requestPurchase: iap.requestPurchase,
      subscriptions: iap.subscriptions,
    });
  }, [
    iap.connected,
    iap.fetchProducts,
    iap.finishTransaction,
    iap.products,
    iap.requestPurchase,
    iap.subscriptions,
    onReady,
  ]);

  useEffect(() => {
    if (!iap.connected) return;
    void iap.fetchProducts({ skus: [APPLE_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID], type: "subs" });
    void iap.fetchProducts({ skus: [getAppleProductIdForSource("single_purchase")], type: "in-app" });
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

function resolveAutoRenewDescription(input: {
  isPro: boolean;
  expiresAt: string | null;
  autoRenew: MobileAutoRenewSubscription | null;
}): string {
  if (input.autoRenew?.status === "pending") {
    return "签约处理中，如未完成可稍后重试。";
  }
  if (hasActiveAutoRenew(input.autoRenew)) {
    return `已通过${formatProviderName(input.autoRenew.provider)}开启，${
      formatNullableDate(input.autoRenew.nextBillingAt) || "下次扣款时间待同步"
    }`;
  }
  if (input.isPro && input.expiresAt) {
    return `${formatAutoRenewProviderLabel()}自动续费会在当前会员到期后接续，不会立即重复扣费。`;
  }
  return `${formatAutoRenewProviderLabel()}自动续费会先完成首期支付，之后按月自动续费，可随时管理。`;
}

function resolveProStatusLabel(input: {
  isPro: boolean;
  expiresAt: string | null;
  autoRenew: MobileAutoRenewSubscription | null;
}): string | null {
  if (hasActiveAutoRenew(input.autoRenew)) {
    return formatNullableDate(input.autoRenew.nextBillingAt) || "下次扣费待同步";
  }
  if (input.isPro && input.expiresAt) {
    return `有效期至：${formatDate(input.expiresAt)}`;
  }
  return null;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatProviderName(provider: MobileAutoRenewSubscription["provider"]): string {
  return provider === "apple" ? "Apple" : "微信";
}

function readPositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function resolveQuotaBenefit(entitlement: CurrentEntitlement | null): { title: string; subtitle: string } {
  if (!entitlement) {
    return {
      title: "正在同步额度",
      subtitle: "获取后显示当前权益",
    };
  }

  if (entitlement.isPro) {
    return {
      title: `每日 ${formatNumber(entitlement.dailyTotalLimit)} 字额度`,
      subtitle: entitlement.expiresAt ? `Pro 权益有效期至 ${formatDate(entitlement.expiresAt)}` : "Pro 权益已生效",
    };
  }

  const validUntil = entitlement.validUntil ? `，有效期至 ${formatDate(entitlement.validUntil)}` : "";
  return {
    title: `普通版 ${formatNumber(entitlement.dailyTotalLimit)} 体验字符`,
    subtitle: `剩余 ${formatNumber(entitlement.remainingChars)} 字${validUntil}`,
  };
}

type ProductPriceLabels = {
  primary: string | null;
  primarySuffix: string;
  oneTime: string | null;
  autoRenew: string | null;
};

type CachedProductPriceLabels = ProductPriceLabels & {
  platform: typeof Platform.OS;
  cachedAt: number;
};

async function loadCachedProductPrices(): Promise<ProductPriceLabels | null> {
  const raw = await AsyncStorage.getItem(PRODUCT_PRICE_CACHE_KEY);
  if (!raw) return null;

  try {
    const cached = JSON.parse(raw) as Partial<CachedProductPriceLabels>;
    const isFresh = typeof cached.cachedAt === "number" && Date.now() - cached.cachedAt <= PRODUCT_PRICE_CACHE_TTL_MS;
    if (!isFresh || cached.platform !== Platform.OS || typeof cached.primary !== "string" || !cached.primary) {
      return null;
    }
    return {
      primary: cached.primary,
      primarySuffix: typeof cached.primarySuffix === "string" ? cached.primarySuffix : "",
      oneTime: typeof cached.oneTime === "string" ? cached.oneTime : null,
      autoRenew: typeof cached.autoRenew === "string" ? cached.autoRenew : null,
    };
  } catch {
    await AsyncStorage.removeItem(PRODUCT_PRICE_CACHE_KEY);
    return null;
  }
}

async function saveCachedProductPrices(prices: ProductPriceLabels): Promise<void> {
  if (!prices.primary) return;
  const cached: CachedProductPriceLabels = {
    ...prices,
    platform: Platform.OS,
    cachedAt: Date.now(),
  };
  await AsyncStorage.setItem(PRODUCT_PRICE_CACHE_KEY, JSON.stringify(cached));
}

function resolveProMonthlyPriceLabels(input: {
  appleIap: AppleIapBridgeState | null;
  wechatPriceLabel: string | null;
}): ProductPriceLabels {
  if (Platform.OS === "ios") {
    const subscriptionPrice = input.appleIap?.subscriptions.find(
      (product) => product.id === APPLE_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID
    )?.displayPrice;
    const oneTimePrice = input.appleIap?.products.find(
      (product) => product.id === getAppleProductIdForSource("single_purchase")
    )?.displayPrice;
    const primary = subscriptionPrice || oneTimePrice || null;
    return {
      primary,
      primarySuffix: primary ? " / 月起" : "",
      oneTime: oneTimePrice ?? null,
      autoRenew: subscriptionPrice ?? null,
    };
  }

  if (Platform.OS === "android") {
    const price = input.wechatPriceLabel;
    return {
      primary: price,
      primarySuffix: price ? " / 月" : "",
      oneTime: price,
      autoRenew: price,
    };
  }

  return {
    primary: null,
    primarySuffix: "",
    oneTime: null,
    autoRenew: null,
  };
}

function formatOneTimePurchaseButtonLabel(isRenew: boolean, price: string | null): string {
  const action = isRenew ? "仅续费" : "仅购买";
  return price ? `${action} ${price}` : `${action} 1 个月`;
}

function hasActiveAutoRenew(autoRenew: MobileAutoRenewSubscription | null): autoRenew is MobileAutoRenewSubscription {
  return Boolean(autoRenew && (autoRenew.status === "active" || autoRenew.status === "billing_retry"));
}

function isAppleProPurchase(purchase: Purchase): boolean {
  return (
    purchase.productId === APPLE_PRO_MONTHLY_ONE_TIME_PRODUCT_ID ||
    purchase.productId === APPLE_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID
  );
}

function isWechatUserCancelError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("用户取消微信支付");
}

function formatAutoRenewProviderLabel(): string {
  if (Platform.OS === "ios") return "Apple ";
  if (Platform.OS === "android") return "微信";
  return "";
}

function formatAutoRenewButtonLabel(price: string | null = null): string {
  const suffix = price ? ` ${price}/月` : "";
  if (Platform.OS === "ios") return `Apple 开通${suffix}`;
  if (Platform.OS === "android") return `微信开通${suffix}`;
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

const PAYMENT_RULES = [
  "随着网页版、语音合成等新功能加入，Pro 价格可能会随服务内容调整。",
  "Pro 有效期统一累计，单买和订阅都接在同一条时间线上。",
  "单月购买每次只加 1 个月，最多预存到约 2 个月后。",
  "已有 Pro 开通订阅不会立即重复扣费，到期后自动接续。",
  "订阅中单买 1 个月，会同步推迟下一次扣费。",
  "价格或权益调整后，在后续购买或自动续费时生效。",
  "取消订阅只停止后续扣款，当前权益保留至到期。",
  "用户取消自动续费后，当前 Pro 权益保留至到期；到期前不允许重新签约自动续费，到期后可重新开通。",
];

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FCFCFD",
  },

  header: {
    height: 48,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    color: "#111111",
    fontSize: 16,
    fontWeight: "500",
  },

  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingBottom: 16,
  },

  heroCard: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E5E2FF",
    backgroundColor: "#F8F7FF",
  },
  heroTitle: {
    color: "#111111",
    fontSize: 15,
    fontWeight: "500",
  },
  heroCopy: {
    marginTop: 4,
    color: "#44527E",
    fontSize: 12,
    lineHeight: 17,
  },

  benefitCard: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E2E5EB",
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
  },
  benefitItem: {
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  benefitItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: "#ECEEF2",
  },
  benefitIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#DDE2EC",
    alignItems: "center",
    justifyContent: "center",
  },
  benefitCopy: {
    flex: 1,
    marginLeft: 10,
  },
  benefitTitle: {
    color: "#111111",
    fontSize: 13,
    fontWeight: "500",
  },
  benefitSubtitle: {
    marginTop: 2,
    color: "#44527E",
    fontSize: 11,
    lineHeight: 15,
  },

  priceCard: {
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
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
    fontSize: 14,
    fontWeight: "500",
  },
  expire: {
    color: "#6A7290",
    fontSize: 11,
  },
  priceRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "baseline",
  },
  price: {
    color: "#6E63FF",
    fontSize: 26,
    fontWeight: "500",
  },
  priceUnit: {
    color: "#3E4761",
    fontSize: 13,
  },
  autoRenewBox: {
    marginTop: 8,
    padding: 9,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#DDE2EC",
    backgroundColor: "#FAFBFF",
    flexDirection: "row",
    alignItems: "center",
  },
  autoRenewCopy: {
    flex: 1,
  },
  autoRenewTitle: {
    color: "#111111",
    fontSize: 12,
    fontWeight: "500",
  },
  autoRenewText: {
    marginTop: 3,
    color: "#59617B",
    fontSize: 11,
    lineHeight: 16,
  },
  secondaryButton: {
    minHeight: 38,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  secondaryButtonText: {
    color: "#111111",
    fontSize: 12,
    fontWeight: "500",
    textAlign: "center",
  },
  subscribeButton: {
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#111111",
    backgroundColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
  },
  subscribeButtonDisabled: {
    opacity: 0.7,
  },
  subscribeText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
  },
  actionRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 10,
  },
  actionButton: {
    flex: 1,
  },
  restoreButton: {
    marginTop: 8,
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  restoreHintText: {
    color: "#6A7290",
    fontSize: 11,
    fontWeight: "400",
  },
  restoreButtonText: {
    color: "#111111",
    fontSize: 11,
    fontWeight: "500",
    textDecorationLine: "underline",
  },
  ruleCard: {
    marginTop: 8,
    paddingHorizontal: 2,
    paddingBottom: 2,
  },
  ruleTitle: {
    color: "#111111",
    fontSize: 12,
    fontWeight: "500",
    marginBottom: 4,
  },
  ruleItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 4,
  },
  ruleDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 6,
    marginRight: 6,
    backgroundColor: "#6E63FF",
  },
  ruleText: {
    flex: 1,
    color: "#59617B",
    fontSize: 10,
    lineHeight: 14,
  },
});
