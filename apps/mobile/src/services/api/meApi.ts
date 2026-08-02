import { getAuthHeaders } from "../auth/authHeaders";
import type { TargetLanguageCode } from "@lf/core/language/targetLanguages";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

type ApiOk<T> = { ok: true; data: T };
type ApiFail = { ok: false; error: { code: string; message: string } };
type ApiResult<T> = ApiOk<T> | ApiFail;

export type CurrentEntitlement = {
  userId: string;
  plan: "free" | "plus_monthly" | "pro_monthly";
  tier: "free" | "plus" | "pro";
  isPro: boolean;
  isPlus: boolean;
  isMember: boolean;
  expiresAt: string | null;
  dateKey: string;
  dailyTotalLimit: number;
  validUntil: string | null;
  usedTotalChars: number;
  remainingChars: number;
  quotas?: {
    aiDailyChars: number;
    cloudImages: number;
    usedCloudImages: number;
    remainingCloudImages: number;
  };
  features?: {
    cloudSync: boolean;
    conversationHistorySync: boolean;
    highQualityTts: boolean;
  };
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
export type LearningLanguage = TargetLanguageCode;
export type TtsProviderCode = "azure_global";
export type PromptDifficulty = "simple" | "native";
export type GuideState = Record<string, { completedAt?: string }>;

export type UserPreference = {
  userId: string;
  appLocale: AppLocale;
  learningLanguage: LearningLanguage;
  promptDifficulty: PromptDifficulty;
  guideState: GuideState;
  ttsProvider: TtsProviderCode;
  ttsVoiceCode: string | null;
  sttMultilingualRecognitionEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type UpdateUserPreferenceInput = Partial<{
  appLocale: AppLocale;
  learningLanguage: LearningLanguage;
  promptDifficulty: PromptDifficulty;
  guideState: GuideState;
  ttsProvider: TtsProviderCode;
  ttsVoiceCode: string | null;
  sttMultilingualRecognitionEnabled: boolean;
}>;

export type UserProfile = {
  userId: string;
  nickname: string;
  nicknameSource: "default_generated" | "user_custom";
  registrationMethod: "phone" | "email";
  avatar: { url: string; thumbnailUrl: string; urlExpiresAt: string | null } | null;
  avatarKind: "default" | "custom";
};

export type UserBindings = {
  registrationMethod: "phone" | "email";
  phone: { bound: boolean; maskedValue: string | null; action: "none" | "bind" | "unsupported" };
  email: { bound: boolean; maskedValue: string | null; action: "none" | "bind" | "unsupported" };
};

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

export async function getUserProfile(): Promise<UserProfile> {
  return meRequest<UserProfile>("/me/profile");
}

export async function updateProfileNickname(nickname: string): Promise<UserProfile> {
  return meRequest<UserProfile>("/me/profile/nickname", {
    method: "PUT",
    body: JSON.stringify({ nickname }),
  });
}

export async function getUserBindings(): Promise<UserBindings> {
  return meRequest<UserBindings>("/me/bindings");
}

export async function createAvatarUpload(input: {
  fileSize: number;
  width: number;
  height: number;
}): Promise<{ uploadId: string; uploadUrl: string; headers: Record<string, string>; expiresAt: string }> {
  return meRequest("/me/avatar-uploads", { method: "POST", body: JSON.stringify(input) });
}

export async function completeAvatarUpload(uploadId: string): Promise<UserProfile> {
  return meRequest(`/me/avatar-uploads/${encodeURIComponent(uploadId)}/complete`, { method: "POST", body: "{}" });
}

export async function removeProfileAvatar(): Promise<UserProfile> {
  return meRequest("/me/avatar", { method: "DELETE" });
}

async function meRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(await getAuthHeaders()),
      ...init.headers,
    },
  });
  const json = (await res.json()) as ApiResult<T>;
  if (!json.ok) throw new Error(json.error.message);
  return json.data;
}
