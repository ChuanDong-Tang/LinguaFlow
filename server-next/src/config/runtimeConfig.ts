export type RuntimeMode = "development" | "production" | "test";

export interface PaymentRuntimeConfig {
  proMonthlyPriceCents: number;
  proMonthlyMaxPrepaidMonths: number;
  descriptionProMonthly: string;
  pendingReuseWindowMs: number;
  reconcileGraceMs: number;
  pendingExpireMs: number;
  reconcileBatchSize: number;
  reconcileIntervalMs: number;
  certSyncIntervalMs: number;
  certExpireWarnDays: number;
  certRetentionDaysAfterExpire: number;
  rateLimitWebhookLimit: number;
  rateLimitWebhookWindowSec: number;
  rateLimitOrdersCreateLimit: number;
  rateLimitOrdersCreateWindowSec: number;
  rateLimitOrdersQueryLimit: number;
  rateLimitOrdersQueryWindowSec: number;
  wechatPayNotifyUrl: string | null;
  wechatAutoRenew: {
    enabled: boolean;
    contractNotifyUrl: string | null;
    debitNotifyUrl: string | null;
    planId: string | null;
    contractReturnUrl: string | null;
    intervalMs: number;
    batchSize: number;
    chargeDescription: string;
    billingLeadMs: number;
    reconcileGraceMs: number;
  };
  appleIap: {
    issuerId: string | null;
    keyId: string | null;
    bundleId: string | null;
    privateKey: string | null;
    rootCa: string | null;
    proMonthlyProductId: string | null;
  };
}

export interface RuntimeConfig {
  mode: RuntimeMode;
  isProduction: boolean;
  allowMockAuth: boolean;
  mockUserIds: string[];
  requireRedis: boolean;
  redisUrl: string | null;
  authingDomain: string | null;
  authingAppId: string | null;
  authingAppSecret: string | null;
  authJwtSecret: string;
  authAccessTokenTtlSeconds: number;
  authRefreshTokenTtlSeconds: number;
  deepSeekApiKey: string;
  deepSeekBaseUrl: string;
  deepSeekModel: string;
  deepSeekTimeoutMs: number;
  quotaTimeZone: string;
  proDailyTotalLimit: number;
  freeDailyTotalLimit: number;
  benefitGrantRetryEnabled: boolean;
  benefitGrantMaxAttempts: number;
  benefitGrantBackoffMaxMs: number;
  payment: PaymentRuntimeConfig;
  sessionCleanupEnabled: boolean;
  sessionCleanupIntervalMs: number;
  sessionRevokedRetentionDays: number;
  sessionCleanupBatchSize: number;
  sessionCleanupMaxRetryAttempts: number;
  sessionCleanupRetryBaseDelayMs: number;
  sessionCleanupRetryMaxDelayMs: number;
  sessionCleanupCircuitFailThreshold: number;
  sessionCleanupCircuitOpenMs: number;
  systemEventLogCleanupEnabled: boolean;
  systemEventLogCleanupIntervalMs: number;
  systemEventLogRetentionDays: number;
  systemEventLogCleanupBatchSize: number;
  systemEventLogCleanupMaxRetryAttempts: number;
  systemEventLogCleanupRetryBaseDelayMs: number;
  systemEventLogCleanupRetryMaxDelayMs: number;
  systemEventLogCleanupCircuitFailThreshold: number;
  systemEventLogCleanupCircuitOpenMs: number;
  aiRequestLogCleanupEnabled: boolean;
  aiRequestLogCleanupIntervalMs: number;
  aiRequestLogRetentionDays: number;
  aiRequestLogCleanupBatchSize: number;
  aiRequestLogCleanupMaxRetryAttempts: number;
  aiRequestLogCleanupRetryBaseDelayMs: number;
  aiRequestLogCleanupRetryMaxDelayMs: number;
  aiRequestLogCleanupCircuitFailThreshold: number;
  aiRequestLogCleanupCircuitOpenMs: number;
  chatGenerationTaskTtlMs: number;
  chatGenerationGlobalRateLimit: number;
  chatGenerationGlobalRateWindowMs: number;
  chatGenerationUserRateLimit: number;
  chatGenerationUserRateWindowMs: number;
  chatGenerationMaxInputChars: number;
  chatMessagesUserRateLimit: number;
  chatMessagesUserRateWindowMs: number;
}

