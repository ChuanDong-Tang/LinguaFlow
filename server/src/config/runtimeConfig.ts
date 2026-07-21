export type RuntimeMode = "development" | "production" | "test";
export type AiProviderName = "deepseek" | "openai" | "grok";
export type MembershipFeatureTier = "free" | "plus" | "pro";

export interface PaymentRuntimeConfig {
  wechatPayEnabled: boolean;
  plusMonthlyPriceCents: number;
  proMonthlyPriceCents: number;
  descriptionPlusMonthly: string;
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
    plusPlanId: string | null;
    proPlanId: string | null;
    contractReturnUrl: string | null;
    intervalMs: number;
    batchSize: number;
    chargeDescription: string;
    billingLeadMs: number;
    reconcileGraceMs: number;
  };
  appleIap: {
    enabled: boolean;
    issuerId: string | null;
    keyId: string | null;
    bundleId: string | null;
    privateKey: string | null;
    rootCa: string | null;
    plusMonthlyProductId: string | null;
    proMonthlyProductId: string | null;
    proMonthlyOneTimeProductId: string | null;
    allowSandboxFallback: boolean;
  };
  googlePlayBilling: {
    enabled: boolean;
    apiProxyUrl: string | null;
    apiTimeoutMs: number;
    apiConnectTimeoutMs: number;
    apiMaxAttempts: number;
    apiRetryBaseDelayMs: number;
    reconcileIntervalMs: number;
    reconcileBatchSize: number;
    packageName: string | null;
    serviceAccountJson: string | null;
    plusMonthlyProductId: string | null;
    proMonthlyProductId: string | null;
    plusMonthlyBasePlanId: string | null;
    proMonthlyBasePlanId: string | null;
    notifyToken: string | null;
    notifyOidcAudience: string | null;
    notifyOidcServiceAccountEmail: string | null;
  };
}

