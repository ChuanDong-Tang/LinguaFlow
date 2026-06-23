import { getAuthHeaders } from "../auth/authHeaders";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

type ApiOk<T> = { ok: true; data: T };
type ApiFail = { ok: false; error: { code: string; message: string } };
type ApiResult<T> = ApiOk<T> | ApiFail;

export type TtsWordMark = {
  text: string;
  startMs: number;
  durationMs: number;
};

export type TtsSentenceMark = {
  text: string;
  textStart: number;
  textEnd: number;
  startMs: number;
  durationMs: number;
};

export type TtsSourceKey = "rewrite" | "reply";

export type TtsVoiceOption = {
  provider: string;
  languageCode: string;
  voiceCode: string;
  label: string;
  isDefault: boolean;
};

export type TtsMessageAsset = {
  id: string;
  messageId: string;
  provider: string;
  voiceCode: string;
  languageCode: string;
  sourceKey: TtsSourceKey;
  sourceText: string;
  sourceTextHash: string;
  audioUrl: string;
  audioUrlExpiresAt: string | null;
  durationMs: number | null;
  playbackRange: {
    startMs: number;
    endMs: number;
  } | null;
  wordMarks: TtsWordMark[] | null;
  sentenceMarks: TtsSentenceMark[] | null;
  cached: boolean;
  deduped: boolean;
};

export async function getMessageTtsAsset(input: {
  messageId: string;
  sourceKey?: TtsSourceKey;
  textStart?: number;
  textEnd?: number;
  signal?: AbortSignal;
}): Promise<TtsMessageAsset> {
  validateTtsRange(input);
  const params = new URLSearchParams();
  params.set("sourceKey", input.sourceKey ?? "rewrite");
  if (input.textStart !== undefined) params.set("textStart", String(input.textStart));
  if (input.textEnd !== undefined) params.set("textEnd", String(input.textEnd));
  const query = params.toString();
  const res = await fetch(
    `${BASE_URL}/tts/messages/${encodeURIComponent(input.messageId)}${query ? `?${query}` : ""}`,
    { headers: await getAuthHeaders(), signal: input.signal },
  );
  const json = (await res.json()) as ApiResult<TtsMessageAsset>;
  if (!json.ok) {
    const error = new Error(json.error.message) as Error & { code?: string; status?: number };
    error.code = json.error.code;
    error.status = res.status;
    throw error;
  }
  return json.data;
}

export async function listTtsVoices(input: { languageCode?: string } = {}): Promise<TtsVoiceOption[]> {
  const params = new URLSearchParams();
  if (input.languageCode) params.set("languageCode", input.languageCode);
  const query = params.toString();
  const res = await fetch(`${BASE_URL}/tts/voices${query ? `?${query}` : ""}`, {
    headers: await getAuthHeaders(),
  });
  const json = (await res.json()) as ApiResult<TtsVoiceOption[]>;
  if (!json.ok) {
    const error = new Error(json.error.message) as Error & { code?: string; status?: number };
    error.code = json.error.code;
    error.status = res.status;
    throw error;
  }
  return json.data;
}

function validateTtsRange(input: { textStart?: number; textEnd?: number }): void {
  if (input.textStart === undefined && input.textEnd === undefined) return;
  if (input.textStart === undefined || input.textEnd === undefined) {
    throw new Error("TTS textStart and textEnd must be provided together");
  }
  if (
    !Number.isInteger(input.textStart) ||
    !Number.isInteger(input.textEnd) ||
    input.textStart < 0 ||
    input.textEnd <= input.textStart
  ) {
    throw new Error("Invalid TTS text range");
  }
}