export function getRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const mode = normalizeMode(env.NODE_ENV);
  return {
    mode,
    isProduction: mode === "production",
    allowMockAuth: readBoolean(env.LF_ALLOW_MOCK_AUTH, false),
    mockUserIds: readCsv(env.LF_MOCK_USER_IDS, ["mock_user_001"]),
    requireRedis: readBoolean(env.LF_REQUIRE_REDIS, mode === "production"),
    redisUrl: trimToNull(env.REDIS_URL),
    authingDomain: trimToNull(env.AUTHING_DOMAIN),
    authingAppId: trimToNull(env.AUTHING_APP_ID),
    authingAppSecret: trimToNull(env.AUTHING_APP_SECRET),
    authJwtSecret: env.AUTH_JWT_SECRET?.trim() || "dev-only-change-me",
    authAccessTokenTtlSeconds: readPositiveInt(env.AUTH_ACCESS_TOKEN_TTL_SECONDS, 60 * 30),
    authRefreshTokenTtlSeconds: readPositiveInt(env.AUTH_REFRESH_TOKEN_TTL_SECONDS, 60 * 60 * 24 * 30),
    deepSeekApiKey: env.DEEPSEEK_API_KEY?.trim() || "",
    deepSeekBaseUrl: env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
    deepSeekModel: env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash",
    deepSeekTimeoutMs: readPositiveInt(env.DEEPSEEK_TIMEOUT_MS, 20_000),
    quotaTimeZone: env.LF_QUOTA_TIME_ZONE?.trim() || "Asia/Shanghai",
    proDailyTotalLimit: readPositiveInt(env.LF_PRO_DAILY_TOTAL_LIMIT, 10_000),
    freeDailyTotalLimit: readPositiveInt(env.LF_FREE_DAILY_TOTAL_LIMIT, 500),
    payment: readPaymentRuntimeConfig(env),
    benefitGrantRetryEnabled: readBoolean(env.LF_BENEFIT_GRANT_RETRY_ENABLED, true),
    benefitGrantMaxAttempts: readPositiveInt(env.LF_BENEFIT_GRANT_MAX_ATTEMPTS, 6),
    benefitGrantBackoffMaxMs: readPositiveInt(env.LF_BENEFIT_GRANT_BACKOFF_MAX_MS, 60_000),
    sessionCleanupEnabled: readBoolean(env.LF_SESSION_CLEANUP_ENABLED, true),
    sessionCleanupIntervalMs: readPositiveInt(env.LF_SESSION_CLEANUP_INTERVAL_MS, 86_400_000),
    sessionRevokedRetentionDays: readPositiveInt(env.LF_SESSION_REVOKED_RETENTION_DAYS, 14),
    sessionCleanupBatchSize: readPositiveInt(env.LF_SESSION_CLEANUP_BATCH_SIZE, 1000),
    sessionCleanupMaxRetryAttempts: readPositiveInt(env.LF_SESSION_CLEANUP_MAX_RETRY_ATTEMPTS, 3),
    sessionCleanupRetryBaseDelayMs: readPositiveInt(env.LF_SESSION_CLEANUP_RETRY_BASE_DELAY_MS, 1000),
    sessionCleanupRetryMaxDelayMs: readPositiveInt(env.LF_SESSION_CLEANUP_RETRY_MAX_DELAY_MS, 30_000),
    sessionCleanupCircuitFailThreshold: readPositiveInt(env.LF_SESSION_CLEANUP_CIRCUIT_FAIL_THRESHOLD, 5),
    sessionCleanupCircuitOpenMs: readPositiveInt(env.LF_SESSION_CLEANUP_CIRCUIT_OPEN_MS, 300_000),
    systemEventLogCleanupEnabled: readBoolean(env.LF_SYSTEM_EVENT_LOG_CLEANUP_ENABLED, true),
    systemEventLogCleanupIntervalMs: readPositiveInt(env.LF_SYSTEM_EVENT_LOG_CLEANUP_INTERVAL_MS, 86_400_000),
    systemEventLogRetentionDays: readPositiveInt(env.LF_SYSTEM_EVENT_LOG_RETENTION_DAYS, 30),
    systemEventLogCleanupBatchSize: readPositiveInt(env.LF_SYSTEM_EVENT_LOG_CLEANUP_BATCH_SIZE, 2000),
    systemEventLogCleanupMaxRetryAttempts: readPositiveInt(env.LF_SYSTEM_EVENT_LOG_CLEANUP_MAX_RETRY_ATTEMPTS, 3),
    systemEventLogCleanupRetryBaseDelayMs: readPositiveInt(env.LF_SYSTEM_EVENT_LOG_CLEANUP_RETRY_BASE_DELAY_MS, 1000),
    systemEventLogCleanupRetryMaxDelayMs: readPositiveInt(env.LF_SYSTEM_EVENT_LOG_CLEANUP_RETRY_MAX_DELAY_MS, 30_000),
    systemEventLogCleanupCircuitFailThreshold: readPositiveInt(env.LF_SYSTEM_EVENT_LOG_CLEANUP_CIRCUIT_FAIL_THRESHOLD, 5),
    systemEventLogCleanupCircuitOpenMs: readPositiveInt(env.LF_SYSTEM_EVENT_LOG_CLEANUP_CIRCUIT_OPEN_MS, 300_000),
    aiRequestLogCleanupEnabled: readBoolean(env.LF_AI_REQUEST_LOG_CLEANUP_ENABLED, true),
    aiRequestLogCleanupIntervalMs: readPositiveInt(env.LF_AI_REQUEST_LOG_CLEANUP_INTERVAL_MS, 86_400_000),
    aiRequestLogRetentionDays: readPositiveInt(env.LF_AI_REQUEST_LOG_RETENTION_DAYS, 90),
    aiRequestLogCleanupBatchSize: readPositiveInt(env.LF_AI_REQUEST_LOG_CLEANUP_BATCH_SIZE, 2000),
    aiRequestLogCleanupMaxRetryAttempts: readPositiveInt(env.LF_AI_REQUEST_LOG_CLEANUP_MAX_RETRY_ATTEMPTS, 3),
    aiRequestLogCleanupRetryBaseDelayMs: readPositiveInt(env.LF_AI_REQUEST_LOG_CLEANUP_RETRY_BASE_DELAY_MS, 1000),
    aiRequestLogCleanupRetryMaxDelayMs: readPositiveInt(env.LF_AI_REQUEST_LOG_CLEANUP_RETRY_MAX_DELAY_MS, 30_000),
    aiRequestLogCleanupCircuitFailThreshold: readPositiveInt(env.LF_AI_REQUEST_LOG_CLEANUP_CIRCUIT_FAIL_THRESHOLD, 5),
    aiRequestLogCleanupCircuitOpenMs: readPositiveInt(env.LF_AI_REQUEST_LOG_CLEANUP_CIRCUIT_OPEN_MS, 300_000),
    chatGenerationTaskTtlMs: readPositiveInt(env.CHAT_GENERATION_TASK_TTL_MS, 60_000),
    chatGenerationGlobalRateLimit: readPositiveInt(env.CHAT_GENERATION_GLOBAL_RATE_LIMIT, 30),
    chatGenerationGlobalRateWindowMs: readPositiveInt(env.CHAT_GENERATION_GLOBAL_RATE_WINDOW_MS, 60_000),
    chatGenerationUserRateLimit: readPositiveInt(env.CHAT_GENERATION_USER_RATE_LIMIT, 20),
    chatGenerationUserRateWindowMs: readPositiveInt(env.CHAT_GENERATION_USER_RATE_WINDOW_MS, 60_000),
    chatGenerationMaxInputChars: readPositiveInt(env.CHAT_GENERATION_MAX_INPUT_CHARS, 3000),
    chatMessagesUserRateLimit: readPositiveInt(env.CHAT_MESSAGES_USER_RATE_LIMIT, 20),
    chatMessagesUserRateWindowMs: readPositiveInt(env.CHAT_MESSAGES_USER_RATE_WINDOW_MS, 60_000),
  };
}

