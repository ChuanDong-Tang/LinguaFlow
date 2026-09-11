import type { FastifyInstance, FastifyReply } from "fastify";
import { ExpoUpdateStorageProvider } from "@lf/server/providers/storage/ExpoUpdateStorageProvider.js";
import {
  createManifestResponse,
  createNoUpdateResponse,
  parseStoredExpoUpdate,
  updatePointerKey,
  type UpdatePlatform,
} from "./protocol.js";

type UpdateStorage = Pick<ExpoUpdateStorageProvider, "download">;

interface UpdateRequest {
  Headers: {
    "expo-platform"?: string;
    "expo-runtime-version"?: string;
    "expo-protocol-version"?: string;
    "expo-current-update-id"?: string;
    "expo-expect-signature"?: string;
    "expo-channel-name"?: string;
  };
  Querystring: {
    platform?: string;
    "runtime-version"?: string;
    channel?: string;
  };
}

export function registerExpoUpdateRoutes(
  app: FastifyInstance,
  storage: UpdateStorage = new ExpoUpdateStorageProvider(),
): void {
  const prefix = normalizeSegment(process.env.LF_EXPO_UPDATES_STORAGE_PREFIX || "expo-updates");
  const updatesEnabled = readBoolean(process.env.LF_EXPO_UPDATES_ENABLED, false);

  app.get<UpdateRequest>("/updates/manifest", async (req, reply) => {
    const platform = req.headers["expo-platform"] ?? req.query.platform;
    const runtimeVersion = req.headers["expo-runtime-version"] ?? req.query["runtime-version"];
    const channel = req.headers["expo-channel-name"] ?? req.query.channel ?? "production";
    const protocolVersion = Number.parseInt(req.headers["expo-protocol-version"] ?? "1", 10);

    if (platform !== "ios" && platform !== "android") {
      return reply.status(400).send({ error: "expo-platform must be ios or android" });
    }
    if (!runtimeVersion || !isSafeSegment(runtimeVersion)) {
      return reply.status(400).send({ error: "expo-runtime-version is missing or invalid" });
    }
    if (!isSafeSegment(channel)) {
      return reply.status(400).send({ error: "expo-channel-name is invalid" });
    }
    if (protocolVersion !== 0 && protocolVersion !== 1) {
      return reply.status(400).send({ error: "expo-protocol-version must be 0 or 1" });
    }
    if (!updatesEnabled) return sendNoUpdate(reply, protocolVersion);

    const expected = { channel, runtimeVersion, platform: platform as UpdatePlatform };
    let rawPointer: Buffer;
    try {
      rawPointer = await storage.download(updatePointerKey(prefix, channel, runtimeVersion, expected.platform));
    } catch (error) {
      if (!isMissingCosObject(error)) {
        req.log.error({ err: error, channel, runtimeVersion, platform }, "OTA manifest lookup failed");
        return reply.status(503).send({ error: "update service unavailable" });
      }
      return sendNoUpdate(reply, protocolVersion);
    }

    try {
      const update = parseStoredExpoUpdate(rawPointer, expected);
      if (protocolVersion === 1 && req.headers["expo-current-update-id"] === update.manifest.id) {
        return sendNoUpdate(reply, protocolVersion);
      }
      const response = createManifestResponse(update, Boolean(req.headers["expo-expect-signature"]));
      setProtocolHeaders(reply, protocolVersion, response.contentType);
      return reply.status(200).send(response.body);
    } catch (error) {
      req.log.error({ err: error, channel, runtimeVersion, platform }, "OTA manifest is invalid");
      return reply.status(500).send({ error: "invalid update manifest" });
    }
  });
}

function sendNoUpdate(reply: FastifyReply, protocolVersion: number) {
  if (protocolVersion === 0) {
    return reply.status(404).send({ error: "no update available" });
  }
  const response = createNoUpdateResponse();
  setProtocolHeaders(reply, 1, response.contentType);
  return reply.status(200).send(response.body);
}

function setProtocolHeaders(
  reply: { header(name: string, value: string | number): unknown },
  protocolVersion: number,
  contentType: string,
): void {
  reply.header("expo-protocol-version", protocolVersion);
  reply.header("expo-sfv-version", 0);
  reply.header("cache-control", "private, no-store");
  reply.header("vary", "expo-platform, expo-runtime-version, expo-channel-name, expo-current-update-id");
  reply.header("content-type", contentType);
}

function normalizeSegment(value: string): string {
  const normalized = value.trim().replace(/^\/+|\/+$/g, "");
  if (!normalized || !isSafeSegment(normalized)) throw new Error("LF_EXPO_UPDATES_STORAGE_PREFIX is invalid");
  return normalized;
}

function isSafeSegment(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value);
}

function isMissingCosObject(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; statusCode?: number };
  return candidate.code === "NoSuchKey" || candidate.code === "NoSuchResource" || candidate.statusCode === 404;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return value.trim().toLowerCase() === "true";
}
