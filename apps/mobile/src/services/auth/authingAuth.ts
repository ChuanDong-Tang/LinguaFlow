import * as AuthSession from "expo-auth-session";
import Constants from "expo-constants";

const AUTHING_DOMAIN = process.env.EXPO_PUBLIC_AUTHING_DOMAIN;
const AUTHING_CLIENT_ID = process.env.EXPO_PUBLIC_AUTHING_CLIENT_ID;

export type AuthingDiscovery = {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userInfoEndpoint: string;
};

export function isAuthingConfigured(): boolean {
  return Boolean(AUTHING_DOMAIN && AUTHING_CLIENT_ID);
}

export function getAuthingDiscovery(): AuthingDiscovery {
  const domain = normalizeAuthingDomain();

  return {
    authorizationEndpoint: `${domain}/oidc/auth`,
    tokenEndpoint: `${domain}/oidc/token`,
    userInfoEndpoint: `${domain}/oidc/me`,
  };
}

export function getAuthingClientId(): string {
  if (!AUTHING_CLIENT_ID) {
    throw new Error("EXPO_PUBLIC_AUTHING_CLIENT_ID is required");
  }

  return AUTHING_CLIENT_ID;
}

export function getAuthingRedirectUri(): string {
  return AuthSession.makeRedirectUri({
    scheme: process.env.EXPO_PUBLIC_AUTHING_REDIRECT_SCHEME ?? getExpoScheme() ?? "oio",
    path: "auth/callback",
  });
}

function normalizeAuthingDomain(): string {
  if (!AUTHING_DOMAIN) {
    throw new Error("EXPO_PUBLIC_AUTHING_DOMAIN is required");
  }

  return AUTHING_DOMAIN.replace(/\/+$/, "");
}

function getExpoScheme(): string | null {
  const scheme = Constants.expoConfig?.scheme;
  if (typeof scheme === "string" && scheme.trim()) return scheme.trim();
  if (Array.isArray(scheme)) {
    const first = scheme.find((item) => typeof item === "string" && item.trim());
    return first?.trim() ?? null;
  }
  return null;
}
