import { getAuthService } from "../auth/authService";

export interface RewriteSuccessPayload {
  version: "1";
  rewritten_text: string;
  key_phrases: string[];
}

export interface RewriteUsagePayload {
  daily_used: number;
  daily_limit: number;
}

export interface OioChatRewritePayload {
  version: "4";
  natural_version: string;
  reply: string;
  key_phrases: string[];
  usage?: RewriteUsagePayload | null;
}

export interface PracticeFeedbackPayload {
  version: "2";
  is_already_natural: boolean;
  rewritten_answer: string;
  feedback: string;
  usage?: RewriteUsagePayload | null;
}

export interface PracticeQuestionPayload {
  version: "1";
  question: string;
  usage?: RewriteUsagePayload | null;
}

interface RewriteErrorPayload {
  error?: {
    code?: string;
    message?: string;
  };
}

export class RewriteApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RewriteApiError";
    this.code = code;
  }
}

const DEFAULT_REWRITE_ENDPOINT = "/api/rewrite";
const DEFAULT_REWRITE_TIMEOUT_MS = 30_000;

function getRewriteEndpoint(): string {
  const customEndpoint = import.meta.env.VITE_REWRITE_API_URL;
  return customEndpoint?.trim() || DEFAULT_REWRITE_ENDPOINT;
}

function getRewriteTimeoutMs(): number {
  const parsed = Number.parseInt(import.meta.env.VITE_REWRITE_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REWRITE_TIMEOUT_MS;
}

export async function requestRewrite(text: string): Promise<RewriteSuccessPayload> {
  return await requestJson<RewriteSuccessPayload>({ text }, "Rewrite request failed.", (payload) => {
    return (
      !!payload &&
      typeof (payload as RewriteSuccessPayload).rewritten_text === "string" &&
      Array.isArray((payload as RewriteSuccessPayload).key_phrases)
    );
  });
}

export async function requestOioChat(text: string, mode: "beginner" | "advanced"): Promise<OioChatRewritePayload> {
  return await requestJson<OioChatRewritePayload>({ text, mode }, "Chat request failed.", (payload) => {
    if (!payload || typeof payload !== "object") return false;
    return (
      (payload as OioChatRewritePayload).version === "4" &&
      typeof (payload as OioChatRewritePayload).natural_version === "string" &&
      typeof (payload as OioChatRewritePayload).reply === "string" &&
      Array.isArray((payload as OioChatRewritePayload).key_phrases)
    );
  });
}

export async function requestPracticeFeedback(question: string, answer: string, referenceAnswer?: string): Promise<PracticeFeedbackPayload> {
  return await requestPracticeFeedbackWithTargetPhrase(question, answer, "", referenceAnswer);
}

export async function requestPracticeQuestion(contextText: string, targetPhrase: string): Promise<PracticeQuestionPayload> {
  return await requestJson<PracticeQuestionPayload>(
    { mode: "practice_question", context_text: contextText, target_phrase: targetPhrase },
    "Practice question request failed.",
    (payload) =>
      !!payload &&
      (payload as PracticeQuestionPayload).version === "1" &&
      typeof (payload as PracticeQuestionPayload).question === "string",
  );
}

export async function requestPracticeFeedbackWithTargetPhrase(
  question: string,
  answer: string,
  targetPhrase: string,
  referenceAnswer?: string,
): Promise<PracticeFeedbackPayload> {
  return await requestJson<PracticeFeedbackPayload>(
    { mode: "practice_feedback", question, answer, target_phrase: targetPhrase, reference_answer: referenceAnswer ?? "" },
    "Practice feedback request failed.",
    (payload) =>
      !!payload &&
      (payload as PracticeFeedbackPayload).version === "2" &&
      typeof (payload as PracticeFeedbackPayload).is_already_natural === "boolean" &&
      typeof (payload as PracticeFeedbackPayload).rewritten_answer === "string" &&
      typeof (payload as PracticeFeedbackPayload).feedback === "string",
  );
}

async function requestJson<T>(
  body: Record<string, unknown>,
  fallbackMessage: string,
  isValid: (payload: unknown) => boolean,
): Promise<T> {
  const token = await getAuthService().getSessionToken();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), getRewriteTimeoutMs());
  try {
    const response = await fetch(getRewriteEndpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let payload: T | RewriteErrorPayload | null = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const error = (payload as RewriteErrorPayload | null)?.error;
      throw new RewriteApiError(error?.code || "REQUEST_FAILED", error?.message || fallbackMessage);
    }

    if (!isValid(payload)) {
      throw new RewriteApiError("INVALID_MODEL_RESPONSE", "The model result is invalid.");
    }

    return payload as T;
  } catch (error) {
    if (error instanceof RewriteApiError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new RewriteApiError("REQUEST_TIMEOUT", "The request timed out. Please try again.");
    }
    throw new RewriteApiError("NETWORK_ERROR", "Network error while contacting the server.");
  } finally {
    window.clearTimeout(timeout);
  }
}
