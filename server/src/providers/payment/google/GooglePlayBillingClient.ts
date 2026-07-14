import { createSign } from "node:crypto";
import {
  GOOGLE_ANDROID_PUBLISHER_BASE_URL,
  GOOGLE_ANDROID_PUBLISHER_SCOPE,
  GOOGLE_OAUTH_TOKEN_URL,
} from "./GooglePlayBillingConstants.js";
import type { GoogleServiceAccountCredentials } from "./GooglePlayBillingConfig.js";
import { GooglePlayBillingVerifyError } from "./GooglePlayBillingErrors.js";

export interface GoogleSubscriptionPurchaseV2 {
  kind?: string;
  regionCode?: string;
  startTime?: string;
  subscriptionState?: string;
  latestOrderId?: string;
  linkedPurchaseToken?: string;
  pausedStateContext?: unknown;
  canceledStateContext?: unknown;
  testPurchase?: unknown;
  acknowledgementState?: string;
  externalAccountIdentifiers?: {
    externalAccountId?: string;
    obfuscatedExternalAccountId?: string;
    obfuscatedExternalProfileId?: string;
  };
  lineItems?: Array<{
    productId?: string;
    expiryTime?: string;
    autoRenewingPlan?: {
      autoRenewEnabled?: boolean;
      recurringPrice?: {
        currencyCode?: string;
        units?: string | number;
        nanos?: number;
      };
    };
    prepaidPlan?: {
      allowExtendAfterTime?: string;
    };
    offerDetails?: {
      basePlanId?: string;
      offerId?: string;
      offerTags?: string[];
    };
  }>;
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

export async function createGoogleAccessToken(credentials: GoogleServiceAccountCredentials): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) {
    return cachedToken.accessToken;
  }

  const assertion = createServiceAccountJwt(credentials, now);
  const response = await fetch(credentials.token_uri || GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });
  const bodyText = await response.text().catch(() => "");
  if (!response.ok) {
    throw new GooglePlayBillingVerifyError(
      `Google OAuth token request failed: HTTP ${response.status}`,
      `GOOGLE_OAUTH_HTTP_${response.status}`,
      { status: response.status, responseBody: truncateForLog(bodyText) }
    );
  }
  const body = JSON.parse(bodyText) as { access_token?: string; expires_in?: number };
  const accessToken = body.access_token?.trim();
  if (!accessToken) {
    throw new GooglePlayBillingVerifyError("Google OAuth token response missing access_token");
  }
  cachedToken = {
    accessToken,
    expiresAt: now + (typeof body.expires_in === "number" ? body.expires_in : 3600),
  };
  return accessToken;
}

export async function fetchGoogleSubscriptionV2(input: {
  packageName: string;
  purchaseToken: string;
  accessToken: string;
}): Promise<GoogleSubscriptionPurchaseV2> {
  const response = await fetch(
    `${GOOGLE_ANDROID_PUBLISHER_BASE_URL}/applications/${encodeURIComponent(input.packageName)}` +
      `/purchases/subscriptionsv2/tokens/${encodeURIComponent(input.purchaseToken)}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${input.accessToken}` },
    }
  );
  const bodyText = await response.text().catch(() => "");
  if (!response.ok) {
    throw new GooglePlayBillingVerifyError(
      `Google Play subscription verify failed: HTTP ${response.status}`,
      `GOOGLE_PLAY_SUBSCRIPTION_HTTP_${response.status}`,
      { status: response.status, responseBody: truncateForLog(bodyText) }
    );
  }
  return JSON.parse(bodyText) as GoogleSubscriptionPurchaseV2;
}

export async function acknowledgeGoogleSubscription(input: {
  packageName: string;
  subscriptionId: string;
  purchaseToken: string;
  accessToken: string;
  externalAccountId?: string | null;
}): Promise<void> {
  const response = await fetch(
    `${GOOGLE_ANDROID_PUBLISHER_BASE_URL}/applications/${encodeURIComponent(input.packageName)}` +
      `/purchases/subscriptions/${encodeURIComponent(input.subscriptionId)}` +
      `/tokens/${encodeURIComponent(input.purchaseToken)}:acknowledge`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(input.externalAccountId
          ? { externalAccountIds: { obfuscatedAccountId: input.externalAccountId } }
          : {}),
      }),
    }
  );
  if (response.ok) return;
  const bodyText = await response.text().catch(() => "");
  throw new GooglePlayBillingVerifyError(
    `Google Play subscription acknowledge failed: HTTP ${response.status}`,
    `GOOGLE_PLAY_ACK_HTTP_${response.status}`,
    { status: response.status, responseBody: truncateForLog(bodyText) }
  );
}

export async function cancelGoogleSubscriptionRenewal(input: {
  packageName: string;
  purchaseToken: string;
  accessToken: string;
}): Promise<void> {
  const response = await fetch(
    `${GOOGLE_ANDROID_PUBLISHER_BASE_URL}/applications/${encodeURIComponent(input.packageName)}` +
      `/purchases/subscriptionsv2/tokens/${encodeURIComponent(input.purchaseToken)}:cancel`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cancellationContext: {
          cancellationType: "USER_REQUESTED_STOP_RENEWALS",
        },
      }),
    }
  );
  if (response.ok) return;
  const bodyText = await response.text().catch(() => "");
  throw new GooglePlayBillingVerifyError(
    `Google Play subscription cancel failed: HTTP ${response.status}`,
    `GOOGLE_PLAY_CANCEL_HTTP_${response.status}`,
    { status: response.status, responseBody: truncateForLog(bodyText) }
  );
}

function createServiceAccountJwt(credentials: GoogleServiceAccountCredentials, now: number): string {
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({
    iss: credentials.client_email,
    scope: GOOGLE_ANDROID_PUBLISHER_SCOPE,
    aud: credentials.token_uri || GOOGLE_OAUTH_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  });
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(credentials.private_key, "base64url");
  return `${signingInput}.${signature}`;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function truncateForLog(value: string, maxLength = 500): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}
