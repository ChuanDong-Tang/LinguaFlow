#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SKILL_DIR/../.." && pwd)"
MOBILE_DIR="$REPO_ROOT/apps/mobile"
RECEIPT_DIR="$REPO_ROOT/.tmp/release-smoke"
RECEIPT_FILE="$RECEIPT_DIR/latest.json"
BUNDLE_ID="com.yueyantech.oio"
PACKAGE_ID="com.yueyantech.oio"
IOS_SCHEME="OIO"
ANDROID_AVD="${LF_ANDROID_SMOKE_AVD:-Pixel_8}"
MAX_RECEIPT_AGE_SECONDS="${LF_SMOKE_RECEIPT_MAX_AGE_SECONDS:-86400}"

MODE=run
FORCE=false
KEEP_TARGET=""

usage() {
  cat <<'USAGE'
Usage: bash skills/linguaflow-android-release/scripts/simulator-smoke.sh [options]

Options:
  --check         Verify that iOS 26, iOS 27, and the Android AVD exist.
  --run           Build and cold-launch the current source on all three targets (default).
  --require       Require a still-valid receipt for the current source; do not build or launch.
  --force         Ignore a reusable receipt and run all smoke checks again.
  --keep-running  Compatibility alias for --keep-target android.
  --keep-target T Re-open only one inspected target after the gate: ios26, ios27, or android.
  -h, --help      Show this help.
USAGE
}

fail() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

while (($#)); do
  case "$1" in
    --check) MODE=check ;;
    --run) MODE=run ;;
    --require) MODE=require ;;
    --force) FORCE=true ;;
    --keep-running) KEEP_TARGET=android ;;
    --keep-target)
      shift
      [[ $# -gt 0 ]] || fail "Missing value for --keep-target"
      KEEP_TARGET="$1"
      ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
  shift
done

case "$KEEP_TARGET" in
  ""|ios26|ios27|android) ;;
  *) fail "--keep-target must be ios26, ios27, or android" ;;
esac

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

resolve_android_tools() {
  local sdk_root
  sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}"
  ADB_BIN="${ADB_BIN:-$sdk_root/platform-tools/adb}"
  EMULATOR_BIN="${EMULATOR_BIN:-$sdk_root/emulator/emulator}"
  [[ -x "$ADB_BIN" ]] || fail "adb not found: $ADB_BIN"
  [[ -x "$EMULATOR_BIN" ]] || fail "Android emulator not found: $EMULATOR_BIN"
}

source_fingerprint() {
  node - "$MOBILE_DIR" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
const excludedDirectories = new Set([
  '.expo', '.gradle', 'Pods', 'build', 'DerivedData', 'node_modules',
]);
const generatedNativeDirectories = new Set(['ios', 'android']);
const excludedFiles = new Set(['.DS_Store']);
const environmentKeys = [
  'EXPO_PUBLIC_API_BASE_URL',
  'EXPO_PUBLIC_DISTRIBUTION_CHANNEL',
  'EXPO_PUBLIC_ENABLE_APPLE_AUTO_RENEW',
  'EXPO_PUBLIC_ENABLE_APPLE_ONE_TIME_PURCHASE',
  'EXPO_PUBLIC_ENABLE_GOOGLE_PLAY_AUTO_RENEW',
  'EXPO_PUBLIC_ENABLE_ALIPAY_AUTO_RENEW',
  'EXPO_PUBLIC_ENABLE_ALIPAY_ANNUAL_PASS',
  'EAS_BUILD_PROFILE',
];
const files = [];
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excludedFiles.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    const relativePath = path.relative(root, fullPath);
    if (entry.isDirectory()) {
      if (excludedDirectories.has(entry.name)) continue;
      // Only the root native projects are generated outputs. Plugin source
      // folders named ios/android are tracked inputs and must invalidate the
      // smoke receipt when they change.
      if (generatedNativeDirectories.has(relativePath)) continue;
      visit(fullPath);
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
}
visit(root);
files.sort();
const hash = crypto.createHash('sha256');
for (const relativePath of files) {
  hash.update(relativePath);
  hash.update('\0');
  hash.update(fs.readFileSync(path.join(root, relativePath)));
  hash.update('\0');
}
for (const key of environmentKeys) {
  hash.update(key);
  hash.update('\0');
  hash.update(process.env[key] ?? '');
  hash.update('\0');
}
process.stdout.write(hash.digest('hex'));
NODE
}

