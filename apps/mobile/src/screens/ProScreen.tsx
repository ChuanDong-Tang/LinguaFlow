import { PointsUsageSheet } from "./shared/PointsUsageSheet";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  ErrorCode,
  getAvailablePurchases,
  presentCodeRedemptionSheetIOS,
  restorePurchases as restoreIapPurchases,
  showManageSubscriptionsIOS,
  useIAP,
  type Purchase,
} from "expo-iap";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  cancelAutoRenewSubscription,
  abandonAutoRenewPlanChange,
  changeAutoRenewPlan,
  createAlipayAutoRenewSubscription,
  getCurrentAutoRenewSubscription,
  getPaymentProducts,
  getPlusMonthlyProductQuote,
  getProMonthlyProductQuote,
  MobileApiError,
  registerAppleAppAccountToken,
  registerGooglePlayObfuscatedAccountId,
  resumeAlipayAutoRenewSubscription,
  verifyGooglePlaySubscriptionPurchase,
  verifyAppleProMonthlyTransaction,
  type MobileAutoRenewSubscription,
  type MobilePaymentBillingPeriod,
  type MobilePaymentCatalogProduct,
  type MobilePlanChangeResult,
  type MobilePaymentProductCode,
  type MobilePaymentProductQuote,
} from "../services/api/paymentApi";
import { refreshEntitlementAndSession } from "../services/entitlement/entitlementSync";
import { getCachedEntitlementForUser, isSameEntitlement, setCachedEntitlement } from "../services/entitlement/entitlementCache";
import { getCurrentEntitlement, getUsageV2, type CurrentEntitlement, type UsageV2 } from "../services/api/meApi";
import { getSession, setSession } from "../services/auth/authStorage";
import {
  APPLE_PRO_MONTHLY_ONE_TIME_PRODUCT_ID,
  APPLE_PLUS_MONTHLY_SUBSCRIPTION_PRODUCT_ID,
  APPLE_PLUS_YEARLY_SUBSCRIPTION_PRODUCT_ID,
  APPLE_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID,
  APPLE_PRO_YEARLY_SUBSCRIPTION_PRODUCT_ID,
  type ApplePurchaseSource,
  assertAppleIapAvailable,
  createAppleAppAccountToken,
  getAppleTransactionId,
  getAppleProductIdForSource,
} from "../services/payment/appleIap";
import {
  GOOGLE_PLAY_PLUS_MONTHLY_SUBSCRIPTION_PRODUCT_ID,
  GOOGLE_PLAY_PLUS_YEARLY_SUBSCRIPTION_PRODUCT_ID,
  GOOGLE_PLAY_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID,
  GOOGLE_PLAY_PRO_YEARLY_SUBSCRIPTION_PRODUCT_ID,
  assertGooglePlayBillingAvailable,
  createGooglePlayObfuscatedAccountId,
  getGooglePlayBasePlanOfferToken,
  getGooglePlayProductId,
  getGooglePlayPurchaseToken,
} from "../services/payment/googlePlayBilling";
import { useMountedGuard } from "../hooks/useMountedGuard";
import { environmentStorageKey } from "../services/storage/environmentStorageKey";
import { t, tf } from "../i18n";
import {
  subscriptionBillingPeriod,
  subscriptionProductCode,
  subscriptionTier,
} from "../domain/subscription/subscriptionPlans";

type ProScreenProps = {
  onBack?: () => void;
  compact?: boolean;
  initialEntitlement?: CurrentEntitlement | null;
  initialUsage?: UsageV2 | null;
  onEntitlementChanged?: (entitlement: CurrentEntitlement) => void;
  onUsageChanged?: (usage: UsageV2) => void;
};
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
const AUTO_RENEW_CACHE_KEY = environmentStorageKey("lf_current_auto_renew_v1");
const AUTO_RENEW_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const APPLE_PURCHASE_TIMEOUT_MS = 120 * 1000;
const APPLE_DEFERRED_PLAN_CHANGE_TIMEOUT_MS = 10 * 1000;
const ALIPAY_ANDROID_MARKET_URL = "market://details?id=com.eg.android.AlipayGphone";
const ALIPAY_DOWNLOAD_FALLBACK_URL = "https://www.alipay.cn/";
const IOS_DEVELOPMENT_PRICES: Record<MobilePaymentProductCode, number> = {
  plus_monthly: 39,
  plus_yearly: 368,
  pro_monthly: 59,
  pro_yearly: 468,
};
const IOS_DEVELOPMENT_PRICE_LABELS: Record<MobilePaymentProductCode, string> = {
  plus_monthly: "¥39",
  plus_yearly: "¥368",
  pro_monthly: "¥59",
  pro_yearly: "¥468",
};

