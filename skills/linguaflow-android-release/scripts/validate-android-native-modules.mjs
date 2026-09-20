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

const selectableTextView = `${packageName}.chatselectabletext.ChatSelectableTextView`;
const viewResult = spawnSync(
  analyzer,
  ["dex", "code", "--class", selectableTextView, artifact],
  { encoding: "utf8" },
);
if (viewResult.error) fail(`Unable to inspect ${selectableTextView}: ${viewResult.error.message}`);
if (viewResult.status !== 0) {
  fail(viewResult.stderr.trim() || `apkanalyzer exited with status ${viewResult.status}`);
}
if (viewResult.stdout.includes("ReactContext;->getJSModule")) {
  fail(
    "ChatSelectableTextView still dispatches view events through ReactContext.getJSModule. "
    + "Expo 57's bridgeless runtime rejects this API, disabling Card selection and cloze interactions.",
  );
}
if (!viewResult.stdout.includes("UIManagerHelper;->getEventDispatcherForReactTag")) {
  fail(
    "ChatSelectableTextView does not use UIManagerHelper.getEventDispatcherForReactTag. "
    + "The native view event path is not compatible with React Native's new architecture.",
  );
}

process.stdout.write(
  `Native module validation passed: ${mainApplication} registration and bridgeless event dispatch\n`,
);

function fail(message) {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
}
