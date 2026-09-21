#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SKILL_DIR/../.." && pwd)"
MOBILE_DIR="$REPO_ROOT/apps/mobile"
CONFIG_FILE="$SKILL_DIR/config/android-play.env"

ASSUME_YES=false
BUILD_ONLY=true
CHECK_ONLY=false
VALIDATE_ONLY_PACKAGE=""
SUBMIT_ONLY_PACKAGE=""
DIRECT_SUBMIT_ONLY_PACKAGE=""
ACCEPTANCE_FILE=""
ANDROID_TARGET="${OIO_ANDROID_TARGET:-google}"
if [[ "$ANDROID_TARGET" == "china" ]]; then
  ARTIFACT_DIR="$REPO_ROOT/ci/cd/artifacts/android-china"
else
  ARTIFACT_DIR="$REPO_ROOT/ci/cd/artifacts/android"
fi

usage() {
  cat <<'USAGE'
Usage: bash skills/linguaflow-android-release/scripts/android-play.sh [options]

Options:
  --yes         Skip the confirmation prompt.
  --build-only  Build and validate the release package (the default behavior).
  --check       Run local preflight checks without building.
  --validate FILE  Validate an existing China APK without rebuilding it.
  --submit-only FILE  Upload an accepted Google AAB to internal testing.
  --submit-direct FILE  Upload an accepted Google AAB directly to internal testing.
  --acceptance FILE  Required artifact-bound candidate acceptance record for any upload.
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

resolve_hermesc() {
  local candidate
  for candidate in \
    "$MOBILE_DIR/node_modules/hermes-compiler/hermesc/osx-bin/hermesc" \
    "$MOBILE_DIR/node_modules/react-native/sdks/hermesc/osx-bin/hermesc"; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  fail "Hermes bytecode inspector not found in Expo 57 or legacy React Native locations."
}

while (($#)); do
  case "$1" in
    --yes) ASSUME_YES=true ;;
    --build-only) BUILD_ONLY=true ;;
    --check) CHECK_ONLY=true ;;
    --validate)
      (($# >= 2)) || fail "--validate requires an APK path"
      VALIDATE_ONLY_PACKAGE="$2"
      shift
      ;;
    --submit-only)
      (($# >= 2)) || fail "--submit-only requires an AAB path"
      SUBMIT_ONLY_PACKAGE="$2"
      BUILD_ONLY=false
      shift
      ;;
    --submit-direct)
      (($# >= 2)) || fail "--submit-direct requires an AAB path"
      DIRECT_SUBMIT_ONLY_PACKAGE="$2"
      BUILD_ONLY=false
      shift
      ;;
    --acceptance)
      (($# >= 2)) || fail "--acceptance requires a record path"
      ACCEPTANCE_FILE="$2"
      shift
      ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
  shift
done

[[ -f "$CONFIG_FILE" ]] || fail "Missing config: $CONFIG_FILE (copy android-play.env.example first)"
# shellcheck disable=SC1090
source "$CONFIG_FILE"

if [[ "$ANDROID_TARGET" == "china" ]]; then
  BUILD_PROFILE=china
  EXPECTED_CHANNEL=production-china
  PACKAGE_KIND=APK
  PACKAGE_EXTENSION=apk
else
  PACKAGE_KIND=AAB
  PACKAGE_EXTENSION=aab
fi

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
  bash "$SCRIPT_DIR/simulator-smoke.sh" --check --target android
  load_dotenv "$MOBILE_DIR/.env"
  export NODE_ENV=production
  # Android packages must never expose either Apple purchase path.
  export EXPO_PUBLIC_ENABLE_APPLE_AUTO_RENEW=false
  export EXPO_PUBLIC_ENABLE_APPLE_ONE_TIME_PURCHASE=false
  export EXPO_PUBLIC_ENABLE_ALIPAY_ANNUAL_PASS=false

  case "$ANDROID_TARGET" in
    google)
      export EXPO_PUBLIC_DISTRIBUTION_CHANNEL=google
      export EXPO_PUBLIC_ENABLE_GOOGLE_PLAY_AUTO_RENEW=true
      export EXPO_PUBLIC_ENABLE_ALIPAY_AUTO_RENEW=false
      [[ "$EXPECTED_PLAY_TRACK" == "internal" ]] || \
        fail "Candidate upload track must be internal; production promotion is a separate canary-verified action."
      ;;
    china)
      export EXPO_PUBLIC_DISTRIBUTION_CHANNEL=china
      export EXPO_PUBLIC_ENABLE_GOOGLE_PLAY_AUTO_RENEW=false
      export EXPO_PUBLIC_ENABLE_ALIPAY_AUTO_RENEW=true
      export EXPO_PUBLIC_ENABLE_ALIPAY_ANNUAL_PASS=true
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
const expectedBuildType = target === 'china' ? 'apk' : 'app-bundle';
if (build.android?.buildType !== expectedBuildType) throw new Error(`Android buildType must be ${expectedBuildType}`);
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
  "$(resolve_hermesc)" -b -dump-bytecode "$bundle_file" > "$dump_file"
  grep -F "$EXPECTED_API_URL" "$dump_file" >/dev/null || \
    fail "Production API URL is not embedded in the JS bundle. Upload stopped."

  grep -F "{\"expo-channel-name\":\"$EXPECTED_CHANNEL\"}" "$manifest_dump" >/dev/null || \
    fail "Production Expo Updates channel is not embedded in Android resources. Upload stopped."

  node "$SCRIPT_DIR/validate-android-native-modules.mjs" "$aab" "$EXPECTED_PACKAGE_ID"

  log "AAB validation passed"
  printf 'App: %s\nVersion: %s\nVersion code: %s\nChannel: %s\nAPI: %s\n' \
    "$AAB_PACKAGE_ID" "$AAB_VERSION_NAME" "$AAB_VERSION_CODE" "$EXPECTED_CHANNEL" "$EXPECTED_API_URL"
}

validate_apk() {
  local apk="$1"
  local verify_dir bundle_file dump_file badging manifest_dump permissions_dump
  local manifest_version_code manifest_version_name build_tools_dir aapt2 apksigner permission
  verify_dir="$(mktemp -d "${TMPDIR%/}/linguaflow-android-verify.XXXXXX")"
  trap '[[ -n "${verify_dir:-}" && "$verify_dir" == "${TMPDIR%/}"/linguaflow-android-verify.* ]] && rm -rf "$verify_dir"' RETURN

  build_tools_dir="$(find "$ANDROID_SDK_ROOT/build-tools" -mindepth 1 -maxdepth 1 -type d -print | sort | tail -n 1)"
  [[ -n "$build_tools_dir" ]] || fail "Android SDK build-tools not found."
  aapt2="$build_tools_dir/aapt2"
  apksigner="$build_tools_dir/apksigner"
  [[ -x "$aapt2" ]] || fail "aapt2 not found: $aapt2"
  [[ -x "$apksigner" ]] || fail "apksigner not found: $apksigner"

  badging="$($aapt2 dump badging "$apk")"
  grep -F "package: name='$EXPECTED_PACKAGE_ID'" <<<"$badging" >/dev/null || fail "Unexpected package ID in APK manifest."
  manifest_version_code="$(sed -n "s/^package:.*versionCode='\([^']*\)'.*/\1/p" <<<"$badging")"
  manifest_version_name="$(sed -n "s/^package:.*versionName='\([^']*\)'.*/\1/p" <<<"$badging")"
  [[ -n "$manifest_version_code" ]] || fail "Version code not found in APK manifest."
  [[ -n "$manifest_version_name" ]] || fail "Version name not found in APK manifest."
  ! grep -F 'application-debuggable' <<<"$badging" >/dev/null || fail "APK is debuggable."

  permissions_dump="$($aapt2 dump permissions "$apk")"
  for permission in \
    android.permission.READ_MEDIA_IMAGES \
    android.permission.READ_MEDIA_VIDEO \
    android.permission.READ_MEDIA_VISUAL_USER_SELECTED \
    android.permission.READ_EXTERNAL_STORAGE \
    android.permission.WRITE_EXTERNAL_STORAGE; do
    ! grep -F "$permission" <<<"$permissions_dump" >/dev/null || fail "APK contains forbidden media permission: $permission"
  done

  "$apksigner" verify --verbose "$apk" >/dev/null || fail "APK signature verification failed."
  bundle_file="$verify_dir/index.android.bundle"
  unzip -p "$apk" assets/index.android.bundle > "$bundle_file" || fail "index.android.bundle not found in APK."
  [[ -s "$bundle_file" ]] || fail "index.android.bundle is empty in APK."
  dump_file="$verify_dir/hermes-bytecode.txt"
  "$(resolve_hermesc)" -b -dump-bytecode "$bundle_file" > "$dump_file"
  grep -F "$EXPECTED_API_URL" "$dump_file" >/dev/null || fail "Production API URL is not embedded in the JS bundle."
  grep -F 'https://yueyantech.com' "$dump_file" >/dev/null || fail "China update URL is not embedded in the JS bundle."

  manifest_dump="$verify_dir/manifest.txt"
  "$aapt2" dump xmltree --file AndroidManifest.xml "$apk" > "$manifest_dump"
  grep -F "$EXPECTED_CHANNEL" "$manifest_dump" >/dev/null || fail "Production Expo Updates channel is not embedded in APK manifest."

  node "$SCRIPT_DIR/validate-android-native-modules.mjs" "$apk" "$EXPECTED_PACKAGE_ID"

  PACKAGE_VERSION_CODE="$manifest_version_code"
  PACKAGE_VERSION_NAME="$manifest_version_name"
  log "APK validation passed"
  printf 'App: %s\nVersion: %s\nVersion code: %s\nChannel: %s\nAPI: %s\nPayment: Alipay\n' \
    "$EXPECTED_PACKAGE_ID" "$PACKAGE_VERSION_NAME" "$PACKAGE_VERSION_CODE" "$EXPECTED_CHANNEL" "$EXPECTED_API_URL"
}

