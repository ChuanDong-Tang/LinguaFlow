#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = process.env.LF_OTA_REPOSITORY_ROOT?.trim()
  ? path.resolve(process.env.LF_OTA_REPOSITORY_ROOT.trim())
  : path.resolve(scriptDirectory, "../../..");
const options = parseArguments(process.argv.slice(2));
const targetKey = `${options.channel}:${options.platform}`;
const allowedTargets = new Set([
  "production:ios",
  "production-google:android",
  "production-china:android",
]);

if (!allowedTargets.has(targetKey)) {
  throw new Error("Use production/ios, production-google/android, or production-china/android");
}

const environment = options.dryRun
  ? process.env
  : { ...process.env, ...readProductionCosEnvironment() };
const publisherArguments = [
  "--prefix",
  "apps/mobile",
  "run",
  "publish:update",
  "--",
  "--channel",
  options.channel,
  "--platform",
  options.platform,
  ...(options.dryRun ? ["--dry-run"] : []),
];
const result = spawnSync("npm", publisherArguments, {
  cwd: repositoryRoot,
  env: environment,
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);

function readProductionCosEnvironment() {
  const sshHost = process.env.LF_OTA_SSH_HOST?.trim() || "oio-main";
  if (!/^[A-Za-z0-9._-]+$/u.test(sshHost)) throw new Error("LF_OTA_SSH_HOST is invalid");
  const remoteScript = [
    "const e=process.env;",
    "const value={",
    "secretId:e.LF_EXPO_UPDATES_COS_SECRET_ID||e.TENCENT_COS_SECRET_ID||e.COS_SECRET_ID,",
    "secretKey:e.LF_EXPO_UPDATES_COS_SECRET_KEY||e.TENCENT_COS_SECRET_KEY||e.COS_SECRET_KEY",
    "};",
    "if(!value.secretId||!value.secretKey)process.exit(2);",
    "process.stdout.write(JSON.stringify(value));",
  ].join("");
  const rawCredentials = execFileSync(
    "ssh",
    [
      sshHost,
      `cd /opt/oio-production && node --env-file=.env -e '${remoteScript}'`,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  const credentials = JSON.parse(rawCredentials);
  return {
    LF_EXPO_UPDATES_COS_SECRET_ID: credentials.secretId,
    LF_EXPO_UPDATES_COS_SECRET_KEY: credentials.secretKey,
    LF_EXPO_UPDATES_COS_BUCKET: "oio-download-1422482413",
    LF_EXPO_UPDATES_COS_REGION: "ap-shanghai",
    LF_EXPO_UPDATES_PUBLIC_BASE_URL: "https://download.yueyantech.com",
    LF_EXPO_UPDATES_STORAGE_PREFIX: "expo-updates",
  };
}

function parseArguments(args) {
  const parsed = { channel: "", platform: "", dryRun: false };
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    const value = args[index + 1];
    if (name === "--channel" && value) parsed.channel = value;
    else if (name === "--platform" && value) parsed.platform = value;
    else throw new Error(`Unknown or incomplete argument: ${name}`);
    index += 1;
  }
  return parsed;
}
