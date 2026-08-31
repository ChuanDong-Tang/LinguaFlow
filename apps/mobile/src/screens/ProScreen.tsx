import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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
import { SafeAreaView } from "react-native-safe-area-context";
import {
  cancelAutoRenewSubscription,
  createAlipayAutoRenewSubscription,
  getCurrentAutoRenewSubscription,
  getPlusMonthlyProductQuote,
  getProMonthlyProductQuote,
  MobileApiError,
  registerAppleAppAccountToken,
  registerGooglePlayObfuscatedAccountId,
  verifyGooglePlaySubscriptionPurchase,
  verifyAppleProMonthlyTransaction,
  type MobileAutoRenewSubscription,
  type MobilePaymentProductCode,
  type MobilePaymentProductQuote,
} from "../services/api/paymentApi";
import { refreshEntitlementAndSession } from "../services/entitlement/entitlementSync";
import { getCachedEntitlementForUser, isSameEntitlement, setCachedEntitlement } from "../services/entitlement/entitlementCache";
import { getCurrentEntitlement, type CurrentEntitlement } from "../services/api/meApi";
import { getSession, setSession } from "../services/auth/authStorage";
import {
  APPLE_PRO_MONTHLY_ONE_TIME_PRODUCT_ID,
  APPLE_PLUS_MONTHLY_SUBSCRIPTION_PRODUCT_ID,
  APPLE_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID,
  type ApplePurchaseSource,
  assertAppleIapAvailable,
  createAppleAppAccountToken,
  getAppleTransactionId,
  getAppleProductIdForSource,
} from "../services/payment/appleIap";
import {
  GOOGLE_PLAY_PLUS_MONTHLY_SUBSCRIPTION_PRODUCT_ID,
  GOOGLE_PLAY_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID,
  assertGooglePlayBillingAvailable,
  createGooglePlayObfuscatedAccountId,
  getGooglePlayBasePlanOfferToken,
  getGooglePlayProductId,
  getGooglePlayPurchaseToken,
} from "../services/payment/googlePlayBilling";
import { useMountedGuard } from "../hooks/useMountedGuard";
import { environmentStorageKey } from "../services/storage/environmentStorageKey";
import { t, tf } from "../i18n";

type ProScreenProps = { onBack?: () => void; compact?: boolean; initialEntitlement?: CurrentEntitlement | null };
type AppleIapBridgeState = Pick<
  ReturnType<typeof useIAP>,
  "connected" | "fetchProducts" | "finishTransaction" | "products" | "reconnect" | "requestPurchase" | "subscriptions"
>;
type AppleIapBridgeProps = {
  onReady: (bridge: AppleIapBridgeState) => void;
  onPurchaseSuccess: (purchase: Purchase) => void;
  onPurchaseError: (error: unknown) => void;
  onStoreError: (error: unknown) => void;
};

const ENABLE_APPLE_ONE_TIME_PURCHASE = process.env.EXPO_PUBLIC_ENABLE_APPLE_ONE_TIME_PURCHASE === "true";
const ENABLE_APPLE_AUTO_RENEW = process.env.EXPO_PUBLIC_ENABLE_APPLE_AUTO_RENEW === "true";
const ENABLE_GOOGLE_PLAY_AUTO_RENEW = process.env.EXPO_PUBLIC_ENABLE_GOOGLE_PLAY_AUTO_RENEW === "true";
const ENABLE_ALIPAY_AUTO_RENEW = process.env.EXPO_PUBLIC_ENABLE_ALIPAY_AUTO_RENEW === "true";
const DISTRIBUTION_CHANNEL = process.env.EXPO_PUBLIC_DISTRIBUTION_CHANNEL?.trim().toLowerCase();
const IS_CHINA_ANDROID = Platform.OS === "android" && DISTRIBUTION_CHANNEL === "china";
const PRODUCT_PRICE_CACHE_KEY = environmentStorageKey(
  Platform.OS === "android" ? "lf_membership_product_price_v3" : "lf_membership_product_price_v2"
);
const AUTO_RENEW_CACHE_KEY = environmentStorageKey("lf_current_auto_renew_v1");
const PRODUCT_PRICE_CACHE_TTL_MS = readPositiveIntEnv(
  process.env.EXPO_PUBLIC_PRO_PRICE_CACHE_TTL_MS,
  24 * 60 * 60 * 1000
);
const AUTO_RENEW_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const APPLE_PURCHASE_TIMEOUT_MS = 120 * 1000;

