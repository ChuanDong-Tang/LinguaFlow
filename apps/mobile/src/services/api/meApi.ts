import { getAuthHeaders } from "../auth/authHeaders";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

type ApiOk<T> = { ok: true; data: T };
type ApiFail = { ok: false; error: { code: string; message: string } };
type ApiResult<T> = ApiOk<T> | ApiFail;

export type CurrentEntitlement = {
  userId: string;
  plan: "free" | "pro_monthly";
  isPro: boolean;
  expiresAt: string | null;
  dateKey: string;
  dailyTotalLimit: number;
  validUntil: string | null;
  usedTotalChars: number;
  remainingChars: number;
  source?: "authing" | "mock";
};

export type RefreshEntitlementResult = {
  entitlement: CurrentEntitlement;
  paymentOrders: {
    scanned: number;
    paid: number;
    closed: number;
    failed: number;
  };
  autoRenewCharges: {
    scanned: number;
    paid: number;
    failed: number;
  };
};

export type AppLocale = "zh-CN" | "zh-TW" | "en-US" | "ja-JP";
export type LearningLanguage = "en-US" | "ja-JP";
export type TtsProviderCode = "azure_global";
export type PromptDifficulty = "simple" | "natural" | "native";
export type PromptStyle = "native_casual" | "standard";

export type UserPreference = {
  userId: string;
  appLocale: AppLocale;
  learningLanguage: LearningLanguage;
  promptDifficulty: PromptDifficulty;
  promptStyle: PromptStyle;
  ttsProvider: TtsProviderCode;
  ttsVoiceCode: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpdateUserPreferenceInput = Partial<{
  appLocale: AppLocale;
  learningLanguage: LearningLanguage;
  promptDifficulty: PromptDifficulty;
  promptStyle: PromptStyle;
  ttsProvider: TtsProviderCode;
  ttsVoiceCode: string | null;
}>;

export async function getCurrentEntitlement(): Promise<CurrentEntitlement> {
  const res = await fetch(`${BASE_URL}/me/entitlement`, {
    headers: await getAuthHeaders(),
  });

  const json = (await res.json()) as ApiResult<CurrentEntitlement>;
  if (!json.ok) {
    throw new Error(json.error.message);
  }

  return json.data;
}

export async function refreshCurrentEntitlement(): Promise<RefreshEntitlementResult> {
  const res = await fetch(`${BASE_URL}/me/entitlement/refresh`, {
    method: "POST",
    headers: await getAuthHeaders(),
  });

  const json = (await res.json()) as ApiResult<RefreshEntitlementResult>;
  if (!json.ok) {
    throw new Error(json.error.message);
  }

  return json.data;
}

export async function getUserPreference(): Promise<UserPreference> {
  const res = await fetch(`${BASE_URL}/me/preferences`, {
    headers: await getAuthHeaders(),
  });

  const json = (await res.json()) as ApiResult<UserPreference>;
  if (!json.ok) {
    throw new Error(json.error.message);
  }

  return json.data;
}

export async function updateUserPreference(input: UpdateUserPreferenceInput): Promise<UserPreference> {
  const res = await fetch(`${BASE_URL}/me/preferences`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify(input),
  });

  const json = (await res.json()) as ApiResult<UserPreference>;
  if (!json.ok) {
    throw new Error(json.error.message);
  }

  return json.data;
}