function normalizeMode(value: string | undefined): RuntimeMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "production" || normalized === "test") return normalized;
  return "development";
}

function readPaymentRuntimeConfig(env: NodeJS.ProcessEnv): PaymentRuntimeConfig {
  return {
    proMonthlyPriceCents: readPositiveInt(env.LF_PRO_MONTHLY_PRICE_CENTS, 1900),
    // 单次月卡最多允许预存多少个月的 Pro 权益。默认 2 个月，避免未来调价后用户长期囤低价月卡。
    proMonthlyMaxPrepaidMonths: readPositiveInt(env.LF_PRO_MONTHLY_MAX_PREPAID_MONTHS, 2),
    descriptionProMonthly: env.LF_PAYMENT_DESC_PRO_MONTHLY?.trim() || "OIO Pro 月卡",
    pendingReuseWindowMs: readPositiveInt(env.LF_PAYMENT_PENDING_REUSE_WINDOW_MS, 300_000),
    reconcileGraceMs: readPositiveInt(env.LF_PAYMENT_RECONCILE_GRACE_MS, 120_000),
    pendingExpireMs: readPositiveInt(env.LF_PAYMENT_PENDING_EXPIRE_MS, 1_800_000),
    reconcileBatchSize: readPositiveInt(env.LF_PAYMENT_RECONCILE_BATCH_SIZE, 20),
    reconcileIntervalMs: readPositiveInt(env.LF_PAYMENT_RECONCILE_INTERVAL_MS, 60_000),
    certSyncIntervalMs: readPositiveInt(env.LF_PAYMENT_CERT_SYNC_INTERVAL_MS, 900_000),
    certExpireWarnDays: readPositiveInt(env.LF_PAYMENT_CERT_EXPIRE_WARN_DAYS, 30),
    certRetentionDaysAfterExpire: readPositiveInt(
      env.LF_PAYMENT_CERT_RETENTION_DAYS_AFTER_EXPIRE,
      30
    ),
    rateLimitWebhookLimit: readPositiveInt(env.LF_RL_PAYMENT_WEBHOOK_LIMIT, 120),
    rateLimitWebhookWindowSec: readPositiveInt(env.LF_RL_PAYMENT_WEBHOOK_WINDOW_SEC, 60),
    rateLimitOrdersCreateLimit: readPositiveInt(env.LF_RL_PAYMENT_ORDERS_CREATE_LIMIT, 30),
    rateLimitOrdersCreateWindowSec: readPositiveInt(
      env.LF_RL_PAYMENT_ORDERS_CREATE_WINDOW_SEC,
      60
    ),
    rateLimitOrdersQueryLimit: readPositiveInt(env.LF_RL_PAYMENT_ORDERS_QUERY_LIMIT, 60),
    rateLimitOrdersQueryWindowSec: readPositiveInt(
      env.LF_RL_PAYMENT_ORDERS_QUERY_WINDOW_SEC,
      60
    ),
    wechatPayNotifyUrl: trimToNull(env.WECHAT_PAY_NOTIFY_URL),
    wechatAutoRenew: {
      enabled: readBoolean(env.WECHAT_AUTORENEW_ENABLED, false),
      contractNotifyUrl: trimToNull(env.WECHAT_AUTORENEW_CONTRACT_NOTIFY_URL),
      debitNotifyUrl: trimToNull(env.WECHAT_AUTORENEW_DEBIT_NOTIFY_URL),
      planId: trimToNull(env.WECHAT_AUTORENEW_PLAN_ID),
      contractReturnUrl: trimToNull(env.WECHAT_AUTORENEW_CONTRACT_RETURN_URL),
      intervalMs: readPositiveInt(env.WECHAT_AUTORENEW_INTERVAL_MS, 300_000),
      batchSize: readPositiveInt(env.WECHAT_AUTORENEW_BATCH_SIZE, 20),
      chargeDescription: env.WECHAT_AUTORENEW_CHARGE_DESC?.trim() || "OIO Pro 自动续费",
      billingLeadMs: readPositiveInt(
        env.WECHAT_AUTORENEW_BILLING_LEAD_MS ?? env.WECHAT_AUTORENEW_SCHEDULE_LEAD_MS,
        172_800_000
      ),
      reconcileGraceMs: readPositiveInt(env.WECHAT_AUTORENEW_RECONCILE_GRACE_MS, 600_000),
    },
    appleIap: {
      issuerId: trimToNull(env.APPLE_IAP_ISSUER_ID),
      keyId: trimToNull(env.APPLE_IAP_KEY_ID),
      bundleId: trimToNull(env.APPLE_IAP_BUNDLE_ID),
      privateKey: trimToNull(env.APPLE_IAP_PRIVATE_KEY),
      rootCa: trimToNull(env.APPLE_IAP_ROOT_CA),
      proMonthlyProductId: trimToNull(env.APPLE_IAP_PRO_MONTHLY_PRODUCT_ID),
    },
  };
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return fallback;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function trimToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function readCsv(value: string | undefined, fallback: string[]): string[] {
  const raw = value?.trim();
  if (!raw) return fallback;
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