export function ProScreen({ onBack = () => {}, compact = false, initialEntitlement = null }: ProScreenProps) {
  const { isMounted: isScreenAlive, safeAlert } = useMountedGuard();
  const [isPaying, setIsPaying] = useState(false);
  const [isRenew, setIsRenew] = useState(initialEntitlement?.isMember ?? initialEntitlement?.isPro ?? false);
  const [proExpiresAt, setProExpiresAt] = useState<string | null>(initialEntitlement?.expiresAt ?? null);
  const [autoRenew, setAutoRenew] = useState<MobileAutoRenewSubscription | null>(null);
  const [isAutoRenewLoading, setIsAutoRenewLoading] = useState(false);
  const [hasLoadedAutoRenew, setHasLoadedAutoRenew] = useState(false);
  const [isApplePurchaseFinishing, setIsApplePurchaseFinishing] = useState(false);
  const [isRestoringApplePurchases, setIsRestoringApplePurchases] = useState(false);
  const [isRestoringGooglePlayPurchases, setIsRestoringGooglePlayPurchases] = useState(false);
  const [isRedeemingAppleOffer, setIsRedeemingAppleOffer] = useState(false);
  const [appleIap, setAppleIap] = useState<AppleIapBridgeState | null>(null);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [cachedProductPrices, setCachedProductPrices] = useState<ProductPriceLabels | null>(null);
  const [productQuotes, setProductQuotes] = useState<Partial<Record<MobilePaymentProductCode, MobilePaymentProductQuote>>>({});
  const [currentEntitlement, setCurrentEntitlement] = useState<CurrentEntitlement | null>(initialEntitlement);
  const applePurchaseIntentRef = useRef(false);
  const applePurchaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appleAppAccountTokenRef = useRef<string | null>(null);
  const appleAppAccountTokenPromiseRef = useRef<Promise<string | null> | null>(null);
  const googlePlayPurchaseIntentRef = useRef(false);
  const googlePlayPurchaseFinishingRef = useRef(false);
  const handledGooglePlayPurchaseTokensRef = useRef(new Set<string>());
  const activeAutoRenew = hasActiveAutoRenew(autoRenew);
  const manageableAutoRenew = isRenew && activeAutoRenew && !autoRenew.cancelAtPeriodEnd;
  const liveProductPrices = resolveMembershipPriceLabels(appleIap);
  const productPrices = hasAnyProductPrice(liveProductPrices) ? liveProductPrices : cachedProductPrices ?? liveProductPrices;
  const quotaBenefit = resolveQuotaBenefit(currentEntitlement);
  const membershipStatusLabel = resolveMembershipStatusLabel({
    isMember: isRenew,
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
    Platform.OS === "ios" && ENABLE_APPLE_ONE_TIME_PURCHASE;
  const canStartAutoRenew =
    !isRenew &&
    hasLoadedAutoRenew &&
    ((Platform.OS === "ios" && ENABLE_APPLE_AUTO_RENEW) ||
      (Platform.OS === "android" && ((IS_CHINA_ANDROID && ENABLE_ALIPAY_AUTO_RENEW) || (!IS_CHINA_ANDROID && ENABLE_GOOGLE_PLAY_AUTO_RENEW))));
  const shouldShowPurchaseActions = !isRenew || manageableAutoRenew;
  const shouldReservePurchaseActionSpace = shouldShowPurchaseActions || (isRenew && !hasLoadedAutoRenew);

  function applyEntitlementToState(entitlement: CurrentEntitlement): void {
    setIsRenew(entitlement.isMember ?? entitlement.isPro);
    setProExpiresAt(entitlement.expiresAt);
    setCurrentEntitlement(entitlement);
  }

  function applyAutoRenewToState(subscription: MobileAutoRenewSubscription | null): void {
    setAutoRenew(subscription);
    void saveCachedAutoRenewSubscriptionForCurrentUser(subscription);
  }

  useEffect(() => {
    if (initialEntitlement) applyEntitlementToState(initialEntitlement);
  }, [initialEntitlement]);

  function alertOpenSuccess(input?: MembershipTierInput): void {
    const tier = resolveMembershipTier(input);
    safeAlert(t("pro.alert.open_success_title"), t(tier === "plus" ? "pro.alert.open_success_message_plus" : "pro.alert.open_success_message_pro"));
  }

  function alertRestoreSuccess(input?: MembershipTierInput): void {
    const tier = resolveMembershipTier(input);
    safeAlert(t("pro.alert.restore_success_title"), t(tier === "plus" ? "pro.alert.restore_success_message_plus" : "pro.alert.restore_success_message_pro"));
  }

  async function syncSessionProFlag(entitlement: CurrentEntitlement): Promise<void> {
    const session = await getSession();
    if (!session) return;
    await setSession({
      ...session,
      sessionFlags: {
        ...(session.sessionFlags ?? {}),
        isPro: entitlement.isMember ?? entitlement.isPro,
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

  async function ensureStoreConnected(): Promise<boolean> {
    if (appleIap?.connected) return true;
    let errorMessage = storeError;
    try {
      const connected = await appleIap?.reconnect();
      if (connected) {
        setStoreError(null);
        return true;
      }
    } catch (error) {
      errorMessage = formatStoreErrorMessage(error);
      if (isScreenAlive()) setStoreError(errorMessage);
    }
    if (isScreenAlive()) {
      safeAlert(
        t(Platform.OS === "android" ? "pro.alert.google_init_title" : "pro.alert.apple_init_title"),
        errorMessage ?? t("app.delete.retry_later"),
      );
    }
    return false;
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
    let cancelled = false;
    void Promise.allSettled([getPlusMonthlyProductQuote(), getProMonthlyProductQuote()]).then((results) => {
      if (cancelled || !isScreenAlive()) return;
      const next: Partial<Record<MobilePaymentProductCode, MobilePaymentProductQuote>> = {};
      for (const result of results) {
        if (result.status === "fulfilled") next[result.value.productCode] = result.value;
      }
      setProductQuotes(next);
    });
    return () => {
      cancelled = true;
    };
  }, [isScreenAlive]);

  useEffect(() => {
    if (!hasAnyProductPrice(liveProductPrices)) return;
    setCachedProductPrices(liveProductPrices);
    void saveCachedProductPrices(liveProductPrices);
  }, [liveProductPrices.plus, liveProductPrices.pro, liveProductPrices.monthSuffix]);

  useEffect(() => {
    if (appleIap?.connected) setStoreError(null);
  }, [appleIap?.connected]);

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
      safeAlert(t("pro.not_open"), t("pro.alert.one_time_not_open"));
      return;
    }

    safeAlert(t("pro.alert.unsupported_title"), t("pro.alert.unsupported_purchase"));
  }

  async function handleStartAutoRenew(productCode: MobilePaymentProductCode): Promise<void> {
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
      await startAppleIapPurchase("auto_renew", productCode);
      return;
    }

    if (Platform.OS === "android") {
      if (IS_CHINA_ANDROID) {
        if (!ENABLE_ALIPAY_AUTO_RENEW) {
          safeAlert(t("pro.not_open"), t("pro.alert.unsupported_auto"));
          return;
        }
        await startAlipayAutoRenew(productCode);
        return;
      }
      if (!ENABLE_GOOGLE_PLAY_AUTO_RENEW) {
        safeAlert(t("pro.not_open"), t("pro.alert.unsupported_auto"));
        return;
      }
      await startGooglePlaySubscriptionPurchase(productCode);
      return;
    }

    safeAlert(t("pro.alert.unsupported_title"), t("pro.alert.unsupported_auto"));
  }

  async function startAlipayAutoRenew(productCode: MobilePaymentProductCode): Promise<void> {
    setIsAutoRenewLoading(true);
    setIsPaying(true);
    try {
      const created = await createAlipayAutoRenewSubscription(productCode);
      await Linking.openURL(created.jumpSchema);
      if (!isScreenAlive()) return;
      safeAlert(t("pro.alert.payment_processing_title"), t("pro.alert.payment_processing_message"));
      const current = await pollAlipayAutoRenewResult(created.autoRenewSubscriptionId);
      if (!isScreenAlive()) return;
      applyAutoRenewToState(current);
      const entitlementResult = await refreshProEntitlementState();
      if (entitlementResult?.entitlement.isMember ?? entitlementResult?.entitlement.isPro) {
        setIsRenew(true);
        alertOpenSuccess({ entitlement: entitlementResult?.entitlement, productCode });
      }
    } catch (error) {
      if (!isScreenAlive()) return;
      const message = error instanceof Error ? error.message : t("app.delete.retry_later");
      safeAlert(t("pro.alert.payment_start_failed"), message);
    } finally {
      if (isScreenAlive()) { setIsAutoRenewLoading(false); setIsPaying(false); }
    }
  }

  async function startGooglePlaySubscriptionPurchase(productCode: MobilePaymentProductCode): Promise<void> {
    assertGooglePlayBillingAvailable(productCode);
    if (!(await ensureStoreConnected()) || !appleIap) return;
    const productId = getGooglePlayProductId(productCode);
    const product = appleIap.subscriptions.find((item) => item.id === productId);
    if (!product) {
      safeAlert(t("pro.alert.google_product_loading_title"), storeError ?? t("pro.alert.google_product_loading_message"));
      return;
    }

    setIsPaying(true);
    setIsAutoRenewLoading(true);
    try {
      const latestEntitlement = await refreshProEntitlementState();
      if (!isScreenAlive()) return;
      if (latestEntitlement?.entitlement.isMember ?? latestEntitlement?.entitlement.isPro) {
        setIsRenew(true);
        safeAlert(t("pro.alert.pro_active_title"), t("pro.alert.pro_active_subscribe_later"));
        setIsPaying(false);
        setIsAutoRenewLoading(false);
        return;
      }
      const session = await getSession();
      const obfuscatedAccountId = session?.user.id ? await createGooglePlayObfuscatedAccountId(session.user.id) : null;
      if (obfuscatedAccountId) {
        await registerGooglePlayObfuscatedAccountId(obfuscatedAccountId);
      }
      const offerToken = getGooglePlayBasePlanOfferToken(product, productCode);
      if (!offerToken) {
        throw new Error("Google Play base plan is unavailable or does not match the configured plan.");
      }
      googlePlayPurchaseIntentRef.current = true;
      const purchaseResult = await appleIap.requestPurchase({
        type: "subs",
        request: {
          google: {
            skus: [productId],
            obfuscatedAccountId,
            subscriptionOffers: [{ sku: productId, offerToken }],
          },
        },
      });
      if (isEmptyApplePurchaseResult(purchaseResult)) {
        googlePlayPurchaseIntentRef.current = false;
        if (!isScreenAlive()) return;
        setIsPaying(false);
        setIsAutoRenewLoading(false);
      }
    } catch (error) {
      googlePlayPurchaseIntentRef.current = false;
      if (!isScreenAlive()) return;
      if (isAppleUserCancelledPurchase(error)) {
        setIsPaying(false);
        setIsAutoRenewLoading(false);
        return;
      }
      const message = error instanceof Error ? error.message : t("app.delete.retry_later");
      safeAlert(t("pro.alert.payment_start_failed"), message);
      setIsPaying(false);
      setIsAutoRenewLoading(false);
    }
  }

  async function handleManageAutoRenew(): Promise<void> {
    if (!autoRenew) return;
    if (autoRenew.provider === "apple") {
      // Apple 订阅只能去 Apple ID 订阅管理里取消，服务端不能替用户直接取消平台订阅。
      safeAlert(t("pro.alert.apple_manage_title"), t("pro.alert.apple_manage_message"));
      return;
    }
    if (autoRenew.provider === "google_play") {
      const productId = getGooglePlayProductId(autoRenew.productCode);
      const url =
        "https://play.google.com/store/account/subscriptions" +
        `?sku=${encodeURIComponent(productId)}` +
        "&package=com.yueyantech.oio";
      await Linking.openURL(url);
      return;
    }
    setIsAutoRenewLoading(true);
    try {
      const cancelled = await cancelAutoRenewSubscription(autoRenew.id);
      if (!isScreenAlive()) return;
      applyAutoRenewToState(
        autoRenew.id === cancelled.id
          ? { ...autoRenew, status: cancelled.status, cancelledAt: cancelled.cancelledAt, cancelAtPeriodEnd: cancelled.cancelAtPeriodEnd }
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

  async function startAppleIapPurchase(
    source: ApplePurchaseSource,
    productCode: MobilePaymentProductCode = "pro_monthly"
  ): Promise<void> {
    assertAppleIapAvailable(source, productCode);
    if (!appleIap?.connected) {
      safeAlert(t("pro.alert.apple_init_title"), t("app.delete.retry_later"));
      return;
    }
    const productId = getAppleProductIdForSource(source, productCode);
    if (!hasLoadedAppleProduct(appleIap, source, productId)) {
      safeAlert(t("pro.alert.apple_product_loading_title"), t("pro.alert.apple_product_loading_message"));
      return;
    }
    setIsPaying(true);
    setIsAutoRenewLoading(true);
    try {
      const latestEntitlement = await refreshProEntitlementState();
      if (!isScreenAlive()) return;
      if (latestEntitlement?.entitlement.isMember ?? latestEntitlement?.entitlement.isPro) {
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
      setIsRenew(entitlementResult?.entitlement.isMember ?? entitlementResult?.entitlement.isPro ?? true);
      if (verified.purchaseKind === "auto_renew") {
        const currentAutoRenew = await getCurrentAutoRenewSubscription();
        if (!isScreenAlive()) return true;
        applyAutoRenewToState(currentAutoRenew);
      }
      alertOpenSuccess({ entitlement: entitlementResult?.entitlement, productId });
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
      setIsRenew(entitlementResult?.entitlement.isMember ?? entitlementResult?.entitlement.isPro ?? true);
      if (!isOneTimePurchase) {
        const currentAutoRenew = await getCurrentAutoRenewSubscription();
        if (!isScreenAlive()) return;
        applyAutoRenewToState(currentAutoRenew);
      }
      if (isUserInitiatedPurchase) {
        alertOpenSuccess({ entitlement: entitlementResult?.entitlement, productId: purchase.productId });
      }
    } catch (error) {
      if (!isScreenAlive()) return;
      if (isAppleTransactionOwnedByDifferentAccount(error)) {
        if (
          purchase.productId === APPLE_PLUS_MONTHLY_SUBSCRIPTION_PRODUCT_ID ||
          purchase.productId === APPLE_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID
        ) {
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

  async function handleGooglePlayPurchaseSuccess(purchase: Purchase): Promise<void> {
    if (!isGooglePlayProPurchase(purchase) || googlePlayPurchaseFinishingRef.current) return;
    googlePlayPurchaseFinishingRef.current = true;
    const isUserInitiatedPurchase = googlePlayPurchaseIntentRef.current;
    googlePlayPurchaseIntentRef.current = false;
    let purchaseToken: string | null = null;
    try {
      purchaseToken = getGooglePlayPurchaseToken(purchase);
      if (handledGooglePlayPurchaseTokensRef.current.has(purchaseToken)) return;
      handledGooglePlayPurchaseTokensRef.current.add(purchaseToken);
      const session = await getSession();
      const obfuscatedAccountId = session?.user.id ? await createGooglePlayObfuscatedAccountId(session.user.id) : null;
      await verifyGooglePlaySubscriptionPurchase({
        productId: purchase.productId,
        purchaseToken,
        obfuscatedAccountId,
      });
      if (!appleIap) throw new Error(t("pro.alert.google_not_initialized"));
      await appleIap.finishTransaction({ purchase, isConsumable: false });
      const entitlementResult = await refreshProEntitlementState();
      const currentAutoRenew = await getCurrentAutoRenewSubscription();
      if (!isScreenAlive()) return;
      setIsRenew(entitlementResult?.entitlement.isMember ?? entitlementResult?.entitlement.isPro ?? true);
      applyAutoRenewToState(currentAutoRenew);
      if (isUserInitiatedPurchase) {
        alertOpenSuccess({ entitlement: entitlementResult?.entitlement, productId: purchase.productId });
      }
    } catch (error) {
      if (purchaseToken) {
        handledGooglePlayPurchaseTokensRef.current.delete(purchaseToken);
      }
      if (!isScreenAlive()) return;
      if (isUserInitiatedPurchase) {
        safeAlert(t("pro.alert.google_verify_failed"), formatGooglePlayPaymentErrorMessage(error));
      }
    } finally {
      googlePlayPurchaseFinishingRef.current = false;
      if (isScreenAlive()) {
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
          setIsRenew(entitlementResult?.entitlement.isMember ?? entitlementResult?.entitlement.isPro ?? true);
          if (verified.purchaseKind === "auto_renew") {
            const currentAutoRenew = await getCurrentAutoRenewSubscription();
            if (!isScreenAlive()) return;
            applyAutoRenewToState(currentAutoRenew);
          }
          if (!silentFailure) {
            alertRestoreSuccess({ entitlement: entitlementResult?.entitlement, productId: purchase.productId });
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

  async function handleRestoreGooglePlayPurchases(): Promise<void> {
    if (Platform.OS !== "android") return;
    if (!(await ensureStoreConnected()) || !appleIap) return;
    if (isRestoringGooglePlayPurchases) return;

    setIsRestoringGooglePlayPurchases(true);
    try {
      const purchases = (await getAvailablePurchases()).filter(isGooglePlayProPurchase);
      if (purchases.length === 0) {
        if (isScreenAlive()) {
          safeAlert(t("pro.alert.restore_not_found_title"), t("pro.alert.restore_not_found_message"));
        }
        return;
      }

      const session = await getSession();
      const obfuscatedAccountId = session?.user.id
        ? await createGooglePlayObfuscatedAccountId(session.user.id)
        : null;
      let lastError: unknown = null;
      for (const purchase of purchases) {
        try {
          await verifyGooglePlaySubscriptionPurchase({
            productId: purchase.productId,
            purchaseToken: getGooglePlayPurchaseToken(purchase),
            obfuscatedAccountId,
          });
          await appleIap.finishTransaction({ purchase, isConsumable: false }).catch(() => {});
          const entitlementResult = await refreshProEntitlementState();
          const currentAutoRenew = await getCurrentAutoRenewSubscription();
          if (!isScreenAlive()) return;
          setIsRenew(entitlementResult?.entitlement.isMember ?? entitlementResult?.entitlement.isPro ?? true);
          applyAutoRenewToState(currentAutoRenew);
          alertRestoreSuccess({ entitlement: entitlementResult?.entitlement, productId: purchase.productId });
          return;
        } catch (error) {
          lastError = error;
        }
      }
      if (isScreenAlive()) {
        safeAlert(t("pro.alert.restore_failed_title"), formatGooglePlayPaymentErrorMessage(lastError));
      }
    } catch (error) {
      if (isScreenAlive()) {
        safeAlert(t("pro.alert.restore_failed_title"), formatGooglePlayPaymentErrorMessage(error));
      }
    } finally {
      if (isScreenAlive()) setIsRestoringGooglePlayPurchases(false);
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

  const iapBridge = Platform.OS === "ios" || Platform.OS === "android" ? (
    <AppleIapBridge
      onReady={setAppleIap}
      onStoreError={(error) => setStoreError(formatStoreErrorMessage(error))}
      onPurchaseSuccess={(purchase) => {
        if (Platform.OS === "android") {
          void handleGooglePlayPurchaseSuccess(purchase);
          return;
        }
        void handleApplePurchaseSuccess(purchase);
      }}
      onPurchaseError={(error) => {
        if (!isScreenAlive()) return;
        if (Platform.OS === "android") {
          const isUserInitiatedPurchase = googlePlayPurchaseIntentRef.current;
          googlePlayPurchaseIntentRef.current = false;
          if (isUserInitiatedPurchase && !isAppleUserCancelledPurchase(error)) {
            safeAlert(t("pro.alert.payment_start_failed"), formatGooglePlayPaymentErrorMessage(error));
          }
          setIsPaying(false);
          setIsAutoRenewLoading(false);
          return;
        }
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
  ) : null;

  if (compact) {
    const currentTier = currentEntitlement?.tier ?? "free";
    const visibleTiers: Array<"plus" | "pro"> = currentTier === "free" ? ["plus", "pro"] : [currentTier];
    const purchaseBusy = isAutoRenewLoading || isPaying || !hasLoadedAutoRenew;
    return (
      <View style={styles.compactContainer}>
        {iapBridge}
        <View style={[styles.compactPlanGrid, visibleTiers.length === 1 && styles.compactPlanGridSingle]}>
          {visibleTiers.map((tier) => {
            const isPlus = tier === "plus";
            const price = isPlus ? productPrices.plus : productPrices.pro;
            const productCode: MobilePaymentProductCode = isPlus ? "plus_monthly" : "pro_monthly";
            const quote = productQuotes[productCode];
            const benefits = isPlus
              ? [
                  resolveTokenBenefit("plus", quote?.monthlyTokenLimit),
                  resolveImageBenefit("plus", quote?.monthlyImageUploadBytes),
                  t("pro.compact.assistant"),
                ]
              : [
                  resolveTokenBenefit("pro", quote?.monthlyTokenLimit),
                  resolveImageBenefit("pro", quote?.monthlyImageUploadBytes),
                  t("pro.compact.assistant"),
                  t("pro.compact.custom_material"),
                ];
            return (
              <View key={tier} style={[styles.compactPlanCard, visibleTiers.length === 1 && styles.compactPlanCardSingle]}>
                <View style={styles.compactPlanTitleRow}>
                  <Text style={styles.compactPlanTitle}>{isPlus ? "Plus" : "Pro"}</Text>
                  {currentTier === tier ? <Text style={styles.compactCurrentBadge}>{t("pro.compact.current")}</Text> : null}
                </View>
                <View style={styles.compactBenefitList}>
                  {benefits.map((benefit) => (
                    <View key={benefit} style={styles.compactBenefitRow}>
                      <Ionicons name="checkmark-circle-outline" size={15} color="#444444" />
                      <Text style={styles.compactBenefitText}>{benefit}</Text>
                    </View>
                  ))}
                </View>
                {currentTier === tier && proExpiresAt ? (
                  <Text style={styles.compactExpiry}>{tf("pro.valid_until", { date: formatDate(proExpiresAt) })}</Text>
                ) : null}
                {currentTier === "free" ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={tf("pro.compact.subscribe", { plan: isPlus ? "Plus" : "Pro" })}
                    style={[styles.compactPriceButton, (!canStartAutoRenew || purchaseBusy) && styles.subscribeButtonDisabled]}
                    disabled={!canStartAutoRenew || purchaseBusy}
                    onPress={() => void handleStartAutoRenew(productCode)}
                  >
                    {purchaseBusy ? <ActivityIndicator size="small" color="#FFFFFF" /> : (
                      <View style={styles.compactPriceContent}>
                        <Text style={styles.compactPrice}>{price ?? "--"}</Text>
                        {price ? <Text style={styles.compactPriceSuffix}>{productPrices.monthSuffix}</Text> : null}
                      </View>
                    )}
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
        {Platform.OS === "ios" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("pro.redeem.button")}
            style={({ pressed }) => [
              styles.compactRedeemButton,
              pressed && styles.compactRedeemButtonPressed,
              (isRedeemingAppleOffer || isRestoringApplePurchases || isPaying || isAutoRenewLoading) &&
                styles.subscribeButtonDisabled,
            ]}
            disabled={isRedeemingAppleOffer || isRestoringApplePurchases || isPaying || isAutoRenewLoading}
            onPress={() => void handleRedeemAppleOfferCode()}
          >
            {isRedeemingAppleOffer
              ? <ActivityIndicator size="small" color="#111111" />
              : <Text style={styles.compactRedeemText}>{t("pro.redeem.button")}</Text>}
          </Pressable>
        ) : null}
        {currentTier === "free" && (Platform.OS === "ios" || Platform.OS === "android") ? (
          <Pressable
            style={styles.compactRestoreButton}
            disabled={isRestoringApplePurchases || isRestoringGooglePlayPurchases}
            onPress={() => void (Platform.OS === "android" ? handleRestoreGooglePlayPurchases() : handleRestoreApplePurchases())}
          >
            {isRestoringApplePurchases || isRestoringGooglePlayPurchases
              ? <ActivityIndicator size="small" color="#777777" />
              : <Text style={styles.compactRestoreText}>{t("pro.restore.button")}</Text>}
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {iapBridge}
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={onBack} hitSlop={10}>
          <Ionicons name="arrow-back" size={24} color="#111111" />
        </Pressable>
        <Text style={styles.headerTitle}>{t("me.pro.title")}</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} alwaysBounceVertical={false}>
        <View style={styles.benefitCard}>
          <BenefitItem icon="text-outline" title={t("pro.plus.title")} subtitle={t("pro.plus.subtitle")} />
          <BenefitItem icon="flash-outline" title={t("pro.pro.title")} subtitle={t("pro.pro.subtitle")} />
          <BenefitItem icon="leaf-outline" title={t("pro.shared.title")} subtitle={t("pro.shared.subtitle")} isLast />
        </View>

        <View style={styles.priceCard}>
          <View style={styles.priceHead}>
            <Text style={styles.priceTitle}>{t("pro.current.title")}</Text>
          </View>
          <Text style={styles.membershipStatus}>{quotaBenefit.title}</Text>
          <Text style={styles.autoRenewText}>{quotaBenefit.subtitle}</Text>
          <View style={styles.planPriceRow}>
            <View style={styles.planPriceItem}>
              <Text style={styles.planPriceName}>Plus</Text>
              <View style={styles.planPriceValueRow}>
                <Text style={styles.planPriceValue}>{productPrices.plus ?? "--"}</Text>
                <Text style={styles.planPriceUnit}>{productPrices.plus ? productPrices.monthSuffix : ""}</Text>
              </View>
            </View>
            <View style={styles.planPriceItem}>
              <Text style={styles.planPriceName}>Pro</Text>
              <View style={styles.planPriceValueRow}>
                <Text style={styles.planPriceValue}>{productPrices.pro ?? "--"}</Text>
                <Text style={styles.planPriceUnit}>{productPrices.pro ? productPrices.monthSuffix : ""}</Text>
              </View>
            </View>
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
                  {!manageableAutoRenew ? (
                    <Pressable
                      style={[
                        styles.secondaryButton,
                        styles.actionButton,
                        (!canStartAutoRenew || isAutoRenewLoading || !hasLoadedAutoRenew) &&
                          styles.subscribeButtonDisabled,
                      ]}
                      onPress={() => void handleStartAutoRenew("plus_monthly")}
                      disabled={!canStartAutoRenew || isAutoRenewLoading || !hasLoadedAutoRenew}
                    >
                      {isAutoRenewLoading || !hasLoadedAutoRenew ? (
                        <ActivityIndicator color="#111111" />
                      ) : (
                        <Text style={styles.secondaryButtonText}>
                          {canStartAutoRenew ? t("pro.plus.subscribe") : t("pro.not_open")}
                        </Text>
                      )}
                    </Pressable>
                  ) : null}
                  <Pressable
                    style={[
                      styles.subscribeButton,
                      styles.actionButton,
                      ((!canStartAutoRenew && !manageableAutoRenew) || isAutoRenewLoading || !hasLoadedAutoRenew) &&
                        styles.subscribeButtonDisabled,
                    ]}
                    onPress={manageableAutoRenew ? () => void handleManageAutoRenew() : () => void handleStartAutoRenew("pro_monthly")}
                    disabled={(!canStartAutoRenew && !manageableAutoRenew) || isAutoRenewLoading || !hasLoadedAutoRenew}
                  >
                    {isAutoRenewLoading || !hasLoadedAutoRenew ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Text style={styles.subscribeText}>
                        {manageableAutoRenew
                          ? formatAutoRenewCancelButtonLabel(autoRenew.provider)
                          : canStartAutoRenew
                            ? t("pro.pro.subscribe")
                            : t("pro.not_open")}
                      </Text>
                    )}
                  </Pressable>
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
          {Platform.OS === "ios" || Platform.OS === "android" ? (
            <Pressable
              style={[
                styles.restoreButton,
                (isRestoringApplePurchases || isRestoringGooglePlayPurchases || isRedeemingAppleOffer) &&
                  styles.subscribeButtonDisabled,
              ]}
              onPress={() =>
                void (Platform.OS === "android"
                  ? handleRestoreGooglePlayPurchases()
                  : handleRestoreApplePurchases())
              }
              disabled={isRestoringApplePurchases || isRestoringGooglePlayPurchases || isRedeemingAppleOffer}
            >
              {isRestoringApplePurchases || isRestoringGooglePlayPurchases ? (
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

function AppleIapBridge({ onReady, onPurchaseSuccess, onPurchaseError, onStoreError }: AppleIapBridgeProps) {
  const iap = useIAP({
    onPurchaseSuccess,
    onPurchaseError,
    onError: onStoreError,
  });

  useEffect(() => {
    onReady({
      connected: iap.connected,
      fetchProducts: iap.fetchProducts,
      finishTransaction: iap.finishTransaction,
      products: iap.products,
      reconnect: iap.reconnect,
      requestPurchase: iap.requestPurchase,
      subscriptions: iap.subscriptions,
    });
  }, [
    iap.connected,
    iap.fetchProducts,
    iap.finishTransaction,
    iap.products,
    iap.reconnect,
    iap.requestPurchase,
    iap.subscriptions,
    onReady,
  ]);

  useEffect(() => {
    if (!iap.connected) return;
    if (Platform.OS === "android") {
      void iap.fetchProducts({
        skus: [
          GOOGLE_PLAY_PLUS_MONTHLY_SUBSCRIPTION_PRODUCT_ID,
          GOOGLE_PLAY_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID,
        ].filter(Boolean),
        type: "subs",
      });
      return;
    }
    if (Platform.OS === "ios") {
      void iap.fetchProducts({
        skus: [APPLE_PLUS_MONTHLY_SUBSCRIPTION_PRODUCT_ID, APPLE_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID].filter(Boolean),
        type: "subs",
      });
      void iap.fetchProducts({ skus: [getAppleProductIdForSource("single_purchase")], type: "in-app" });
    }
  }, [iap.connected, iap.fetchProducts]);

  return null;
}

function formatProviderName(provider: MobileAutoRenewSubscription["provider"]): string {
  if (provider === "apple") return "Apple";
  if (provider === "google_play") return "Google Play";
  if (provider === "alipay") return "支付宝";
  return provider;
}

type MembershipTierInput = {
  entitlement?: CurrentEntitlement | null;
  productCode?: MobilePaymentProductCode | null;
  productId?: string | null;
};

function resolveMembershipTier(input?: MembershipTierInput): "plus" | "pro" {
  if (
    input?.productCode === "plus_monthly" ||
    input?.productId === APPLE_PLUS_MONTHLY_SUBSCRIPTION_PRODUCT_ID ||
    input?.productId === GOOGLE_PLAY_PLUS_MONTHLY_SUBSCRIPTION_PRODUCT_ID
  ) return "plus";
  if (
    input?.productCode === "pro_monthly" ||
    input?.productId === APPLE_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID ||
    input?.productId === APPLE_PRO_MONTHLY_ONE_TIME_PRODUCT_ID ||
    input?.productId === GOOGLE_PLAY_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID
  ) return "pro";
  if (input?.entitlement?.tier === "plus") return "plus";
  return "pro";
}

function resolveAutoRenewDescription(input: {
  isPro: boolean;
  expiresAt: string | null;
  autoRenew: MobileAutoRenewSubscription | null;
  hasLoadedAutoRenew: boolean;
}): string {
  if (!input.hasLoadedAutoRenew) return t("pro.auto.desc.syncing");
  if (input.autoRenew?.status === "pending") return t("pro.auto.desc.pending");
  if (hasActiveAutoRenew(input.autoRenew)) {
    return tf("pro.auto.desc.active", { provider: formatProviderName(input.autoRenew.provider) });
  }
  if (input.isPro && input.expiresAt) {
    return tf("pro.auto.desc.after_expiry", { provider: formatAutoRenewProviderLabel() });
  }
  return tf("pro.auto.desc.first_payment", { provider: formatAutoRenewProviderLabel() });
}

function resolveMembershipStatusLabel(input: { isMember: boolean; expiresAt: string | null }): string | null {
  return input.isMember && input.expiresAt
    ? tf("pro.valid_until", { date: formatDate(input.expiresAt) })
    : null;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return tf("pro.date_full", { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() });
}

async function pollAlipayAutoRenewResult(id: string): Promise<MobileAutoRenewSubscription | null> {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const current = await getCurrentAutoRenewSubscription();
    if (current?.id === id && current.status !== "pending") return current;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return getCurrentAutoRenewSubscription();
}

function readPositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function resolveTokenBenefit(tier: "plus" | "pro", value?: number): string {
  if (!Number.isFinite(value) || value! <= 0) {
    return t(tier === "plus" ? "pro.compact.plus.ai" : "pro.compact.pro.ai");
  }
  return tf("pro.compact.dynamic.ai", { count: formatCompactNumber(value!) });
}

function resolveImageBenefit(tier: "plus" | "pro", value?: number): string {
  if (!Number.isFinite(value) || value! <= 0) {
    return t(tier === "plus" ? "pro.compact.plus.images" : "pro.compact.pro.images");
  }
  return tf("pro.compact.dynamic.images", { size: formatStorageBytes(value!) });
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatStorageBytes(value: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(amount)} ${units[unitIndex]}`;
}

function resolveQuotaBenefit(entitlement: CurrentEntitlement | null): { title: string; subtitle: string } {
  if (!entitlement) {
    return {
      title: t("pro.quota.syncing_title"),
      subtitle: t("pro.quota.syncing_subtitle"),
    };
  }

  if (entitlement.isMember ?? entitlement.isPro) {
    const planName = entitlement.tier === "plus" ? "Plus" : "Pro";
    return {
      title: tf("pro.quota.member_title", { plan: planName, count: formatNumber(entitlement.dailyTotalLimit) }),
      subtitle: entitlement.expiresAt
        ? tf("pro.quota.member_subtitle", { date: formatDate(entitlement.expiresAt) })
        : t("pro.quota.member_active"),
    };
  }

  const validUntil = entitlement.validUntil ? tf("pro.quota.free_valid_until", { date: formatDate(entitlement.validUntil) }) : "";
  return {
    title: tf("pro.quota.free_title", { count: formatNumber(entitlement.dailyTotalLimit) }),
    subtitle: tf("pro.quota.free_subtitle", { count: formatNumber(entitlement.remainingChars), validUntil }),
  };
}

type ProductPriceLabels = {
  plus: string | null;
  pro: string | null;
  monthSuffix: string;
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
    if (!isFresh || cached.platform !== Platform.OS) {
      return null;
    }
    return {
      plus: typeof cached.plus === "string" ? cached.plus : null,
      pro: typeof cached.pro === "string" ? cached.pro : null,
      monthSuffix: typeof cached.monthSuffix === "string" ? cached.monthSuffix : "",
    };
  } catch {
    await AsyncStorage.removeItem(PRODUCT_PRICE_CACHE_KEY);
    return null;
  }
}

async function saveCachedProductPrices(prices: ProductPriceLabels): Promise<void> {
  if (!hasAnyProductPrice(prices)) return;
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
    (candidate.provider === "apple" || candidate.provider === "alipay" || candidate.provider === "google_play") &&
    (candidate.productCode === "plus_monthly" || candidate.productCode === "pro_monthly") &&
    typeof candidate.status === "string"
  );
}

function resolveMembershipPriceLabels(appleIap: AppleIapBridgeState | null): ProductPriceLabels {
  if (Platform.OS === "ios") {
    const plusSubscriptionPrice = appleIap?.subscriptions.find(
      (product) => product.id === APPLE_PLUS_MONTHLY_SUBSCRIPTION_PRODUCT_ID
    )?.displayPrice;
    const proSubscriptionPrice = appleIap?.subscriptions.find(
      (product) => product.id === APPLE_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID
    )?.displayPrice;
    return {
      plus: plusSubscriptionPrice ?? null,
      pro: proSubscriptionPrice ?? null,
      monthSuffix: t("pro.price.month_suffix"),
    };
  }

  if (Platform.OS === "android") {
    const plusSubscriptionPrice = appleIap?.subscriptions.find(
      (product) => product.id === GOOGLE_PLAY_PLUS_MONTHLY_SUBSCRIPTION_PRODUCT_ID
    )?.displayPrice;
    const proSubscriptionPrice = appleIap?.subscriptions.find(
      (product) => product.id === GOOGLE_PLAY_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID
    )?.displayPrice;
    return {
      plus: plusSubscriptionPrice ?? null,
      pro: proSubscriptionPrice ?? null,
      monthSuffix: t("pro.price.month_suffix"),
    };
  }

  return {
    plus: null,
    pro: null,
    monthSuffix: "",
  };
}

function hasAnyProductPrice(prices: ProductPriceLabels): boolean {
  return Boolean(prices.plus || prices.pro);
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
    purchase.productId === APPLE_PLUS_MONTHLY_SUBSCRIPTION_PRODUCT_ID ||
    purchase.productId === APPLE_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID
  );
}

function isGooglePlayProPurchase(purchase: Purchase): boolean {
  return (
    purchase.productId === GOOGLE_PLAY_PLUS_MONTHLY_SUBSCRIPTION_PRODUCT_ID ||
    purchase.productId === GOOGLE_PLAY_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID
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

function formatGooglePlayPaymentErrorMessage(error: unknown, fallback = t("app.delete.retry_later")): string {
  if (error instanceof MobileApiError) {
    if (error.code === "GOOGLE_PLAY_SUBSCRIPTION_INACTIVE" || error.code === "GOOGLE_PLAY_SUBSCRIPTION_EXPIRED") {
      return t("pro.alert.google_subscription_expired");
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

function formatStoreErrorMessage(error: unknown): string {
  if (Platform.OS === "android") return formatGooglePlayPaymentErrorMessage(error);
  return formatApplePaymentErrorMessage(error);
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

function formatAutoRenewProviderLabel(): string {
  if (Platform.OS === "ios") return "Apple ";
  if (Platform.OS === "android") return "Google Play";
  return "";
}

function formatAutoRenewButtonLabel(): string {
  if (Platform.OS === "ios") return t("pro.auto.apple_subscription");
  if (Platform.OS === "android") return IS_CHINA_ANDROID ? "支付宝自动续费" : "Google Play";
  return t("pro.auto.start");
}

function formatAutoRenewCancelButtonLabel(provider: MobileAutoRenewSubscription["provider"]): string {
  if (provider === "apple") return t("pro.auto.cancel_apple");
  if (provider === "google_play") return "Manage in Google Play";
  if (provider === "alipay") return "取消支付宝自动续费";
  return t("pro.auto.start");
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
  compactContainer: {
    paddingVertical: 16,
  },
  compactPlanGrid: {
    flexDirection: "row",
    gap: 10,
  },
  compactPlanGridSingle: {
    maxWidth: 320,
  },
  compactPlanCard: {
    flex: 1,
    minHeight: 194,
    padding: 13,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#DCDCDC",
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
  },
  compactPlanCardSingle: {
    minHeight: 160,
  },
  compactPlanTitleRow: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  compactPlanTitle: {
    color: "#111111",
    fontSize: 17,
    fontWeight: "600",
  },
  compactCurrentBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: "hidden",
    color: "#8A6218",
    backgroundColor: "#FFF2D7",
    fontSize: 9,
    fontWeight: "600",
  },
  compactBenefitList: {
    flex: 1,
    marginTop: 11,
    gap: 8,
  },
  compactBenefitRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  compactBenefitText: {
    flex: 1,
    color: "#444444",
    fontSize: 11,
    lineHeight: 16,
  },
  compactExpiry: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E8E8E8",
    color: "#777777",
    fontSize: 11,
  },
  compactPriceButton: {
    minHeight: 38,
    paddingHorizontal: 8,
    borderRadius: 9,
    backgroundColor: "#171717",
    alignItems: "center",
    justifyContent: "center",
  },
  compactPriceContent: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 3,
  },
  compactPrice: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
  compactPriceSuffix: {
    color: "#D0D0D0",
    fontSize: 10,
  },
  compactRestoreButton: {
    minHeight: 30,
    marginTop: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  compactRestoreText: {
    color: "#777777",
    fontSize: 11,
  },
  compactRedeemButton: {
    minHeight: 42,
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#111111",
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  compactRedeemButtonPressed: {
    backgroundColor: "#F1F1F1",
  },
  compactRedeemText: {
    color: "#111111",
    fontSize: 13,
    fontWeight: "600",
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
    borderColor: "#DEDEDE",
    backgroundColor: "#F5F5F5",
  },
  heroTitle: {
    color: "#111111",
    fontSize: 15,
    fontWeight: "500",
  },
  heroCopy: {
    marginTop: 4,
    color: "#5F5F5F",
    fontSize: 12,
    lineHeight: 17,
  },

  benefitCard: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#DEDEDE",
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
    borderColor: "#DEDEDE",
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
    color: "#5F5F5F",
    fontSize: 11,
    lineHeight: 15,
  },

  priceCard: {
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#DEDEDE",
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
    color: "#707070",
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 5,
  },
  planPriceRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 8,
  },
  planPriceItem: {
    flex: 1,
    minHeight: 58,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#DEDEDE",
    backgroundColor: "#FAFAFA",
    justifyContent: "center",
  },
  planPriceName: {
    color: "#111111",
    fontSize: 12,
    fontWeight: "500",
  },
  planPriceValueRow: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "baseline",
  },
  planPriceValue: {
    color: "#111111",
    fontSize: 20,
    fontWeight: "600",
  },
  planPriceUnit: {
    color: "#686868",
    fontSize: 11,
  },
  autoRenewBox: {
    marginTop: 8,
    padding: 9,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#DEDEDE",
    backgroundColor: "#FAFAFA",
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
    color: "#686868",
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
    borderColor: "#DEDEDE",
    backgroundColor: "#FAFAFA",
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
    color: "#707070",
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
    backgroundColor: "#9AA0AB",
  },
  ruleText: {
    flex: 1,
    color: "#686868",
    fontSize: 10,
    lineHeight: 14,
  },
});
