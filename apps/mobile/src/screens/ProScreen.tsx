import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  ErrorCode,
  getAvailablePurchases,
  presentCodeRedemptionSheetIOS,
  restorePurchases as restoreIapPurchases,
  useIAP,
  type Purchase,
} from "expo-iap";
import * as WebBrowser from "expo-web-browser";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  cancelAutoRenewSubscription,
  createWeChatAutoRenewPreSign,
  getProMonthlyProductQuote,
  createProMonthlyOrder,
  getCurrentAutoRenewSubscription,
  MobileApiError,
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
import { getCachedEntitlementForUser, isSameEntitlement, setCachedEntitlement } from "../services/entitlement/entitlementCache";
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
import { environmentStorageKey } from "../services/storage/environmentStorageKey";
import { t, tf } from "../i18n";

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
const PRODUCT_PRICE_CACHE_KEY = environmentStorageKey("lf_pro_product_price_v1");
const AUTO_RENEW_CACHE_KEY = environmentStorageKey("lf_current_auto_renew_v1");
const PRODUCT_PRICE_CACHE_TTL_MS = readPositiveIntEnv(
  process.env.EXPO_PUBLIC_PRO_PRICE_CACHE_TTL_MS,
  24 * 60 * 60 * 1000
);
const AUTO_RENEW_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const APPLE_PURCHASE_TIMEOUT_MS = 120 * 1000;

