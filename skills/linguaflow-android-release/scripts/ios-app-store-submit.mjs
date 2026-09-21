#!/usr/bin/env node

import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(skillDir, "../..");
const defaultConfig = path.join(skillDir, "config/ios-testflight.env");
const apiBase = "https://api.appstoreconnect.apple.com/v1";

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { mode: "check", config: defaultConfig, releaseType: "manual", whatsNew: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") options.mode = "check";
    else if (arg === "--submit") options.mode = "submit";
    else if (["--version", "--build", "--acceptance", "--config"].includes(arg)) {
      const value = argv[index + 1];
      if (!value) fail(`${arg} requires a value.`);
      options[arg.slice(2)] = value;
      index += 1;
    } else if (arg === "--release-type") {
      const value = argv[index + 1];
      if (!value) fail("--release-type requires a value.");
      options.releaseType = value;
      index += 1;
    } else if (arg === "--whats-new") {
      const value = argv[index + 1];
      if (!value || !value.includes("=")) fail("--whats-new requires <locale>=<text>.");
      options.whatsNew.push(value);
      index += 1;
    } else if (arg === "--yes") options.yes = true;
    else if (arg === "--accept-auto-release-risk") options.acceptAutoReleaseRisk = true;
    else if (arg === "--self-test") options.selfTest = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else fail(`Unknown option: ${arg}`);
  }
  return options;
}

function usage() {
  console.log(`Usage:
  node skills/linguaflow-android-release/scripts/ios-app-store-submit.mjs \\
    --check --version <version> --build <build>

  node skills/linguaflow-android-release/scripts/ios-app-store-submit.mjs \\
    --submit --version <version> --build <build> \\
    --acceptance <record> --release-type manual|automatic \\
    --whats-new <locale>=<text> [--whats-new <locale>=<text>] --yes

The submit mode creates the App Store version when absent, sets the requested release mode,
binds the exact VALID build, creates/reuses a review submission, and submits it.
Automatic release additionally requires --accept-auto-release-risk.`);
}

function parseEnvFile(file) {
  const result = {};
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error(`Invalid environment line in ${file}.`);
    result[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return result;
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function makeToken({ keyId, issuerId, privateKey, now = Math.floor(Date.now() / 1000) }) {
  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const claims = base64url(JSON.stringify({ iss: issuerId, iat: now, exp: now + 900, aud: "appstoreconnect-v1" }));
  const unsigned = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(unsigned), {
    key: createPrivateKey(privateKey),
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return `${unsigned}.${signature}`;
}

async function request(token, method, resourcePath, body = undefined, acceptedStatuses = []) {
  const url = resourcePath.startsWith("http") ? resourcePath : `${apiBase}${resourcePath}`;
  const encodedBody = body === undefined ? undefined : JSON.stringify(body);
  return await new Promise((resolve, reject) => {
    const req = https.request(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(encodedBody ? {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(encodedBody)),
        } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let parsed = {};
        if (raw) {
          try { parsed = JSON.parse(raw); } catch { parsed = { raw }; }
        }
        const status = res.statusCode ?? 500;
        if ((status < 200 || status >= 300) && !acceptedStatuses.includes(status)) {
          const details = (parsed.errors ?? []).map((error) =>
            [error.code, error.title, error.detail].filter(Boolean).join(": ")
          ).join(" | ") || parsed.raw || `HTTP ${status}`;
          const error = new Error(`${method} ${new URL(url).pathname} failed (${status}): ${details}`);
          error.status = status;
          error.response = parsed;
          reject(error);
          return;
        }
        resolve({ status, body: parsed });
      });
    });
    req.setTimeout(60_000, () => req.destroy(new Error("App Store Connect API request timed out.")));
    req.on("error", reject);
    if (encodedBody) req.write(encodedBody);
    req.end();
  });
}

function relationship(type, id) {
  return { data: { type, id } };
}

