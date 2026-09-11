import { createHash, createSign, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const options = parseArguments(process.argv.slice(2));
const secretId = process.env.LF_EXPO_UPDATES_COS_SECRET_ID ?? process.env.TENCENT_COS_SECRET_ID ?? process.env.COS_SECRET_ID ?? "";
const secretKey = process.env.LF_EXPO_UPDATES_COS_SECRET_KEY ?? process.env.TENCENT_COS_SECRET_KEY ?? process.env.COS_SECRET_KEY ?? "";
const bucket = process.env.LF_EXPO_UPDATES_COS_BUCKET ?? process.env.TENCENT_COS_BUCKET ?? process.env.COS_BUCKET ?? "";
const region = process.env.LF_EXPO_UPDATES_COS_REGION ?? process.env.TENCENT_COS_REGION ?? process.env.COS_REGION ?? "";
const publicBaseUrl = normalizeBaseUrl(
  process.env.LF_EXPO_UPDATES_PUBLIC_BASE_URL
    ?? process.env.TENCENT_COS_PUBLIC_BASE_URL
    ?? process.env.COS_PUBLIC_BASE_URL
    ?? (options.dryRun ? "https://updates.invalid" : ""),
);
const storagePrefix = normalizeSegment(process.env.LF_EXPO_UPDATES_STORAGE_PREFIX || "expo-updates");

if (!options.dryRun) {
  assertConfigured("LF_EXPO_UPDATES_COS_SECRET_ID (or existing COS secret ID)", secretId);
  assertConfigured("LF_EXPO_UPDATES_COS_SECRET_KEY (or existing COS secret key)", secretKey);
  assertConfigured("LF_EXPO_UPDATES_COS_BUCKET (or existing COS bucket)", bucket);
  assertConfigured("LF_EXPO_UPDATES_COS_REGION (or existing COS region)", region);
}
assertConfigured("LF_EXPO_UPDATES_PUBLIC_BASE_URL (or COS public base URL)", publicBaseUrl);

const exportDirectory = await mkdtemp(path.join(os.tmpdir(), "oio-updates-"));
try {
  const releaseTarget = resolveReleaseTarget(options);
  const commandEnvironment = { ...process.env, ...releaseTarget.environment };
  // EXPO_PUBLIC_* values are inlined into the bundle. Clear Metro's transform
  // cache so publishing a different distribution cannot reuse another target's
  // payment flags.
  runExpo(["export", "--clear", "--platform", options.platform, "--output-dir", exportDirectory, "--dump-assetmap"], commandEnvironment);
  const expoConfig = JSON.parse(runExpo(["config", "--type", "public", "--json"], commandEnvironment, true));
  const metadata = JSON.parse(await readFile(path.join(exportDirectory, "metadata.json"), "utf8"));
  const runtimeVersion = options.runtimeVersion || expoConfig.runtimeVersion;
  if (!runtimeVersion || typeof runtimeVersion !== "string") {
    throw new Error("runtimeVersion is missing from Expo config; pass --runtime-version explicitly");
  }

  const client = options.dryRun ? null : await createCosClient();
  const platforms = options.platform === "all" ? ["ios", "android"] : [options.platform];
  const uploadedKeys = new Set();

  for (const platform of platforms) {
    const platformMetadata = metadata.fileMetadata?.[platform];
    if (!platformMetadata) throw new Error(`Expo export did not contain ${platform} metadata`);

    const launchAsset = await createAsset(platformMetadata.bundle, null, true);
    const assets = await Promise.all(
      platformMetadata.assets.map((asset) => createAsset(asset.path, asset.ext, false)),
    );
    for (const asset of [launchAsset, ...assets]) {
      if (uploadedKeys.has(asset.objectKey)) continue;
      await uploadObject(client, asset.objectKey, asset.body, asset.contentType, "public, max-age=31536000, immutable");
      uploadedKeys.add(asset.objectKey);
    }

    const manifest = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      runtimeVersion,
      launchAsset: publicAsset(launchAsset),
      assets: assets.map(publicAsset),
      metadata: {},
      extra: { expoClient: expoConfig },
    };
    const signature = await signManifestIfConfigured(manifest);
    const pointer = {
      schemaVersion: 1,
      channel: options.channel,
      platform,
      runtimeVersion,
      manifest,
      ...(signature ? { signature } : {}),
    };
    const releaseKey = joinObjectKey(
      storagePrefix,
      "releases",
      options.channel,
      runtimeVersion,
      platform,
      `${manifest.id}.json`,
    );
    await uploadObject(
      client,
      releaseKey,
      Buffer.from(JSON.stringify(pointer), "utf8"),
      "application/json; charset=utf-8",
      "public, max-age=31536000, immutable",
    );
    const pointerKey = joinObjectKey(storagePrefix, "manifests", options.channel, runtimeVersion, `${platform}.json`);
    await uploadObject(
      client,
      pointerKey,
      Buffer.from(JSON.stringify(pointer), "utf8"),
      "application/json; charset=utf-8",
      "no-store",
    );
    const action = options.dryRun ? "Prepared" : "Published";
    process.stdout.write(`${action} ${options.channel}/${runtimeVersion}/${platform}: ${manifest.id}\n`);
  }

  async function createAsset(relativePath, extension, isLaunchAsset) {
    const body = await readFile(path.resolve(exportDirectory, relativePath));
    const sha256 = createHash("sha256").update(body).digest();
    const hash = sha256.toString("base64url");
    const contentExtension = isLaunchAsset ? "bundle" : normalizeExtension(extension);
    const objectKey = joinObjectKey(storagePrefix, "assets", `${sha256.toString("hex")}.${contentExtension}`);
    return {
      body,
      objectKey,
      hash,
      key: createHash("md5").update(body).digest("hex"),
      fileExtension: `.${contentExtension}`,
      contentType: isLaunchAsset ? "application/javascript" : contentTypeForExtension(contentExtension),
      url: `${publicBaseUrl}/${objectKey.split("/").map(encodeURIComponent).join("/")}`,
    };
  }
} finally {
  const expectedPrefix = `${os.tmpdir()}${path.sep}oio-updates-`;
  if (exportDirectory.startsWith(expectedPrefix)) {
    await rm(exportDirectory, { recursive: true, force: true });
  }
}

