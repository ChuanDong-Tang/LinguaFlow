import { randomUUID } from "node:crypto";

export type UpdatePlatform = "ios" | "android";

export interface ExpoUpdateAsset {
  hash: string;
  key: string;
  contentType: string;
  fileExtension?: string;
  url: string;
}

export interface ExpoUpdateManifest {
  id: string;
  createdAt: string;
  runtimeVersion: string;
  launchAsset: ExpoUpdateAsset;
  assets: ExpoUpdateAsset[];
  metadata: Record<string, string>;
  extra: Record<string, unknown>;
}

export interface StoredExpoUpdate {
  schemaVersion: 1;
  channel: string;
  platform: UpdatePlatform;
  runtimeVersion: string;
  manifest: ExpoUpdateManifest;
  signature?: {
    sig: string;
    keyid: string;
    alg: "rsa-v1_5-sha256";
  };
}

export function updatePointerKey(prefix: string, channel: string, runtimeVersion: string, platform: UpdatePlatform): string {
  return [prefix, "manifests", channel, runtimeVersion, `${platform}.json`]
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export function parseStoredExpoUpdate(
  raw: Buffer,
  expected: { channel: string; runtimeVersion: string; platform: UpdatePlatform },
): StoredExpoUpdate {
  const value = JSON.parse(raw.toString("utf8")) as Partial<StoredExpoUpdate>;
  if (
    value.schemaVersion !== 1
    || value.channel !== expected.channel
    || value.runtimeVersion !== expected.runtimeVersion
    || value.platform !== expected.platform
    || !isManifest(value.manifest, expected.runtimeVersion)
  ) {
    throw new Error("EXPO_UPDATE_POINTER_INVALID");
  }
  return value as StoredExpoUpdate;
}

export function createManifestResponse(update: StoredExpoUpdate, expectSignature: boolean): MultipartResponse {
  if (expectSignature && !update.signature) {
    throw new Error("EXPO_UPDATE_SIGNATURE_REQUIRED");
  }
  return createMultipartResponse([
    {
      name: "manifest",
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(update.manifest),
      signature: expectSignature ? serializeSignature(update.signature!) : undefined,
    },
    {
      name: "extensions",
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({ assetRequestHeaders: {} }),
    },
  ]);
}

export function createNoUpdateResponse(): MultipartResponse {
  // A zero-part multipart response is the protocol-defined no-op. Unlike a
  // directive, it does not require the API server to hold the signing key.
  return createMultipartResponse([]);
}

interface MultipartResponse {
  body: Buffer;
  contentType: string;
}

interface MultipartPart {
  name: "manifest" | "extensions" | "directive";
  contentType: string;
  body: string;
  signature?: string;
}

function createMultipartResponse(parts: MultipartPart[]): MultipartResponse {
  const boundary = `expo-${randomUUID()}`;
  const chunks = parts.map((part) => {
    const headers = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="${part.name}"`,
      `Content-Type: ${part.contentType}`,
      ...(part.signature ? [`expo-signature: ${part.signature}`] : []),
      "",
      part.body,
    ];
    return headers.join("\r\n");
  });
  const body = parts.length > 0
    ? `${chunks.join("\r\n")}\r\n--${boundary}--\r\n`
    : `--${boundary}--\r\n`;
  return {
    body: Buffer.from(body, "utf8"),
    contentType: `multipart/mixed; boundary=${boundary}`,
  };
}

function serializeSignature(signature: NonNullable<StoredExpoUpdate["signature"]>): string {
  return `sig="${escapeStructuredHeaderString(signature.sig)}", keyid="${escapeStructuredHeaderString(signature.keyid)}", alg="${signature.alg}"`;
}

function escapeStructuredHeaderString(value: string): string {
  return value.replace(/(["\\])/g, "\\$1");
}

function isManifest(value: unknown, runtimeVersion: string): value is ExpoUpdateManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<ExpoUpdateManifest>;
  return typeof manifest.id === "string"
    && typeof manifest.createdAt === "string"
    && manifest.runtimeVersion === runtimeVersion
    && isAsset(manifest.launchAsset)
    && Array.isArray(manifest.assets)
    && manifest.assets.every(isAsset)
    && Boolean(manifest.metadata && typeof manifest.metadata === "object")
    && Boolean(manifest.extra && typeof manifest.extra === "object");
}

function isAsset(value: unknown): value is ExpoUpdateAsset {
  if (!value || typeof value !== "object") return false;
  const asset = value as Partial<ExpoUpdateAsset>;
  return typeof asset.hash === "string"
    && typeof asset.key === "string"
    && typeof asset.contentType === "string"
    && typeof asset.url === "string";
}