resolve_ios_device() {
  local major="$1"
  local devices_json
  devices_json="$(xcrun simctl list -j devices available)"
  node - "$major" "$devices_json" <<'NODE'
  const major = process.argv[2];
  const data = JSON.parse(process.argv[3]);
  const matches = [];
  for (const [runtime, devices] of Object.entries(data.devices ?? {})) {
    if (!new RegExp(`\\.iOS-${major}(?:-|$)`).test(runtime)) continue;
    for (const device of devices) {
      if (device.isAvailable !== false && /^iPhone/.test(device.name)) {
        matches.push({ ...device, runtime });
      }
    }
  }
  matches.sort((a, b) => Number(b.state === 'Booted') - Number(a.state === 'Booted') || a.name.localeCompare(b.name));
  if (!matches.length) process.exit(3);
  const selected = matches[0];
  process.stdout.write([selected.udid, selected.name, selected.runtime].join('\t'));
NODE
}

resolve_targets() {
  require_command node
  require_command xcrun
  require_command xcodebuild
  require_command npx
  require_command pod
  resolve_android_tools

  IOS_26="$(resolve_ios_device 26)" || fail "No available iPhone simulator with iOS 26.x is installed."
  IOS_27="$(resolve_ios_device 27)" || fail "No available iPhone simulator with iOS 27.x is installed."
  "$EMULATOR_BIN" -list-avds | grep -Fx "$ANDROID_AVD" >/dev/null || \
    fail "Android AVD not found: $ANDROID_AVD"

  printf 'iOS 26: %s\niOS 27: %s\nAndroid: %s\n' \
    "${IOS_26#*$'\t'}" "${IOS_27#*$'\t'}" "$ANDROID_AVD"
}

receipt_is_current() {
  local fingerprint="$1"
  [[ -f "$RECEIPT_FILE" ]] || return 1
  node - "$RECEIPT_FILE" "$fingerprint" "$MAX_RECEIPT_AGE_SECONDS" <<'NODE'
const fs = require('fs');
const [file, fingerprint, maxAgeText] = process.argv.slice(2);
const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
const ageSeconds = (Date.now() - Date.parse(receipt.completedAt)) / 1000;
const valid = receipt.status === 'passed'
  && receipt.schemaVersion === 2
  && receipt.sourceFingerprint === fingerprint
  && Number.isFinite(ageSeconds)
  && ageSeconds >= 0
  && ageSeconds <= Number(maxAgeText)
  && receipt.targets?.ios26?.launches === 2
  && receipt.targets?.ios27?.launches === 2
  && receipt.targets?.android?.launches === 2
  && receipt.execution?.strategy === 'sequential'
  && receipt.execution?.maxConcurrentDevices === 1;
process.exit(valid ? 0 : 1);
NODE
}

smoke_ios() {
  local label="$1"
  local descriptor="$2"
  local udid="${descriptor%%$'\t'*}"
  local remainder="${descriptor#*$'\t'}"
  local name="${remainder%%$'\t'*}"
  local runtime="${remainder#*$'\t'}"

  log "Booting $label ($name, $runtime)"
  IOS_ACTIVE_UDID="$udid"
  if ! xcrun simctl list devices | grep -F "$udid" | grep -F '(Booted)' >/dev/null; then
    xcrun simctl boot "$udid"
  fi
  xcrun simctl bootstatus "$udid" -b
  xcrun simctl uninstall "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  xcrun simctl install "$udid" "$IOS_APP"

  local attempt
  for attempt in 1 2; do
    xcrun simctl terminate "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
    xcrun simctl launch --terminate-running-process "$udid" "$BUNDLE_ID" >/dev/null
    sleep 6
    xcrun simctl terminate "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || \
      fail "$label launch $attempt did not remain running."
  done

  xcrun simctl terminate "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
  IOS_ACTIVE_UDID=""
}

find_android_serial() {
  local serial avd_name
  while IFS=$'\t' read -r serial state; do
    [[ "$serial" == emulator-* && "$state" == device ]] || continue
    avd_name="$($ADB_BIN -s "$serial" emu avd name 2>/dev/null | tr -d '\r' | head -n 1)"
    if [[ "$avd_name" == "$ANDROID_AVD" ]]; then
      printf '%s' "$serial"
      return 0
    fi
  done < <("$ADB_BIN" devices | tail -n +2)
  return 1
}