function parseArguments(args) {
  const parsed = { channel: "production", platform: "all", runtimeVersion: null, dryRun: false };
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    const value = args[index + 1];
    if (name === "--channel" && value) parsed.channel = value;
    else if (name === "--platform" && value) parsed.platform = value;
    else if (name === "--runtime-version" && value) parsed.runtimeVersion = value;
    else throw new Error(`Unknown or incomplete argument: ${name}`);
    index += 1;
  }
  if (!isSafeSegment(parsed.channel)) throw new Error("--channel must contain only letters, numbers, dot, underscore or dash");
  if (!["ios", "android", "all"].includes(parsed.platform)) throw new Error("--platform must be ios, android or all");
  if (parsed.runtimeVersion && !isSafeSegment(parsed.runtimeVersion)) throw new Error("--runtime-version is invalid");
  return parsed;
}

function resolveReleaseTarget(options) {
  const targets = {
    preview: {
      platforms: ["ios", "android", "all"],
      environment: {
        EAS_BUILD_PROFILE: "preview",
        EXPO_UPDATES_CHANNEL: "preview",
      },
    },
    production: {
      platforms: ["ios"],
      environment: {
        EAS_BUILD_PROFILE: "testflight",
        EXPO_UPDATES_CHANNEL: "production",
        EXPO_PUBLIC_ENABLE_APPLE_AUTO_RENEW: "true",
        EXPO_PUBLIC_ENABLE_GOOGLE_PLAY_AUTO_RENEW: "false",
        EXPO_PUBLIC_ENABLE_ALIPAY_AUTO_RENEW: "false",
      },
    },
    "production-google": {
      platforms: ["android"],
      environment: {
        EAS_BUILD_PROFILE: "google",
        EXPO_UPDATES_CHANNEL: "production-google",
        EXPO_PUBLIC_DISTRIBUTION_CHANNEL: "google",
        EXPO_PUBLIC_ENABLE_APPLE_AUTO_RENEW: "false",
        EXPO_PUBLIC_ENABLE_APPLE_ONE_TIME_PURCHASE: "false",
        EXPO_PUBLIC_ENABLE_GOOGLE_PLAY_AUTO_RENEW: "true",
        EXPO_PUBLIC_ENABLE_ALIPAY_AUTO_RENEW: "false",
      },
    },
    "production-china": {
      platforms: ["android"],
      environment: {
        EAS_BUILD_PROFILE: "china",
        EXPO_UPDATES_CHANNEL: "production-china",
        EXPO_PUBLIC_DISTRIBUTION_CHANNEL: "china",
        EXPO_PUBLIC_ENABLE_APPLE_AUTO_RENEW: "false",
        EXPO_PUBLIC_ENABLE_APPLE_ONE_TIME_PURCHASE: "false",
        EXPO_PUBLIC_ENABLE_GOOGLE_PLAY_AUTO_RENEW: "false",
        EXPO_PUBLIC_ENABLE_ALIPAY_AUTO_RENEW: "true",
      },
    },
  };
  const target = targets[options.channel];
  if (!target) {
    throw new Error("--channel must be preview, production, production-google or production-china");
  }
  if (!target.platforms.includes(options.platform)) {
    throw new Error(`Channel ${options.channel} does not support --platform ${options.platform}`);
  }
  return target;
}