function assertCandidateAcceptance(file, version, build) {
  const absolute = path.resolve(repoRoot, file);
  const result = spawnSync(process.execPath, [
    path.join(scriptDir, "release-acceptance.mjs"), "check",
    "--file", absolute, "--stage", "candidate",
  ], { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`Candidate acceptance failed:\n${result.stderr || result.stdout}`);
  }
  const record = JSON.parse(readFileSync(absolute, "utf8"));
  if (record.distribution !== "ios" || record.version !== version || String(record.build) !== String(build)) {
    throw new Error("Acceptance record does not match the requested iOS version/build.");
  }
}

const submittedStates = new Set([
  "WAITING_FOR_REVIEW", "IN_REVIEW", "PENDING_APPLE_RELEASE", "PENDING_DEVELOPER_RELEASE",
  "READY_FOR_SALE", "PROCESSING_FOR_APP_STORE", "ACCEPTED",
]);

function versionState(version) {
  return version?.attributes?.appStoreState ?? version?.attributes?.appVersionState ?? "UNKNOWN";
}

function selectExactBuild(builds, buildNumber) {
  const matches = builds.filter((build) => String(build.attributes?.version) === String(buildNumber));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one App Store Connect build ${buildNumber}, found ${matches.length}.`);
  }
  const build = matches[0];
  if (build.attributes?.processingState !== "VALID") {
    throw new Error(`Build ${buildNumber} is ${build.attributes?.processingState ?? "UNKNOWN"}, not VALID.`);
  }
  if (build.attributes?.expired === true) throw new Error(`Build ${buildNumber} is expired.`);
  return build;
}

async function findApp(token, bundleId) {
  const query = new URLSearchParams({ "filter[bundleId]": bundleId, limit: "2" });
  const { body } = await request(token, "GET", `/apps?${query}`);
  if ((body.data ?? []).length !== 1) throw new Error(`Expected one app for bundle ID ${bundleId}, found ${(body.data ?? []).length}.`);
  return body.data[0];
}

async function findBuild(token, appId, buildNumber) {
  const query = new URLSearchParams({
    "filter[app]": appId,
    "filter[version]": String(buildNumber),
    "fields[builds]": "version,uploadedDate,processingState,expired,usesNonExemptEncryption",
    limit: "10",
  });
  const { body } = await request(token, "GET", `/builds?${query}`);
  return selectExactBuild(body.data ?? [], buildNumber);
}

async function findVersion(token, appId, versionString) {
  const query = new URLSearchParams({
    "filter[platform]": "IOS",
    "filter[versionString]": versionString,
    "fields[appStoreVersions]": "platform,versionString,appStoreState,appVersionState,releaseType,earliestReleaseDate,createdDate",
    "include": "build",
    "limit": "10",
  });
  const { body } = await request(token, "GET", `/apps/${appId}/appStoreVersions?${query}`);
  if ((body.data ?? []).length > 1) throw new Error(`Found multiple iOS App Store versions named ${versionString}.`);
  const version = body.data?.[0] ?? null;
  if (!version) return null;
  const includedBuild = (body.included ?? []).find((item) => item.type === "builds") ?? null;
  return { ...version, includedBuild };
}

async function createVersion(token, appId, versionString, releaseType) {
  const { body } = await request(token, "POST", "/appStoreVersions", {
    data: {
      type: "appStoreVersions",
      attributes: { platform: "IOS", versionString, releaseType },
      relationships: { app: relationship("apps", appId) },
    },
  });
  return { ...body.data, includedBuild: null };
}

async function setReleaseType(token, version, releaseType) {
  if (version.attributes?.releaseType === releaseType) return version;
  const { body } = await request(token, "PATCH", `/appStoreVersions/${version.id}`, {
    data: { type: "appStoreVersions", id: version.id, attributes: { releaseType } },
  });
  return { ...body.data, includedBuild: version.includedBuild };
}

async function bindBuild(token, version, build) {
  if (version.includedBuild?.id === build.id) return;
  await request(token, "PATCH", `/appStoreVersions/${version.id}/relationships/build`, {
    data: { type: "builds", id: build.id },
  });
}

async function preflightMetadata(token, versionId) {
  const [localizations, reviewDetail] = await Promise.all([
    request(token, "GET", `/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=200`),
    request(token, "GET", `/appStoreVersions/${versionId}/appStoreReviewDetail`, undefined, [404]),
  ]);
  const localizationSummaries = [];
  for (const localization of localizations.body.data ?? []) {
    const screenshots = await request(
      token,
      "GET",
      `/appStoreVersionLocalizations/${localization.id}/appScreenshotSets?include=appScreenshots&limit=200`,
    );
    localizationSummaries.push({
      id: localization.id,
      locale: localization.attributes?.locale ?? "unknown",
      hasDescription: Boolean(localization.attributes?.description),
      hasKeywords: Boolean(localization.attributes?.keywords),
      hasSupportUrl: Boolean(localization.attributes?.supportUrl),
      hasWhatsNew: Boolean(localization.attributes?.whatsNew),
      screenshotSets: screenshots.body.data?.length ?? 0,
      screenshots: (screenshots.body.included ?? []).filter((item) => item.type === "appScreenshots").length,
    });
  }
  const review = reviewDetail.body.data?.attributes ?? {};
  return {
    localizationCount: localizations.body.data?.length ?? 0,
    hasReviewDetail: reviewDetail.status === 200 && Boolean(reviewDetail.body.data),
    localizationSummaries,
    reviewDetailComplete: ["contactFirstName", "contactLastName", "contactPhone", "contactEmail"]
      .every((field) => Boolean(review[field])) && review.demoAccountRequired !== undefined,
  };
}

async function applyWhatsNew(token, metadata, entries) {
  const requested = new Map(entries.map((entry) => {
    const separator = entry.indexOf("=");
    return [entry.slice(0, separator), entry.slice(separator + 1)];
  }));
  const knownLocales = new Set(metadata.localizationSummaries.map((item) => item.locale));
  for (const locale of requested.keys()) {
    if (!knownLocales.has(locale)) throw new Error(`--whats-new specified unknown locale ${locale}.`);
  }
  for (const localization of metadata.localizationSummaries) {
    const text = requested.get(localization.locale);
    if (text) {
      await request(token, "PATCH", `/appStoreVersionLocalizations/${localization.id}`, {
        data: {
          type: "appStoreVersionLocalizations",
          id: localization.id,
          attributes: { whatsNew: text },
        },
      });
      localization.hasWhatsNew = true;
    }
  }
  const missing = metadata.localizationSummaries.filter((item) => !item.hasWhatsNew).map((item) => item.locale);
  if (missing.length) throw new Error(`Missing What's New text for locale(s): ${missing.join(", ")}.`);
}

