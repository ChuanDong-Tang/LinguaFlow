#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MOBILE_DIR="$REPO_ROOT/apps/mobile"
CONFIG_FILE="$SCRIPT_DIR/android-play.env"

ASSUME_YES=false
BUILD_ONLY=false
CHECK_ONLY=false
ANDROID_TARGET="${OIO_ANDROID_TARGET:-google}"
if [[ "$ANDROID_TARGET" == "china" ]]; then
  ARTIFACT_DIR="$SCRIPT_DIR/artifacts/android-china"
else
  ARTIFACT_DIR="$SCRIPT_DIR/artifacts/android"
fi

usage() {
  cat <<'USAGE'
Usage: bash ci/cd/android-play.sh [options]

Options:
  --yes         Skip the confirmation prompt.
  --build-only  Build and validate the AAB, but do not upload it.
  --check       Run local preflight checks without building.
  -h, --help    Show this help.
USAGE
}

log() {
  printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

fail() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

while (($#)); do
  case "$1" in
    --yes) ASSUME_YES=true ;;
    --build-only) BUILD_ONLY=true ;;
    --check) CHECK_ONLY=true ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
  shift
done

[[ -f "$CONFIG_FILE" ]] || fail "Missing config: $CONFIG_FILE (copy android-play.env.example first)"
# shellcheck disable=SC1090
source "$CONFIG_FILE"

load_dotenv() {
  local env_file="$1"
  local line
  [[ -f "$env_file" ]] || fail "Missing environment file: $env_file"
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    case "$line" in
      ''|'#'*) continue ;;
    esac
    [[ "$line" == *=* ]] || fail "Invalid line in $env_file: $line"
    export "$line"
  done < "$env_file"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

resolve_android_tools() {
  if [[ -z "${JAVA_HOME:-}" && -d "/Applications/Android Studio.app/Contents/jbr/Contents/Home" ]]; then
    export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  fi
  ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}"
  export ANDROID_SDK_ROOT
}

preflight() {
  log "Running Android $ANDROID_TARGET production preflight"
  require_command node
  require_command npm
  require_command npx
  require_command git
  require_command unzip
  require_command strings
  require_command jarsigner
  resolve_android_tools
  load_dotenv "$MOBILE_DIR/.env"
  export NODE_ENV=production

  case "$ANDROID_TARGET" in
    google)
      export EXPO_PUBLIC_DISTRIBUTION_CHANNEL=google
      export EXPO_PUBLIC_ENABLE_GOOGLE_PLAY_AUTO_RENEW=true
      export EXPO_PUBLIC_ENABLE_ALIPAY_AUTO_RENEW=false
      ;;
    china)
      export EXPO_PUBLIC_DISTRIBUTION_CHANNEL=china
      export EXPO_PUBLIC_ENABLE_GOOGLE_PLAY_AUTO_RENEW=false
      export EXPO_PUBLIC_ENABLE_ALIPAY_AUTO_RENEW=true
      BUILD_ONLY=true
      ;;
    *) fail "Unsupported Android target: $ANDROID_TARGET (expected google or china)" ;;
  esac

  [[ "${EXPO_PUBLIC_API_BASE_URL:-}" == "$EXPECTED_API_URL" ]] || \
    fail "Local API URL is not production: ${EXPO_PUBLIC_API_BASE_URL:-<unset>}"
  [[ "${EXPO_PUBLIC_ENABLE_TEST_PASSWORD_LOGIN:-}" == "false" ]] || \
    fail "Test password login must be false."
  [[ "${EXPO_PUBLIC_SHOW_DEBUG_PROMPT_PANEL:-}" == "false" ]] || \
    fail "Debug prompt panel must be false."

  node - "$MOBILE_DIR/eas.json" "$BUILD_PROFILE" "$SUBMIT_PROFILE" "$EXPECTED_CHANNEL" "$EXPECTED_PLAY_TRACK" "$ANDROID_TARGET" <<'NODE'
