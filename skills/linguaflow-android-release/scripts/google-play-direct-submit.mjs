#!/usr/bin/env node

import { createSign } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import https from "node:https";

const args = process.argv.slice(2);
const statusOnly = args[0] === "--status";
const subscriptionOnly = args[0] === "--subscription";
const promoteOnly = args[0] === "--promote";
const readOnly = statusOnly || subscriptionOnly;
const parsedArgs = statusOnly || subscriptionOnly || promoteOnly ? args.slice(1) : args;
const [credentialPath, packageName, track, fourthArg, fifthArg] = parsedArgs;
const aabPath = promoteOnly ? null : fourthArg;
const expectedVersionCode = fifthArg;
const targetTrack = promoteOnly ? fourthArg : null;
if (
  !credentialPath ||
  !packageName ||
  !track ||
  (promoteOnly && (!targetTrack || !expectedVersionCode)) ||
  (!readOnly && !promoteOnly && (!aabPath || !expectedVersionCode))
) {
  throw new Error("Usage: google-play-direct-submit.mjs [--status|--subscription] <credentials.json> <package> <track-or-product> [<aab> <versionCode>] | --promote <credentials.json> <package> <source-track> <target-track> <versionCode>");
}

const credentials = JSON.parse(readFileSync(credentialPath, "utf8"));
if (credentials.type !== "service_account" || !credentials.client_email || !credentials.private_key) {
  throw new Error("Google Play service account credentials are invalid.");
}

const base64url = (value) => Buffer.from(value).toString("base64url");

async function request({ method, url, headers = {}, body, timeoutMs = 120_000, returnMeta = false, acceptStatuses = [] }) {
  return await new Promise((resolve, reject) => {
    const requestHeaders = { ...headers };
    let responseStarted = false;
    const req = https.request(url, { method, headers: requestHeaders }, (res) => {
      responseStarted = true;
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed = null;
        if (text) {
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = { raw: text };
          }
        }
        if (((res.statusCode ?? 500) < 200 || (res.statusCode ?? 500) >= 300) && !acceptStatuses.includes(res.statusCode)) {
          const message = parsed?.error?.message ?? parsed?.raw ?? `HTTP ${res.statusCode}`;
          reject(new Error(`${method} ${new URL(url).pathname} failed: ${message}`));
          return;
        }
        const responseBody = parsed ?? {};
        resolve(returnMeta ? { body: responseBody, headers: res.headers, statusCode: res.statusCode } : responseBody);
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Request timed out after ${timeoutMs} ms`)));
    req.on("error", (error) => {
      if (responseStarted && error.code === "EPIPE") return;
      reject(error);
    });
    if (body != null) req.write(body);
    req.end();
  });
}

async function uploadInChunks(uploadUrl, filePath, fileSize) {
  const chunkSize = 8 * 1024 * 1024;
  const fd = openSync(filePath, "r");
  let offset = 0;
  try {
    while (offset < fileSize) {
      const length = Math.min(chunkSize, fileSize - offset);
      const chunk = Buffer.allocUnsafe(length);
      const bytesRead = readSync(fd, chunk, 0, length, offset);
      if (bytesRead !== length) throw new Error(`Could not read AAB chunk at byte ${offset}.`);
      let response;
      let lastError;
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        try {
          response = await request({
            method: "PUT",
            url: uploadUrl,
            headers: {
              "content-type": "application/octet-stream",
              "content-length": String(length),
              "content-range": `bytes ${offset}-${offset + length - 1}/${fileSize}`,
            },
            body: chunk,
            timeoutMs: 120_000,
            returnMeta: true,
            acceptStatuses: [308],
          });
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
        }
      }
      if (!response) throw lastError;
      if (response.statusCode !== 308) return response.body;
      const receivedRange = response.headers.range;
      const match = typeof receivedRange === "string" ? receivedRange.match(/bytes=0-(\d+)/) : null;
      offset = match ? Number(match[1]) + 1 : offset + length;
    }
  } finally {
    closeSync(fd);
  }
  throw new Error("Google Play resumable upload ended without bundle metadata.");
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(credentials.private_key).toString("base64url")}`;
  const form = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  }).toString();
  const response = await request({
    method: "POST",
    url: "https://oauth2.googleapis.com/token",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "content-length": String(Buffer.byteLength(form)),
    },
    body: form,
  });
  if (!response.access_token) throw new Error("Google OAuth response did not include an access token.");
  return response.access_token;
}

