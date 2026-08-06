export type ResourceKind = "llm" | "stt" | "tts" | "embedding";

export type ResourcePolicy = {
  userRequestsPerMinute: number;
  globalRequestsPerMinute: number;
  userConcurrency: number;
  globalConcurrency: number;
  leaseMs: number;
};

export type ResourcePolicies = Record<ResourceKind, ResourcePolicy>;

type LegacyResourceValues = {
  llmUserRpm: number;
  llmGlobalRpm: number;
  llmGlobalConcurrency: number;
  sttUserRpm: number;
  sttGlobalRpm: number;
  sttMaxSessionMs: number;
  ttsGlobalRpm: number;
  embeddingGlobalRpm: number;
  embeddingGlobalConcurrency: number;
};

/** New RESOURCE_* values win; legacy values remain a deployment-compatible fallback. */
export function resolveResourcePolicies(env: NodeJS.ProcessEnv, legacy: LegacyResourceValues): ResourcePolicies {
  return {
    llm: {
      userRequestsPerMinute: positiveInt(env.RESOURCE_LLM_USER_RPM, legacy.llmUserRpm),
      globalRequestsPerMinute: positiveInt(env.RESOURCE_LLM_GLOBAL_RPM, legacy.llmGlobalRpm),
      userConcurrency: positiveInt(env.RESOURCE_LLM_USER_CONCURRENCY, 1),
      globalConcurrency: positiveInt(env.RESOURCE_LLM_GLOBAL_CONCURRENCY, legacy.llmGlobalConcurrency),
      leaseMs: positiveInt(env.RESOURCE_LLM_LEASE_MS, 300_000),
    },
    stt: {
      userRequestsPerMinute: positiveInt(env.RESOURCE_STT_USER_RPM, legacy.sttUserRpm),
      globalRequestsPerMinute: positiveInt(env.RESOURCE_STT_GLOBAL_RPM, legacy.sttGlobalRpm),
      userConcurrency: positiveInt(env.RESOURCE_STT_USER_CONCURRENCY, 1),
      globalConcurrency: positiveInt(env.RESOURCE_STT_GLOBAL_CONCURRENCY, 50),
      leaseMs: positiveInt(env.RESOURCE_STT_LEASE_MS, Math.max(120_000, legacy.sttMaxSessionMs * 2)),
    },
    tts: {
      userRequestsPerMinute: positiveInt(env.RESOURCE_TTS_USER_RPM, 120),
      globalRequestsPerMinute: positiveInt(env.RESOURCE_TTS_GLOBAL_RPM, legacy.ttsGlobalRpm),
      userConcurrency: positiveInt(env.RESOURCE_TTS_USER_CONCURRENCY, 2),
      globalConcurrency: positiveInt(env.RESOURCE_TTS_GLOBAL_CONCURRENCY, 12),
      leaseMs: positiveInt(env.RESOURCE_TTS_LEASE_MS, 120_000),
    },
    embedding: {
      userRequestsPerMinute: positiveInt(env.RESOURCE_EMBEDDING_USER_RPM, 60),
      globalRequestsPerMinute: positiveInt(env.RESOURCE_EMBEDDING_GLOBAL_RPM, legacy.embeddingGlobalRpm),
      userConcurrency: positiveInt(env.RESOURCE_EMBEDDING_USER_CONCURRENCY, 2),
      globalConcurrency: positiveInt(env.RESOURCE_EMBEDDING_GLOBAL_CONCURRENCY, legacy.embeddingGlobalConcurrency),
      leaseMs: positiveInt(env.RESOURCE_EMBEDDING_LEASE_MS, 120_000),
    },
  };
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
