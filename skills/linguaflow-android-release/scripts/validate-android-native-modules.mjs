#!/usr/bin/env node

import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const [artifact, packageName] = process.argv.slice(2);
if (!artifact || !packageName) {
  fail("Usage: validate-android-native-modules.mjs <apk-or-aab> <package-name>");
}

const sdkRoot = process.env.ANDROID_SDK_ROOT
  || process.env.ANDROID_HOME
  || path.join(homedir(), "Library", "Android", "sdk");
const analyzer = path.join(sdkRoot, "cmdline-tools", "latest", "bin", "apkanalyzer");
const mainApplication = `${packageName}.MainApplication`;
const result = spawnSync(
  analyzer,
  ["dex", "code", "--class", mainApplication, artifact],
  { encoding: "utf8" },
);

if (result.error) fail(`Unable to run apkanalyzer: ${result.error.message}`);
if (result.status !== 0) {
  fail(result.stderr.trim() || `apkanalyzer exited with status ${result.status}`);
}

const packageDescriptor = `L${packageName.replaceAll(".", "/")}/chatselectabletext/ChatSelectableTextPackage;`;
if (!result.stdout.includes(packageDescriptor)) {
  fail(
    "ChatSelectableTextPackage is present in source but is not registered by MainApplication. "
    + "This package would disable Card selection and cloze interactions.",
  );
}

process.stdout.write(`Native module registration passed: ${mainApplication} -> ChatSelectableTextPackage\n`);

function fail(message) {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
}