preflight
if $CHECK_ONLY; then
  exit 0
fi
if [[ -n "$VALIDATE_ONLY_PACKAGE" ]]; then
  [[ "$ANDROID_TARGET" == "china" ]] || fail "--validate is only supported by the China APK workflow."
  [[ -s "$VALIDATE_ONLY_PACKAGE" ]] || fail "APK not found: $VALIDATE_ONLY_PACKAGE"
  validate_apk "$VALIDATE_ONLY_PACKAGE"
  shasum -a 256 "$VALIDATE_ONLY_PACKAGE"
  printf 'APK: %s\n' "$VALIDATE_ONLY_PACKAGE"
  exit 0
fi
if [[ -n "$SUBMIT_ONLY_PACKAGE" ]]; then
  [[ "$ANDROID_TARGET" == "google" ]] || fail "--submit-only is only supported by the Google workflow."
  [[ -s "$SUBMIT_ONLY_PACKAGE" ]] || fail "AAB not found: $SUBMIT_ONLY_PACKAGE"
  validate_aab "$SUBMIT_ONLY_PACKAGE"
  [[ -n "$ACCEPTANCE_FILE" ]] || fail "--acceptance is required before upload."
  node "$SCRIPT_DIR/release-prepublish-gate.mjs" check \
    --acceptance "$ACCEPTANCE_FILE" --artifact "$SUBMIT_ONLY_PACKAGE" --distribution google-android \
    --version "$AAB_VERSION_NAME" --build "$AAB_VERSION_CODE"
  shasum -a 256 "$SUBMIT_ONLY_PACKAGE"
  log "Submitting validated AAB to Google Play internal testing"
  (
    cd "$MOBILE_DIR"
    npx --yes eas-cli submit \
      --platform android \
      --profile "$SUBMIT_PROFILE" \
      --path "$SUBMIT_ONLY_PACKAGE" \
      --non-interactive \
      --verbose \
      --wait
  )
  log "Google Play upload completed"
  printf 'AAB: %s\nGoogle Play Console: https://play.google.com/console/\n' "$SUBMIT_ONLY_PACKAGE"
  exit 0
