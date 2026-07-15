import { fetch, ProxyAgent } from "undici";
import { getRuntimeConfig } from "../../../config/runtimeConfig.js";
import {
  GooglePlayBillingConfigError,
  GooglePlayBillingVerifyError,
} from "./GooglePlayBillingErrors.js";

let cachedProxy: { url: string; dispatcher: ProxyAgent } | null = null;

/** Sends only explicitly selected Google API calls through the dedicated proxy. */
export async function fetchGoogleApi(input: string | URL, init?: Parameters<typeof fetch>[1]) {
  const config = getRuntimeConfig().payment.googlePlayBilling;
  const timeoutSignal = AbortSignal.timeout(config.apiTimeoutMs);
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  try {
    return await fetch(input, {
      ...init,
      signal,
      ...(config.apiProxyUrl
        ? { dispatcher: getProxyDispatcher(config.apiProxyUrl) }
        : {}),
    });
  } catch (error) {
    if (error instanceof GooglePlayBillingConfigError) throw error;
    throw new GooglePlayBillingVerifyError(
      "Google API network request failed",
      "GOOGLE_API_NETWORK_ERROR",
      {
        proxyEnabled: Boolean(config.apiProxyUrl),
        cause: describeNetworkError(error),
      }
    );
  }
}

function getProxyDispatcher(rawProxyUrl: string): ProxyAgent {
  if (cachedProxy?.url === rawProxyUrl) return cachedProxy.dispatcher;

  let parsed: URL;
  try {
    parsed = new URL(rawProxyUrl);
  } catch {
    throw new GooglePlayBillingConfigError("GOOGLE_API_PROXY_URL must be a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new GooglePlayBillingConfigError("GOOGLE_API_PROXY_URL must use http or https");
  }
  if (!parsed.hostname || !parsed.port) {
    throw new GooglePlayBillingConfigError("GOOGLE_API_PROXY_URL must include a host and port");
  }
  if (!parsed.username || !parsed.password) {
    throw new GooglePlayBillingConfigError("GOOGLE_API_PROXY_URL must include username and password authentication");
  }

  let username: string;
  let password: string;
  try {
    username = decodeURIComponent(parsed.username);
    password = decodeURIComponent(parsed.password);
  } catch {
    throw new GooglePlayBillingConfigError(
      "GOOGLE_API_PROXY_URL username and password must be URL-encoded"
    );
  }
  parsed.username = "";
  parsed.password = "";
  const dispatcher = new ProxyAgent({
    uri: parsed.toString(),
    token: `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`,
  });
  cachedProxy = { url: rawProxyUrl, dispatcher };
  return dispatcher;
}

function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) return String(error).slice(0, 200);
  const cause = error.cause;
  if (cause && typeof cause === "object" && "code" in cause) {
    return String((cause as { code?: unknown }).code).slice(0, 200);
  }
  return error.name.slice(0, 200);
}
