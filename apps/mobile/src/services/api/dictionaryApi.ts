import { getAuthHeaders } from "../auth/authHeaders";
import { notifyQuotaExhaustion, quotaExhaustionKindForCode } from "../usage/quotaExhaustion";
import { fetchWithTimeout } from "./fetchWithTimeout";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

type ApiOk<T> = { ok: true; data: T };
type ApiFail = { ok: false; error: { code: string; message: string } };
type ApiResult<T> = ApiOk<T> | ApiFail;

export type DictionaryLookupResult = {
  queryType: "word" | "phrase" | "sentence";
  term: string;
  phonetic: string | null;
  audioUrl: string | null;
  targetMeaning: string;
  nativeMeaning: string;
};

export function dictionaryLookupErrorKey(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";
  if (code === "DICTIONARY_NOT_FOUND") return "dictionary.error.not_found" as const;
  if (code === "TOKEN_QUOTA_EXCEEDED" || code === "DAILY_QUOTA_EXCEEDED") {
    return "dictionary.error.quota_exceeded" as const;
  }
  return "dictionary.error.failed" as const;
}

export async function lookupDictionary(input: {
  term: string;
  context: string;
  selectionStart: number;
  selectionEnd: number;
  targetLanguage: string;
  uiLanguage: string;
  contactId: string;
  messageId?: string | null;
  signal?: AbortSignal;
}): Promise<DictionaryLookupResult> {
  const res = await fetchWithTimeout(`${BASE_URL}/dictionary/lookup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-lf-usage-api": "v2",
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify({
      term: input.term,
      context: input.context,
      selectionStart: input.selectionStart,
      selectionEnd: input.selectionEnd,
      targetLanguage: input.targetLanguage,
      uiLanguage: input.uiLanguage,
      contactId: input.contactId,
      messageId: input.messageId ?? null,
    }),
    signal: input.signal,
  });
  const json = (await res.json()) as ApiResult<DictionaryLookupResult>;
  if (!json.ok) {
    const quotaKind = quotaExhaustionKindForCode(json.error.code);
    if (quotaKind) notifyQuotaExhaustion(quotaKind);
    const error = new Error(json.error.message) as Error & { code?: string; status?: number };
    error.code = json.error.code;
    error.status = res.status;
    throw error;
  }
  return json.data;
}

export async function getDictionaryTermAudio(term: string, signal?: AbortSignal): Promise<{ audioUrl: string; audioUrlExpiresAt: string | null }> {
  const res = await fetchWithTimeout(`${BASE_URL}/tts/dictionary`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify({ term, languageCode: "en-US" }),
    signal,
  });
  const json = (await res.json()) as ApiResult<{ audioUrl: string; audioUrlExpiresAt: string | null }>;
  if (!json.ok) throw new Error(json.error.message);
  return json.data;
}

export async function getStandaloneTextAudio(text: string, languageCode = "en-US"): Promise<{ audioUrl: string; audioUrlExpiresAt: string | null }> {
  const res = await fetchWithTimeout(`${BASE_URL}/tts/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify({ text, languageCode }),
  });
  const json = (await res.json()) as ApiResult<{ audioUrl: string; audioUrlExpiresAt: string | null }>;
  if (!json.ok) throw new Error(json.error.message);
  return json.data;
}
