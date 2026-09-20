#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import COS from "cos-nodejs-sdk-v5";

const apkPath = path.resolve(process.argv[2] ?? "");
const filename = path.basename(apkPath);
if (!/^OIO-\d+\.\d+\.\d+-\d+\.apk$/u.test(filename)) {
  throw new Error("Usage: upload-china-apk.mjs <OIO-version-versionCode.apk>");
}

const localHash = sha256(readFileSync(apkPath));
const credentials = readProductionCosCredentials();
const Bucket = "oio-download-1422482413";
const Region = "ap-shanghai";
const Key = filename;
const publicUrl = `https://download.yueyantech.com/${encodeURIComponent(filename)}`;
const cos = new COS({ SecretId: credentials.secretId, SecretKey: credentials.secretKey });

const exists = await objectExists(cos, { Bucket, Region, Key });
if (!exists) {
  await putObject(cos, {
    Bucket,
    Region,
    Key,
    Body: createReadStream(apkPath),
    ContentType: "application/vnd.android.package-archive",
  });
}

const response = await fetch(publicUrl, { cache: "no-store" });
if (!response.ok) throw new Error(`Uploaded APK is not reachable: HTTP ${response.status}`);
const downloadedHash = sha256(Buffer.from(await response.arrayBuffer()));
if (downloadedHash !== localHash) {
  throw new Error(`Uploaded APK SHA-256 mismatch: local=${localHash} remote=${downloadedHash}`);
}

console.log(`url=${publicUrl}`);
console.log(`sha256=${localHash}`);
console.log(`object=${exists ? "reused" : "uploaded"}`);

function readProductionCosCredentials() {
  const remoteScript = [
    "const e=process.env;",
    "const value={",
    "secretId:e.LF_EXPO_UPDATES_COS_SECRET_ID||e.TENCENT_COS_SECRET_ID||e.COS_SECRET_ID,",
    "secretKey:e.LF_EXPO_UPDATES_COS_SECRET_KEY||e.TENCENT_COS_SECRET_KEY||e.COS_SECRET_KEY",
    "};",
    "if(!value.secretId||!value.secretKey)process.exit(2);",
    "process.stdout.write(JSON.stringify(value));",
  ].join("");
  const raw = execFileSync(
    "ssh",
    ["oio-main", `cd /opt/oio-production && node --env-file=.env -e '${remoteScript}'`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  return JSON.parse(raw);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function objectExists(client, options) {
  return new Promise((resolve, reject) => {
    client.headObject(options, (error) => {
      if (!error) return resolve(true);
      if (error.statusCode === 404 || error.code === "NoSuchKey") return resolve(false);
      reject(error);
    });
  });
}

function putObject(client, options) {
  return new Promise((resolve, reject) => {
    client.putObject(options, (error, data) => error ? reject(error) : resolve(data));
  });
}