export interface RuntimeConfig {
  mode: RuntimeMode;
  isProduction: boolean;
  allowMockAuth: boolean;
  mockUserIds: string[];
  requireRedis: boolean;
  redisUrl: string | null;
  journalEnabled: boolean;
  authingDomain: string | null;
  authingAppId: string | null;
  authingAppSecret: string | null;
  authJwtSecret: string;
  authAccessTokenTtlSeconds: number;
  authRefreshTokenTtlSeconds: number;
  aiProvider: AiProviderName;
  aiAllowClientModel: boolean;
  deepSeekApiKey: string;
  deepSeekBaseUrl: string;
  deepSeekModel: string;
  deepSeekAllowedModels: string[];
  deepSeekTimeoutMs: number;
  openAiApiKey: string;
  openAiBaseUrl: string;
  openAiModel: string;
  openAiAllowedModels: string[];
  openAiTimeoutMs: number;
  grokApiKey: string;
  grokBaseUrl: string;
  grokModel: string;
  grokAllowedModels: string[];
  grokTimeoutMs: number;
  quotaTimeZone: string;
  plusDailyTotalLimit: number;
  proDailyTotalLimit: number;
  membershipFeatures: {
    cloudSync: MembershipFeatureTier[];
    highQualityTts: MembershipFeatureTier[];
  };
  freeTrialTotalLimit: number;
  freeTrialValidDays: number;
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
  ttsAssetCleanupEnabled: boolean;
  ttsAssetCleanupIntervalMs: number;
  ttsFailedAssetRetentionDays: number;
  ttsAssetCleanupBatchSize: number;
  ttsRequestLogCleanupEnabled: boolean;
  ttsRequestLogCleanupIntervalMs: number;
  ttsRequestLogRetentionDays: number;
  ttsRequestLogCleanupBatchSize: number;
  ttsRequestLogCleanupMaxRetryAttempts: number;
  ttsRequestLogCleanupRetryBaseDelayMs: number;
  ttsRequestLogCleanupRetryMaxDelayMs: number;
  ttsRequestLogCleanupCircuitFailThreshold: number;
  ttsRequestLogCleanupCircuitOpenMs: number;
  accountDeletionCleanupEnabled: boolean;
  accountDeletionCleanupIntervalMs: number;
  accountDeletionCleanupBatchSize: number;
  chatGenerationTaskTtlMs: number;
  chatGenerationGlobalRateLimit: number;
  chatGenerationGlobalRateWindowMs: number;
  chatGenerationUserRateLimit: number;
  chatGenerationUserRateWindowMs: number;
  chatGenerationMaxInputChars: number;
  chatGenerationMinInputChars: number;
  chatMessagesUserRateLimit: number;
  chatMessagesUserRateWindowMs: number;
  dictionaryLookupGlobalRateLimit: number;
  dictionaryLookupUserRateLimit: number;
  dictionaryLookupRateWindowMs: number;
  dictionaryLookupMaxOutputTokens: number;
  sttRealtimeGlobalRateLimit: number;
  sttRealtimeUserRateLimit: number;
  sttRealtimeRateWindowMs: number;
  sttRealtimeMaxSessionMs: number;
  sttRealtimeCandidateLanguages: string[];
  sttRequestLogEnabled: boolean;
  ttsMessagesGlobalRateLimit: number;
  ttsMessagesGlobalRateWindowMs: number;
  ttsCostPerMillionCharsCents: number;
  ttsCostCurrency: string;
  contentSafetyTencentTmsEnabled: boolean;
  contentSafetyTencentSecretId: string;
  contentSafetyTencentSecretKey: string;
  contentSafetyTencentRegion: string;
  contentSafetyTencentBizType: string | null;
  contentSafetyTencentTimeoutMs: number;
  contentSafetyTencentBlockSuggestions: string[];
  contentSafetyTencentFailClosed: boolean;
  contentSafetyTencentReviewMode: "suspect" | "all";
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
    journalEnabled: readBoolean(env.LF_JOURNAL_ENABLED, mode !== "production"),
    authingDomain: trimToNull(env.AUTHING_DOMAIN),
    authingAppId: trimToNull(env.AUTHING_APP_ID),
    authingAppSecret: trimToNull(env.AUTHING_APP_SECRET),
    authJwtSecret: env.AUTH_JWT_SECRET?.trim() || "dev-only-change-me",
    authAccessTokenTtlSeconds: readPositiveInt(env.AUTH_ACCESS_TOKEN_TTL_SECONDS, 60 * 30),
    authRefreshTokenTtlSeconds: readPositiveInt(env.AUTH_REFRESH_TOKEN_TTL_SECONDS, 60 * 60 * 24 * 30),
    aiProvider: readAiProvider(env.LF_AI_DEFAULT_PROVIDER, "grok"),
    aiAllowClientModel: readBoolean(env.LF_AI_ALLOW_CLIENT_MODEL, false),
    deepSeekApiKey: env.DEEPSEEK_API_KEY?.trim() || "",
    deepSeekBaseUrl: env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
    deepSeekModel: env.DEEPSEEK_DEFAULT_MODEL?.trim() || "deepseek-v4-flash",
    deepSeekAllowedModels: readCsv(
      env.DEEPSEEK_ALLOWED_MODELS,
      [env.DEEPSEEK_DEFAULT_MODEL?.trim() || "deepseek-v4-flash"]
    ),
    deepSeekTimeoutMs: readPositiveInt(env.DEEPSEEK_TIMEOUT_MS, 20_000),
    openAiApiKey: env.OPENAI_API_KEY?.trim() || env.ChatGPT_API_KEY?.trim() || "",
    openAiBaseUrl: env.OPENAI_BASE_URL?.trim() || env.ChatGPT_BASE_URL?.trim() || "https://api.openai.com/v1",
    openAiModel: env.OPENAI_DEFAULT_MODEL?.trim() || "gpt-5.4-mini",
    openAiAllowedModels: readCsv(
      env.OPENAI_ALLOWED_MODELS,
      [env.OPENAI_DEFAULT_MODEL?.trim() || "gpt-5.4-mini"]
    ),
    openAiTimeoutMs: readPositiveInt(env.OPENAI_TIMEOUT_MS ?? env.ChatGPT_TIMEOUT_MS, 20_000),
    grokApiKey: env.GROK_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || env.ChatGPT_API_KEY?.trim() || "",
    grokBaseUrl:
      env.GROK_BASE_URL?.trim() ||
      env.OPENAI_BASE_URL?.trim() ||
      env.ChatGPT_BASE_URL?.trim() ||
      "https://api.openai.com/v1",
    grokModel: env.GROK_DEFAULT_MODEL?.trim() || "grok-4-1-fast-non-reasoning",
    grokAllowedModels: readCsv(
      env.GROK_ALLOWED_MODELS,
      [env.GROK_DEFAULT_MODEL?.trim() || "grok-4-1-fast-non-reasoning"]
    ),
    grokTimeoutMs: readPositiveInt(env.GROK_TIMEOUT_MS ?? env.OPENAI_TIMEOUT_MS ?? env.ChatGPT_TIMEOUT_MS, 20_000),
    quotaTimeZone: env.LF_QUOTA_TIME_ZONE?.trim() || "Asia/Shanghai",
    plusDailyTotalLimit: readPositiveInt(env.LF_PLUS_DAILY_TOTAL_LIMIT, 5_000),
    proDailyTotalLimit: readPositiveInt(env.LF_PRO_DAILY_TOTAL_LIMIT, 10_000),
    membershipFeatures: {
      cloudSync: readTierCsv(env.LF_FEATURE_CLOUD_SYNC_TIERS, ["plus", "pro"]),
      highQualityTts: readTierCsv(env.LF_FEATURE_HIGH_QUALITY_TTS_TIERS, ["plus", "pro"]),
    },
    freeTrialTotalLimit: readPositiveInt(env.LF_FREE_TRIAL_TOTAL_LIMIT, 5000),
    freeTrialValidDays: readPositiveInt(env.LF_FREE_TRIAL_VALID_DAYS, 7),
    payment: readPaymentRuntimeConfig(env, mode),
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
    ttsAssetCleanupEnabled: readBoolean(env.LF_TTS_ASSET_CLEANUP_ENABLED, true),
    ttsAssetCleanupIntervalMs: readPositiveInt(env.LF_TTS_ASSET_CLEANUP_INTERVAL_MS, 86_400_000),
    ttsFailedAssetRetentionDays: readPositiveInt(env.LF_TTS_FAILED_ASSET_RETENTION_DAYS, 7),
    ttsAssetCleanupBatchSize: readPositiveInt(env.LF_TTS_ASSET_CLEANUP_BATCH_SIZE, 1000),
    ttsRequestLogCleanupEnabled: readBoolean(env.LF_TTS_REQUEST_LOG_CLEANUP_ENABLED, true),
    ttsRequestLogCleanupIntervalMs: readPositiveInt(env.LF_TTS_REQUEST_LOG_CLEANUP_INTERVAL_MS, 86_400_000),
    ttsRequestLogRetentionDays: readPositiveInt(env.LF_TTS_REQUEST_LOG_RETENTION_DAYS, 30),
    ttsRequestLogCleanupBatchSize: readPositiveInt(env.LF_TTS_REQUEST_LOG_CLEANUP_BATCH_SIZE, 2000),
    ttsRequestLogCleanupMaxRetryAttempts: readPositiveInt(env.LF_TTS_REQUEST_LOG_CLEANUP_MAX_RETRY_ATTEMPTS, 3),
    ttsRequestLogCleanupRetryBaseDelayMs: readPositiveInt(env.LF_TTS_REQUEST_LOG_CLEANUP_RETRY_BASE_DELAY_MS, 1000),
    ttsRequestLogCleanupRetryMaxDelayMs: readPositiveInt(env.LF_TTS_REQUEST_LOG_CLEANUP_RETRY_MAX_DELAY_MS, 30_000),
    ttsRequestLogCleanupCircuitFailThreshold: readPositiveInt(env.LF_TTS_REQUEST_LOG_CLEANUP_CIRCUIT_FAIL_THRESHOLD, 5),
    ttsRequestLogCleanupCircuitOpenMs: readPositiveInt(env.LF_TTS_REQUEST_LOG_CLEANUP_CIRCUIT_OPEN_MS, 300_000),
    accountDeletionCleanupEnabled: readBoolean(env.LF_ACCOUNT_DELETION_CLEANUP_ENABLED, true),
    accountDeletionCleanupIntervalMs: readPositiveInt(env.LF_ACCOUNT_DELETION_CLEANUP_INTERVAL_MS, 7 * 24 * 60 * 60 * 1000),
    accountDeletionCleanupBatchSize: readPositiveInt(env.LF_ACCOUNT_DELETION_CLEANUP_BATCH_SIZE, 5),
    chatGenerationTaskTtlMs: readPositiveInt(env.CHAT_GENERATION_TASK_TTL_MS, 60_000),
    chatGenerationGlobalRateLimit: readPositiveInt(env.CHAT_GENERATION_GLOBAL_RATE_LIMIT, 30),
    chatGenerationGlobalRateWindowMs: readPositiveInt(env.CHAT_GENERATION_GLOBAL_RATE_WINDOW_MS, 60_000),
    chatGenerationUserRateLimit: readPositiveInt(env.CHAT_GENERATION_USER_RATE_LIMIT, 20),
    chatGenerationUserRateWindowMs: readPositiveInt(env.CHAT_GENERATION_USER_RATE_WINDOW_MS, 60_000),
    chatGenerationMaxInputChars: readPositiveInt(env.CHAT_GENERATION_MAX_INPUT_CHARS, 3000),
    chatGenerationMinInputChars: readPositiveInt(env.CHAT_GENERATION_MIN_INPUT_CHARS, 10),
    chatMessagesUserRateLimit: readPositiveInt(env.CHAT_MESSAGES_USER_RATE_LIMIT, 20),
    chatMessagesUserRateWindowMs: readPositiveInt(env.CHAT_MESSAGES_USER_RATE_WINDOW_MS, 60_000),
    dictionaryLookupGlobalRateLimit: readPositiveInt(env.DICTIONARY_LOOKUP_GLOBAL_RATE_LIMIT, 500),
    dictionaryLookupUserRateLimit: readPositiveInt(env.DICTIONARY_LOOKUP_USER_RATE_LIMIT, 80),
    dictionaryLookupRateWindowMs: readPositiveInt(env.DICTIONARY_LOOKUP_RATE_WINDOW_MS, 60_000),
    dictionaryLookupMaxOutputTokens: readPositiveInt(env.DICTIONARY_LOOKUP_MAX_OUTPUT_TOKENS, 420),
    sttRealtimeGlobalRateLimit: readPositiveInt(env.STT_REALTIME_GLOBAL_RATE_LIMIT, 80),
    sttRealtimeUserRateLimit: readPositiveInt(env.STT_REALTIME_USER_RATE_LIMIT, 20),
    sttRealtimeRateWindowMs: readPositiveInt(env.STT_REALTIME_RATE_WINDOW_MS, 60_000),
    sttRealtimeMaxSessionMs: readPositiveInt(env.STT_REALTIME_MAX_SESSION_MS, 60_000),
    sttRealtimeCandidateLanguages: readCsv(env.STT_REALTIME_CANDIDATE_LANGUAGES, [
      "zh-CN",
      "en-US",
      "ja-JP",
      "ko-KR",
    ]).slice(0, 4),
    sttRequestLogEnabled: readBoolean(env.STT_REQUEST_LOG_ENABLED, false),
    ttsMessagesGlobalRateLimit: readPositiveInt(env.TTS_MESSAGES_GLOBAL_RATE_LIMIT, 100),
    ttsMessagesGlobalRateWindowMs: readPositiveInt(env.TTS_MESSAGES_GLOBAL_RATE_WINDOW_MS, 60_000),
    ttsCostPerMillionCharsCents: readNonNegativeInt(env.TTS_COST_PER_1M_CHARS_CENTS, 0),
    ttsCostCurrency: env.TTS_COST_CURRENCY?.trim() || "USD",
    contentSafetyTencentTmsEnabled: readBoolean(env.LF_TENCENT_TMS_ENABLED, false),
    contentSafetyTencentSecretId: env.TENCENTCLOUD_SECRET_ID?.trim() || env.TENCENT_TMS_SECRET_ID?.trim() || "",
    contentSafetyTencentSecretKey: env.TENCENTCLOUD_SECRET_KEY?.trim() || env.TENCENT_TMS_SECRET_KEY?.trim() || "",
    contentSafetyTencentRegion: env.TENCENT_TMS_REGION?.trim() || "ap-guangzhou",
    contentSafetyTencentBizType: trimToNull(env.TENCENT_TMS_BIZ_TYPE),
    contentSafetyTencentTimeoutMs: readPositiveInt(env.TENCENT_TMS_TIMEOUT_MS, 1500),
    contentSafetyTencentBlockSuggestions: readCsv(env.TENCENT_TMS_BLOCK_SUGGESTIONS, ["Block", "Review"]),
    contentSafetyTencentFailClosed: readBoolean(env.TENCENT_TMS_FAIL_CLOSED, false),
    contentSafetyTencentReviewMode: readTencentTmsReviewMode(env.TENCENT_TMS_REVIEW_MODE, "suspect"),
  };
}