function runExpo(args, env, captureOutput = false) {
  const expoBinary = path.join(projectDirectory, "node_modules", ".bin", "expo");
  const result = spawnSync(expoBinary, args, {
    cwd: projectDirectory,
    env,
    encoding: "utf8",
    stdio: captureOutput ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`expo ${args[0]} failed with exit code ${result.status}`);
  return result.stdout ?? "";
}

async function signManifestIfConfigured(manifest) {
  const privateKeyPath = process.env.LF_EXPO_UPDATES_PRIVATE_KEY_PATH?.trim();
  if (!privateKeyPath) return null;
  const privateKey = await readFile(path.resolve(privateKeyPath), "utf8");
  const signer = createSign("RSA-SHA256");
  signer.update(JSON.stringify(manifest), "utf8");
  signer.end();
  return {
    sig: signer.sign(privateKey, "base64"),
    keyid: "main",
    alg: "rsa-v1_5-sha256",
  };
}

function publicAsset(asset) {
  return {
    hash: asset.hash,
    key: asset.key,
    fileExtension: asset.fileExtension,
    contentType: asset.contentType,
    url: asset.url,
  };
}

function uploadObject(client, key, body, contentType, cacheControl) {
  if (!client) return Promise.resolve();
  return new Promise((resolve, reject) => client.putObject(
    { Bucket: bucket, Region: region, Key: key, Body: body, ContentType: contentType, CacheControl: cacheControl },
    (error) => error ? reject(error) : resolve(),
  ));
}

async function createCosClient() {
  const CosModule = await import("cos-nodejs-sdk-v5");
  const COS = CosModule.default ?? CosModule;
  return new COS({ SecretId: secretId, SecretKey: secretKey });
}

function joinObjectKey(...parts) {
  for (const part of parts) {
    if (!isSafeSegment(part)) throw new Error(`Unsafe COS object key segment: ${part}`);
  }
  return parts.join("/");
}

function normalizeSegment(value) {
  const normalized = value.trim().replace(/^\/+|\/+$/g, "");
  if (!isSafeSegment(normalized)) throw new Error("LF_EXPO_UPDATES_STORAGE_PREFIX is invalid");
  return normalized;
}

function normalizeExtension(value) {
  const extension = String(value || "bin").replace(/^\./, "").toLowerCase();
  if (!isSafeSegment(extension)) throw new Error(`Invalid asset extension: ${value}`);
  return extension;
}

function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function isSafeSegment(value) {
  return /^[A-Za-z0-9._-]+$/.test(value);
}

function assertConfigured(name, value) {
  if (!value) throw new Error(`${name} is required`);
}

function contentTypeForExtension(extension) {
  const types = {
    avif: "image/avif", bin: "application/octet-stream", gif: "image/gif", heic: "image/heic",
    jpeg: "image/jpeg", jpg: "image/jpeg", json: "application/json", mp3: "audio/mpeg",
    mp4: "video/mp4", otf: "font/otf", png: "image/png", svg: "image/svg+xml",
    ttf: "font/ttf", wav: "audio/wav", webm: "video/webm", webp: "image/webp", woff: "font/woff",
    woff2: "font/woff2",
  };
  return types[extension] || "application/octet-stream";
}
