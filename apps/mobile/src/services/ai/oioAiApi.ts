import EventSource from "react-native-sse";
import { getAuthHeaders } from "../auth/authHeaders";
import { fetchWithTimeout } from "../api/fetchWithTimeout";
import { notifyQuotaExhaustion, quotaExhaustionKindForCode } from "../usage/quotaExhaustion";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;
const STREAM_TIMEOUT_MS = 90_000;

export type OioAiCard = {
  recordId: string;
  title: string;
  dateKey: string;
  preview: string;
  hasPhoto: boolean;
  thumbnail: { url: string; width: number; height: number } | null;
};

export type OioAiAction = { kind: "start_blind_box"; cardIds: string[]; label: string };

export type OioAiBlock = { type: "cards"; cards: OioAiCard[] } | { type: "action"; action: OioAiAction };

export type OioAiEvent =
  | { type: "thread"; threadId: string }
  | { type: "delta"; text: string }
  | { type: "tool"; name: string }
  | { type: "cards"; cards: OioAiCard[] }
  | { type: "action"; action: OioAiAction }
  | { type: "done"; messageId: string; threadId: string }
  | { type: "error"; code: string };

export type OioAiMessage = { id: string; role: "user" | "assistant"; text: string; blocks?: OioAiBlock[] | null; createdAt: string };
export type OioAiThread = { id: string; title: string | null; contextCardId: string | null; updatedAt: string };

export class OioAiError extends Error {
  constructor(readonly code: string) { super(code); }
}

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Streams one OIO AI turn. Resolves on `done`; rejects with OioAiError on failure. */
export function streamOioAi(
  input: { text: string; threadId?: string | null; contextCardId?: string | null; appLocale: string; signal?: AbortSignal },
  onEvent: (event: OioAiEvent) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let source: EventSource | null = null;
    const finish = (error?: OioAiError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      source?.removeAllEventListeners();
      source?.close();
      if (error) {
        const quota = quotaExhaustionKindForCode(error.code);
        if (quota) notifyQuotaExhaustion(quota);
        reject(error);
      } else resolve();
    };
    const onAbort = () => finish(new OioAiError("ABORTED"));
    const timer = setTimeout(() => finish(new OioAiError("TIMEOUT")), STREAM_TIMEOUT_MS);
    if (input.signal?.aborted) { onAbort(); return; }
    input.signal?.addEventListener("abort", onAbort, { once: true });
    void getAuthHeaders().then((headers) => {
      if (settled) return;
      source = new EventSource(`${BASE_URL}/ai/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-lf-usage-api": "v2", ...headers },
        body: JSON.stringify({
          text: input.text,
          ...(input.threadId ? { threadId: input.threadId } : {}),
          ...(input.contextCardId ? { contextCardId: input.contextCardId } : {}),
          appLocale: input.appLocale,
          today: localToday(),
        }),
        pollingInterval: 0,
      });
      source.addEventListener("message", (event) => {
        if (!event.data) return;
        try {
          const parsed = JSON.parse(event.data) as OioAiEvent;
          onEvent(parsed);
          if (parsed.type === "done") finish();
          else if (parsed.type === "error") finish(new OioAiError(parsed.code));
        } catch {
          // Ignore a malformed chunk; the stream continues.
        }
      });
      source.addEventListener("error", (event) => {
        // HTTP errors before the stream opens carry the JSON error body.
        const body = "message" in event && typeof event.message === "string" ? event.message : "";
        let code = "NETWORK_ERROR";
        try { code = (JSON.parse(body) as { error?: { code?: string } }).error?.code ?? code; } catch { /* not JSON */ }
        finish(new OioAiError(code));
      });
    }).catch(() => finish(new OioAiError("AUTH_FAILED")));
  });
}

async function get<T>(path: string): Promise<T> {
  const response = await fetchWithTimeout(`${BASE_URL}${path}`, { headers: await getAuthHeaders() });
  const result = await response.json() as { ok: true; data: T } | { ok: false; error: { code: string } };
  if (!result.ok) throw new OioAiError(result.error.code);
  return result.data;
}

export async function listOioAiThreads(): Promise<OioAiThread[]> {
  return (await get<{ threads: OioAiThread[] }>("/ai/threads")).threads;
}

export async function listOioAiMessages(threadId: string): Promise<OioAiMessage[]> {
  return (await get<{ messages: OioAiMessage[] }>(`/ai/threads/${encodeURIComponent(threadId)}/messages`)).messages;
}