const fs = require('fs');
const [file, buildProfileName, submitProfileName, expectedChannel, expectedTrack, target] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
const build = config.build?.[buildProfileName];
if (!build) throw new Error(`Missing EAS build profile: ${buildProfileName}`);
if (build.environment !== 'production') throw new Error('EAS environment must be production');
if (build.channel !== expectedChannel) throw new Error(`EAS channel must be ${expectedChannel}`);
if (build.distribution !== 'store') throw new Error('EAS distribution must be store');
if (build.android?.buildType !== 'app-bundle') throw new Error('Android buildType must be app-bundle');
if (target === 'google') {
  const submit = config.submit?.[submitProfileName]?.android;
  if (!submit) throw new Error(`Missing Android submit profile: ${submitProfileName}`);
  if (submit.track !== expectedTrack) throw new Error(`Google Play track must be ${expectedTrack}`);
  if (submit.releaseStatus !== 'completed') throw new Error('Google Play internal releaseStatus must be completed');
}
NODE

  log "Preflight passed"
  printf 'Target: %s\nProfile: %s\nChannel: %s\nAPI: %s\nPackage: %s\nPayment: %s\nArtifacts: %s\n' \
    "$ANDROID_TARGET" "$BUILD_PROFILE" "$EXPECTED_CHANNEL" "$EXPECTED_API_URL" "$EXPECTED_PACKAGE_ID" \
    "$([[ "$ANDROID_TARGET" == china ]] && printf Alipay || printf 'Google Play')" "$ARTIFACT_DIR"
}

validate_aab() {
  local aab="$1"
  local verify_dir bundle_file dump_file manifest_dump manifest_version_code manifest_version_name permission
  verify_dir="$(mktemp -d "${TMPDIR%/}/linguaflow-android-verify.XXXXXX")"
  trap '[[ -n "${verify_dir:-}" && "$verify_dir" == "${TMPDIR%/}"/linguaflow-android-verify.* ]] && rm -rf "$verify_dir"' RETURN

  unzip -q "$aab" -d "$verify_dir/unpacked"
  manifest_dump="$verify_dir/manifest.txt"
  strings "$verify_dir/unpacked/base/manifest/AndroidManifest.xml" > "$manifest_dump"
  grep -F "$EXPECTED_PACKAGE_ID" "$manifest_dump" >/dev/null || fail "Unexpected package ID in AAB manifest."
  manifest_version_code="$(awk '$0 == "versionCode" { getline; print; exit }' "$manifest_dump" | sed 's/[^0-9].*$//')"
  manifest_version_name="$(awk '$0 == "versionName" { getline; print; exit }' "$manifest_dump" | sed 's/[^0-9A-Za-z._+-].*$//')"
  [[ -n "$manifest_version_code" ]] || fail "Version code not found in AAB manifest."
  [[ -n "$manifest_version_name" ]] || fail "Version name not found in AAB manifest."
  ! grep -Fx 'debuggable' "$manifest_dump" >/dev/null || fail "AAB manifest contains a debuggable attribute."
  for permission in \
    android.permission.READ_MEDIA_IMAGES \
    android.permission.READ_MEDIA_VIDEO \
    android.permission.READ_MEDIA_VISUAL_USER_SELECTED \
    android.permission.READ_EXTERNAL_STORAGE \
    android.permission.WRITE_EXTERNAL_STORAGE; do
    ! grep -F "$permission" "$manifest_dump" >/dev/null || fail "AAB contains forbidden media permission: $permission"
  done
  AAB_PACKAGE_ID="$EXPECTED_PACKAGE_ID"
  AAB_VERSION_CODE="$manifest_version_code"
  AAB_VERSION_NAME="$manifest_version_name"
  jarsigner -verify "$aab" >/dev/null || fail "AAB signature verification failed."

  bundle_file="$(find "$verify_dir/unpacked" -type f -name 'index.android.bundle' -print -quit)"
  [[ -n "$bundle_file" ]] || fail "index.android.bundle not found in AAB."
  dump_file="$verify_dir/hermes-bytecode.txt"
  "$MOBILE_DIR/node_modules/react-native/sdks/hermesc/osx-bin/hermesc" -b -dump-bytecode "$bundle_file" > "$dump_file"
  grep -F "$EXPECTED_API_URL" "$dump_file" >/dev/null || \
    fail "Production API URL is not embedded in the JS bundle. Upload stopped."

  grep -F "{\"expo-channel-name\":\"$EXPECTED_CHANNEL\"}" "$manifest_dump" >/dev/null || \
    fail "Production Expo Updates channel is not embedded in Android resources. Upload stopped."

  log "AAB validation passed"
  printf 'App: %s\nVersion: %s\nVersion code: %s\nChannel: %s\nAPI: %s\n' \
    "$AAB_PACKAGE_ID" "$AAB_VERSION_NAME" "$AAB_VERSION_CODE" "$EXPECTED_CHANNEL" "$EXPECTED_API_URL"
}