const token = await getAccessToken();
const encodedPackage = encodeURIComponent(packageName);
const apiBase = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodedPackage}`;
const authHeaders = { authorization: `Bearer ${token}` };
const jsonHeaders = { ...authHeaders, "content-type": "application/json" };

if (subscriptionOnly) {
  const subscription = await request({
    method: "GET",
    url: `${apiBase}/subscriptions/${encodeURIComponent(track)}`,
    headers: authHeaders,
  });
  console.log(JSON.stringify({
    productId: subscription.productId,
    basePlans: (subscription.basePlans ?? []).map((plan) => ({
      basePlanId: plan.basePlanId,
      state: plan.state,
      autoRenewingBasePlanType: plan.autoRenewingBasePlanType,
    })),
  }));
  process.exit(0);
}

const edit = await request({ method: "POST", url: `${apiBase}/edits`, headers: jsonHeaders, body: "{}" });
if (!edit.id) throw new Error("Google Play did not return an edit ID.");
const encodedEdit = encodeURIComponent(edit.id);

if (statusOnly) {
  try {
    const currentTrack = await request({
      method: "GET",
      url: `${apiBase}/edits/${encodedEdit}/tracks/${encodeURIComponent(track)}`,
      headers: authHeaders,
    });
    console.log(JSON.stringify(currentTrack));
  } finally {
    await request({ method: "DELETE", url: `${apiBase}/edits/${encodedEdit}`, headers: authHeaders });
  }
  process.exit(0);
}

if (promoteOnly) {
  try {
    const source = await request({
      method: "GET",
      url: `${apiBase}/edits/${encodedEdit}/tracks/${encodeURIComponent(track)}`,
      headers: authHeaders,
    });
    const sourceRelease = (source.releases ?? []).find((release) =>
      (release.versionCodes ?? []).map(String).includes(String(expectedVersionCode))
    );
    if (!sourceRelease) {
      throw new Error(`Source track ${track} does not contain versionCode ${expectedVersionCode}.`);
    }
    if (sourceRelease.status !== "completed") {
      throw new Error(`Source versionCode ${expectedVersionCode} is ${sourceRelease.status ?? "unknown"}, not completed.`);
    }

    const release = {
      track: targetTrack,
      releases: [{
        name: sourceRelease.name || `OIO ${expectedVersionCode}`,
        versionCodes: [String(expectedVersionCode)],
        status: "completed",
        ...(sourceRelease.releaseNotes ? { releaseNotes: sourceRelease.releaseNotes } : {}),
      }],
    };
    await request({
      method: "PUT",
      url: `${apiBase}/edits/${encodedEdit}/tracks/${encodeURIComponent(targetTrack)}`,
      headers: jsonHeaders,
      body: JSON.stringify(release),
    });
    await request({
      method: "POST",
      url: `${apiBase}/edits/${encodedEdit}:commit`,
      headers: jsonHeaders,
      body: "{}",
    });
    console.log(`Google Play promotion committed: package=${packageName} source=${track} target=${targetTrack} versionCode=${expectedVersionCode} edit=${edit.id}`);
  } catch (error) {
    try {
      await request({ method: "DELETE", url: `${apiBase}/edits/${encodedEdit}`, headers: authHeaders });
    } catch {
      // Edits expire automatically. Preserve the original failure.
    }
    throw error;
  }
  process.exit(0);
}

try {
  const fileSize = statSync(aabPath).size;
  const uploadStart = await request({
    method: "POST",
    url: `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${encodedPackage}/edits/${encodedEdit}/bundles?uploadType=resumable`,
    headers: {
      ...authHeaders,
      "content-length": "0",
      "x-upload-content-type": "application/octet-stream",
      "x-upload-content-length": String(fileSize),
    },
    returnMeta: true,
  });
  const uploadUrl = uploadStart.headers.location;
  if (!uploadUrl) throw new Error("Google Play did not return a resumable upload URL.");
  const bundle = await uploadInChunks(uploadUrl, aabPath, fileSize);
  if (String(bundle.versionCode) !== String(expectedVersionCode)) {
    throw new Error(`Google Play returned versionCode ${bundle.versionCode ?? "<missing>"}, expected ${expectedVersionCode}.`);
  }

  const release = {
    track,
    releases: [{
      name: `OIO ${expectedVersionCode}`,
      versionCodes: [String(expectedVersionCode)],
      status: "completed",
    }],
  };
  await request({
    method: "PUT",
    url: `${apiBase}/edits/${encodedEdit}/tracks/${encodeURIComponent(track)}`,
    headers: jsonHeaders,
    body: JSON.stringify(release),
  });
  await request({
    method: "POST",
    url: `${apiBase}/edits/${encodedEdit}:commit?changesInReviewBehavior=ERROR_IF_IN_REVIEW`,
    headers: jsonHeaders,
    body: "{}",
  });
  console.log(`Google Play direct upload committed: package=${packageName} track=${track} versionCode=${expectedVersionCode} edit=${edit.id}`);
} catch (error) {
  try {
    await request({ method: "DELETE", url: `${apiBase}/edits/${encodedEdit}`, headers: authHeaders });
  } catch {
    // Edits expire automatically. Preserve the original failure.
  }
  throw error;
}