function normalizeMode(value: string | undefined): RuntimeMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "production" || normalized === "test") return normalized;
  return "development";
}

function readAiProvider(value: string | undefined, fallback: AiProviderName): AiProviderName {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "openai" || normalized === "chatgpt") return "openai";
  if (normalized === "grok") return "grok";
  if (normalized === "deepseek") return "deepseek";
  return fallback;
}

function readTencentTmsReviewMode(value: string | undefined, fallback: "suspect" | "all"): "suspect" | "all" {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "all") return "all";
  if (normalized === "suspect" || normalized === "suspicious") return "suspect";
  return fallback;
}

function readPaymentRuntimeConfig(env: NodeJS.ProcessEnv, mode: RuntimeMode): PaymentRuntimeConfig {
  return {
    wechatPayEnabled: readBoolean(env.WECHAT_PAY_ENABLED, false),
    plusMonthlyPriceCents: readPositiveInt(env.LF_PLUS_MONTHLY_PRICE_CENTS, 1500),
    proMonthlyPriceCents: readPositiveInt(env.LF_PRO_MONTHLY_PRICE_CENTS, 3000),
    descriptionPlusMonthly: env.LF_PAYMENT_DESC_PLUS_MONTHLY?.trim() || "OIO Plus 月卡",
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
      plusPlanId: trimToNull(env.WECHAT_AUTORENEW_PLUS_PLAN_ID),
      proPlanId: trimToNull(env.WECHAT_AUTORENEW_PRO_PLAN_ID),
      contractReturnUrl: trimToNull(env.WECHAT_AUTORENEW_CONTRACT_RETURN_URL),
      intervalMs: readPositiveInt(env.WECHAT_AUTORENEW_INTERVAL_MS, 300_000),
      batchSize: readPositiveInt(env.WECHAT_AUTORENEW_BATCH_SIZE, 20),
      chargeDescription: env.WECHAT_AUTORENEW_CHARGE_DESC?.trim() || "OIO Pro 自动续费",
      billingLeadMs: readPositiveInt(env.WECHAT_AUTORENEW_BILLING_LEAD_MS, 172_800_000),
      reconcileGraceMs: readPositiveInt(env.WECHAT_AUTORENEW_RECONCILE_GRACE_MS, 600_000),
    },
    appleIap: {
      enabled: readBoolean(env.APPLE_IAP_ENABLED, false),
      issuerId: trimToNull(env.APPLE_IAP_ISSUER_ID),
      keyId: trimToNull(env.APPLE_IAP_KEY_ID),
      bundleId: trimToNull(env.APPLE_IAP_BUNDLE_ID),
      privateKey: trimToNull(env.APPLE_IAP_PRIVATE_KEY),
      rootCa: trimToNull(env.APPLE_IAP_ROOT_CA),
      plusMonthlyProductId: trimToNull(env.APPLE_IAP_PLUS_MONTHLY_PRODUCT_ID),
      proMonthlyProductId: trimToNull(env.APPLE_IAP_PRO_MONTHLY_PRODUCT_ID),
      proMonthlyOneTimeProductId: trimToNull(env.APPLE_IAP_PRO_MONTHLY_ONE_TIME_PRODUCT_ID),
      allowSandboxFallback: readBoolean(env.APPLE_IAP_ALLOW_SANDBOX_FALLBACK, mode !== "production"),
    },
    googlePlayBilling: {
      enabled: readBoolean(env.GOOGLE_PLAY_BILLING_ENABLED, false),
      apiProxyUrl: trimToNull(env.GOOGLE_API_PROXY_URL),
      apiTimeoutMs: readPositiveInt(env.GOOGLE_API_TIMEOUT_MS, 15_000),
      apiConnectTimeoutMs: readPositiveInt(env.GOOGLE_API_CONNECT_TIMEOUT_MS, 5_000),
      apiMaxAttempts: Math.min(readPositiveInt(env.GOOGLE_API_MAX_ATTEMPTS, 3), 5),
      apiRetryBaseDelayMs: readPositiveInt(env.GOOGLE_API_RETRY_BASE_DELAY_MS, 250),
      reconcileIntervalMs: readPositiveInt(env.GOOGLE_PLAY_RECONCILE_INTERVAL_MS, 300_000),
      reconcileBatchSize: readPositiveInt(env.GOOGLE_PLAY_RECONCILE_BATCH_SIZE, 50),
      packageName: trimToNull(env.GOOGLE_PLAY_PACKAGE_NAME),
      serviceAccountJson: trimToNull(env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON),
      plusMonthlyProductId: trimToNull(env.GOOGLE_PLAY_PLUS_MONTHLY_PRODUCT_ID),
      proMonthlyProductId: trimToNull(env.GOOGLE_PLAY_PRO_MONTHLY_PRODUCT_ID),
      plusMonthlyBasePlanId: trimToNull(env.GOOGLE_PLAY_PLUS_MONTHLY_BASE_PLAN_ID),
      proMonthlyBasePlanId: trimToNull(env.GOOGLE_PLAY_PRO_MONTHLY_BASE_PLAN_ID),
      notifyToken: trimToNull(env.GOOGLE_PLAY_NOTIFY_TOKEN),
      notifyOidcAudience: trimToNull(env.GOOGLE_PLAY_NOTIFY_OIDC_AUDIENCE),
      notifyOidcServiceAccountEmail: trimToNull(env.GOOGLE_PLAY_NOTIFY_OIDC_SERVICE_ACCOUNT_EMAIL),
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

function readNonNegativeInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
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

function readTierCsv(value: string | undefined, fallback: MembershipFeatureTier[]): MembershipFeatureTier[] {
  const tiers = readCsv(value, fallback);
  const allowed = new Set<MembershipFeatureTier>(["free", "plus", "pro"]);
  const parsed = tiers.filter((tier): tier is MembershipFeatureTier => allowed.has(tier as MembershipFeatureTier));
  return parsed.length ? parsed : fallback;
}