export function ProScreen({
  onBack = () => {},
  compact = false,
  initialEntitlement = null,
  initialUsage = null,
  onEntitlementChanged,
  onUsageChanged,
}: ProScreenProps) {
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
  const [productQuotes, setProductQuotes] = useState<Partial<Record<MobilePaymentProductCode, MobilePaymentProductQuote>>>({});
  const [catalogProducts, setCatalogProducts] = useState<MobilePaymentCatalogProduct[]>([]);
  const [billingPeriod, setBillingPeriod] = useState<MobilePaymentBillingPeriod>("year");
  const [currentEntitlement, setCurrentEntitlement] = useState<CurrentEntitlement | null>(initialEntitlement);
  const [usageV2, setUsageV2] = useState<UsageV2 | null>(initialUsage);
  const applePurchaseIntentRef = useRef(false);
  const applePurchaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appleAppAccountTokenRef = useRef<string | null>(null);
  const appleAppAccountTokenPromiseRef = useRef<Promise<string | null> | null>(null);
  const googlePlayPurchaseIntentRef = useRef(false);
  const googlePlayPurchaseFinishingRef = useRef(false);
  const pendingPlanChangeRef = useRef<{
    autoRenewSubscriptionId: string;
    targetProductCode: MobilePaymentProductCode;
    operation: "change" | "revert";
  } | null>(null);
  const handledGooglePlayPurchaseTokensRef = useRef(new Set<string>());
  const appStateRef = useRef(AppState.currentState);
  const pendingAlipayReturnRef = useRef<{
    autoRenewSubscriptionId: string;
    productCode: MobilePaymentProductCode;
    operation: "create" | "resume" | "change";
  } | null>(null);
  const pendingStoreManagementReturnRef = useRef<"cancel" | "resume" | "plan_change" | null>(null);
  const isSyncingAlipayReturnRef = useRef(false);
  const isSyncingStoreManagementRef = useRef(false);
  const activeAutoRenew = hasActiveAutoRenew(autoRenew);
  const autoRenewBelongsToCurrentPlatform = Boolean(
    autoRenew && canManageAutoRenewOnCurrentPlatform(autoRenew.provider)
  );
  const manageableAutoRenew =
    isRenew && activeAutoRenew && autoRenewBelongsToCurrentPlatform && !autoRenew.cancelAtPeriodEnd;
  const restorableAutoRenew =
    isRenew && activeAutoRenew && autoRenewBelongsToCurrentPlatform && autoRenew.cancelAtPeriodEnd;
  const liveProductPrices = resolveMembershipPriceLabels(appleIap, productQuotes);
  const productPrices = liveProductPrices;
  const [pointsUsageVisible, setPointsUsageVisible] = useState(false);
  const quotaBenefit = resolveQuotaBenefit(currentEntitlement, usageV2);
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
  const canStartOneTimePurchase =
    Platform.OS === "ios" && ENABLE_APPLE_ONE_TIME_PURCHASE;
  const canStartAutoRenew =
    !isRenew &&
    hasLoadedAutoRenew &&
    ((Platform.OS === "ios" && ENABLE_APPLE_AUTO_RENEW) ||
      (Platform.OS === "android" && ((IS_CHINA_ANDROID && ENABLE_ALIPAY_AUTO_RENEW) || (!IS_CHINA_ANDROID && ENABLE_GOOGLE_PLAY_AUTO_RENEW))));
  const shouldShowPurchaseActions = !isRenew || manageableAutoRenew || restorableAutoRenew;
  const shouldReservePurchaseActionSpace = shouldShowPurchaseActions || (isRenew && !hasLoadedAutoRenew);

  function applyEntitlementToState(entitlement: CurrentEntitlement): void {
    setIsRenew(entitlement.isMember ?? entitlement.isPro);
    setProExpiresAt(entitlement.expiresAt);
    setCurrentEntitlement(entitlement);
    onEntitlementChanged?.(entitlement);
  }

  function applyAutoRenewToState(subscription: MobileAutoRenewSubscription | null): void {
    setAutoRenew(subscription);
    void saveCachedAutoRenewSubscriptionForCurrentUser(subscription);
  }

  function applyUsageToState(usage: UsageV2): void {
    setUsageV2(usage);
    onUsageChanged?.(usage);
  }

  useEffect(() => {
    if (initialEntitlement) applyEntitlementToState(initialEntitlement);
  }, [initialEntitlement]);

  useEffect(() => {
    if (initialUsage) applyUsageToState(initialUsage);
  }, [initialUsage]);

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

  async function loadUsageState(): Promise<UsageV2 | null> {
    try {
      const usage = await getUsageV2();
      if (isScreenAlive()) applyUsageToState(usage);
      return usage;
    } catch {
      return null;
    }
  }

  async function refreshProEntitlementState(): Promise<Awaited<ReturnType<typeof refreshEntitlementAndSession>> | null> {
    try {
      const result = await refreshEntitlementAndSession();
      if (isScreenAlive()) {
        applyEntitlementToState(result.entitlement);
      }
      await loadUsageState();
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

  function startApplePurchaseTimeout(planChange?: MobilePlanChangeResult): void {
    clearApplePurchaseTimeout();
    applePurchaseTimeoutRef.current = setTimeout(() => {
      applePurchaseTimeoutRef.current = null;
      void handleApplePurchaseTimeout(planChange);
    }, planChange?.timing === "period_end" ? APPLE_DEFERRED_PLAN_CHANGE_TIMEOUT_MS : APPLE_PURCHASE_TIMEOUT_MS);
  }

  async function handleApplePurchaseTimeout(planChange?: MobilePlanChangeResult): Promise<void> {
    if (!isScreenAlive()) return;
    applePurchaseIntentRef.current = false;
    setIsPaying(false);
    setIsAutoRenewLoading(false);

    if (planChange?.timing === "period_end") {
      try {
        const current = await getCurrentAutoRenewSubscription(8_000);
        if (!isScreenAlive()) return;
        applyAutoRenewToState(current);
        if (
          current?.productCode === planChange.targetProductCode ||
          current?.pendingProductCode === planChange.targetProductCode
        ) {
          if (current.productCode === planChange.targetProductCode) {
            pendingPlanChangeRef.current = null;
          }
          safeAlert(
            t("subscription.manager.switch_submitted"),
            formatPlanChangeEffectiveText(current.pendingChangeEffectiveAt ?? planChange.effectiveAt),
          );
          return;
        }
      } catch {
        // The provider notification and payment worker continue syncing the
        // reserved change even when this best-effort status refresh fails.
      }
      safeAlert(t("subscription.manager.confirming_title"), t("subscription.manager.confirming_message"));
      return;
    }

    safeAlert(t("pro.alert.apple_unfinished_title"), t("pro.alert.apple_unfinished_message"));
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
    let cancelled = false;
    void (async () => {
      const session = await getSession();
      const cached = session?.user.id ? await getCachedEntitlementForUser(session.user.id) : null;
      if (cached && !cancelled && isScreenAlive()) {
        applyEntitlementToState(cached.data);
      }
      const cachedAutoRenew = session?.user.id ? await loadCachedAutoRenewSubscription(session.user.id) : null;
      if (cachedAutoRenew && !cancelled && isScreenAlive()) {
        setAutoRenew(cachedAutoRenew);
      }

      try {
        const currentAutoRenew = await getCurrentAutoRenewSubscription();
        if (!cancelled && isScreenAlive()) {
          applyAutoRenewToState(currentAutoRenew);
        }
      } catch {
        // The create endpoint still rejects duplicate subscriptions server-side.
        // Do not leave the purchase controls permanently loading on a transient sync failure.
      } finally {
        if (!cancelled && isScreenAlive()) {
          setHasLoadedAutoRenew(true);
        }
      }

      await Promise.all([loadProEntitlementState(), loadUsageState()]);
    })();
    return () => {
      cancelled = true;
    };
  }, [isScreenAlive, safeAlert]);

  useEffect(() => {
    if (!IS_CHINA_ANDROID) return;
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
    let cancelled = false;
    void getPaymentProducts()
      .then((products) => {
        if (!cancelled && isScreenAlive()) setCatalogProducts(products);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [isScreenAlive]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;
      if (nextState !== "active" || previousState === "active") return;

      if (pendingStoreManagementReturnRef.current && !isSyncingStoreManagementRef.current) {
        const operation = pendingStoreManagementReturnRef.current;
        pendingStoreManagementReturnRef.current = null;
        isSyncingStoreManagementRef.current = true;
        setIsAutoRenewLoading(true);
        void syncAutoRenewAfterStoreManagement(operation).finally(() => {
          isSyncingStoreManagementRef.current = false;
          if (isScreenAlive()) setIsAutoRenewLoading(false);
        });
        return;
      }

      if (!pendingAlipayReturnRef.current || isSyncingAlipayReturnRef.current) return;

      const pending = pendingAlipayReturnRef.current;
      pendingAlipayReturnRef.current = null;
      isSyncingAlipayReturnRef.current = true;
      setIsAutoRenewLoading(true);
      if (pending.operation === "create") setIsPaying(true);
      void syncAlipayAutoRenewAfterReturn(pending).finally(() => {
        isSyncingAlipayReturnRef.current = false;
        if (isScreenAlive()) {
          setIsAutoRenewLoading(false);
          setIsPaying(false);
        }
      });
    });
    return () => subscription.remove();
  }, [isScreenAlive]);

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

  async function handleSelectPlan(productCode: MobilePaymentProductCode): Promise<void> {
    if (isAutoRenewLoading || isPaying || !hasLoadedAutoRenew) return;
    if (autoRenew?.pendingProductCode) {
      safeAlert(t("subscription.manager.pending_title"), formatPendingPlanLabel(autoRenew));
      return;
    }
    if (autoRenew?.status === "pending") {
      safeAlert(t("subscription.manager.confirming_title"), t("subscription.manager.confirming_message"));
      return;
    }
    if (hasActiveAutoRenew(autoRenew)) {
      if (autoRenew.productCode === productCode) {
        safeAlert(t("subscription.manager.current_title"), t("subscription.manager.current_message"));
        return;
      }
      if (autoRenew.cancelAtPeriodEnd) {
        safeAlert(t("subscription.manager.resume_first_title"), t("subscription.manager.resume_first_message"));
        return;
      }
      if (!canManageAutoRenewOnCurrentPlatform(autoRenew.provider)) {
        safeAlert(
          t("subscription.manager.original_platform_title"),
          tf("subscription.manager.original_platform_message", { provider: formatProviderName(autoRenew.provider) }),
        );
        return;
      }
      await handleChangePlan(autoRenew, productCode);
      return;
    }
    await handleStartAutoRenew(productCode);
  }

  async function handleChangePlan(
    subscription: MobileAutoRenewSubscription,
    targetProductCode: MobilePaymentProductCode,
    options?: { revertScheduledChange?: boolean },
  ): Promise<void> {
    setIsAutoRenewLoading(true);
    try {
      const prepared = await changeAutoRenewPlan({
        autoRenewSubscriptionId: subscription.id,
        targetProductCode,
      });
      pendingPlanChangeRef.current = {
        autoRenewSubscriptionId: subscription.id,
        targetProductCode,
        operation: options?.revertScheduledChange ? "revert" : "change",
      };
      if (subscription.provider === "alipay") {
        if (!prepared.jumpSchema) throw new Error("支付宝未返回方案切换链接");
        pendingAlipayReturnRef.current = {
          autoRenewSubscriptionId: subscription.id,
          productCode: targetProductCode,
          operation: "change",
        };
        if (!await openAlipayOrPromptInstall(prepared.jumpSchema)) {
          pendingAlipayReturnRef.current = null;
          pendingPlanChangeRef.current = null;
        }
        return;
      }
      if (subscription.provider === "apple") {
        applyAutoRenewToState({
          ...subscription,
          pendingProductCode: targetProductCode,
          pendingChangeStatus: "pending_confirmation",
          pendingChangeEffectiveAt: prepared.effectiveAt,
          pendingChangeRequestedAt: new Date().toISOString(),
        });
        await startAppleIapPurchase("auto_renew", targetProductCode, {
          allowExistingMembership: true,
          planChange: prepared,
        });
        return;
      }
      await startGooglePlaySubscriptionPurchase(targetProductCode, prepared);
    } catch (error) {
      await abandonPendingPlanChange();
      if (!isScreenAlive()) return;
      if (error instanceof MobileApiError && error.code === "AUTO_RENEW_NOT_FOUND") {
        const current = await getCurrentAutoRenewSubscription(8_000).catch(() => null);
        if (!isScreenAlive()) return;
        applyAutoRenewToState(current);
        const entitlement = await refreshProEntitlementState();
        if (!isScreenAlive()) return;
        if (
          !current &&
          entitlement &&
          !(entitlement?.entitlement.isMember ?? entitlement?.entitlement.isPro)
        ) {
          // The cached subscription expired between rendering the manager and
          // tapping a plan. Preserve the user's selection, but start a normal
          // store purchase instead of attempting to change a missing plan.
          await startAutoRenewPurchaseForCurrentPlatform(targetProductCode);
          return;
        }
      }
      const message = error instanceof Error ? error.message : t("app.delete.retry_later");
      safeAlert(t("subscription.manager.switch_failed"), message);
    } finally {
      if (isScreenAlive()) setIsAutoRenewLoading(false);
    }
  }

  async function abandonPendingPlanChange(): Promise<void> {
    const pending = pendingPlanChangeRef.current;
    if (!pending) return;
    pendingPlanChangeRef.current = null;
    try {
      await abandonAutoRenewPlanChange(pending);
      const current = await getCurrentAutoRenewSubscription(8_000);
      if (isScreenAlive()) applyAutoRenewToState(current);
    } catch {
      // The server reconciler is the fallback when the store result is ambiguous.
    }
  }

  async function handleStartAutoRenew(productCode: MobilePaymentProductCode): Promise<void> {
    if (isAutoRenewLoading) return;
    if (isRenew) {
      const sourceType = currentEntitlement?.membershipSource?.type;
      if (sourceType !== "manual" && sourceType !== "legacy") {
        safeAlert(t("pro.alert.pro_active_title"), t("pro.alert.pro_active_subscribe_later"));
        return;
      }
    }

    if (hasActiveAutoRenew(autoRenew)) {
      safeAlert(t("pro.alert.auto_active_title"), tf("pro.alert.auto_active_message", { provider: formatProviderName(autoRenew.provider) }));
      return;
    }

    await startAutoRenewPurchaseForCurrentPlatform(productCode);
  }

  async function startAutoRenewPurchaseForCurrentPlatform(
    productCode: MobilePaymentProductCode,
  ): Promise<void> {
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
      pendingAlipayReturnRef.current = {
        autoRenewSubscriptionId: created.autoRenewSubscriptionId,
        productCode,
        operation: "create",
      };
      if (!await openAlipayOrPromptInstall(created.jumpSchema)) {
        pendingAlipayReturnRef.current = null;
      }
    } catch (error) {
      pendingAlipayReturnRef.current = null;
      if (!isScreenAlive()) return;
      const message = error instanceof Error ? error.message : t("app.delete.retry_later");
      safeAlert(t("pro.alert.payment_start_failed"), message);
    } finally {
      if (isScreenAlive()) { setIsAutoRenewLoading(false); setIsPaying(false); }
    }
  }

  async function syncAlipayAutoRenewAfterReturn(input: {
    autoRenewSubscriptionId: string;
    productCode: MobilePaymentProductCode;
    operation: "create" | "resume" | "change";
  }): Promise<void> {
    try {
      const current = await getCurrentAutoRenewSubscription(8_000);
      if (!isScreenAlive()) return;
      applyAutoRenewToState(current);
      const entitlementResult = await refreshProEntitlementState();
      if (!isScreenAlive()) return;
      if (input.operation === "resume") {
        if (current?.id === input.autoRenewSubscriptionId && hasActiveAutoRenew(current) && !current.cancelAtPeriodEnd) {
          safeAlert(t("pro.alert.resume_success_title"), t("pro.alert.resume_success_message"));
        }
        return;
      }
      if (input.operation === "change") {
        if (current?.pendingProductCode === input.productCode) {
          safeAlert(t("subscription.manager.switch_submitted"), formatPlanChangeEffectiveText(current.pendingChangeEffectiveAt));
        }
        return;
      }
      if (entitlementResult?.entitlement.isMember ?? entitlementResult?.entitlement.isPro) {
        setIsRenew(true);
        alertOpenSuccess({ entitlement: entitlementResult?.entitlement, productCode: input.productCode });
        return;
      }
      if (current?.id === input.autoRenewSubscriptionId && current.status === "pending") {
        safeAlert(t("pro.alert.payment_unfinished_title"), t("pro.alert.alipay_unfinished_message"));
      }
    } catch {
      if (isScreenAlive()) {
        safeAlert(t("pro.alert.payment_processing_title"), t("pro.alert.payment_processing_message"));
      }
    }
  }

  async function startGooglePlaySubscriptionPurchase(
    productCode: MobilePaymentProductCode,
    planChange?: MobilePlanChangeResult,
  ): Promise<void> {
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
      if (
        !planChange &&
        (latestEntitlement?.entitlement.isMember ?? latestEntitlement?.entitlement.isPro) &&
        !isManualOrLegacyEntitlement(latestEntitlement?.entitlement)
      ) {
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
      const oldProductId = autoRenew ? getGooglePlayProductId(autoRenew.productCode) : null;
      const replacementMode = planChange?.googlePlayReplacementMode === "CHARGE_PRORATED_PRICE"
        ? "charge-prorated-price" as const
        : planChange?.googlePlayReplacementMode === "DEFERRED"
          ? "deferred" as const
          : null;
      const existingPurchase = oldProductId && replacementMode
        ? (await getAvailablePurchases())
          .filter((purchase) => purchase.productId === oldProductId)
          .sort((left, right) => Number(right.transactionDate ?? 0) - Number(left.transactionDate ?? 0))[0]
        : null;
      const oldPurchaseToken = existingPurchase ? getGooglePlayPurchaseToken(existingPurchase) : null;
      if (oldProductId && replacementMode && !oldPurchaseToken) {
        throw new Error("Google Play current subscription purchase token is unavailable. Restore purchases and try again.");
      }
      const isRevertingScheduledChange = Boolean(
        planChange &&
        autoRenew?.pendingProductCode &&
        productCode === autoRenew.productCode
      );
      // Play normally issues a new token for another replacement. If a Play
      // Store version reports the current token again while reverting, allow
      // the purchase listener to verify it instead of treating it as a replay.
      if (isRevertingScheduledChange && oldPurchaseToken) {
        handledGooglePlayPurchaseTokensRef.current.delete(oldPurchaseToken);
      }
      const purchaseResult = await appleIap.requestPurchase({
        type: "subs",
        request: {
          google: {
            skus: [productId],
            obfuscatedAccountId,
            subscriptionOffers: [{ sku: productId, offerToken }],
            ...(oldPurchaseToken && replacementMode ? {
              purchaseToken: oldPurchaseToken,
              // expo-iap 4.3.1 only supports this purchase-level replacement
              // path reliably. Billing 8 item-level params require a native
              // bridge update because the installed bridge sets both APIs.
              replacementMode: replacementMode === "charge-prorated-price" ? 2 : 6,
            } : {}),
          },
        },
      });
      if (isEmptyApplePurchaseResult(purchaseResult)) {
        googlePlayPurchaseIntentRef.current = false;
        await abandonPendingPlanChange();
        if (!isScreenAlive()) return;
        setIsPaying(false);
        setIsAutoRenewLoading(false);
      }
    } catch (error) {
      googlePlayPurchaseIntentRef.current = false;
      await abandonPendingPlanChange();
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
    if (!autoRenew || !manageableAutoRenew || !canManageAutoRenewOnCurrentPlatform(autoRenew.provider)) return;
    if (autoRenew.provider !== "alipay") {
      await openStoreSubscriptionManagement(autoRenew, "cancel");
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

  async function handleResumeAutoRenew(): Promise<void> {
    if (
      !autoRenew ||
      !restorableAutoRenew ||
      !canManageAutoRenewOnCurrentPlatform(autoRenew.provider)
    ) return;
    if (autoRenew.provider !== "alipay") {
      await openStoreSubscriptionManagement(autoRenew, "resume");
      return;
    }

    setIsAutoRenewLoading(true);
    try {
      const resumed = await resumeAlipayAutoRenewSubscription(autoRenew.id);
      pendingAlipayReturnRef.current = {
        autoRenewSubscriptionId: autoRenew.id,
        productCode: autoRenew.productCode,
        operation: "resume",
      };
      if (!await openAlipayOrPromptInstall(resumed.jumpSchema)) {
        pendingAlipayReturnRef.current = null;
      }
    } catch (error) {
      pendingAlipayReturnRef.current = null;
      if (!isScreenAlive()) return;
      const message = error instanceof Error ? error.message : t("app.delete.retry_later");
      safeAlert(t("pro.alert.resume_failed_title"), message);
    } finally {
      if (isScreenAlive()) setIsAutoRenewLoading(false);
    }
  }

  function handlePendingPlanChange(action: "modify" | "cancel"): void {
    if (
      !autoRenew?.pendingProductCode ||
      !canManageAutoRenewOnCurrentPlatform(autoRenew.provider) ||
      (autoRenew.provider === "alipay" && !autoRenew.managementUrl)
    ) return;

    if (action === "modify") {
      void openStoreSubscriptionManagement(autoRenew, "plan_change");
      return;
    }

    Alert.alert(
      t("subscription.manager.cancel_change_title"),
      tf(
        autoRenew.provider === "google_play"
          ? "subscription.manager.cancel_change_google_message"
          : "subscription.manager.cancel_change_message",
        { plan: formatProductCode(autoRenew.productCode) },
      ),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.continue"),
          onPress: () => void (
            autoRenew.provider === "google_play"
              ? handleChangePlan(autoRenew, autoRenew.productCode, { revertScheduledChange: true })
              : openStoreSubscriptionManagement(autoRenew, "plan_change")
          ),
        },
      ],
    );
  }

  async function openStoreSubscriptionManagement(
    subscription: MobileAutoRenewSubscription,
    operation: "cancel" | "resume" | "plan_change",
  ): Promise<void> {
    pendingStoreManagementReturnRef.current = operation;
    try {
      if (subscription.provider === "apple") {
        await showManageSubscriptionsIOS();
        const pendingOperation = pendingStoreManagementReturnRef.current;
        pendingStoreManagementReturnRef.current = null;
        if (pendingOperation && !isSyncingStoreManagementRef.current) {
          isSyncingStoreManagementRef.current = true;
          setIsAutoRenewLoading(true);
          try {
            await syncAutoRenewAfterStoreManagement(pendingOperation);
          } finally {
            isSyncingStoreManagementRef.current = false;
            if (isScreenAlive()) setIsAutoRenewLoading(false);
          }
        }
        return;
      }
      const url = subscription.provider === "alipay"
        ? subscription.managementUrl
        : "https://play.google.com/store/account/subscriptions" +
          `?sku=${encodeURIComponent(getGooglePlayProductId(subscription.productCode))}` +
          "&package=com.yueyantech.oio";
      if (!url) throw new Error(t("pro.alert.subscription_management_unavailable"));
      await Linking.openURL(url);
    } catch (error) {
      pendingStoreManagementReturnRef.current = null;
      const message = error instanceof Error ? error.message : t("app.delete.retry_later");
      safeAlert(t("pro.alert.subscription_manage_failed_title"), message);
    }
  }

  async function openAlipayOrPromptInstall(jumpSchema: string): Promise<boolean> {
    try {
      await Linking.openURL(jumpSchema);
      return true;
    } catch {
      if (!isScreenAlive()) return false;
      Alert.alert(
        t("pro.alert.alipay_required_title"),
        t("pro.alert.alipay_required_message"),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("pro.alert.alipay_install"),
            onPress: () => void openAlipayInstallPage(),
          },
        ]
      );
      return false;
    }
  }

  async function openAlipayInstallPage(): Promise<void> {
    try {
      await Linking.openURL(ALIPAY_ANDROID_MARKET_URL);
    } catch {
      try {
        await Linking.openURL(ALIPAY_DOWNLOAD_FALLBACK_URL);
      } catch {
        if (isScreenAlive()) {
          safeAlert(t("pro.alert.alipay_install_failed_title"), t("pro.alert.alipay_install_failed_message"));
        }
      }
    }
  }

  async function syncAutoRenewAfterStoreManagement(operation: "cancel" | "resume" | "plan_change"): Promise<void> {
    try {
      const current = await getCurrentAutoRenewSubscription(8_000);
      if (!isScreenAlive()) return;
      applyAutoRenewToState(current);
      await refreshProEntitlementState();
      if (!isScreenAlive()) return;
      if (operation === "resume" && current && hasActiveAutoRenew(current) && !current.cancelAtPeriodEnd) {
        safeAlert(t("pro.alert.resume_success_title"), t("pro.alert.resume_success_message"));
      }
    } catch {
      // Store notifications and the payment worker remain the fallback if the provider is briefly stale.
    }
  }

  async function startAppleIapPurchase(
    source: ApplePurchaseSource,
    productCode: MobilePaymentProductCode = "pro_monthly",
    options?: { allowExistingMembership?: boolean; planChange?: MobilePlanChangeResult },
  ): Promise<void> {
    assertAppleIapAvailable(source, productCode);
    if (!appleIap?.connected) {
      if (options?.planChange) await abandonPendingPlanChange();
      safeAlert(t("pro.alert.apple_init_title"), t("app.delete.retry_later"));
      return;
    }
    const productId = getAppleProductIdForSource(source, productCode);
    if (!hasLoadedAppleProduct(appleIap, source, productId)) {
      if (options?.planChange) await abandonPendingPlanChange();
      safeAlert(t("pro.alert.apple_product_loading_title"), t("pro.alert.apple_product_loading_message"));
      return;
    }
    setIsPaying(true);
    setIsAutoRenewLoading(true);
    try {
      const latestEntitlement = await refreshProEntitlementState();
      if (!isScreenAlive()) return;
      if (
        !options?.allowExistingMembership &&
        (latestEntitlement?.entitlement.isMember ?? latestEntitlement?.entitlement.isPro) &&
        !isManualOrLegacyEntitlement(latestEntitlement?.entitlement)
      ) {
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
      startApplePurchaseTimeout(options?.planChange);
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
        await abandonPendingPlanChange();
        if (!isScreenAlive()) return;
        setIsPaying(false);
        setIsAutoRenewLoading(false);
      }
    } catch (error) {
      clearApplePurchaseTimeout();
      applePurchaseIntentRef.current = false;
      await abandonPendingPlanChange();
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
      pendingPlanChangeRef.current = null;
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
        promptAppleSubscriptionTransfer(getAppleTransactionId(existingSubscription));
        return true;
      }
      safeAlert(t("pro.alert.apple_verify_failed"), formatApplePaymentErrorMessage(error));
      return true;
    }
  }

  function promptAppleSubscriptionTransfer(transactionId: string): void {
    if (!isScreenAlive()) return;
    Alert.alert(
      t("pro.alert.apple_transfer_title"),
      t("pro.alert.apple_transfer_message"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("pro.alert.apple_transfer_action"),
          onPress: () => void transferAppleSubscriptionToCurrentAccount(transactionId),
        },
      ],
    );
  }

  async function transferAppleSubscriptionToCurrentAccount(transactionId: string): Promise<void> {
    if (isAutoRenewLoading || isPaying) return;
    setIsAutoRenewLoading(true);
    setIsPaying(true);
    try {
      await verifyAppleProMonthlyTransaction(transactionId, {
        allowAccountTransfer: true,
      });
      const entitlementResult = await refreshProEntitlementState();
      if (!isScreenAlive()) return;
      setIsRenew(entitlementResult?.entitlement.isMember ?? entitlementResult?.entitlement.isPro ?? true);
      const currentAutoRenew = await getCurrentAutoRenewSubscription();
      if (!isScreenAlive()) return;
      applyAutoRenewToState(currentAutoRenew);
      safeAlert(
        t("pro.alert.apple_transfer_success_title"),
        t("pro.alert.apple_transfer_success_message"),
      );
    } catch (error) {
      if (!isScreenAlive()) return;
      safeAlert(
        t("pro.alert.apple_transfer_failed_title"),
        formatApplePaymentErrorMessage(error),
      );
    } finally {
      if (isScreenAlive()) {
        setIsPaying(false);
        setIsAutoRenewLoading(false);
      }
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
      pendingPlanChangeRef.current = null;
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
          purchase.productId === APPLE_PLUS_YEARLY_SUBSCRIPTION_PRODUCT_ID ||
          purchase.productId === APPLE_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID ||
          purchase.productId === APPLE_PRO_YEARLY_SUBSCRIPTION_PRODUCT_ID
        ) {
          await appleIap?.finishTransaction({
            purchase,
            isConsumable: false,
          }).catch(() => { });
        }
        if (isUserInitiatedPurchase) {
          promptAppleSubscriptionTransfer(getAppleTransactionId(purchase));
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
      const planChangeIntent = pendingPlanChangeRef.current;
      const verified = await verifyGooglePlaySubscriptionPurchase({
        productId: purchase.productId,
        purchaseToken,
        obfuscatedAccountId,
      });
      pendingPlanChangeRef.current = null;
      if (!appleIap) throw new Error(t("pro.alert.google_not_initialized"));
      await appleIap.finishTransaction({ purchase, isConsumable: false });
      const entitlementResult = await refreshProEntitlementState();
      const currentAutoRenew = await getCurrentAutoRenewSubscription();
      if (!isScreenAlive()) return;
      setIsRenew(entitlementResult?.entitlement.isMember ?? entitlementResult?.entitlement.isPro ?? true);
      applyAutoRenewToState(currentAutoRenew);
      if (isUserInitiatedPurchase) {
        if (planChangeIntent?.operation === "revert") {
          safeAlert(
            t(currentAutoRenew?.pendingProductCode
              ? "subscription.manager.cancel_change_confirming_title"
              : "subscription.manager.cancel_change_success_title"),
            t(currentAutoRenew?.pendingProductCode
              ? "subscription.manager.cancel_change_confirming_message"
              : "subscription.manager.cancel_change_success_message"),
          );
        } else if (currentAutoRenew?.pendingProductCode) {
          safeAlert(
            t("subscription.manager.switch_submitted"),
            formatPendingPlanLabel(currentAutoRenew),
          );
        } else {
          alertOpenSuccess({
            entitlement: entitlementResult?.entitlement,
            productCode: currentAutoRenew?.productCode ?? verified.productCode,
          });
        }
      }
    } catch (error) {
      if (purchaseToken) {
        handledGooglePlayPurchaseTokensRef.current.delete(purchaseToken);
      }
      if (!isScreenAlive()) return;
      if (isGooglePlaySubscriptionOwnedByDifferentAccount(error) && purchaseToken && isUserInitiatedPurchase) {
        promptGooglePlaySubscriptionTransfer(purchase, purchaseToken);
        return;
      }
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

  function promptGooglePlaySubscriptionTransfer(purchase: Purchase, purchaseToken: string): void {
    if (!isScreenAlive()) return;
    Alert.alert(
      t("pro.alert.google_transfer_title"),
      t("pro.alert.google_transfer_message"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("pro.alert.google_transfer_action"),
          onPress: () => void transferGooglePlaySubscriptionToCurrentAccount(purchase, purchaseToken),
        },
      ],
    );
  }

  async function transferGooglePlaySubscriptionToCurrentAccount(
    purchase: Purchase,
    purchaseToken: string,
  ): Promise<void> {
    if (isAutoRenewLoading || isPaying) return;
    setIsAutoRenewLoading(true);
    setIsPaying(true);
    try {
      const session = await getSession();
      const obfuscatedAccountId = session?.user.id
        ? await createGooglePlayObfuscatedAccountId(session.user.id)
        : null;
      await verifyGooglePlaySubscriptionPurchase({
        productId: purchase.productId,
        purchaseToken,
        obfuscatedAccountId,
        allowAccountTransfer: true,
      });
      await appleIap?.finishTransaction({ purchase, isConsumable: false }).catch(() => {});
      const entitlementResult = await refreshProEntitlementState();
      const currentAutoRenew = await getCurrentAutoRenewSubscription();
      if (!isScreenAlive()) return;
      setIsRenew(entitlementResult?.entitlement.isMember ?? entitlementResult?.entitlement.isPro ?? true);
      applyAutoRenewToState(currentAutoRenew);
      handledGooglePlayPurchaseTokensRef.current.add(purchaseToken);
      safeAlert(t("pro.alert.google_transfer_success_title"), t("pro.alert.google_transfer_success_message"));
    } catch (error) {
      if (!isScreenAlive()) return;
      safeAlert(t("pro.alert.google_transfer_failed_title"), formatGooglePlayPaymentErrorMessage(error));
    } finally {
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
      let boundTransactionId: string | null = null;
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
          if (isAppleTransactionOwnedByDifferentAccount(error)) {
            boundTransactionId = getAppleTransactionId(purchase);
          }
        }
      }

      if (isAppleTransactionOwnedByDifferentAccount(lastError)) {
        if (!silentFailure) {
          if (boundTransactionId) promptAppleSubscriptionTransfer(boundTransactionId);
          else safeAlert(t("pro.alert.restore_failed_title"), t("pro.alert.restore_wrong_account"));
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
      let boundPurchase: Purchase | null = null;
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
          if (isGooglePlaySubscriptionOwnedByDifferentAccount(error)) boundPurchase = purchase;
        }
      }
      if (isScreenAlive()) {
        if (boundPurchase) {
          promptGooglePlaySubscriptionTransfer(boundPurchase, getGooglePlayPurchaseToken(boundPurchase));
          return;
        }
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
    if (isRenew) return;
    if (isRedeemingAppleOffer || isRestoringApplePurchases || isPaying || isAutoRenewLoading) return;

    setIsRedeemingAppleOffer(true);
    try {
      const latestEntitlement = await refreshProEntitlementState();
      if (!isScreenAlive()) return;
      if (latestEntitlement?.entitlement.isMember ?? latestEntitlement?.entitlement.isPro) {
        setIsRenew(true);
        return;
      }
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

  const iapBridge = Platform.OS === "ios" || (Platform.OS === "android" && !IS_CHINA_ANDROID) ? (
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
          console.warn(
            "[GooglePlayBilling] purchase_error",
            JSON.stringify(readGooglePlayPurchaseErrorDiagnostics(error)),
          );
          const isUserInitiatedPurchase = googlePlayPurchaseIntentRef.current;
          googlePlayPurchaseIntentRef.current = false;
          void abandonPendingPlanChange();
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
        void abandonPendingPlanChange();
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
    const visibleTiers: Array<"plus" | "pro"> = ["plus", "pro"];
    const purchaseBusy = isAutoRenewLoading || isPaying || !hasLoadedAutoRenew;
    const compactAutoRenewStatus = resolveCompactAutoRenewStatus({ autoRenew, hasLoadedAutoRenew });
    const compactAutoRenewTone = !hasLoadedAutoRenew || autoRenew?.status === "pending"
      ? "neutral"
      : activeAutoRenew && autoRenew.cancelAtPeriodEnd
        ? "warning"
        : activeAutoRenew
          ? "active"
          : "neutral";
    return (
      <View style={styles.compactContainer}>
        {iapBridge}
        <PointsUsageSheet visible={pointsUsageVisible} onClose={() => setPointsUsageVisible(false)} />
        <View style={styles.compactPlanGrid}>
          <View style={[styles.compactPlanCard, currentTier === "free" && styles.compactPlanCardCurrent]}>
            <View style={styles.compactPlanTitleRow}>
              <Text style={styles.compactPlanTitle}>Free</Text>
              {currentTier === "free" ? <Text style={styles.compactCurrentBadge}>{t("pro.compact.current")}</Text> : null}
            </View>
            <View style={styles.compactBenefitList}>
              {[t("pro.compact.free.basic_ai"), t("pro.compact.free.images")].map((benefit, index) => <View key={benefit} style={styles.compactBenefitRow}>
                <Ionicons name="checkmark-circle-outline" size={15} color="#444444" style={styles.compactBenefitIcon} />
                <View style={styles.compactBenefitContent}>
                  <Text style={[styles.compactBenefitText, styles.compactBenefitLabel]}>{benefit}</Text>
                  {index === 0 ? <Pressable accessibilityRole="button" accessibilityLabel={t("pro.points.title")} hitSlop={10} style={styles.pointsInfoButton} onPress={() => setPointsUsageVisible(true)}><Ionicons name="information-circle-outline" size={15} color="#999999" /></Pressable> : null}
                </View>
              </View>)}
            </View>
          </View>
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
                  t("pro.compact.dictation"),
                  t("pro.compact.custom_material"),
                ];
            return (
              <View key={tier} style={[styles.compactPlanCard, currentTier === tier && styles.compactPlanCardCurrent]}>
                <View style={styles.compactPlanTitleRow}>
                  <Text style={styles.compactPlanTitle}>{isPlus ? "Plus" : "Pro"}</Text>
                  {currentTier === tier ? <Text style={styles.compactCurrentBadge}>{t("pro.compact.current")}</Text> : null}
                </View>
                <View style={styles.compactBenefitList}>
                  {benefits.map((benefit, index) => (
                    <View key={benefit} style={styles.compactBenefitRow}>
                      <Ionicons name="checkmark-circle-outline" size={15} color="#444444" style={styles.compactBenefitIcon} />
                      <View style={styles.compactBenefitContent}>
                  <Text style={[styles.compactBenefitText, styles.compactBenefitLabel]}>{benefit}</Text>
                  {index === 0 ? <Pressable accessibilityRole="button" accessibilityLabel={t("pro.points.title")} hitSlop={10} style={styles.pointsInfoButton} onPress={() => setPointsUsageVisible(true)}><Ionicons name="information-circle-outline" size={15} color="#999999" /></Pressable> : null}
                </View>
                    </View>
                  ))}
                </View>
                {currentTier === tier && proExpiresAt ? (
                  <Text style={styles.compactExpiry}>{tf("pro.valid_until", { date: formatDate(proExpiresAt) })}</Text>
                ) : null}
                {currentTier === tier ? (
                  <View style={styles.compactAutoRenewRow}>
                    <View style={styles.compactAutoRenewStatus}>
                      <View
                        style={[
                          styles.compactAutoRenewDot,
                          compactAutoRenewTone === "active"
                            ? styles.compactAutoRenewDotActive
                            : compactAutoRenewTone === "warning"
                              ? styles.compactAutoRenewDotWarning
                              : styles.compactAutoRenewDotNeutral,
                        ]}
                      />
                      <Text numberOfLines={2} style={styles.compactAutoRenewStatusText}>
                        {compactAutoRenewStatus}
                      </Text>
                    </View>
                    {manageableAutoRenew || restorableAutoRenew ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={restorableAutoRenew ? t("pro.auto.resume") : t("pro.auto.cancel")}
                        style={[
                          styles.compactAutoRenewAction,
                          restorableAutoRenew && styles.compactAutoRenewActionPrimary,
                          isAutoRenewLoading && styles.subscribeButtonDisabled,
                        ]}
                        disabled={isAutoRenewLoading}
                        onPress={() => void (restorableAutoRenew ? handleResumeAutoRenew() : handleManageAutoRenew())}
                      >
                        {isAutoRenewLoading ? (
                          <ActivityIndicator size="small" color={restorableAutoRenew ? "#8A6218" : "#666666"} />
                        ) : (
                          <Text
                            style={[
                              styles.compactAutoRenewActionText,
                              restorableAutoRenew && styles.compactAutoRenewActionTextPrimary,
                            ]}
                          >
                            {restorableAutoRenew ? t("pro.auto.resume") : t("pro.auto.cancel")}
                          </Text>
                        )}
                      </Pressable>
                    ) : null}
                  </View>
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
        {Platform.OS === "ios" && currentTier === "free" ? (
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
        {currentTier === "free" && (Platform.OS === "ios" || (Platform.OS === "android" && !IS_CHINA_ANDROID)) ? (
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

  const selectedProducts = (["plus", "pro"] as const).map((tier) => {
    const productCode = subscriptionProductCode(tier, billingPeriod);
    return {
      tier,
      productCode,
      price: resolveSubscriptionPrice(appleIap, catalogProducts, productCode),
      discount: resolveAnnualDiscount(appleIap, catalogProducts, tier),
    };
  });
  const currentTier = currentEntitlement?.tier ?? "free";
  const canChoosePlan = hasLoadedAutoRenew && !isAutoRenewLoading && !isPaying;

  return (
    <SafeAreaView style={styles.container}>
      {iapBridge}
      <PointsUsageSheet visible={pointsUsageVisible} onClose={() => setPointsUsageVisible(false)} />
      <View style={styles.header}>
        <Pressable accessibilityLabel={t("subscription.manager.back")} style={styles.backButton} onPress={onBack} hitSlop={10}>
          <Ionicons name="arrow-back" size={24} color="#111111" />
        </Pressable>
        <Text style={styles.headerTitle}>{t("subscription.manager.title")}</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.managerContent} alwaysBounceVertical={false}>
        <View style={styles.currentAccessCard}>
          <Text style={styles.managerEyebrow}>{t("pro.current.title")}</Text>
          <View style={styles.managerCurrentRow}>
            <Text style={styles.managerCurrentTier}>{currentTier === "free" ? "Free" : currentTier === "plus" ? "Plus" : "Pro"}</Text>
            {currentEntitlement?.membershipSource?.type === "manual" ? <Text style={styles.manualBadge}>{t("subscription.manager.manual")}</Text> : null}
          </View>
          <Text style={styles.managerMeta}>{quotaBenefit.subtitle}</Text>
          {membershipStatusLabel ? <Text style={styles.managerMeta}>{membershipStatusLabel}</Text> : null}
        </View>

        <View style={styles.currentSubscriptionCard}>
          <View style={styles.managerSectionHead}>
            <Text style={styles.managerSectionTitle}>{t("subscription.manager.current_subscription")}</Text>
            {manageableAutoRenew || restorableAutoRenew ? (
              <Pressable onPress={() => void (restorableAutoRenew ? handleResumeAutoRenew() : handleManageAutoRenew())}>
                <Text style={styles.managerLink}>{t(restorableAutoRenew ? "subscription.manager.resume_renewal" : "subscription.manager.manage_renewal")}</Text>
              </Pressable>
            ) : null}
          </View>
          {autoRenew ? (
            <>
              <Text style={styles.subscriptionName}>{formatProductCode(autoRenew.productCode)} · {formatProviderName(autoRenew.provider)}</Text>
              <Text style={styles.managerMeta}>{autoRenewDescription}</Text>
              {autoRenew.pendingProductCode ? (
                <View style={styles.pendingPlanBox}>
                  <Text style={styles.pendingPlanTitle}>{tf("subscription.manager.pending", { plan: formatProductCode(autoRenew.pendingProductCode) })}</Text>
                  <Text style={styles.pendingPlanText}>{formatPlanChangeEffectiveText(autoRenew.pendingChangeEffectiveAt)}</Text>
                  {canManageAutoRenewOnCurrentPlatform(autoRenew.provider) &&
                  (autoRenew.provider !== "alipay" || autoRenew.managementUrl) ? (
                    <View style={styles.pendingPlanActions}>
                      <Pressable onPress={() => handlePendingPlanChange("modify")}>
                        <Text style={styles.pendingPlanAction}>{t("subscription.manager.modify_change")}</Text>
                      </Pressable>
                      <Pressable onPress={() => handlePendingPlanChange("cancel")}>
                        <Text style={styles.pendingPlanAction}>{t("subscription.manager.cancel_change")}</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </>
          ) : (
            <Text style={styles.managerMeta}>{t(hasLoadedAutoRenew ? "subscription.manager.no_subscription" : "subscription.manager.syncing")}</Text>
          )}
        </View>

        <View style={styles.planChooserHead}>
          <View style={styles.planChooserTitleRow}>
            <Text style={styles.managerSectionTitle}>{t("subscription.manager.choose_plan")}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("subscription.manager.switch_rules_title")}
              hitSlop={10}
              onPress={() => Alert.alert(
                t("subscription.manager.switch_rules_title"),
                t("subscription.manager.switch_rules_message"),
                [{ text: t("common.got_it") }],
              )}
            >
              <Ionicons name="information-circle-outline" size={18} color="#777064" />
            </Pressable>
          </View>
          <View style={styles.periodToggle}>
            {(["month", "year"] as const).map((period) => (
              <Pressable
                key={period}
                style={[styles.periodOption, billingPeriod === period && styles.periodOptionActive]}
                onPress={() => setBillingPeriod(period)}
              >
                <Text style={[styles.periodOptionText, billingPeriod === period && styles.periodOptionTextActive]}>
                  {t(period === "month" ? "subscription.manager.monthly" : "subscription.manager.yearly")}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.managerPlanGrid}>
          {selectedProducts.map(({ tier, productCode, price, discount }) => {
            const isCurrent = autoRenew?.productCode === productCode && !autoRenew.pendingProductCode;
            const isPending = autoRenew?.pendingProductCode === productCode;
            const benefits = tier === "plus"
              ? [resolveTokenBenefit("plus", productQuotes.plus_monthly?.monthlyTokenLimit), resolveImageBenefit("plus", productQuotes.plus_monthly?.monthlyImageUploadBytes), t("pro.compact.assistant")]
              : [resolveTokenBenefit("pro", productQuotes.pro_monthly?.monthlyTokenLimit), resolveImageBenefit("pro", productQuotes.pro_monthly?.monthlyImageUploadBytes), t("pro.compact.assistant"), t("pro.compact.dictation")];
            return (
              <View key={productCode} style={[styles.managerPlanCard, tier === "pro" && styles.managerPlanCardFeatured]}>
                <View style={styles.managerPlanTitleRow}>
                  <Text style={styles.managerPlanTitle}>{tier === "plus" ? "Plus" : "Pro"}</Text>
                  {billingPeriod === "year" && discount ? <Text style={styles.savingBadge}>{tf("subscription.manager.saving", { percent: discount })}</Text> : null}
                </View>
                <View style={styles.managerPriceRow}>
                  <Text style={styles.managerPrice}>{price ?? "--"}</Text>
                  <Text style={styles.managerPricePeriod}>{t(billingPeriod === "year" ? "subscription.manager.year_unit" : "subscription.manager.month_unit")}</Text>
                </View>
                <View style={styles.managerBenefits}>
                  {benefits.map((benefit) => (
                    <View key={benefit} style={styles.managerBenefitRow}>
                      <Ionicons name="checkmark" size={15} color="#333333" />
                      <Text style={styles.managerBenefitText}>{benefit}</Text>
                    </View>
                  ))}
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={!canChoosePlan || isCurrent || isPending}
                  style={[styles.managerPlanButton, tier === "plus" && styles.managerPlanButtonSecondary, (!canChoosePlan || isCurrent || isPending) && styles.subscribeButtonDisabled]}
                  onPress={() => void handleSelectPlan(productCode)}
                >
                  {isAutoRenewLoading || isPaying ? <ActivityIndicator color={tier === "pro" ? "#FFFFFF" : "#111111"} /> : (
                    <Text style={[styles.managerPlanButtonText, tier === "plus" && styles.managerPlanButtonTextSecondary]}>
                      {isPending
                        ? t("subscription.manager.waiting")
                        : isCurrent
                          ? t("subscription.manager.current")
                          : tf(autoRenew ? "subscription.manager.switch_to" : "subscription.manager.select", { plan: tier === "plus" ? "Plus" : "Pro" })}
                    </Text>
                  )}
                </Pressable>
              </View>
            );
          })}
        </View>

        <View style={styles.managerFooterActions}>
          {Platform.OS === "ios" ? <Pressable disabled={isRedeemingAppleOffer} onPress={() => void handleRedeemAppleOfferCode()}><Text style={styles.managerFooterLink}>{t("subscription.manager.redeem")}</Text></Pressable> : null}
          {Platform.OS === "ios" || (Platform.OS === "android" && !IS_CHINA_ANDROID) ? (
            <Pressable disabled={isRestoringApplePurchases || isRestoringGooglePlayPurchases} onPress={() => void (Platform.OS === "android" ? handleRestoreGooglePlayPurchases() : handleRestoreApplePurchases())}>
              <Text style={styles.managerFooterLink}>{t("subscription.manager.restore")}</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.managerFootnote}>{tf("subscription.manager.footnote", { provider: formatAutoRenewProviderLabel() })}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

export const SubscriptionManagementScreen = ProScreen;

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
          GOOGLE_PLAY_PLUS_YEARLY_SUBSCRIPTION_PRODUCT_ID,
          GOOGLE_PLAY_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID,
          GOOGLE_PLAY_PRO_YEARLY_SUBSCRIPTION_PRODUCT_ID,
        ].filter(Boolean),
        type: "subs",
      });
      return;
    }
    if (Platform.OS === "ios") {
      void iap.fetchProducts({
        skus: [
          APPLE_PLUS_MONTHLY_SUBSCRIPTION_PRODUCT_ID,
          APPLE_PLUS_YEARLY_SUBSCRIPTION_PRODUCT_ID,
          APPLE_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID,
          APPLE_PRO_YEARLY_SUBSCRIPTION_PRODUCT_ID,
        ].filter(Boolean),
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

function formatProductCode(productCode: MobilePaymentProductCode): string {
  const tier = subscriptionTier(productCode) === "plus" ? "Plus" : "Pro";
  return `${tier} ${t(subscriptionBillingPeriod(productCode) === "year" ? "subscription.manager.yearly" : "subscription.manager.monthly")}`;
}

function formatPlanChangeEffectiveText(value: string | null | undefined): string {
  return value
    ? tf("subscription.manager.effective_at", { date: formatDate(value) })
    : t("subscription.manager.pending_confirmation");
}

function formatPendingPlanLabel(subscription: MobileAutoRenewSubscription): string {
  if (!subscription.pendingProductCode) return "已有方案正在处理中。";
  return `${formatProductCode(subscription.pendingProductCode)} · ${formatPlanChangeEffectiveText(subscription.pendingChangeEffectiveAt)}`;
}

function isManualOrLegacyEntitlement(entitlement: CurrentEntitlement | null | undefined): boolean {
  return entitlement?.membershipSource?.type === "manual" || entitlement?.membershipSource?.type === "legacy";
}

function resolveSubscriptionPrice(
  iap: AppleIapBridgeState | null,
  catalog: MobilePaymentCatalogProduct[],
  productCode: MobilePaymentProductCode,
): string | null {
  if (Platform.OS === "ios") {
    return iap?.subscriptions.find((product) => product.id === getAppleProductIdForSource("auto_renew", productCode))?.displayPrice
      ?? (__DEV__ ? IOS_DEVELOPMENT_PRICE_LABELS[productCode] : null);
  }
  if (IS_CHINA_ANDROID) {
    return catalog.find((product) => product.productCode === productCode)?.alipay.displayPrice ?? null;
  }
  if (Platform.OS === "android") {
    return iap?.subscriptions.find((product) => product.id === getGooglePlayProductId(productCode))?.displayPrice ?? null;
  }
  return null;
}

function resolveSubscriptionNumericPrice(
  iap: AppleIapBridgeState | null,
  catalog: MobilePaymentCatalogProduct[],
  productCode: MobilePaymentProductCode,
): number | null {
  if (Platform.OS === "ios") {
    return iap?.subscriptions.find((product) => product.id === getAppleProductIdForSource("auto_renew", productCode))?.price
      ?? (__DEV__ ? IOS_DEVELOPMENT_PRICES[productCode] : null);
  }
  if (IS_CHINA_ANDROID) {
    return catalog.find((product) => product.productCode === productCode)?.alipay.amount ?? null;
  }
  if (Platform.OS === "android") {
    return iap?.subscriptions.find((product) => product.id === getGooglePlayProductId(productCode))?.price ?? null;
  }
  return null;
}

function resolveAnnualDiscount(
  iap: AppleIapBridgeState | null,
  catalog: MobilePaymentCatalogProduct[],
  tier: "plus" | "pro",
): number | null {
  const monthly = resolveSubscriptionNumericPrice(iap, catalog, subscriptionProductCode(tier, "month"));
  const yearly = resolveSubscriptionNumericPrice(iap, catalog, subscriptionProductCode(tier, "year"));
  if (!monthly || !yearly || monthly <= 0 || yearly <= 0) return null;
  return Math.max(0, Math.round((1 - yearly / (monthly * 12)) * 100));
}

function canManageAutoRenewOnCurrentPlatform(
  provider: MobileAutoRenewSubscription["provider"]
): boolean {
  if (Platform.OS === "ios") return provider === "apple";
  if (Platform.OS === "android") {
    return IS_CHINA_ANDROID ? provider === "alipay" : provider === "google_play";
  }
  return false;
}

type MembershipTierInput = {
  entitlement?: CurrentEntitlement | null;
  productCode?: MobilePaymentProductCode | null;
  productId?: string | null;
};

function resolveMembershipTier(input?: MembershipTierInput): "plus" | "pro" {
  if (
    input?.productCode === "plus_monthly" ||
    input?.productCode === "plus_yearly" ||
    input?.productId === APPLE_PLUS_MONTHLY_SUBSCRIPTION_PRODUCT_ID ||
    input?.productId === APPLE_PLUS_YEARLY_SUBSCRIPTION_PRODUCT_ID ||
    input?.productId === GOOGLE_PLAY_PLUS_MONTHLY_SUBSCRIPTION_PRODUCT_ID ||
    input?.productId === GOOGLE_PLAY_PLUS_YEARLY_SUBSCRIPTION_PRODUCT_ID
  ) return "plus";
  if (
    input?.productCode === "pro_monthly" ||
    input?.productCode === "pro_yearly" ||
    input?.productId === APPLE_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID ||
    input?.productId === APPLE_PRO_YEARLY_SUBSCRIPTION_PRODUCT_ID ||
    input?.productId === APPLE_PRO_MONTHLY_ONE_TIME_PRODUCT_ID ||
    input?.productId === GOOGLE_PLAY_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID ||
    input?.productId === GOOGLE_PLAY_PRO_YEARLY_SUBSCRIPTION_PRODUCT_ID
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
  if (hasActiveAutoRenew(input.autoRenew) && input.autoRenew.cancelAtPeriodEnd) {
    return tf("pro.auto.desc.cancelled", { provider: formatProviderName(input.autoRenew.provider) });
  }
  if (hasActiveAutoRenew(input.autoRenew)) {
    return tf("pro.auto.desc.active", { provider: formatProviderName(input.autoRenew.provider) });
  }
  if (input.isPro && !input.autoRenew) return t("pro.auto.desc.none");
  if (input.isPro && input.expiresAt) {
    return tf("pro.auto.desc.after_expiry", { provider: formatAutoRenewProviderLabel() });
  }
  return tf("pro.auto.desc.first_payment", { provider: formatAutoRenewProviderLabel() });
}

function resolveCompactAutoRenewStatus(input: {
  autoRenew: MobileAutoRenewSubscription | null;
  hasLoadedAutoRenew: boolean;
}): string {
  if (!input.hasLoadedAutoRenew) return t("pro.auto.status.syncing");
  if (input.autoRenew?.status === "pending") return t("pro.auto.status.pending");
  if (hasActiveAutoRenew(input.autoRenew) && input.autoRenew.cancelAtPeriodEnd) {
    return tf("pro.auto.status.cancelled", { provider: formatProviderName(input.autoRenew.provider) });
  }
  if (hasActiveAutoRenew(input.autoRenew)) {
    return tf("pro.auto.status.active", { provider: formatProviderName(input.autoRenew.provider) });
  }
  return t("pro.auto.status.none");
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

function resolveQuotaBenefit(entitlement: CurrentEntitlement | null, usage: UsageV2 | null): { title: string; subtitle: string } {
  if (!entitlement) {
    return {
      title: t("pro.quota.syncing_title"),
      subtitle: t("pro.quota.syncing_subtitle"),
    };
  }

  if (usage) {
    return {
      title: t("me.quota.v2_ai"),
      subtitle: tf("subscription.manager.points_remaining", { count: formatNumber(usage.token.remaining) }),
    };
  }

  return {
    title: t("me.quota.v2_ai"),
    subtitle: t("subscription.manager.points_unavailable"),
  };
}

type ProductPriceLabels = {
  plus: string | null;
  pro: string | null;
  monthSuffix: string;
};

type CachedAutoRenewSubscription = {
  userId: string;
  platform: typeof Platform.OS;
  subscription: MobileAutoRenewSubscription | null;
  cachedAt: number;
};

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
    (["plus_monthly", "plus_yearly", "pro_monthly", "pro_yearly"] as string[]).includes(String(candidate.productCode)) &&
    typeof candidate.status === "string"
  );
}

function resolveMembershipPriceLabels(
  appleIap: AppleIapBridgeState | null,
  productQuotes: Partial<Record<MobilePaymentProductCode, MobilePaymentProductQuote>>
): ProductPriceLabels {
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

  if (IS_CHINA_ANDROID) {
    return {
      plus: productQuotes.plus_monthly?.displayPrice ?? null,
      pro: productQuotes.pro_monthly?.displayPrice ?? null,
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
    purchase.productId === APPLE_PLUS_YEARLY_SUBSCRIPTION_PRODUCT_ID ||
    purchase.productId === APPLE_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID ||
    purchase.productId === APPLE_PRO_YEARLY_SUBSCRIPTION_PRODUCT_ID
  );
}

function isGooglePlayProPurchase(purchase: Purchase): boolean {
  return (
    purchase.productId === GOOGLE_PLAY_PLUS_MONTHLY_SUBSCRIPTION_PRODUCT_ID ||
    purchase.productId === GOOGLE_PLAY_PLUS_YEARLY_SUBSCRIPTION_PRODUCT_ID ||
    purchase.productId === GOOGLE_PLAY_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID ||
    purchase.productId === GOOGLE_PLAY_PRO_YEARLY_SUBSCRIPTION_PRODUCT_ID
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

function isGooglePlaySubscriptionOwnedByDifferentAccount(error: unknown): boolean {
  return error instanceof MobileApiError && (
    error.code === "GOOGLE_PLAY_ACCOUNT_ID_MISMATCH" ||
    error.code === "GOOGLE_PLAY_SUBSCRIPTION_ALREADY_BOUND"
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

function readGooglePlayPurchaseErrorDiagnostics(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== "object") {
    return { message: String(error) };
  }
  const candidate = error as {
    code?: unknown;
    debugMessage?: unknown;
    message?: unknown;
    productId?: unknown;
    productIds?: unknown;
    responseCode?: unknown;
  };
  return {
    code: candidate.code ?? null,
    responseCode: candidate.responseCode ?? null,
    debugMessage: candidate.debugMessage ?? null,
    message: candidate.message ?? null,
    productId: candidate.productId ?? null,
    productIds: Array.isArray(candidate.productIds) ? candidate.productIds : null,
  };
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
  if (Platform.OS === "ios") return "Apple";
  if (Platform.OS === "android") return IS_CHINA_ANDROID ? "支付宝" : "Google Play";
  return "";
}

function formatAutoRenewButtonLabel(): string {
  if (Platform.OS === "ios") return t("pro.auto.apple_subscription");
  if (Platform.OS === "android") return IS_CHINA_ANDROID ? "支付宝自动续费" : "Google Play";
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
  managerContent: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 36,
  },
  currentAccessCard: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: "#F2F0EA",
  },
  managerEyebrow: { color: "#7B7870", fontSize: 11, letterSpacing: 0.5 },
  managerCurrentRow: { marginTop: 5, flexDirection: "row", alignItems: "center", gap: 8 },
  managerCurrentTier: { color: "#171717", fontSize: 28, fontWeight: "600" },
  manualBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: "hidden",
    color: "#74571E",
    backgroundColor: "#E9D8AD",
    fontSize: 10,
    fontWeight: "600",
  },
  managerMeta: { marginTop: 5, color: "#6A6863", fontSize: 12, lineHeight: 18 },
  currentSubscriptionCard: {
    marginTop: 12,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#DDDBD6",
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
  },
  managerSectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  managerSectionTitle: { color: "#171717", fontSize: 15, fontWeight: "600" },
  managerLink: { color: "#5B574F", fontSize: 12, textDecorationLine: "underline" },
  subscriptionName: { marginTop: 11, color: "#171717", fontSize: 17, fontWeight: "600" },
  pendingPlanBox: { marginTop: 12, padding: 11, borderRadius: 10, backgroundColor: "#F6F3EA" },
  pendingPlanTitle: { color: "#3F392C", fontSize: 12, fontWeight: "600" },
  pendingPlanText: { marginTop: 3, color: "#777064", fontSize: 11 },
  pendingPlanActions: { marginTop: 10, flexDirection: "row", gap: 18 },
  pendingPlanAction: { color: "#514B40", fontSize: 12, fontWeight: "600", textDecorationLine: "underline" },
  planChooserHead: { marginTop: 26, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  planChooserTitleRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  periodToggle: { flexDirection: "row", padding: 3, borderRadius: 10, backgroundColor: "#EEEEEC" },
  periodOption: { minWidth: 54, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, alignItems: "center" },
  periodOptionActive: { backgroundColor: "#FFFFFF" },
  periodOptionText: { color: "#777777", fontSize: 12, fontWeight: "500" },
  periodOptionTextActive: { color: "#171717", fontWeight: "600" },
  managerPlanGrid: { marginTop: 12, flexDirection: "row", alignItems: "stretch", gap: 10 },
  managerPlanCard: {
    flex: 1,
    minWidth: 0,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#D8D8D5",
    borderRadius: 15,
    backgroundColor: "#FFFFFF",
  },
  managerPlanCardFeatured: { borderColor: "#AFA99C", backgroundColor: "#FAF8F3" },
  managerPlanTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 5 },
  managerPlanTitle: { color: "#171717", fontSize: 18, fontWeight: "600" },
  savingBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: "hidden",
    color: "#77591F",
    backgroundColor: "#EEE1BF",
    fontSize: 9,
    fontWeight: "600",
  },
  managerPriceRow: { marginTop: 11, flexDirection: "row", alignItems: "baseline" },
  managerPrice: { color: "#171717", fontSize: 22, fontWeight: "600" },
  managerPricePeriod: { marginLeft: 2, color: "#777777", fontSize: 11 },
  managerBenefits: { minHeight: 112, marginTop: 14, gap: 7 },
  managerBenefitRow: { flexDirection: "row", alignItems: "flex-start", gap: 5 },
  managerBenefitText: { flex: 1, color: "#555555", fontSize: 11, lineHeight: 16 },
  managerPlanButton: {
    minHeight: 40,
    marginTop: 15,
    paddingHorizontal: 8,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#171717",
  },
  managerPlanButtonSecondary: { borderWidth: 1, borderColor: "#BEBEBB", backgroundColor: "#FFFFFF" },
  managerPlanButtonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "600", textAlign: "center" },
  managerPlanButtonTextSecondary: { color: "#171717" },
  managerFooterActions: { marginTop: 24, flexDirection: "row", justifyContent: "center", gap: 28 },
  managerFooterLink: { color: "#555555", fontSize: 13, textDecorationLine: "underline" },
  managerFootnote: { marginTop: 14, color: "#929292", fontSize: 10.5, lineHeight: 16, textAlign: "center" },
  compactContainer: {
    paddingVertical: 16,
  },
  compactPlanGrid: {
    gap: 12,
  },
  compactPlanCard: {
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#DCDCDC",
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
  },
  compactPlanCardCurrent: {
    borderWidth: 1.5,
    borderColor: "#C99A35",
    backgroundColor: "#FFF9EB",
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
    marginTop: 12,
    gap: 8,
  },
  compactBenefitRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  compactBenefitIcon: {
    width: 16,
    lineHeight: 20,
    textAlign: "center",
    includeFontPadding: false,
  },
  compactBenefitContent: { flex: 1, flexDirection: "row", alignItems: "flex-start", gap: 5 },
  compactBenefitLabel: { flex: 0, flexShrink: 1 },
  pointsInfoButton: { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  compactBenefitText: {
    includeFontPadding: false,
    flex: 1,
    color: "#444444",
    fontSize: 13,
    lineHeight: 20,
  },
  compactExpiry: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E8E8E8",
    color: "#777777",
    fontSize: 11,
  },
  compactAutoRenewRow: {
    minHeight: 38,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E8E8E8",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  compactAutoRenewStatus: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  compactAutoRenewDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },
  compactAutoRenewDotActive: {
    backgroundColor: "#63A785",
  },
  compactAutoRenewDotWarning: {
    backgroundColor: "#C49338",
  },
  compactAutoRenewDotNeutral: {
    backgroundColor: "#B8B8B8",
  },
  compactAutoRenewStatusText: {
    minWidth: 0,
    flex: 1,
    color: "#666666",
    fontSize: 10.5,
    lineHeight: 15,
  },
  compactAutoRenewAction: {
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "#F3F3F3",
    alignItems: "center",
    justifyContent: "center",
  },
  compactAutoRenewActionPrimary: {
    backgroundColor: "#FFF2D7",
  },
  compactAutoRenewActionText: {
    color: "#666666",
    fontSize: 10,
    fontWeight: "600",
  },
  compactAutoRenewActionTextPrimary: {
    color: "#8A6218",
  },
  compactPriceButton: {
    marginTop: 16,
    minHeight: 44,
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