function printMetadata(metadata) {
  console.log(`Localizations: ${metadata.localizationCount}`);
  for (const localization of metadata.localizationSummaries) {
    console.log(
      `  ${localization.locale}: description=${localization.hasDescription ? "yes" : "no"}, ` +
      `keywords=${localization.hasKeywords ? "yes" : "no"}, supportUrl=${localization.hasSupportUrl ? "yes" : "no"}, ` +
      `whatsNew=${localization.hasWhatsNew ? "yes" : "no"}, screenshots=${localization.screenshots} ` +
      `in ${localization.screenshotSets} set(s)`,
    );
  }
  console.log(`Review detail: ${metadata.hasReviewDetail ? "present" : "missing"} (${metadata.reviewDetailComplete ? "complete" : "incomplete"})`);
}

async function findDraftSubmission(token, appId) {
  const { body } = await request(token, "GET", `/apps/${appId}/reviewSubmissions?limit=50`);
  const open = (body.data ?? []).filter((submission) => !["COMPLETE", "CANCELED"].includes(submission.attributes?.state));
  if (open.length > 1) throw new Error(`Found ${open.length} open review submissions; resolve them in App Store Connect before retrying.`);
  return open[0] ?? null;
}

async function ensureSubmission(token, appId, versionId) {
  let submission = await findDraftSubmission(token, appId);
  if (!submission) {
    const { body } = await request(token, "POST", "/reviewSubmissions", {
      data: {
        type: "reviewSubmissions",
        relationships: { app: relationship("apps", appId) },
      },
    });
    submission = body.data;
  }

  const { body: itemsBody } = await request(token, "GET", `/reviewSubmissions/${submission.id}/items?limit=200`);
  const existingVersionIds = new Set();
  for (const item of itemsBody.data ?? []) {
    const related = await request(token, "GET", `/reviewSubmissionItems/${item.id}/appStoreVersion`, undefined, [404]);
    if (related.status === 200 && related.body.data?.id) existingVersionIds.add(related.body.data.id);
  }
  if (!existingVersionIds.has(versionId)) {
    await request(token, "POST", "/reviewSubmissionItems", {
      data: {
        type: "reviewSubmissionItems",
        relationships: {
          reviewSubmission: relationship("reviewSubmissions", submission.id),
          appStoreVersion: relationship("appStoreVersions", versionId),
        },
      },
    });
  }
  return submission;
}