fi
if [[ -n "$DIRECT_SUBMIT_ONLY_PACKAGE" ]]; then
  [[ "$ANDROID_TARGET" == "google" ]] || fail "--submit-direct is only supported by the Google workflow."
  [[ -n "${GOOGLE_PLAY_SERVICE_ACCOUNT_JSON:-}" ]] || fail "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not configured."
  [[ -f "$GOOGLE_PLAY_SERVICE_ACCOUNT_JSON" ]] || fail "Google Play service account key not found: $GOOGLE_PLAY_SERVICE_ACCOUNT_JSON"
  [[ -s "$DIRECT_SUBMIT_ONLY_PACKAGE" ]] || fail "AAB not found: $DIRECT_SUBMIT_ONLY_PACKAGE"
  validate_aab "$DIRECT_SUBMIT_ONLY_PACKAGE"
  [[ -n "$ACCEPTANCE_FILE" ]] || fail "--acceptance is required before upload."
  node "$SCRIPT_DIR/release-prepublish-gate.mjs" check \
    --acceptance "$ACCEPTANCE_FILE" --artifact "$DIRECT_SUBMIT_ONLY_PACKAGE" --distribution google-android \
    --version "$AAB_VERSION_NAME" --build "$AAB_VERSION_CODE"
  shasum -a 256 "$DIRECT_SUBMIT_ONLY_PACKAGE"
  log "Submitting validated AAB directly to Google Play internal testing"
  node "$SCRIPT_DIR/google-play-direct-submit.mjs" \
    "$GOOGLE_PLAY_SERVICE_ACCOUNT_JSON" \
    "$EXPECTED_PACKAGE_ID" \
    "$EXPECTED_PLAY_TRACK" \
    "$DIRECT_SUBMIT_ONLY_PACKAGE" \
    "$AAB_VERSION_CODE"
  log "Google Play direct upload completed"
  printf 'AAB: %s\nGoogle Play Console: https://play.google.com/console/\n' "$DIRECT_SUBMIT_ONLY_PACKAGE"
  exit 0
