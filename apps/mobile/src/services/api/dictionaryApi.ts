import { getAuthHeaders } from "../auth/authHeaders";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

type ApiOk<T> = { ok: true; data: T };
type ApiFail = { ok: false; error: { code: string; message: string } };
type ApiResult<T> = ApiOk<T> | ApiFail;

export type DictionaryLookupResult = {
  term: string;
  source?: {
    type: string;
    title: string;
  } | null;
  target: {
    meaning: string;
    example: string;
    sourceNote?: string | null;
    scenario: string;
  };
  ui: {
    meaning: string;
    example: string;
    sourceNote?: string | null;
    scenario: string;
  };
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
  const res = await fetch(`${BASE_URL}/dictionary/lookup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
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