async function submitReview(token, submission) {
  if (submission.attributes?.submitted === true || submission.attributes?.state === "WAITING_FOR_REVIEW") return submission;
  const { body } = await request(token, "PATCH", `/reviewSubmissions/${submission.id}`, {
    data: {
      type: "reviewSubmissions",
      id: submission.id,
      attributes: { submitted: true },
    },
  });
  return body.data;
}

function runSelfTest() {
  const parsed = parseArgs(["--submit", "--version", "1.1.7", "--build", "157", "--release-type", "automatic"]);
  if (parsed.releaseType !== "automatic") throw new Error("Release type argument parsing failed.");
  const selected = selectExactBuild([{ id: "b", attributes: { version: "157", processingState: "VALID", expired: false } }], "157");
  if (selected.id !== "b") throw new Error("Exact build selection failed.");
  for (const candidate of [
    [{ id: "b", attributes: { version: "157", processingState: "PROCESSING" } }],
    [{ id: "b", attributes: { version: "157", processingState: "VALID", expired: true } }],
    [],
  ]) {
    let rejected = false;
    try { selectExactBuild(candidate, "157"); } catch { rejected = true; }
    if (!rejected) throw new Error("Unsafe build candidate was accepted.");
  }
  if (!submittedStates.has("IN_REVIEW") || submittedStates.has("PREPARE_FOR_SUBMISSION")) {
    throw new Error("Submission state policy is invalid.");
  }
  console.log("ios-app-store-submit self-test passed");
}

const options = parseArgs(process.argv.slice(2));
if (options.help) { usage(); process.exit(0); }
if (options.selfTest) { runSelfTest(); process.exit(0); }
if (!options.version || !options.build) { usage(); fail("--version and --build are required."); }
if (options.mode === "submit" && (!options.acceptance || !options.yes)) {
  fail("Submission requires --acceptance <record> and --yes after explicit user authorization.");
}
if (!new Set(["manual", "automatic"]).has(options.releaseType)) {
  fail("--release-type must be manual or automatic.");
}
if (options.mode === "submit" && options.releaseType === "automatic" && !options.acceptAutoReleaseRisk) {
  fail("Automatic release requires --accept-auto-release-risk because approval can publish immediately.");
}

