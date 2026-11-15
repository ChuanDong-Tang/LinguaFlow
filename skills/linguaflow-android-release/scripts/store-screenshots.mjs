#!/usr/bin/env node
// Store screenshots for App Store Connect and Google Play.
//
//   --list-ios [--version X] [--out DIR]    show (and optionally download) the
//                                           screenshot sets of an App Store version
//   --list-play [--out DIR]                 same for the Google Play listings
//   --upload-ios --version X --dir DIR --yes
//                                           replace the iPhone screenshots of every
//                                           localization of version X (must be editable)
//   --upload-play --dir DIR --yes           replace phoneScreenshots of every Play
//                                           listing in one edit, then commit it
//
// DIR holds one folder per locale to replace (<locale>/01.png, 02.png …);
// locales without a folder keep their current screenshots. Credentials come
// from the ignored config files in ../config; nothing secret is printed.
import { createHash, createPrivateKey, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const fail = (message) => { console.error(`store-screenshots: ${message}`); process.exit(1); };

function parseEnvFile(file) {
  const result = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const at = line.indexOf("=");
    if (at > 0) result[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^"(.*)"$/u, "$1");
  }
  return result;
}

function localShots(dir, locale) {
  const base = path.join(dir, locale);
  if (!existsSync(base) || !statSync(base).isDirectory()) return null;
  const files = readdirSync(base).filter((name) => /^\d+\.png$/u.test(name)).sort();
  if (!files.length) fail(`no NN.png screenshots in ${base}`);
  return files.map((name) => path.join(base, name));
}

