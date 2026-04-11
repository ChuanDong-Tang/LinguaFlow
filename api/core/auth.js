import { createClerkClient, verifyToken } from "@clerk/backend";
import { getAppConfig } from "./appConfig.js";
import { getBearerToken } from "./http.js";

let clerkClient = null;

function getClerkClient() {
  if (clerkClient) return clerkClient;

  const config = getAppConfig();
  if (!config.clerkSecretKey) {
    throw new Error("CLERK_SECRET_KEY is not configured.");
  }

  clerkClient = createClerkClient({
    secretKey: config.clerkSecretKey,
  });

  return clerkClient;
}

export async function authenticateClerkRequest(req, { requireAuth = false } = {}) {
  const token = getBearerToken(req);
  if (!token) {
    if (requireAuth) {
      return {
        ok: false,
        code: "UNAUTHORIZED",
        message: "Sign in is required.",
      };
    }

    return {
      ok: true,
      clerkUserId: null,
      tokenPayload: null,
    };
  }

  try {
    const config = getAppConfig();
    const tokenPayload = await verifyToken(token, {
      secretKey: config.clerkSecretKey,
    });
    const clerkUserId = typeof tokenPayload?.sub === "string" ? tokenPayload.sub : null;
    if (!clerkUserId) {
      return {
        ok: false,
        code: "INVALID_TOKEN",
        message: "The session token is missing a subject.",
      };
    }

    return {
      ok: true,
      clerkUserId,
      tokenPayload,
    };
  } catch {
    if (!requireAuth) {
      return {
        ok: true,
        clerkUserId: null,
        tokenPayload: null,
      };
    }
    return {
      ok: false,
      code: "INVALID_TOKEN",
      message: "The session token could not be verified.",
    };
  }
}

export async function getClerkUser(clerkUserId) {
  const client = getClerkClient();
  return client.users.getUser(clerkUserId);
}