wait_for_android() {
  local deadline=$((SECONDS + 180))
  while ((SECONDS < deadline)); do
    ANDROID_SERIAL="$(find_android_serial || true)"
    if [[ -n "$ANDROID_SERIAL" ]] && [[ "$($ADB_BIN -s "$ANDROID_SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; then
      return 0
    fi
    sleep 3
  done
  return 1
}

smoke_android() {
  ANDROID_SERIAL="$(find_android_serial || true)"
  if [[ -z "$ANDROID_SERIAL" ]]; then
    log "Starting Android AVD $ANDROID_AVD"
    "$EMULATOR_BIN" -avd "$ANDROID_AVD" -no-snapshot-save -no-audio -no-boot-anim \
      >"$RECEIPT_DIR/android-emulator.log" 2>&1 &
  fi
  wait_for_android || fail "Android AVD $ANDROID_AVD did not finish booting within 180 seconds."
  ANDROID_ACTIVE_SERIAL="$ANDROID_SERIAL"
  "$ADB_BIN" -s "$ANDROID_SERIAL" uninstall "$PACKAGE_ID" >/dev/null 2>&1 || true
  "$ADB_BIN" -s "$ANDROID_SERIAL" install "$ANDROID_APK" >/dev/null

  local attempt
  for attempt in 1 2; do
    "$ADB_BIN" -s "$ANDROID_SERIAL" shell am force-stop "$PACKAGE_ID"
    "$ADB_BIN" -s "$ANDROID_SERIAL" shell monkey -p "$PACKAGE_ID" -c android.intent.category.LAUNCHER 1 >/dev/null
    sleep 6
    [[ -n "$($ADB_BIN -s "$ANDROID_SERIAL" shell pidof "$PACKAGE_ID" | tr -d '\r')" ]] || \
      fail "Android launch $attempt did not remain running."
  done

  "$ADB_BIN" -s "$ANDROID_SERIAL" shell am force-stop "$PACKAGE_ID" >/dev/null 2>&1 || true
  "$ADB_BIN" -s "$ANDROID_SERIAL" emu kill >/dev/null 2>&1 || true
  ANDROID_ACTIVE_SERIAL=""
}

cleanup() {
  if [[ -n "${IOS_ACTIVE_UDID:-}" ]]; then
    xcrun simctl shutdown "$IOS_ACTIVE_UDID" >/dev/null 2>&1 || true
  fi
  local serial="${ANDROID_ACTIVE_SERIAL:-${ANDROID_SERIAL:-}}"
  if [[ -z "$serial" ]]; then serial="$(find_android_serial || true)"; fi
  if [[ -n "$serial" ]]; then
    "$ADB_BIN" -s "$serial" emu kill >/dev/null 2>&1 || true
  fi
}

shutdown_configured_targets() {
  local descriptor udid serial
  for descriptor in "$IOS_26" "$IOS_27"; do
    udid="${descriptor%%$'\t'*}"
    xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
  done
  serial="$(find_android_serial || true)"
  if [[ -n "$serial" ]]; then
    "$ADB_BIN" -s "$serial" emu kill >/dev/null 2>&1 || true
    local deadline=$((SECONDS + 30))
    while ((SECONDS < deadline)) && [[ -n "$(find_android_serial || true)" ]]; do sleep 1; done
  fi
}

reopen_kept_target() {
  local descriptor udid
  case "$KEEP_TARGET" in
    "") return ;;
    ios26|ios27)
      if [[ "$KEEP_TARGET" == ios26 ]]; then descriptor="$IOS_26"; else descriptor="$IOS_27"; fi
      udid="${descriptor%%$'\t'*}"
      log "Re-opening only $KEEP_TARGET for manual inspection"
      xcrun simctl boot "$udid"
      xcrun simctl bootstatus "$udid" -b
      xcrun simctl install "$udid" "$IOS_APP"
      xcrun simctl launch --terminate-running-process "$udid" "$BUNDLE_ID" >/dev/null
      ;;
    android)
      log "Re-opening only Android for manual inspection"
      "$EMULATOR_BIN" -avd "$ANDROID_AVD" -no-snapshot-save -no-audio -no-boot-anim \
        >"$RECEIPT_DIR/android-emulator.log" 2>&1 &
      wait_for_android || fail "Android AVD $ANDROID_AVD did not finish booting within 180 seconds."
      "$ADB_BIN" -s "$ANDROID_SERIAL" install -r "$ANDROID_APK" >/dev/null
      "$ADB_BIN" -s "$ANDROID_SERIAL" shell monkey -p "$PACKAGE_ID" -c android.intent.category.LAUNCHER 1 >/dev/null
      ;;
  esac
}

resolve_targets
if [[ "$MODE" == check ]]; then
  log "Simulator smoke preflight passed"
  exit 0
fi

fingerprint="$(source_fingerprint)"
if receipt_is_current "$fingerprint" && { [[ "$MODE" == require ]] || ! $FORCE; }; then
  log "Reusing current three-platform smoke receipt"
  printf 'Receipt: %s\nFingerprint: %s\n' "$RECEIPT_FILE" "$fingerprint"
  exit 0