function pngSize(file) {
  const data = readFileSync(file);
  if (data.readUInt32BE(0) !== 0x89504e47) fail(`${file} is not a PNG`);
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

// ---------------------------------------------------------------- Apple
const asc = (() => {
  let token = null;
  const config = () => parseEnvFile(path.join(skillDir, "config/ios-testflight.env"));
  const makeToken = () => {
    const env = config();
    const now = Math.floor(Date.now() / 1000);
    const enc = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${enc({ alg: "ES256", kid: env.APP_STORE_CONNECT_API_KEY_ID, typ: "JWT" })}.${enc({ iss: env.APP_STORE_CONNECT_API_ISSUER_ID, iat: now, exp: now + 900, aud: "appstoreconnect-v1" })}`;
    const signature = sign("sha256", Buffer.from(unsigned), { key: createPrivateKey(readFileSync(env.APP_STORE_CONNECT_API_KEY_PATH, "utf8")), dsaEncoding: "ieee-p1363" }).toString("base64url");
    return `${unsigned}.${signature}`;
  };
  const call = async (method, resource, body) => {
    token ??= makeToken();
    const url = resource.startsWith("http") ? resource : `https://api.appstoreconnect.apple.com${resource}`;
    const response = await fetch(url, { method, headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(`${method} ${new URL(url).pathname} → ${response.status}: ${(parsed.errors ?? []).map((e) => `${e.code} ${e.detail ?? e.title}`).join(" | ")}`);
    return parsed;
  };
  return { call, bundleId: () => config().EXPECTED_BUNDLE_ID };
})();

async function iosVersion(version) {
  const apps = await asc.call("GET", `/v1/apps?filter[bundleId]=${encodeURIComponent(asc.bundleId())}`);
  const app = apps.data?.[0] ?? fail("app not found");
  const versions = await asc.call("GET", `/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=20`);
  const pick = version
    ? versions.data.find((item) => item.attributes.versionString === version)
    : versions.data.find((item) => item.attributes.appStoreState === "READY_FOR_SALE");
  if (!pick) fail(`App Store version ${version ?? "READY_FOR_SALE"} not found`);
  return pick;
}

async function iosSets(versionId) {
  const localizations = await asc.call("GET", `/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=50`);
  const out = [];
  for (const localization of localizations.data) {
    const sets = await asc.call("GET", `/v1/appStoreVersionLocalizations/${localization.id}/appScreenshotSets?include=appScreenshots&limit=50`);
    const shots = new Map((sets.included ?? []).map((item) => [item.id, item]));
    out.push({
      localization,
      sets: sets.data.map((set) => ({ set, shots: (set.relationships.appScreenshots.data ?? []).map((ref) => shots.get(ref.id)).filter(Boolean) })),
    });
  }
  return out;
}

async function listIos() {
  const version = await iosVersion(option("--version"));
  console.log(`iOS version ${version.attributes.versionString} (${version.attributes.appStoreState})`);
  const outDir = option("--out");
  for (const { localization, sets } of await iosSets(version.id)) {
    console.log(`  ${localization.attributes.locale}`);
    for (const { set, shots } of sets) {
      console.log(`    ${set.attributes.screenshotDisplayType}: ${shots.length}`);
      if (!outDir) continue;
      const dir = path.join(outDir, "ios", localization.attributes.locale, set.attributes.screenshotDisplayType);
      mkdirSync(dir, { recursive: true });
      for (const [index, shot] of shots.entries()) {
        const asset = shot.attributes.imageAsset;
        if (!asset) continue;
        const url = asset.templateUrl.replace("{w}", asset.width).replace("{h}", asset.height).replace("{f}", "png");
        writeFileSync(path.join(dir, `${String(index + 1).padStart(2, "0")}.png`), Buffer.from(await (await fetch(url)).arrayBuffer()));
      }
    }
  }
}

const IOS_TYPES = { "1320x2868": "APP_IPHONE_67", "1290x2796": "APP_IPHONE_67", "1242x2688": "APP_IPHONE_65", "1284x2778": "APP_IPHONE_65" };

async function uploadIos() {
  const version = await iosVersion(option("--version") ?? fail("--version required"));
  if (!["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED"].includes(version.attributes.appStoreState)) fail(`version is ${version.attributes.appStoreState}; screenshots are locked`);
  const dir = option("--dir") ?? fail("--dir required");
  if (!existsSync(dir)) fail(`${dir} not found`);
  for (const { localization, sets } of await iosSets(version.id)) {
    const locale = localization.attributes.locale;
    const files = localShots(dir, locale);
    if (!files) { console.log(`  ${locale}: kept`); continue; }
    const { width, height } = pngSize(files[0]);
    const displayType = IOS_TYPES[`${width}x${height}`] ?? fail(`unsupported iPhone size ${width}x${height}`);
    // Drop every iPhone set; Apple scales the largest one to smaller devices.
    for (const { set } of sets) if (set.attributes.screenshotDisplayType.startsWith("APP_IPHONE")) await asc.call("DELETE", `/v1/appScreenshotSets/${set.id}`);
    const created = await asc.call("POST", "/v1/appScreenshotSets", { data: { type: "appScreenshotSets", attributes: { screenshotDisplayType: displayType }, relationships: { appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: localization.id } } } } });
    for (const file of files) {
      const bytes = readFileSync(file);
      const reserved = await asc.call("POST", "/v1/appScreenshots", { data: { type: "appScreenshots", attributes: { fileName: path.basename(file), fileSize: bytes.length }, relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: created.data.id } } } } });
      for (const operation of reserved.data.attributes.uploadOperations) {
        const part = bytes.subarray(operation.offset, operation.offset + operation.length);
        const headers = Object.fromEntries((operation.requestHeaders ?? []).map((header) => [header.name, header.value]));
        const response = await fetch(operation.url, { method: operation.method, headers, body: part });
        if (!response.ok) fail(`upload part failed ${response.status} for ${file}`);
      }
      const checksum = createHash("md5").update(bytes).digest("hex");
      await asc.call("PATCH", `/v1/appScreenshots/${reserved.data.id}`, { data: { type: "appScreenshots", id: reserved.data.id, attributes: { uploaded: true, sourceFileChecksum: checksum } } });
    }
    console.log(`  ${locale}: ${files.length} × ${displayType}`);
  }
  // Wait for Apple to finish processing.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const pending = [];
    for (const { localization, sets } of await iosSets(version.id)) {
      for (const { shots } of sets) for (const shot of shots) {
        const state = shot.attributes.assetDeliveryState?.state;
        if (state === "FAILED") fail(`${localization.attributes.locale} ${shot.attributes.fileName}: ${JSON.stringify(shot.attributes.assetDeliveryState.errors)}`);
        if (state !== "COMPLETE") pending.push(shot.attributes.fileName);
      }
    }
    if (!pending.length) { console.log("All screenshots processed."); return; }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  fail("screenshots still processing after 150 s; re-run --list-ios to check");
}