let config;
try { config = parseEnvFile(path.resolve(options.config)); } catch (error) { fail(error.message); }
for (const name of ["EXPECTED_BUNDLE_ID", "APP_STORE_CONNECT_API_KEY_ID", "APP_STORE_CONNECT_API_ISSUER_ID", "APP_STORE_CONNECT_API_KEY_PATH"]) {
  if (!config[name]) fail(`Missing ${name} in ${options.config}.`);
}
if (options.mode === "submit") {
  try { assertCandidateAcceptance(options.acceptance, options.version, options.build); } catch (error) { fail(error.message); }
}

let token;
try {
  token = makeToken({
    keyId: config.APP_STORE_CONNECT_API_KEY_ID,
    issuerId: config.APP_STORE_CONNECT_API_ISSUER_ID,
    privateKey: readFileSync(config.APP_STORE_CONNECT_API_KEY_PATH, "utf8"),
  });
} catch (error) { fail(`Could not create App Store Connect token: ${error.message}`); }

try {
  const app = await findApp(token, config.EXPECTED_BUNDLE_ID);
  const build = await findBuild(token, app.id, options.build);
  let version = await findVersion(token, app.id, options.version);

  console.log(`App: ${config.EXPECTED_BUNDLE_ID} (${app.id})`);
  console.log(`Build: ${options.build} / ${build.attributes.processingState}`);
  console.log(`Version: ${options.version} / ${version ? versionState(version) : "NOT_CREATED"}`);

  if (version && submittedStates.has(versionState(version))) {
    if (version.includedBuild?.id && version.includedBuild.id !== build.id) {
      throw new Error(`Version ${options.version} is already submitted with a different build.`);
    }
    if (options.mode === "submit") {
      const requestedReleaseType = options.releaseType === "automatic" ? "AFTER_APPROVAL" : "MANUAL";
      version = await setReleaseType(token, version, requestedReleaseType);
      if (version.attributes?.releaseType !== requestedReleaseType) {
        throw new Error(`Could not verify ${requestedReleaseType} release type for submitted version.`);
      }
      console.log(`Release type: ${version.attributes.releaseType}`);
    }
    console.log(`Already submitted: ${versionState(version)}`);
    process.exit(0);
  }
  if (options.mode === "check") {
    if (version) {
      const metadata = await preflightMetadata(token, version.id);
      console.log(`Release type: ${version.attributes?.releaseType ?? "UNKNOWN"}`);
      console.log(`Bound build: ${version.includedBuild?.attributes?.version ?? "none"}`);
      console.log(`Export compliance: ${build.attributes?.usesNonExemptEncryption === false ? "no non-exempt encryption" : build.attributes?.usesNonExemptEncryption ?? "unanswered"}`);
      printMetadata(metadata);
    }
    process.exit(0);
  }

  if (!version) {
    const requestedReleaseType = options.releaseType === "automatic" ? "AFTER_APPROVAL" : "MANUAL";
    version = await createVersion(token, app.id, options.version, requestedReleaseType);
    console.log(`Created App Store version ${options.version} with ${requestedReleaseType} release.`);
  }
  const requestedReleaseType = options.releaseType === "automatic" ? "AFTER_APPROVAL" : "MANUAL";
  version = await setReleaseType(token, version, requestedReleaseType);
  if (version.attributes?.releaseType !== requestedReleaseType) {
    throw new Error(`Could not verify ${requestedReleaseType} release type; refusing to submit.`);
  }
  await bindBuild(token, version, build);
  const metadata = await preflightMetadata(token, version.id);
  await applyWhatsNew(token, metadata, options.whatsNew);
  printMetadata(metadata);

  const submission = await ensureSubmission(token, app.id, version.id);
  const submitted = await submitReview(token, submission);
  const refreshed = await findVersion(token, app.id, options.version);
  console.log(`Review submission: ${submitted.id}`);
  console.log(`Submission state: ${submitted.attributes?.state ?? "submitted"}`);
  console.log(`App Store version state: ${versionState(refreshed)}`);
  console.log(`Release type: ${requestedReleaseType}`);
} catch (error) {
  fail(error.message);
}