fi
if [[ "$MODE" == require ]]; then
  fail "No valid three-platform smoke receipt exists for the current mobile source. Run simulator-smoke.sh --run."
fi
if ! $FORCE && [[ -f "$RECEIPT_FILE" ]]; then
  log "Existing smoke receipt is stale because source, age, or target coverage changed"
fi

mkdir -p "$RECEIPT_DIR"
IOS_ACTIVE_UDID=""
ANDROID_ACTIVE_SERIAL=""
trap cleanup EXIT

log "Stopping the three managed test targets so the gate uses at most one device at a time"
shutdown_configured_targets

log "Synchronizing generated native projects"
(
  cd "$MOBILE_DIR"
  npx expo prebuild --platform ios --no-install
  npx expo prebuild --platform android --no-install
  (cd ios && pod install)
)

derived_data="$RECEIPT_DIR/ios-derived-data"
log "Building Release app for iOS Simulator"
xcodebuild \
  -workspace "$MOBILE_DIR/ios/OIO.xcworkspace" \
  -scheme "$IOS_SCHEME" \
  -configuration Release \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$derived_data" \
  ARCHS=arm64 \
  ONLY_ACTIVE_ARCH=YES \
  CODE_SIGNING_ALLOWED=NO \
  build >/dev/null
IOS_APP="$(find "$derived_data/Build/Products" -type d -path '*Release-iphonesimulator/*.app' -print -quit)"
[[ -n "$IOS_APP" ]] || fail "iOS Simulator .app was not produced."

log "Building Release APK for Android Emulator"
node - "$MOBILE_DIR/android/app/build.gradle" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const source = fs.readFileSync(file, 'utf8');
const needle = 'signingConfig signingConfigs.release';
if (!source.includes(needle)) {
  throw new Error('Generated Android release signing config was not found');
}
fs.writeFileSync(file, source.replace(needle, 'signingConfig signingConfigs.debug'));
NODE
(
  cd "$MOBILE_DIR/android"
  export NODE_ENV=production
  export JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:+$JAVA_TOOL_OPTIONS }-XX:MaxMetaspaceSize=1536m"
  export GRADLE_OPTS="${GRADLE_OPTS:+$GRADLE_OPTS }-Dorg.gradle.jvmargs=-Xmx4096m\ -XX:MaxMetaspaceSize=1536m\ -Dfile.encoding=UTF-8"
  ./gradlew app:assembleRelease -PreactNativeArchitectures=arm64-v8a -x lintVitalAnalyzeRelease
)
ANDROID_APK="$(find "$MOBILE_DIR/android/app/build/outputs/apk/release" -type f -name '*.apk' -print -quit)"
[[ -s "$ANDROID_APK" ]] || fail "Android release APK was not produced."

smoke_ios "iOS 26" "$IOS_26"
smoke_ios "iOS 27" "$IOS_27"
smoke_android

# Expo prebuild may normalize tracked Mobile inputs such as package-lock.json.
# Bind the receipt to the source that actually produced and launched the apps,
# not to the pre-prebuild snapshot from the start of this script.
fingerprint="$(source_fingerprint)"
commit="$(git -C "$REPO_ROOT" rev-parse HEAD)"
completed_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
node - "$RECEIPT_FILE" "$fingerprint" "$commit" "$completed_at" "$IOS_26" "$IOS_27" "$ANDROID_AVD" <<'NODE'
const fs = require('fs');
const [file, sourceFingerprint, commit, completedAt, ios26, ios27, android] = process.argv.slice(2);
const describeIos = (value) => {
  const [udid, name, runtime] = value.split('\t');
  return { udid, name, runtime, launches: 2 };
};
const receipt = {
  schemaVersion: 2,
  status: 'passed',
  completedAt,
  commit,
  sourceFingerprint,
  execution: {
    strategy: 'sequential',
    maxConcurrentDevices: 1,
    shutdownAfterEachTarget: true,
  },
  targets: {
    ios26: describeIos(ios26),
    ios27: describeIos(ios27),
    android: { avd: android, launches: 2 },
  },
};
fs.writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`);
NODE

log "Three-platform simulator smoke passed"
printf 'Receipt: %s\nFingerprint: %s\n' "$RECEIPT_FILE" "$fingerprint"

# The gate itself is complete and every target is shut down. When manual
# inspection was requested, re-open exactly one target after removing the
# failure cleanup trap so another simulator is never kept alive beside it.
trap - EXIT
cleanup
reopen_kept_target
