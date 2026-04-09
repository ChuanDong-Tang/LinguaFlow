export interface RewriteSuccessPayload {
  version: "1";
  rewritten_text: string;
  key_phrases: string[];
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

function getRewriteEndpoint(): string {
  const customEndpoint = import.meta.env.VITE_REWRITE_API_URL;
  return customEndpoint?.trim() || DEFAULT_REWRITE_ENDPOINT;
}

export async function requestRewrite(text: string): Promise<RewriteSuccessPayload> {
  const response = await fetch(getRewriteEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  let payload: RewriteSuccessPayload | RewriteErrorPayload | null = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = (payload as RewriteErrorPayload | null)?.error;
    throw new RewriteApiError(error?.code || "REQUEST_FAILED", error?.message || "Rewrite request failed.");
  }

  if (
    !payload ||
    typeof (payload as RewriteSuccessPayload).rewritten_text !== "string" ||
    !Array.isArray((payload as RewriteSuccessPayload).key_phrases)
  ) {
    throw new RewriteApiError("INVALID_MODEL_RESPONSE", "The rewrite result is invalid.");
  }

  return payload as RewriteSuccessPayload;
}