preflight
if $CHECK_ONLY; then
  exit 0
fi

log "Current source status"
git -C "$REPO_ROOT" status --short || true

if ! $ASSUME_YES; then
  if $BUILD_ONLY; then
    printf '\nThis will allocate a new Android version code, build locally, and validate the AAB without uploading it.\n'
  else
    printf '\nThis will allocate a new Android version code, build locally, validate, and upload to the Google Play internal track.\n'
  fi
  read -r -p 'Continue? [y/N] ' answer
  case "$answer" in
    y|Y|yes|YES) ;;
    *) fail "Cancelled." ;;
  esac
fi

mkdir -p "$ARTIFACT_DIR"
timestamp="$(date '+%Y%m%d-%H%M%S')"
raw_aab="$ARTIFACT_DIR/OIO-pending-$timestamp.aab"

log "Building $ANDROID_TARGET production AAB locally with EAS"
(
  cd "$MOBILE_DIR"
  # Expo/RN release builds load many Gradle and Kotlin compiler classes. The
  # generated Android project defaults to a 512 MB metaspace cap, which is too
  # small for this app and can leave the local EAS build stuck in RMI errors.
  export JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:+$JAVA_TOOL_OPTIONS }-XX:MaxMetaspaceSize=1536m"
  export GRADLE_OPTS="${GRADLE_OPTS:+$GRADLE_OPTS }-Dorg.gradle.jvmargs=-Xmx4096m\ -XX:MaxMetaspaceSize=1536m\ -Dfile.encoding=UTF-8"
  # Keep release builds away from Android Studio and dev-build Gradle locks.
  export GRADLE_USER_HOME="$ARTIFACT_DIR/.gradle-user-home"
  mkdir -p "$GRADLE_USER_HOME"
  npx expo prebuild --platform android --no-install
  npx --yes eas-cli build \
    --platform android \
    --profile "$BUILD_PROFILE" \
    --local \
    --non-interactive \
    --output "$raw_aab"
)

[[ -s "$raw_aab" ]] || fail "EAS build did not produce an AAB."
validate_aab "$raw_aab"

final_aab="$ARTIFACT_DIR/OIO-$AAB_VERSION_NAME-$AAB_VERSION_CODE.aab"
if [[ -e "$final_aab" ]]; then
  final_aab="$ARTIFACT_DIR/OIO-$AAB_VERSION_NAME-$AAB_VERSION_CODE-$timestamp.aab"
fi
mv "$raw_aab" "$final_aab"
shasum -a 256 "$final_aab"

if $BUILD_ONLY; then
  log "Build-only workflow completed"
  printf 'AAB: %s\n' "$final_aab"
  exit 0
fi

log "Submitting validated AAB to Google Play internal testing"
(
  cd "$MOBILE_DIR"
  npx --yes eas-cli submit \
    --platform android \
    --profile "$SUBMIT_PROFILE" \
    --path "$final_aab" \
    --non-interactive \
    --wait
)

log "Google Play upload completed"
printf 'AAB: %s\nGoogle Play Console: https://play.google.com/console/\n' "$final_aab"