export function ProScreen({ onBack }: ProScreenProps) {
  const { isMounted: isScreenAlive, safeAlert } = useMountedGuard();
  const [isPaying, setIsPaying] = useState(false);
  const [isRenew, setIsRenew] = useState(false);
  const [proExpiresAt, setProExpiresAt] = useState<string | null>(null);
  const [autoRenew, setAutoRenew] = useState<MobileAutoRenewSubscription | null>(null);
  const [isAutoRenewLoading, setIsAutoRenewLoading] = useState(false);
  const [hasLoadedAutoRenew, setHasLoadedAutoRenew] = useState(false);
  const [isApplePurchaseFinishing, setIsApplePurchaseFinishing] = useState(false);
  const [isRestoringApplePurchases, setIsRestoringApplePurchases] = useState(false);
  const [isRedeemingAppleOffer, setIsRedeemingAppleOffer] = useState(false);
  const [appleIap, setAppleIap] = useState<AppleIapBridgeState | null>(null);
  const [wechatPriceLabel, setWechatPriceLabel] = useState<string | null>(null);
  const [cachedProductPrices, setCachedProductPrices] = useState<ProductPriceLabels | null>(null);
  const [currentEntitlement, setCurrentEntitlement] = useState<CurrentEntitlement | null>(null);
  const applePurchaseIntentRef = useRef(false);
  const applePurchaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appleAppAccountTokenRef = useRef<string | null>(null);
  const appleAppAccountTokenPromiseRef = useRef<Promise<string | null> | null>(null);
  const activeAutoRenew = hasActiveAutoRenew(autoRenew);
  const manageableAutoRenew = isRenew && activeAutoRenew;
  const liveProductPrices = resolveProMonthlyPriceLabels({ appleIap, wechatPriceLabel });
  const productPrices = liveProductPrices.primary ? liveProductPrices : cachedProductPrices ?? liveProductPrices;
  const quotaBenefit = resolveQuotaBenefit(currentEntitlement);
  const membershipStatusLabel = resolveMembershipStatusLabel({
    isPro: isRenew,
    expiresAt: proExpiresAt,
  });
  const autoRenewDescription = resolveAutoRenewDescription({
    isPro: isRenew,
    expiresAt: proExpiresAt,
    autoRenew,
    hasLoadedAutoRenew,
  });
  const shouldShowAutoRenewInfo = !isRenew || Boolean(autoRenew);
  const canStartOneTimePurchase =
    (Platform.OS === "ios" && ENABLE_APPLE_ONE_TIME_PURCHASE) ||
    (Platform.OS === "android" && ENABLE_WECHAT_ONE_TIME_PURCHASE);
  const canStartAutoRenew =
    !isRenew &&
    hasLoadedAutoRenew &&
    ((Platform.OS === "ios" && ENABLE_APPLE_AUTO_RENEW) ||
      (Platform.OS === "android" && ENABLE_WECHAT_AUTO_RENEW));
  const shouldShowPurchaseActions = !isRenew || manageableAutoRenew;
  const shouldReservePurchaseActionSpace = shouldShowPurchaseActions || (isRenew && !hasLoadedAutoRenew);

  function applyEntitlementToState(entitlement: CurrentEntitlement): void {
    setIsRenew(entitlement.isPro);
    setProExpiresAt(entitlement.expiresAt);
    setCurrentEntitlement(entitlement);
  }

  function applyAutoRenewToState(subscription: MobileAutoRenewSubscription | null): void {
    setAutoRenew(subscription);
    void saveCachedAutoRenewSubscriptionForCurrentUser(subscription);
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
    const session = await getSession();
    const cached = session?.user.id ? await getCachedEntitlementForUser(session.user.id) : null;
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

  async function ensureAppleAppAccountTokenRegistered(): Promise<string | null> {
    if (Platform.OS !== "ios") return null;
    if (appleAppAccountTokenRef.current) return appleAppAccountTokenRef.current;
    if (appleAppAccountTokenPromiseRef.current) return appleAppAccountTokenPromiseRef.current;

    const promise = (async () => {
      const session = await getSession();
      const appAccountToken = session?.user?.id
        ? await createAppleAppAccountToken(session.user.id)
        : null;
      if (appAccountToken) {
        await registerAppleAppAccountToken(appAccountToken);
        appleAppAccountTokenRef.current = appAccountToken;
      }
      return appAccountToken;
    })();
    appleAppAccountTokenPromiseRef.current = promise;
    try {
      return await promise;
    } catch (error) {
      appleAppAccountTokenPromiseRef.current = null;
      throw error;
    }
  }

  function clearApplePurchaseTimeout(): void {
    if (!applePurchaseTimeoutRef.current) return;
    clearTimeout(applePurchaseTimeoutRef.current);
    applePurchaseTimeoutRef.current = null;
  }

  function startApplePurchaseTimeout(): void {
    clearApplePurchaseTimeout();
    applePurchaseTimeoutRef.current = setTimeout(() => {
      applePurchaseTimeoutRef.current = null;
      if (!isScreenAlive()) return;
      applePurchaseIntentRef.current = false;
      setIsPaying(false);
      setIsAutoRenewLoading(false);
      safeAlert(t("pro.alert.apple_unfinished_title"), t("pro.alert.apple_unfinished_message"));
    }, APPLE_PURCHASE_TIMEOUT_MS);
  }

  useEffect(() => {
    return () => {
      clearApplePurchaseTimeout();
    };
  }, []);

  useEffect(() => {
    void (async () => {
      let didRefreshEntitlement = false;
      const session = await getSession();
      const cached = session?.user.id ? await getCachedEntitlementForUser(session.user.id) : null;
      if (cached && isScreenAlive()) {
        applyEntitlementToState(cached.data);
      }
      const cachedAutoRenew = session?.user.id ? await loadCachedAutoRenewSubscription(session.user.id) : null;
      if (cachedAutoRenew && isScreenAlive()) {
        setAutoRenew(cachedAutoRenew);
      }

      // 页面打开时先恢复未完成订单，处理用户支付后返回 App 的场景。
      const recovered = await recoverPendingPaymentIfAny();
      if (!isScreenAlive()) return;
      if (recovered.status === "paid") {
        setIsRenew(true);
        await refreshProEntitlementState();
        didRefreshEntitlement = true;
        if (!isScreenAlive()) return;
        safeAlert(t("pro.alert.open_success_title"), t("pro.alert.open_success_message"));
      }
      const recoveredAutoRenew = await recoverPendingAutoRenewIfAny();
      if (!isScreenAlive()) return;
      if (recoveredAutoRenew.subscription) {
        applyAutoRenewToState(recoveredAutoRenew.subscription);
      }
      if (recoveredAutoRenew.entitlementIsPro === true) {
        setIsRenew(true);
        await refreshProEntitlementState();
        didRefreshEntitlement = true;
        if (!isScreenAlive()) return;
        safeAlert(t("pro.alert.open_success_title"), t("pro.alert.open_success_message"));
      }
      try {
        const currentAutoRenew = await getCurrentAutoRenewSubscription();
        if (!isScreenAlive()) return;
        applyAutoRenewToState(currentAutoRenew);
      } catch {
      } finally {
        if (isScreenAlive()) setHasLoadedAutoRenew(true);
      }
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

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    void ensureAppleAppAccountTokenRegistered().catch(() => { });
  }, []);

  async function handleSubscribe(): Promise<void> {
    if (isPaying) return;
    if (isRenew) {
      safeAlert(t("pro.alert.pro_active_title"), t("pro.alert.pro_active_buy_later"));
      return;
    }
    if (!canStartOneTimePurchase) {
      safeAlert(t("pro.not_open"), t("pro.alert.one_time_not_open"));
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

    safeAlert(t("pro.alert.unsupported_title"), t("pro.alert.unsupported_purchase"));
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
        safeAlert(t("pro.alert.open_success_title"), t("pro.alert.open_success_message"));
        return;
      }
      if (settled.status === "pending") {
        safeAlert(t("pro.alert.payment_processing_title"), t("pro.alert.payment_processing_message"));
        return;
      }
      await clearPendingPaymentOrder();
      if (!isScreenAlive()) return;
      safeAlert(t("pro.alert.payment_unfinished_title"), tf("pro.alert.payment_status", { status: settled.status }));
    } catch (error) {
      if (!isScreenAlive()) return;
      const message = error instanceof Error ? error.message : t("app.delete.retry_later");
      safeAlert(t("pro.alert.payment_start_failed"), message);
    } finally {
      if (isScreenAlive()) setIsPaying(false);
    }
  }

  async function handleStartAutoRenew(): Promise<void> {
    if (isAutoRenewLoading) return;
    if (isRenew) {
      safeAlert(t("pro.alert.pro_active_title"), t("pro.alert.pro_active_subscribe_later"));
      return;
    }

    if (hasActiveAutoRenew(autoRenew)) {
      safeAlert(t("pro.alert.auto_active_title"), tf("pro.alert.auto_active_message", { provider: formatProviderName(autoRenew.provider) }));
      return;
    }

    if (Platform.OS === "ios") {
      if (!ENABLE_APPLE_AUTO_RENEW) {
        safeAlert(t("pro.not_open"), t("pro.alert.apple_auto_not_open"));
        return;
      }
      await startAppleIapPurchase("auto_renew");
      return;
    }

    if (Platform.OS === "android") {
      if (!ENABLE_WECHAT_AUTO_RENEW) {
        safeAlert(t("pro.not_open"), t("pro.alert.wechat_auto_not_open"));
        return;
      }
      await startWechatAutoRenew();
      return;
    }

    safeAlert(t("pro.alert.unsupported_title"), t("pro.alert.unsupported_auto"));
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
      applyAutoRenewToState(currentAutoRenew);
      if (entitlementResult?.entitlement.isPro) {
        setIsRenew(true);
        await clearPendingAutoRenewFlow();
        safeAlert(t("pro.alert.open_success_title"), t("pro.alert.open_success_message"));
      } else if (currentAutoRenew?.status === "active" || currentAutoRenew?.status === "pending") {
        safeAlert(t("pro.alert.contract_processing_title"), t("pro.alert.contract_processing_message"));
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
    safeAlert(t("pro.alert.contract_processing_title"), t("pro.alert.contract_pending_only"));
  }

  async function handleManageAutoRenew(): Promise<void> {
    if (!autoRenew) return;
    if (autoRenew.provider === "apple") {
      // Apple 订阅只能去 Apple ID 订阅管理里取消，服务端不能替用户直接取消平台订阅。
      safeAlert(t("pro.alert.apple_manage_title"), t("pro.alert.apple_manage_message"));
      return;
    }
    setIsAutoRenewLoading(true);
    try {
      const cancelled = await cancelAutoRenewSubscription(autoRenew.id);
      if (!isScreenAlive()) return;
      applyAutoRenewToState(
        autoRenew.id === cancelled.id
          ? { ...autoRenew, status: cancelled.status, cancelledAt: cancelled.cancelledAt }
          : autoRenew
      );
      safeAlert(t("pro.alert.auto_cancelled_title"), t("pro.alert.auto_cancelled_message"));
    } catch (error) {
      if (!isScreenAlive()) return;
      const message = error instanceof Error ? error.message : t("app.delete.retry_later");
      safeAlert(t("pro.alert.cancel_failed_title"), message);
    } finally {
      if (isScreenAlive()) setIsAutoRenewLoading(false);
    }
  }

  async function startAppleIapPurchase(source: ApplePurchaseSource): Promise<void> {
    assertAppleIapAvailable(source);
    if (!appleIap?.connected) {
      safeAlert(t("pro.alert.apple_init_title"), t("app.delete.retry_later"));
      return;
    }
    const productId = getAppleProductIdForSource(source);
    if (!hasLoadedAppleProduct(appleIap, source, productId)) {
      safeAlert(t("pro.alert.apple_product_loading_title"), t("pro.alert.apple_product_loading_message"));
      return;
    }
    setIsPaying(true);
    setIsAutoRenewLoading(true);
    try {
      const latestEntitlement = await refreshProEntitlementState();
      if (!isScreenAlive()) return;
      if (latestEntitlement?.entitlement.isPro) {
        setIsRenew(true);
        safeAlert(t("pro.alert.pro_active_title"), t("pro.alert.pro_active_buy_later"));
        setIsPaying(false);
        setIsAutoRenewLoading(false);
        return;
      }
      // iOS 一次性月卡与自动续费是两个 App Store 商品；真正权益以后端验单结果为准。
      const appAccountToken = await ensureAppleAppAccountTokenRegistered();
      if (source === "auto_renew") {
        const handledExistingSubscription = await handleExistingAppleSubscriptionBeforePurchase(productId);
        if (handledExistingSubscription) {
          setIsPaying(false);
          setIsAutoRenewLoading(false);
          return;
        }
      }
      applePurchaseIntentRef.current = true;
      startApplePurchaseTimeout();
      const purchaseResult = await appleIap.requestPurchase({
        type: source === "single_purchase" ? "in-app" : "subs",
        request: {
          apple: {
            sku: productId,
            appAccountToken,
            andDangerouslyFinishTransactionAutomatically: false,
          },
        },
      });
      if (isEmptyApplePurchaseResult(purchaseResult)) {
        clearApplePurchaseTimeout();
        applePurchaseIntentRef.current = false;
        if (!isScreenAlive()) return;
        setIsPaying(false);
        setIsAutoRenewLoading(false);
      }
    } catch (error) {
      clearApplePurchaseTimeout();
      applePurchaseIntentRef.current = false;
      if (!isScreenAlive()) return;
      if (isAppleUserCancelledPurchase(error)) {
        setIsPaying(false);
        setIsAutoRenewLoading(false);
        return;
      }
      if (isAppleInactiveSubscriptionTransactionError(error)) {
        safeAlert(t("pro.alert.apple_payment_error_title"), t("pro.alert.apple_retry_subscription"));
        setIsPaying(false);
        setIsAutoRenewLoading(false);
        return;
      }
      const message = error instanceof Error ? error.message : t("app.delete.retry_later");
      safeAlert(t("pro.alert.apple_payment_start_failed"), message);
      setIsPaying(false);
      setIsAutoRenewLoading(false);
    }
  }

  async function handleExistingAppleSubscriptionBeforePurchase(productId: string): Promise<boolean> {
    const purchases = await getAvailablePurchases({ onlyIncludeActiveItemsIOS: true });
    const existingSubscription = purchases
      .filter((purchase) => purchase.productId === productId)
      .sort((left, right) => Number(right.transactionDate ?? 0) - Number(left.transactionDate ?? 0))[0];
    if (!existingSubscription) return false;

    try {
      const transactionId = getAppleTransactionId(existingSubscription);
      const verified = await verifyAppleProMonthlyTransaction(transactionId);
      const entitlementResult = await refreshProEntitlementState();
      if (!isScreenAlive()) return true;
      setIsRenew(entitlementResult?.entitlement.isPro ?? true);
      if (verified.purchaseKind === "auto_renew") {
        const currentAutoRenew = await getCurrentAutoRenewSubscription();
        if (!isScreenAlive()) return true;
        applyAutoRenewToState(currentAutoRenew);
      }
      safeAlert(t("pro.alert.open_success_title"), t("pro.alert.open_success_message"));
      return true;
    } catch (error) {
      if (!isScreenAlive()) return true;
      if (isAppleTransactionOwnedByDifferentAccount(error)) {
        safeAlert(t("pro.alert.apple_bound_title"), t("pro.alert.apple_bound_message"));
        return true;
      }
      safeAlert(t("pro.alert.apple_verify_failed"), formatApplePaymentErrorMessage(error));
      return true;
    }
  }

  async function handleApplePurchaseSuccess(purchase: Purchase): Promise<void> {
    if (isApplePurchaseFinishing) return;
    clearApplePurchaseTimeout();
    setIsApplePurchaseFinishing(true);
    const isUserInitiatedPurchase = applePurchaseIntentRef.current;
    applePurchaseIntentRef.current = false;
    try {
      const transactionId = getAppleTransactionId(purchase);
      // 先让服务端用 App Store Server API 验单并发权益，再 finish transaction。
      const verified = await verifyAppleProMonthlyTransaction(transactionId);
      if (!appleIap) throw new Error(t("pro.alert.apple_not_initialized"));
      const isOneTimePurchase = verified.purchaseKind === "single_purchase";
      await appleIap.finishTransaction({
        purchase,
        isConsumable: purchase.productId === APPLE_PRO_MONTHLY_ONE_TIME_PRODUCT_ID,
      });
      const entitlementResult = await refreshProEntitlementState();
      if (!isScreenAlive()) return;
      setIsRenew(entitlementResult?.entitlement.isPro ?? true);
      if (!isOneTimePurchase) {
        const currentAutoRenew = await getCurrentAutoRenewSubscription();
        if (!isScreenAlive()) return;
        applyAutoRenewToState(currentAutoRenew);
      }
      if (isUserInitiatedPurchase) {
        safeAlert(t("pro.alert.open_success_title"), t("pro.alert.open_success_message"));
      }
    } catch (error) {
      if (!isScreenAlive()) return;
      if (isAppleTransactionOwnedByDifferentAccount(error)) {
        if (purchase.productId === APPLE_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID) {
          await appleIap?.finishTransaction({
            purchase,
            isConsumable: false,
          }).catch(() => { });
        }
        if (isUserInitiatedPurchase) {
          safeAlert(t("pro.alert.apple_bound_title"), t("pro.alert.apple_bound_message"));
        }
        return;
      }
      if (isUserInitiatedPurchase) {
        safeAlert(t("pro.alert.apple_verify_failed"), formatApplePaymentErrorMessage(error));
      }
    } finally {
      if (isScreenAlive()) {
        setIsApplePurchaseFinishing(false);
        setIsPaying(false);
        setIsAutoRenewLoading(false);
      }
    }
  }

  async function handleRestoreApplePurchases(options?: { silentFailure?: boolean }): Promise<void> {
    const silentFailure = options?.silentFailure ?? false;
    if (Platform.OS !== "ios") return;
    assertAppleIapAvailable();
    if (!appleIap?.connected) {
      if (!silentFailure) {
        safeAlert(t("pro.alert.apple_init_title"), t("app.delete.retry_later"));
      }
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
        if (!silentFailure) {
          safeAlert(t("pro.alert.restore_not_found_title"), t("pro.alert.restore_not_found_message"));
        }
        return;
      }

      let lastError: unknown = null;
      for (const purchase of candidates) {
        try {
          const transactionId = getAppleTransactionId(purchase);
          const verified = await verifyAppleProMonthlyTransaction(transactionId);
          await appleIap.finishTransaction({
            purchase,
            isConsumable: purchase.productId === APPLE_PRO_MONTHLY_ONE_TIME_PRODUCT_ID,
          }).catch(() => { });
          const entitlementResult = await refreshProEntitlementState();
          if (!isScreenAlive()) return;
          setIsRenew(entitlementResult?.entitlement.isPro ?? true);
          if (verified.purchaseKind === "auto_renew") {
            const currentAutoRenew = await getCurrentAutoRenewSubscription();
            if (!isScreenAlive()) return;
            applyAutoRenewToState(currentAutoRenew);
          }
          if (!silentFailure) {
            safeAlert(t("pro.alert.restore_success_title"), t("pro.alert.restore_success_message"));
          }
          return;
        } catch (error) {
          lastError = error;
        }
      }

      if (isAppleTransactionOwnedByDifferentAccount(lastError)) {
        if (!silentFailure) {
          safeAlert(t("pro.alert.restore_failed_title"), t("pro.alert.restore_wrong_account"));
        }
        return;
      }
      if (!silentFailure) {
        safeAlert(t("pro.alert.restore_failed_title"), formatApplePaymentErrorMessage(lastError));
      }
    } catch (error) {
      if (!isScreenAlive()) return;
      if (silentFailure) return;
      const message = error instanceof Error ? error.message : t("app.delete.retry_later");
      safeAlert(t("pro.alert.restore_failed_title"), message);
    } finally {
      if (isScreenAlive()) setIsRestoringApplePurchases(false);
    }
  }

  async function handleRedeemAppleOfferCode(): Promise<void> {
    if (Platform.OS !== "ios") return;
    if (isRedeemingAppleOffer || isRestoringApplePurchases || isPaying || isAutoRenewLoading) return;

    setIsRedeemingAppleOffer(true);
    try {
      await ensureAppleAppAccountTokenRegistered();
      const presented = await presentCodeRedemptionSheetIOS();
      if (!presented || !isScreenAlive()) return;
      await handleRestoreApplePurchases({ silentFailure: true });
    } catch (error) {
      if (!isScreenAlive()) return;
      const message = error instanceof Error ? error.message : t("app.delete.retry_later");
      safeAlert(t("pro.alert.redeem_failed_title"), message);
    } finally {
      if (isScreenAlive()) setIsRedeemingAppleOffer(false);
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
            clearApplePurchaseTimeout();
            const isUserInitiatedPurchase = applePurchaseIntentRef.current;
            applePurchaseIntentRef.current = false;
            if (isAppleUserCancelledPurchase(error)) {
              setIsPaying(false);
              setIsAutoRenewLoading(false);
              return;
            }
            if (isUserInitiatedPurchase) {
              safeAlert(t("pro.alert.apple_payment_failed"), formatApplePaymentErrorMessage(error, t("pro.alert.apple_payment_failed")));
            }
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
          <BenefitItem icon="leaf-outline" title={t("pro.cloud_sync.title")} subtitle={t("pro.cloud_sync.subtitle")} />
          <BenefitItem icon="volume-medium-outline" title={t("pro.tts.title")} subtitle={t("pro.tts.subtitle")} />
        </View>

        <View style={styles.priceCard}>
          <View style={styles.priceHead}>
            <Text style={styles.priceTitle}>{t("pro.monthly")}</Text>
          </View>
          <View style={styles.priceRow}>
            <Text style={styles.price}>{productPrices.primary ?? "--"}</Text>
            <Text style={styles.priceUnit}>{productPrices.primary ? productPrices.primarySuffix : ""}</Text>
          </View>
          <View style={styles.autoRenewBox}>
            <View style={styles.autoRenewCopy}>
              {membershipStatusLabel ? <Text style={styles.membershipStatus}>{membershipStatusLabel}</Text> : null}
              {shouldShowAutoRenewInfo ? (
                <>
                  <Text style={styles.autoRenewTitle}>{t("pro.auto_renew")}</Text>
                  <Text style={styles.autoRenewText}>{autoRenewDescription}</Text>
                </>
              ) : null}
            </View>
          </View>

          {shouldReservePurchaseActionSpace ? (
            <View style={[styles.actionSlot, !shouldShowPurchaseActions && styles.actionSlotReserved]}>
              {shouldShowPurchaseActions ? (
                <View style={styles.actionRow}>
                  <Pressable
                    style={[
                      styles.secondaryButton,
                      styles.actionButton,
                      ((!canStartAutoRenew && !manageableAutoRenew) || isAutoRenewLoading || !hasLoadedAutoRenew) &&
                        styles.subscribeButtonDisabled,
                    ]}
                    onPress={manageableAutoRenew ? () => void handleManageAutoRenew() : () => void handleStartAutoRenew()}
                    disabled={(!canStartAutoRenew && !manageableAutoRenew) || isAutoRenewLoading || !hasLoadedAutoRenew}
                  >
                    {isAutoRenewLoading || !hasLoadedAutoRenew ? (
                      <ActivityIndicator color="#111111" />
                    ) : (
                      <Text style={styles.secondaryButtonText}>
                        {manageableAutoRenew
                          ? formatAutoRenewCancelButtonLabel(autoRenew.provider)
                          : canStartAutoRenew
                            ? formatAutoRenewButtonLabel()
                            : t("pro.not_open")}
                      </Text>
                    )}
                  </Pressable>
                  {!manageableAutoRenew ? (
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
                          {canStartOneTimePurchase ? formatOneTimePurchaseButtonLabel() : t("pro.not_open")}
                        </Text>
                      )}
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              {Platform.OS === "ios" && shouldShowPurchaseActions && !manageableAutoRenew ? (
                <Pressable
                  style={[
                    styles.redeemButton,
                    (isRedeemingAppleOffer || isRestoringApplePurchases || isPaying || isAutoRenewLoading) &&
                      styles.subscribeButtonDisabled,
                  ]}
                  onPress={() => void handleRedeemAppleOfferCode()}
                  disabled={isRedeemingAppleOffer || isRestoringApplePurchases || isPaying || isAutoRenewLoading}
                >
                  {isRedeemingAppleOffer ? (
                    <ActivityIndicator color="#111111" />
                  ) : (
                    <Text style={styles.redeemButtonText}>{t("pro.redeem.button")}</Text>
                  )}
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {Platform.OS === "ios" ? (
            <Pressable
              style={[
                styles.restoreButton,
                (isRestoringApplePurchases || isRedeemingAppleOffer) && styles.subscribeButtonDisabled,
              ]}
              onPress={() => void handleRestoreApplePurchases()}
              disabled={isRestoringApplePurchases || isRedeemingAppleOffer}
            >
              {isRestoringApplePurchases ? (
                <ActivityIndicator color="#111111" />
              ) : (
                <>
                  <Text style={styles.restoreHintText}>{t("pro.restore.hint")}</Text>
                  <Text style={styles.restoreButtonText}>{t("pro.restore.button")}</Text>
                </>
              )}
            </Pressable>
          ) : null}
        </View>

        <View style={styles.ruleCard}>
          <Text style={styles.ruleTitle}>{t("pro.rules.title")}</Text>
          {PAYMENT_RULE_KEYS.map((ruleKey) => (
            <View key={ruleKey} style={styles.ruleItem}>
              <View style={styles.ruleDot} />
              <Text style={styles.ruleText}>{t(ruleKey)}</Text>
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
    throw new Error(t("pro.alert.wechat_pay_unsupported"));
  }
}

async function payWithWechatParams(clientPayParams: Record<string, unknown>): Promise<void> {
  assertWechatPayAvailable();
  const { payWithWechat, toWeChatClientPayParams } = await import("../services/payment/wechatPay");
  await payWithWechat(toWeChatClientPayParams(clientPayParams));
}

function resolveAutoRenewDescription(input: {
  isPro: boolean;
  expiresAt: string | null;
  autoRenew: MobileAutoRenewSubscription | null;
  hasLoadedAutoRenew: boolean;
}): string {
  if (!input.hasLoadedAutoRenew) {
    return t("pro.auto.desc.syncing");
  }
  if (input.autoRenew?.status === "pending") {
    return t("pro.auto.desc.pending");
  }
  if (hasActiveAutoRenew(input.autoRenew)) {
    return tf("pro.auto.desc.active", { provider: formatProviderName(input.autoRenew.provider) });
  }
  if (input.isPro && input.expiresAt) {
    return tf("pro.auto.desc.after_expiry", { provider: formatAutoRenewProviderLabel() });
  }
  return tf("pro.auto.desc.first_payment", { provider: formatAutoRenewProviderLabel() });
}

function resolveMembershipStatusLabel(input: {
  isPro: boolean;
  expiresAt: string | null;
}): string | null {
  if (input.isPro && input.expiresAt) {
    return tf("pro.valid_until", { date: formatDate(input.expiresAt) });
  }
  return null;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return tf("pro.date_full", { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() });
}

function formatProviderName(provider: MobileAutoRenewSubscription["provider"]): string {
  return provider === "apple" ? "Apple" : t("pro.provider.wechat");
}

function readPositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function resolveQuotaBenefit(entitlement: CurrentEntitlement | null): { title: string; subtitle: string } {
  if (!entitlement) {
    return {
      title: t("pro.quota.syncing_title"),
      subtitle: t("pro.quota.syncing_subtitle"),
    };
  }

  if (entitlement.isPro) {
    return {
      title: tf("pro.quota.pro_title", { count: formatNumber(entitlement.dailyTotalLimit) }),
      subtitle: entitlement.expiresAt
        ? tf("pro.quota.pro_subtitle", { date: formatDate(entitlement.expiresAt) })
        : t("pro.quota.pro_active"),
    };
  }

  const validUntil = entitlement.validUntil ? tf("pro.quota.free_valid_until", { date: formatDate(entitlement.validUntil) }) : "";
  return {
    title: tf("pro.quota.free_title", { count: formatNumber(entitlement.dailyTotalLimit) }),
    subtitle: tf("pro.quota.free_subtitle", { count: formatNumber(entitlement.remainingChars), validUntil }),
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

type CachedAutoRenewSubscription = {
  userId: string;
  platform: typeof Platform.OS;
  subscription: MobileAutoRenewSubscription | null;
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

async function loadCachedAutoRenewSubscription(userId: string): Promise<MobileAutoRenewSubscription | null> {
  const raw = await AsyncStorage.getItem(AUTO_RENEW_CACHE_KEY);
  if (!raw) return null;

  try {
    const cached = JSON.parse(raw) as Partial<CachedAutoRenewSubscription>;
    const isFresh = typeof cached.cachedAt === "number" && Date.now() - cached.cachedAt <= AUTO_RENEW_CACHE_TTL_MS;
    if (
      !isFresh ||
      cached.userId !== userId ||
      cached.platform !== Platform.OS ||
      !isValidCachedAutoRenewSubscription(cached.subscription)
    ) {
      return null;
    }
    return cached.subscription;
  } catch {
    await AsyncStorage.removeItem(AUTO_RENEW_CACHE_KEY);
    return null;
  }
}

async function saveCachedAutoRenewSubscriptionForCurrentUser(
  subscription: MobileAutoRenewSubscription | null
): Promise<void> {
  const session = await getSession();
  if (!session?.user.id) return;
  await saveCachedAutoRenewSubscription(session.user.id, subscription);
}

async function saveCachedAutoRenewSubscription(
  userId: string,
  subscription: MobileAutoRenewSubscription | null
): Promise<void> {
  const cached: CachedAutoRenewSubscription = {
    userId,
    platform: Platform.OS,
    subscription,
    cachedAt: Date.now(),
  };
  await AsyncStorage.setItem(AUTO_RENEW_CACHE_KEY, JSON.stringify(cached));
}

function isValidCachedAutoRenewSubscription(value: unknown): value is MobileAutoRenewSubscription | null {
  if (value === null) return true;
  if (typeof value !== "object" || !value) return false;
  const candidate = value as Partial<MobileAutoRenewSubscription>;
  return (
    typeof candidate.id === "string" &&
    (candidate.provider === "apple" || candidate.provider === "wechat") &&
    candidate.productCode === "pro_monthly" &&
    typeof candidate.status === "string"
  );
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
      primarySuffix: primary ? t("pro.price.month_suffix") : "",
      oneTime: oneTimePrice ?? null,
      autoRenew: subscriptionPrice ?? null,
    };
  }

  if (Platform.OS === "android") {
    const price = input.wechatPriceLabel;
    return {
      primary: price,
      primarySuffix: price ? t("pro.price.month_suffix") : "",
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

function hasLoadedAppleProduct(appleIap: AppleIapBridgeState, source: ApplePurchaseSource, productId: string): boolean {
  const rows = source === "single_purchase" ? appleIap.products : appleIap.subscriptions;
  return rows.some((product) => product.id === productId);
}

function formatOneTimePurchaseButtonLabel(): string {
  return t("pro.month_card");
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

function isEmptyApplePurchaseResult(result: unknown): boolean {
  return result === null || (Array.isArray(result) && result.length === 0);
}

function isAppleTransactionOwnedByDifferentAccount(error: unknown): boolean {
  return error instanceof MobileApiError && (
    error.code === "APPLE_APP_ACCOUNT_TOKEN_MISMATCH" ||
    error.code === "APPLE_SUBSCRIPTION_ALREADY_BOUND"
  );
}

function formatApplePaymentErrorMessage(error: unknown, fallback = t("app.delete.retry_later")): string {
  if (isAppleInactiveSubscriptionTransactionError(error)) {
    return t("pro.alert.apple_retry_subscription");
  }
  if (error instanceof MobileApiError) {
    if (error.code === "APPLE_SUBSCRIPTION_EXPIRED") {
      return t("pro.alert.apple_subscription_expired");
    }
    if (error.code === "AUTO_RENEW_SWITCH_BLOCKED") {
      return t("pro.alert.pro_active_subscribe_later");
    }
    if (error.code === "PRO_RENEWAL_TOO_EARLY") {
      return t("pro.alert.pro_active_buy_later");
    }
    return error.message || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

function isAppleInactiveSubscriptionTransactionError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  return message.toLowerCase().includes("inactive subscription transaction");
}

function isAppleUserCancelledPurchase(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === ErrorCode.UserCancelled
  );
}

function isWechatUserCancelError(error: unknown): boolean {
  return error instanceof Error && error.name === "WECHAT_PAY_USER_CANCELLED";
}

function formatAutoRenewProviderLabel(): string {
  if (Platform.OS === "ios") return "Apple ";
  if (Platform.OS === "android") return t("pro.provider.wechat");
  return "";
}

function formatAutoRenewButtonLabel(): string {
  if (Platform.OS === "ios") return t("pro.auto.apple_subscription");
  if (Platform.OS === "android") return t("pro.auto.wechat_subscription");
  return t("pro.auto.start");
}

function formatAutoRenewCancelButtonLabel(provider: MobileAutoRenewSubscription["provider"]): string {
  return provider === "apple" ? t("pro.auto.cancel_apple") : t("pro.auto.cancel_wechat");
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

const PAYMENT_RULE_KEYS = [
  "pro.rules.1",
  "pro.rules.2",
  "pro.rules.3",
  "pro.rules.4",
  "pro.rules.5",
  "pro.rules.6",
] as const;

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
  membershipStatus: {
    color: "#6A7290",
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 5,
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
    flexDirection: "row",
    gap: 10,
  },
  actionSlot: {
    marginTop: 10,
    minHeight: 38,
  },
  actionSlotReserved: {
    opacity: 0,
  },
  actionButton: {
    flex: 1,
  },
  redeemButton: {
    marginTop: 8,
    minHeight: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#DDE2EC",
    backgroundColor: "#FAFBFF",
    alignItems: "center",
    justifyContent: "center",
  },
  redeemButtonText: {
    color: "#111111",
    fontSize: 12,
    fontWeight: "500",
    textAlign: "center",
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