// ---------------------------------------------------------------- Google
const play = (() => {
  const config = () => parseEnvFile(path.join(skillDir, "config/android-play.env"));
  let token = null;
  const accessToken = async () => {
    if (token) return token;
    const key = JSON.parse(readFileSync(config().GOOGLE_PLAY_SERVICE_ACCOUNT_JSON, "utf8"));
    const now = Math.floor(Date.now() / 1000);
    const enc = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iss: key.client_email, scope: "https://www.googleapis.com/auth/androidpublisher", aud: key.token_uri, iat: now, exp: now + 3600 })}`;
    const assertion = `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), key.private_key).toString("base64url")}`;
    const response = await fetch(key.token_uri, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }) });
    const body = await response.json();
    if (!response.ok) fail(`Google token: ${body.error}`);
    token = body.access_token;
    return token;
  };
  const call = async (method, url, body, contentType = "application/json") => {
    const response = await fetch(url, { method, headers: { authorization: `Bearer ${await accessToken()}`, ...(body ? { "content-type": contentType } : {}) }, body: body && contentType === "application/json" ? JSON.stringify(body) : body });
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(`${method} ${new URL(url).pathname} → ${response.status}: ${parsed.error?.message ?? text}`);
    return parsed;
  };
  const pkg = () => config().EXPECTED_PACKAGE_ID;
  return { call, pkg };
})();
const playApi = () => `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${play.pkg()}`;

async function listPlay() {
  const edit = await play.call("POST", `${playApi()}/edits`, {});
  try {
    const listings = await play.call("GET", `${playApi()}/edits/${edit.id}/listings`);
    const outDir = option("--out");
    for (const listing of listings.listings ?? []) {
      const images = await play.call("GET", `${playApi()}/edits/${edit.id}/listings/${listing.language}/phoneScreenshots`);
      console.log(`  ${listing.language}: ${(images.images ?? []).length} phone screenshots`);
      if (!outDir) continue;
      const dir = path.join(outDir, "play", listing.language);
      mkdirSync(dir, { recursive: true });
      for (const [index, image] of (images.images ?? []).entries()) {
        writeFileSync(path.join(dir, `${String(index + 1).padStart(2, "0")}.png`), Buffer.from(await (await fetch(`${image.url}=s0`)).arrayBuffer()));
      }
    }
  } finally {
    await play.call("DELETE", `${playApi()}/edits/${edit.id}`).catch(() => undefined);
  }
}

async function uploadPlay() {
  const dir = option("--dir") ?? fail("--dir required");
  const edit = await play.call("POST", `${playApi()}/edits`, {});
  let committed = false;
  try {
    const listings = await play.call("GET", `${playApi()}/edits/${edit.id}/listings`);
    for (const listing of listings.listings ?? []) {
      const files = localShots(dir, listing.language);
      if (!files) { console.log(`  ${listing.language}: kept`); continue; }
      if (files.length > 8) fail(`${listing.language}: Google Play allows at most 8 phone screenshots`);
      await play.call("DELETE", `${playApi()}/edits/${edit.id}/listings/${listing.language}/phoneScreenshots`);
      for (const file of files) {
        await play.call("POST", `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${play.pkg()}/edits/${edit.id}/listings/${listing.language}/phoneScreenshots?uploadType=media`, readFileSync(file), "image/png");
      }
      console.log(`  ${listing.language}: ${files.length} phone screenshots`);
    }
    await play.call("POST", `${playApi()}/edits/${edit.id}:commit`);
    committed = true;
    console.log(`Google Play listing edit committed: ${edit.id}`);
  } finally {
    if (!committed) await play.call("DELETE", `${playApi()}/edits/${edit.id}`).catch(() => undefined);
  }
}

try {
  if (flag("--list-ios")) await listIos();
  else if (flag("--list-play")) await listPlay();
  else if (flag("--upload-ios")) { if (!flag("--yes")) fail("--upload-ios changes App Store metadata; pass --yes"); await uploadIos(); }
  else if (flag("--upload-play")) { if (!flag("--yes")) fail("--upload-play changes the public Play listing; pass --yes"); await uploadPlay(); }
  else fail("choose --list-ios, --list-play, --upload-ios or --upload-play");
} catch (error) {
  fail(error.message);
}