fi

log "Current source status"
git -C "$REPO_ROOT" status --short || true
[[ -z "$(git -C "$REPO_ROOT" status --porcelain -- apps/mobile)" ]] || \
  fail "Mobile source must be committed before a release build so the artifact can be bound to one source commit."

if ! $ASSUME_YES; then
  printf '\nThis will allocate a new Android version code, build locally, and validate the %s without uploading it.\n' "$PACKAGE_KIND"
  read -r -p 'Continue? [y/N] ' answer
  case "$answer" in
    y|Y|yes|YES) ;;
    *) fail "Cancelled." ;;
  esac
fi

log "Running required Android simulator smoke gate"
bash "$SCRIPT_DIR/simulator-smoke.sh" --run --target android

mkdir -p "$ARTIFACT_DIR"
timestamp="$(date '+%Y%m%d-%H%M%S')"
raw_package="$ARTIFACT_DIR/OIO-pending-$timestamp.$PACKAGE_EXTENSION"

log "Building $ANDROID_TARGET production $PACKAGE_KIND locally with EAS"
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
  if [[ "$ANDROID_TARGET" == "china" ]]; then
    mkdir -p "$GRADLE_USER_HOME/init.d"
    cp "$SCRIPT_DIR/gradle-repositories.init.gradle" "$GRADLE_USER_HOME/init.d/linguaflow-repositories.gradle"
  fi
  npx expo prebuild --platform android --no-install
  npx --yes eas-cli build \
    --platform android \
    --profile "$BUILD_PROFILE" \
    --local \
    --non-interactive \
    --output "$raw_package"
)

[[ -s "$raw_package" ]] || fail "EAS build did not produce a $PACKAGE_KIND."
if [[ "$ANDROID_TARGET" == "china" ]]; then
  validate_apk "$raw_package"
else
  validate_aab "$raw_package"
  PACKAGE_VERSION_NAME="$AAB_VERSION_NAME"
  PACKAGE_VERSION_CODE="$AAB_VERSION_CODE"
fi

final_package="$ARTIFACT_DIR/OIO-$PACKAGE_VERSION_NAME-$PACKAGE_VERSION_CODE.$PACKAGE_EXTENSION"
if [[ -e "$final_package" ]]; then
  final_package="$ARTIFACT_DIR/OIO-$PACKAGE_VERSION_NAME-$PACKAGE_VERSION_CODE-$timestamp.$PACKAGE_EXTENSION"
fi
mv "$raw_package" "$final_package"
shasum -a 256 "$final_package"

log "Candidate build completed; upload is intentionally blocked until artifact-bound acceptance passes"
printf '%s: %s\nNext: create and complete a release acceptance record, then use --submit-only/--submit-direct with --acceptance.\n' \
  "$PACKAGE_KIND" "$final_package"
