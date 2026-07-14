import { existsSync, readFileSync } from "node:fs";
import { getRuntimeConfig } from "../../../config/runtimeConfig.js";
import { GooglePlayBillingConfigError } from "./GooglePlayBillingErrors.js";

export interface GoogleServiceAccountCredentials {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface GooglePlayBillingRuntimeConfig {
  packageName: string;
  credentials: GoogleServiceAccountCredentials;
  plusProductId: string;
  proProductId: string;
  plusBasePlanId: string | null;
  proBasePlanId: string | null;
}

export function isGooglePlayBillingConfigured(): boolean {
  const config = getRuntimeConfig();
  return Boolean(
    config.payment.googlePlayBilling.packageName &&
      config.payment.googlePlayBilling.serviceAccountJson &&
      config.payment.googlePlayBilling.plusMonthlyProductId &&
      config.payment.googlePlayBilling.proMonthlyProductId
  );
}

export function loadGooglePlayBillingConfig(): GooglePlayBillingRuntimeConfig {
  const config = getRuntimeConfig();
  return {
    packageName: requireConfig(config.payment.googlePlayBilling.packageName, "GOOGLE_PLAY_PACKAGE_NAME"),
    credentials: parseServiceAccountCredentials(
      requireConfig(config.payment.googlePlayBilling.serviceAccountJson, "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON")
    ),
    plusProductId: requireConfig(
      config.payment.googlePlayBilling.plusMonthlyProductId,
      "GOOGLE_PLAY_PLUS_MONTHLY_PRODUCT_ID"
    ),
    proProductId: requireConfig(
      config.payment.googlePlayBilling.proMonthlyProductId,
      "GOOGLE_PLAY_PRO_MONTHLY_PRODUCT_ID"
    ),
    plusBasePlanId: config.payment.googlePlayBilling.plusMonthlyBasePlanId,
    proBasePlanId: config.payment.googlePlayBilling.proMonthlyBasePlanId,
  };
}

function requireConfig(value: string | null, key: string): string {
  if (!value) throw new GooglePlayBillingConfigError(`${key} is required`);
  return value;
}

function parseServiceAccountCredentials(raw: string): GoogleServiceAccountCredentials {
  const material = readServiceAccountMaterial(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(material);
  } catch (error) {
    throw new GooglePlayBillingConfigError(
      `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new GooglePlayBillingConfigError("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON must be an object");
  }
  const value = parsed as Record<string, unknown>;
  const clientEmail = typeof value.client_email === "string" ? value.client_email.trim() : "";
  const privateKey = typeof value.private_key === "string" ? value.private_key.replace(/\\n/g, "\n").trim() : "";
  const tokenUri = typeof value.token_uri === "string" ? value.token_uri.trim() : undefined;
  if (!clientEmail) throw new GooglePlayBillingConfigError("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON.client_email is required");
  if (!privateKey) throw new GooglePlayBillingConfigError("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON.private_key is required");
  return {
    client_email: clientEmail,
    private_key: privateKey,
    token_uri: tokenUri,
  };
}

function readServiceAccountMaterial(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return trimmed;
  if (existsSync(trimmed)) {
    return readFileSync(trimmed, "utf8").trim();
  }
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8").trim();
    if (decoded.startsWith("{")) return decoded;
  } catch {
    // Fall through to the original value so JSON.parse reports a useful error.
  }
  return trimmed;
}
