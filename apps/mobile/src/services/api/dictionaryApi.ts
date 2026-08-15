import { getAuthHeaders } from "../auth/authHeaders";
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
  meanings: Array<{
    partOfSpeech: string;
    definitions: Array<{ definition: string; example: string | null }>;
  }>;
  source: { type: string; title: string } | null;
  target: DictionaryExplanation;
  ui: DictionaryExplanation;
};

export type DictionaryExplanation = {
  meaning: string;
  example: string;
  sourceNote: string | null;
  scenario: string;
};

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
